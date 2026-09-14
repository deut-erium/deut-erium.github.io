#!/usr/bin/env ruby
# frozen_string_literal: true

# Offline fixtures only. Run with the pinned Ruby and BUNDLE_PATH (see notes).
require "fileutils"
require "json"
require "tmpdir"
require "yaml"
require "cgi"
require "minitest/autorun"
require "bundler/setup"
require "jekyll"
require "jekyll-seo-tag"
require_relative "../_plugins/publications"
require_relative "../_plugins/asset_version"
require_relative "../_plugins/article_contents"

# Emulate metadata/hiding supplied by an earlier generator, not front matter.
class PublicationFixtureMetadata < Jekyll::Generator
  priority :low

  def generate(site)
    return unless site.config["publication_fixture_metadata"]

    site.posts.docs.each do |post|
      post.data["layout"] = "article"
      post.data["hidden"] = true if post.data["title"] == "Hide after reading"
    end
  end
end

class PublicationsTest < Minitest::Test
  Publications = DeuteriumSite::Publications
  ROOT = File.expand_path("..", __dir__)
  SCRATCH = File.join(ROOT, "agent_out/publications/tests")
  HOST = "https://fixture.invalid:8443"
  KEYS = %w[url pdf_url bib_url canonical_url title author date description publication_date date_note].sort.freeze
  BODY = "## Body sentinel\n\nKeep **this article** unchanged.\n\n    puts '<body & code>'\n"

  def setup
    FileUtils.mkdir_p(SCRATCH)
    @source = Dir.mktmpdir("jekyll-", SCRATCH)
    @dest = File.join(@source, "agent_out/site")
    %w[article writeup].each { |name| write("_layouts/#{name}.html", File.read(File.join(ROOT, "_layouts/#{name}.html"))) }
    %w[head publication-actions primitive].each { |name| write("_includes/#{name}.html", File.read(File.join(ROOT, "_includes/#{name}.html"))) }
    # Unrelated QR and theme behavior is outside these fixtures.
    %w[qr-share theme-bootstrap].each { |name| write("_includes/#{name}.html", "") }
    write("_layouts/base.html", "---\n---\n<!doctype html><html><head>{% include head.html %}</head><body>{{ content }}</body></html>")
    write("_layouts/locked.html", "---\nlayout: base\n---\n{{ content }}{% include publication-actions.html %}")
  end

  def teardown
    FileUtils.remove_entry(@source)
  end

  def write(path, bytes)
    full = File.join(@source, path)
    FileUtils.mkdir_p(File.dirname(full))
    File.write(full, bytes)
  end

  def post(slug = "one", url = "/one.html", **data)
    values = { "layout" => "article", "title" => "Same title", "permalink" => url,
               "description" => "A public article.", "date" => "2024-02-03T12:30:00+00:00" }
    data.each { |key, value| values[key.to_s] = value }
    write("_posts/2024-02-03-#{slug}.md", values.to_yaml + "---\n" + BODY)
  end

  def site(**overrides)
    Jekyll::Site.new(Jekyll.configuration({
      "source" => @source, "destination" => @dest, "config" => [],
      "plugins" => [], "quiet" => true, "disable_disk_cache" => true,
      "future" => true, "timezone" => "UTC", "exclude" => ["agent_out"], "url" => HOST, "baseurl" => "",
      "author" => { "name" => "Fixture Author" }, "title" => "Fixture blog",
      "repository" => "example/fixture", "repository_tree" => "main",
    }.merge(overrides.transform_keys(&:to_s))))
  end

  def build(**overrides)
    site(**overrides).tap(&:process)
  end

  def output(route)
    File.read(File.join(@dest, Jekyll::URL.unescape_path(route).delete_prefix("/")))
  end

  def manifest
    JSON.parse(output("/publications.json"))
  end

  def panel(html)
    html[/<details class="publication-cite".*?<\/details>/m].to_s
  end

  def body(html)
    html[/<article id="article-body".*?<\/article>/m]
  end

  def invalid(pattern = nil)
    error = assert_raises(Publications::InvalidPublication) { yield }
    assert_match(pattern, error.message) if pattern
    error
  end

  def test_ordinary_and_pdf_builds_at_root_and_baseurl
    post
    post("two", "/nested/two/", layout: "writeup")
    bodies = {}
    ["", "/preview"].each do |baseurl|
      [nil, false, "true", 1, true].each do |enabled|
        s = build(baseurl: baseurl, academic_pdfs: enabled)
        assert_equal %w[baseurl posts version], manifest.keys.sort
        assert_equal 1, manifest.fetch("version")
        assert_equal baseurl, manifest.fetch("baseurl")
        rows = manifest.fetch("posts")
        assert_equal ["/nested/two/", "/one.html"], rows.map { |row| row.fetch("url") }
        rows.each do |row|
          assert_equal KEYS, row.keys.sort
          assert_equal HOST + baseurl + row.fetch("url"), row.fetch("canonical_url")
          assert_equal "Fixture Author", row.fetch("author")
          assert_equal "2024-02-03", row.fetch("date")
          assert_equal "A public article.", row.fetch("description")
          stem = row.fetch("url").sub(/(?:\.html|\/)\z/, "")
          assert_equal stem + ".bib", row.fetch("bib_url")
          assert_equal stem + ".pdf", row.fetch("pdf_url")
          route = row.fetch("url")
          html = output(route.end_with?("/") ? route + "index.html" : route)
          cite = panel(html)
          assert_includes cite, "<summary>Cite</summary>"
          assert_includes cite, "download>Download BibTeX</a>"
          assert_includes cite, %(href="#{baseurl}#{stem}.bib")
          assert_includes cite, "<textarea readonly"
          refute_match(/\bid=|<script\b|\bon\w+=/, cite)
          assert_equal 1, html.scan(/<summary>Cite<\/summary>/).size
          textarea = cite[/<textarea[^>]*>(.*?)<\/textarea>/m, 1]
          assert_equal output(stem + ".bib"), CGI.unescapeHTML(textarea)
          assert_includes html, 'name="citation_title" content="Same title"'
          assert_includes html, 'name="citation_publication_date" content="2024-02-03"'
          assert_includes html, %(name="citation_abstract_html_url" content="#{HOST}#{baseurl}#{route}")
          assert_equal enabled == true, html.include?('class="publication-pdf"')
          assert_equal enabled == true, html.include?('rel="alternate" type="application/pdf"')
          assert_equal enabled == true, html.include?('name="citation_pdf_url"')
          if enabled == true
            assert_includes html, %(name="citation_pdf_url" content="#{HOST}#{baseurl}#{stem}.pdf")
            assert_includes html, %(href="#{baseurl}#{stem}.pdf")
          end
          refute File.exist?(File.join(@dest, stem + ".pdf")), "Jekyll must not emit fake PDFs"
          bodies[route] ||= body(html)
          assert_equal bodies[route], body(html), "citation mode changed article body"
          assert_includes body(html), "Keep <strong>this article</strong> unchanged."
        end
        assert_equal 3, s.static_files.grep(Publications::Artifact).size
      end
    end
  end

  def test_only_public_posts_get_metadata_bib_or_pdf_links
    post("public", "/public.html")
    exclusions = {
      "hidden" => { hidden: true }, "locked" => { layout: "locked" },
      "unlisted" => { unlisted: true }, "noindex" => { noindex: true },
      "sitemap" => { sitemap: false }, "redirect" => { redirect_to: "/public.html" },
      "redirect-flag" => { redirect: true }, "locked-flag" => { locked: true },
      "wrong-layout" => { layout: "page" }, "redirect-layout" => { layout: "redirect" },
      "unpublished" => { published: false }, "string-hidden" => { hidden: "true" },
    }
    forged = { "bibtex" => "PRIVATE SENTINEL", "bib_url" => "/private.bib", "pdf_url" => "/private.pdf" }
    exclusions.each { |slug, data| post(slug, "/#{slug}.html", **data, publication: forged) }
    page = { "layout" => "article", "title" => "Private standalone sentinel", "publication" => forged }
    write("standalone.html", page.to_yaml + "---\nPage body.")
    write("_notes/other.md", page.merge("permalink" => "/other.html").to_yaml + "---\nOther collection.")
    [false, true].each do |enabled|
      s = build(academic_pdfs: enabled, unpublished: true, collections: { "notes" => { "output" => true } })
      assert_equal ["/public.html"], manifest.fetch("posts").map { |row| row.fetch("url") }
      assert_equal ["public.bib"], Dir.glob(File.join(@dest, "**/*.bib")).map { |path| File.basename(path) }
      refute_includes output("/publications.json"), "PRIVATE SENTINEL"
      (exclusions.keys + %w[standalone other]).each do |slug|
        html = output("/#{slug}.html")
        refute_includes html, 'class="publication-cite"', slug
        refute_includes html, 'class="publication-pdf"', slug
        refute_includes html, 'name="citation_', slug
        refute_includes html, 'type="application/pdf"', slug
        refute File.exist?(File.join(@dest, "#{slug}.bib"))
      end
      assert_nil s.pages.find { |item| item.name == "standalone.html" }.data["publication"]
    end
  end

  def test_false_visibility_flags_and_redirect_alias_remain_public
    post(hidden: false, unlisted: false, noindex: false, locked: false, redirect: false,
         redirect_to: false, sitemap: true, redirect_from: "/old.html")
    build
    assert_equal 1, manifest.fetch("posts").size
  end

  def test_lowest_priority_and_stale_artifact_cleanup
    assert_equal :lowest, Publications::Generator.priority
    post("public", "/public.html", layout: "page")
    post("hidden", "/hidden.html", title: "Hide after reading")
    build
    assert File.exist?(File.join(@dest, "hidden.bib"))
    build(publication_fixture_metadata: true)
    assert_equal ["/public.html"], manifest.fetch("posts").map { |row| row.fetch("url") }
    refute File.exist?(File.join(@dest, "hidden.bib"))
  end

  def test_latex_escaping_stable_keys_and_literal_downloads
    input = "\\ { } % & _ # $ ~ ^"
    expected = '\\textbackslash{} \\textbraceleft{} \\textbraceright{} \\% \\& \\_ \\# \\$ \\textasciitilde{} \\textasciicircum{}'
    assert_equal expected, Publications.latex(input)
    assert_equal '\\textbraceleft{}', Publications.latex("{")
    assert_equal '\\textbraceright{}', Publications.latex("}")
    title = %(Unmatched { #{input} </textarea><script>alert("x")</script> {{ site.title }})
    post(title: title, author: [{ "name" => "A & B" }, "C_D"], description: "<b>Not markup</b>")
    post("same", "/same.html", title: title)
    build(academic_pdfs: true)
    bib = output("/one.bib")
    assert_match(/\A@misc\{post-[0-9a-f]{64},\n/, bib)
    assert_includes bib, "title = {{#{Publications.latex(title)}}}"
    assert_includes bib, 'author = {A \\& B and C\\_D}'
    assert_equal "A & B and C_D", manifest.fetch("posts").find { |row| row["url"] == "/one.html" }.fetch("author")
    cite = panel(output("/one.html"))
    refute_includes cite, "<script>"
    refute_includes cite, 'alert("x")'
    assert_equal 1, cite.scan("</textarea>").size
    assert_equal bib, CGI.unescapeHTML(cite[/<textarea[^>]*>(.*?)<\/textarea>/m, 1])
    citation_title = output("/one.html")[/<meta name="citation_title" content="([^"]*)">/, 1]
    assert_equal title, CGI.unescapeHTML(citation_title)
    key = bib.lines.first
    refute_equal key, output("/same.bib").lines.first
    post(title: "Renamed", author: "New Author", date: "2025-01-01")
    build(baseurl: "/preview")
    assert_equal key, output("/one.bib").lines.first
  end

  def test_challenge_event_date_is_not_claimed_as_article_publication
    %w[article writeup].each do |layout|
      post(layout: layout, challenge_id: "event-challenge")
      build
      assert_equal "2024-02-03", manifest.fetch("posts").first.fetch("date")
      html = output("/one.html")
      assert_includes html, "<dt>Event began</dt>"
      refute_includes html, 'itemprop="datePublished"'
      refute_includes html, 'name="citation_publication_date"'
      refute_includes html, 'property="article:published_time"'
      refute_includes html, 'property="article:modified_time"'
      schema = JSON.parse(html[/<script type="application\/ld\+json">(.*?)<\/script>/m, 1])
      refute schema.key?("datePublished")
      refute schema.key?("dateModified")
      assert_includes panel(html), "article publication date not recorded."
      refute_match(/^  (?:year|date) =/, output("/one.bib"))
      assert_includes output("/one.bib"), "Challenge event began 2024-02-03"
      %w[publication_date published_at].each do |field|
        post(layout: layout, challenge_id: "event-challenge", **{ field => "2026-05-06" })
        build
        assert_equal "2026-05-06", manifest.fetch("posts").first.fetch("date")
        html = output("/one.html")
        assert_includes html, 'name="citation_publication_date" content="2026-05-06"'
        assert_includes html, '<dt>Published</dt>'
        assert_includes html, '>2026-05-06</time>'
        assert_includes html, 'property="article:published_time" content="2026-05-06"'
        schema = JSON.parse(html[/<script type="application\/ld\+json">(.*?)<\/script>/m, 1])
        assert_equal "2026-05-06", schema.fetch("datePublished")
        assert_equal "2026-05-06", schema.fetch("dateModified")
        assert_includes output("/one.bib"), "year = {2026}"
        refute_includes output("/one.bib"), "event began"
      end
    end
    ["not-a-date", "2024-02-31", "2024-1-1", "2024-01-01T99:99:99", Time.utc(10000)].each do |value|
      invalid(/date/) { Publications.iso_date(value) }
    end
    post(challenge_id: "event-challenge", last_modified_at: "2026-07-08")
    build
    html = output("/one.html")
    refute_includes html, 'property="article:published_time"'
    assert_includes html, 'property="article:modified_time" content="2026-07-08T00:00:00+00:00"'
    schema = JSON.parse(html[/<script type="application\/ld\+json">(.*?)<\/script>/m, 1])
    refute schema.key?("datePublished")
    assert_equal "2026-07-08T00:00:00+00:00", schema.fetch("dateModified")
  end

  def test_siblings_and_encoded_routes
    { "/x.html" => "/x", "/x/" => "/x", "/x" => "/x", "/x.txt" => "/x.txt",
      "/a%20b.html" => "/a%20b", "/a&b.html" => "/a&b", "/%C3%A9/" => "/%C3%A9" }.each do |url, stem|
      assert_equal stem + ".bib", Publications.sibling(url, ".bib")
      assert_equal stem + ".pdf", Publications.sibling(url, ".pdf")
    end
    post("encoded", "/a%20b&c_d.html")
    build(baseurl: "/preview", academic_pdfs: true)
    assert File.file?(File.join(@dest, "a b&c_d.bib"))
    html = output("/a%20b&c_d.html")
    assert_includes panel(html), 'href="/preview/a%20b&amp;c_d.bib"'
    assert_includes html, 'href="/preview/a%20b&amp;c_d.pdf"'
    assert_includes output("/a%20b&c_d.bib"), 'a\\%20b\\&c\\_d.html'
  end

  def test_bad_urls_and_config_are_rejected_before_writing
    bad = [nil, "", "/", "x.html", "https://example.invalid/x.html", "//example.invalid/x.html",
           "/a//b.html", "/a/../x.html", "/./x.html", "/x.html?q=1", "/x.html#fragment",
           "/a\\x.html", "/a b.html", "/a\nb.html", '/a"b.html', "/x%", "/x%zz.html",
           "/%2e%2e/x.html", "/x%2fy.html", "/x%5cy.html", "/%252e%252e/x.html",
           "/x%00.html", "/x%0a.html", "/x%ff.html", "/x%3f.html", "/x%23.html"]
    bad.each { |url| invalid { Publications.sibling(url, ".bib") } }
    # Validate explicit permalinks before Jekyll's sanitization hides traversal.
    ["/a/../x.html", "//host/x.html", "relative.html"].each do |url|
      post("one", url)
      invalid { build }
      refute File.exist?(File.join(@dest, "publications.json"))
    end
    ["", "ftp://example.invalid", "https://u:p@example.invalid", "https://example.invalid/path",
     "https://example.invalid?q=1", "https://example.invalid#x", "//example.invalid"].each do |url|
      invalid(/origin/) { Publications.origin(site(url: url)) }
    end
    ["preview", "//preview", "/a/../b", "/%2e%2e", "/preview?q=1"].each do |baseurl|
      invalid { Publications.baseurl(site(baseurl: baseurl)) }
    end
    assert_equal "/preview", Publications.baseurl(site(baseurl: "/preview/"))
    assert_equal HOST, Publications.origin(site(url: HOST + "/"))
  end

  def test_static_and_dynamic_collisions_include_reserved_pdfs_and_manifest
    post
    %w[one.bib one.pdf publications.json].each do |path|
      ["Static bytes", "---\nlayout: null\n---\nDynamic bytes"].each do |bytes|
        [false, true].each do |enabled|
          write(path, bytes)
          invalid(/collision/) { build(academic_pdfs: enabled) }
          refute File.exist?(File.join(@dest, path)), "wrote output before rejecting #{path}"
          File.unlink(File.join(@source, path))
        end
      end
    end
  end

  def test_alias_case_and_file_directory_collisions
    post
    ["/one/", "/ONE.html", "/%6fne.html"].each do |url|
      post("alias", url)
      invalid(/collision/) { build }
    end
    File.unlink(File.join(@source, "_posts/2024-02-03-alias.md"))
    %w[one.pdf one.bib].each do |stem|
      write("#{stem}/child.txt", "File under reserved path")
      invalid(/collision/) { build }
      FileUtils.rm_rf(File.join(@source, stem))
    end
    post("one", "/parent/one.html")
    write("parent", "Static parent blocks directory")
    invalid(/collision/) { build }
  end

  def test_late_dynamic_collisions_and_visibility_changes
    post
    %i[pre_render post_render].each do |hook|
      %w[bib pdf].each do |extension|
        s = site
        s.read
        s.generate
        s.pages << Jekyll::PageWithoutAFile.new(s, @source, "", "one.#{extension}")
        invalid(/collision/) { Jekyll::Hooks.trigger(:site, hook, s, {}) }
      end
    end
    s = site
    s.read
    s.generate
    clone = Jekyll::PageWithoutAFile.new(s, @source, "", "clone.html")
    clone.data["layout"] = "article"
    clone.data["publication"] = s.posts.docs.first.data["publication"]
    s.pages << clone
    Jekyll::Hooks.trigger(:site, :pre_render, s, {})
    assert_nil clone.data["publication"]
    s.posts.docs.first.data["hidden"] = true
    invalid(/changed after generation/) { Jekyll::Hooks.trigger(:site, :pre_render, s, {}) }
  end

  def test_other_collection_output_and_destination_symlinks_collide
    post
    write("_notes/collision.md", { "permalink" => "/one.pdf/" }.to_yaml + "---\nOther collection.")
    invalid(/collision/) { build(collections: { "notes" => { "output" => true } }) }
    FileUtils.rm_rf(File.join(@source, "_notes"))
    FileUtils.mkdir_p(@dest)
    target = File.join(@source, "agent_out/do-not-overwrite")
    File.write(target, "Sentinel")
    File.symlink(target, File.join(@dest, "one.bib"))
    invalid(/symlink/) { build }
    assert_equal "Sentinel", File.read(target)
  end

  def test_empty_manifest_is_public_and_repeated_generation_is_deterministic
    build
    assert_equal({ "version" => 1, "baseurl" => "", "posts" => [] }, manifest)
    post
    s = build
    bytes = output("/publications.json")
    s.generators.find { |generator| generator.is_a?(Publications::Generator) }.generate(s)
    s.write
    assert_equal bytes, output("/publications.json")
    assert_equal 2, s.static_files.grep(Publications::Artifact).size
  end
end
