#!/usr/bin/env ruby
# frozen_string_literal: true

# Offline fixtures only. Never load the release config, original practice
# bodies, private answers, or upstream challenge files.
require "fileutils"
require "json"
require "tmpdir"
require "digest"
require "yaml"
# Minitest is bundled with the pinned Ruby runtime, not a site dependency.
require "minitest/autorun"
require "bundler/setup"
require "jekyll"
require "open3"
require_relative "../_plugins/section_metadata"
require_relative "../_plugins/challenges_index"

class ChallengePostsTest < Minitest::Test
  ROOT = File.expand_path("..", __dir__)
  SCRATCH = File.join(ROOT, "agent_out/challenge-posts/quiz-regressions")
  CATALOG = JSON.parse(File.read(File.join(ROOT, "_data/authored_challenges.json")))
  INCLUDE = File.read(File.join(ROOT, "_includes/challenge.html"))
  PRACTICE_IDS = %w[assignment000001-0 assignment000001-1 assignment000001-2
                    assignment000002-0 assignment000003-0 assignment000004-0 assignment000005-0].freeze
  HASH = Digest::SHA256.hexdigest("flag{synthetic-test-only}" + "a" * 32)
  SHELL = <<~HTML.freeze
    ---
    ---
    <html><head><title>{{ page.title | escape }} / Fixture</title>
    <link rel="canonical" href="{{ page.url | absolute_url }}"></head>
    <body><article data-section="{{ page.section }}" data-layout="{{ page.layout }}">{{ content }}</article></body></html>
  HTML

  def setup
    FileUtils.mkdir_p(SCRATCH)
    @source = Dir.mktmpdir("ruby-", SCRATCH)
    @dest = File.join(@source, "agent_out/site")
    write("_includes/challenge.html", INCLUDE)
    %w[article writeup locked].each { |name| write("_layouts/#{name}.html", SHELL) }
    FileUtils.mkdir_p(File.join(@source, "_plugins"))
  end

  def teardown
    FileUtils.remove_entry(@source) if @source && File.directory?(@source)
  end

  def write(path, bytes, root: @source)
    full = File.join(root, path)
    FileUtils.mkdir_p(File.dirname(full))
    File.write(full, bytes)
  end

  def site(baseurl = "")
    Jekyll::Site.new(Jekyll.configuration(
      "source" => @source, "destination" => @dest, "config" => [],
      "plugins" => [], "plugins_dir" => "_plugins", "quiet" => true,
      "disable_disk_cache" => true, "future" => true, "url" => "https://fixture.invalid",
      "baseurl" => baseurl, "exclude" => ["agent_out"], "permalink" => "/:year/:month/:day/:title.html"
    ))
  end

  def post(path, metadata, body = "Synthetic fixture body.")
    write(path, "---\n#{metadata.to_yaml.sub(/\A---\s*\n/, '')}---\n#{body}\n")
  end

  def include_html(**attributes)
    Liquid::Template.parse(INCLUDE, error_mode: :strict).render!("include" => attributes.transform_keys(&:to_s))
  end

  def form(id, hash: HASH, salt: nil, **attributes)
    include_html(id: id, hash: hash, **(salt.nil? ? {} : { salt: salt }), **attributes)
  end

  # Parse fixtures with Python's standard HTMLParser. This is not an HTML5
  # browser model; Chromium checks separately cover parsing and layout.
  HTML_PARSER = <<~'PY'.freeze
    import json, sys
    from html.parser import HTMLParser
    class Fragment(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.root={'tag':None,'attrs':{},'children':[]}
            self.stack=[self.root]
        def handle_starttag(self, tag, attrs):
            node={'tag':tag,'attrs':dict(attrs),'children':[]}
            self.stack[-1]['children'].append(node)
            if tag not in {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}:
                self.stack.append(node)
        def handle_endtag(self, tag):
            for i in range(len(self.stack)-1,0,-1):
                if self.stack[i]['tag']==tag:
                    del self.stack[i:]
                    break
        def handle_data(self, data):
            self.stack[-1]['children'].append(data)
    parser=Fragment()
    parser.feed(sys.stdin.read())
    parser.close()
    print(json.dumps(parser.root))
  PY

  class FragmentNode
    attr_reader :tag, :children
    def initialize(node, html = nil)
      @tag, @attrs, @html = node.fetch('tag'), node.fetch('attrs'), html
      @children = node.fetch('children').map { |c| c.is_a?(Hash) ? FragmentNode.new(c) : c }
    end
    def [](key) = @attrs[key]
    def key?(key) = @attrs.key?(key)
    def text = @children.map { |c| c.is_a?(FragmentNode) ? c.text : c }.join
    def to_html = @html || raise('raw fixture HTML is available only at the root')
    def descendants
      @children.grep(FragmentNode).flat_map { |c| [c] + c.descendants }
    end
    def css(selector)
      return descendants.select { |n| n['id'] == selector.delete_prefix('#') } if selector.start_with?('#')
      m = /\A([a-z][a-z0-9]*)?(?:\[([a-z0-9-]+)(?:="([^"]*)")?\])?\z/.match(selector)
      raise "unsupported fixture selector: #{selector}" unless m && (m[1] || m[2])
      descendants.select { |n| (!m[1] || n.tag == m[1]) && (!m[2] || (n.key?(m[2]) && (!m[3] || n[m[2]] == m[3]))) }
    end
    def at_css(selector) = css(selector).first
  end

  def parse(html)
    output, error, status = Open3.capture3('python3', '-c', HTML_PARSER, stdin_data: html)
    raise "fixture parser failed: #{error}" unless status.success?
    FragmentNode.new(JSON.parse(output), html)
  end

  # Execute the actual post_write hook against synthetic rendered output.
  # Real PageWithoutAFile destinations exercise unlisted output-path matching.
  def index(pages, unlisted: [], baseurl: "")
    s = site(baseurl)
    pages.each { |path, html| write(path, html, root: @dest) }
    unlisted.each do |path|
      p = Jekyll::PageWithoutAFile.new(s, @source, File.dirname(path), File.basename(path))
      p.data["unlisted"] = true
      s.pages << p
    end
    write("scoreboard/index.html", '<script id="scoreboard-known" type="application/json">[]</script>', root: @dest)
    Jekyll::Hooks.trigger(:site, :post_write, s)
    rows = JSON.parse(File.read(File.join(@dest, "challenges.json")))
    board = parse(File.read(File.join(@dest, "scoreboard/index.html")))
    assert_equal rows, JSON.parse(board.at_css("#scoreboard-known").text), "scoreboard/index differs from challenges.json"
    rows
  end

  ["", "/preview"].each do |baseurl|
    define_method("test_registered_posts_keep_canonical_routes_#{baseurl.empty? ? 'root' : 'baseurl'}") do
      entries = CATALOG.fetch("entries")
      assert_equal 18, entries.size
      entries.each do |entry|
        # Read only the public front matter; synthetic bodies keep this test
        # independent of prose, downloads, and actual event answers.
        source = File.read(File.join(ROOT, entry.fetch("post_path")), encoding: "UTF-8")
        header = source.match(/\A---\n(.*?)\n---\n/m)
        refute_nil header, entry.fetch("post_path")
        data = YAML.safe_load(header[1])
        assert_equal entry.fetch("url"), data.fetch("permalink")
        assert_equal entry.fetch("id"), data.fetch("challenge_id")
        post(entry.fetch("post_path"), data)
      end
      s = site(baseurl)
      s.process # An 18-post fixture, not a release build.
      assert_equal 18, s.posts.docs.size
      by_id = s.posts.docs.to_h { |doc| [doc.data.fetch("challenge_id"), doc] }
      entries.each do |entry|
        doc = by_id.fetch(entry.fetch("id"))
        assert_equal "tutorials", doc.data["section"]
        assert_equal "article", doc.data["layout"]
        assert_equal entry.fetch("url"), doc.url
        assert_equal entry.fetch("post_path"), doc.data["source_path"]
        expected = File.join(@dest, entry.fetch("url").delete_prefix("/"), "index.html")
        assert_equal expected, doc.destination(@dest)
        html = parse(File.read(expected))
        assert_equal "https://fixture.invalid#{baseurl}#{entry.fetch('url')}", html.at_css('link[rel="canonical"]')["href"]
        assert_equal "tutorials", html.at_css("article")["data-section"]
        assert_equal "article", html.at_css("article")["data-layout"]
      end
    end
  end

  NORMAL_POSTS = {
    "tutorial" => ["_posts/ctf-tutorials/2021-07-25-normal.md", "tutorials", "article", "/ctf-tutorials/2021/07/25/normal.html"],
    "short_year" => ["/_posts/ctf-tutorials/nested/21-07-25-Old Title.markdown", "tutorials", "article", "/ctf-tutorials/2021/07/25/Old-Title.html"],
    "rambling" => ["_posts/ramblings/2020-02-03-normal.md", "ramblings", "article", "/ramblings/2020/02/03/normal.html"],
    "writeup" => ["_posts/WriteUps/2021/event/2021-07-25-normal.md", "writeups", "writeup", "/WriteUps/2021/event/2021-07-25-normal.html"],
    "root" => ["_posts/2021-07-25-normal.md", "root", "article", "/original-root.html"]
  }.freeze

  NORMAL_POSTS.each do |name, (path, section, layout, route)|
    [false, true].each do |locked|
      define_method("test_#{name}_#{locked ? 'locked' : 'ordinary'}_metadata") do
        data = { "section" => "wrong-section", "layout" => locked ? "locked" : "wrong-layout", "permalink" => "/original-root.html" }
        doc = Struct.new(:relative_path, :data, :site).new(path, data, site)
        2.times { DeuteriumSite::SectionMetadata.apply(doc) } # post_init and pre_render must agree.
        assert_equal section, data["section"]
        assert_equal locked ? "locked" : layout, data["layout"]
        assert_equal route, data["permalink"]
        assert_equal path.delete_prefix("/"), data["source_path"]
        refute_empty DeuteriumSite::SectionMetadata.generated_description(doc)
      end
    end
  end

  INVALID_ROUTES = {
    "relative" => "challenges/event/slug/", "absolute" => "https://fixture.invalid/challenges/event/slug/",
    "scheme_relative" => "//fixture.invalid/challenges/event/slug/", "missing_slash" => "/challenges/event/slug",
    "file" => "/challenges/event/slug/index.html", "duplicate_separator" => "/challenges//event/slug/",
    "traversal" => "/challenges/event/../slug/", "encoded_separator" => "/challenges/event/a%2fb/",
    "uppercase" => "/challenges/Event/slug/", "underscore" => "/challenges/event/bad_slug/",
    "missing_event" => "/challenges//slug/", "missing_slug" => "/challenges/event//",
    "query" => "/challenges/event/slug/?x=1", "fragment" => "/challenges/event/slug/#flag",
    "newline_suffix" => "/challenges/event/slug/\n", "newline_prefix" => "\n/challenges/event/slug/",
    "empty" => "", "nil" => nil
  }.freeze

  INVALID_ROUTES.each do |name, route|
    define_method("test_rejects_challenge_route_#{name}") do
      entry = CATALOG.fetch("entries").first
      doc = Struct.new(:relative_path, :data, :site).new(entry.fetch("post_path"), {
        "challenge_id" => entry.fetch("id"), "permalink" => route
      }, site)
      error = assert_raises(RuntimeError) { DeuteriumSite::SectionMetadata.apply(doc) }
      assert_includes error.message, "invalid authored challenge permalink"
      assert_includes error.message, entry.fetch("post_path")
    end
  end

  def test_unmarked_tutorial_cannot_keep_a_challenge_route
    doc = Struct.new(:relative_path, :data, :site).new("_posts/ctf-tutorials/2021-07-25-normal.md", {
      "permalink" => "/challenges/event/slug/"
    }, site)
    DeuteriumSite::SectionMetadata.apply(doc)
    assert_equal "/ctf-tutorials/2021/07/25/normal.html", doc.data["permalink"]
  end

  def test_jekyll_include_and_index_roundtrip_long_explicit_title
    title = 'Synthetic <cipher> & "quoted" \'title\' ' + "long " * 140
    path = "_posts/ctf-tutorials/challenges/2024-06-21-fixture.md"
    post(path, { "title" => title, "challenge_id" => "fixture", "permalink" => "/challenges/fixture/long-title/" },
         <<~LIQUID)
           ## Check your flag
           {% include challenge.html id="synthetic-long" hash="#{HASH}" salt="#{'a' * 32}" prefix="CTF" title=page.title %}
         LIQUID
    s = site("/preview")
    s.process
    html = File.read(File.join(@dest, "challenges/fixture/long-title/index.html"))
    form_node = parse(html).at_css("form[data-flag-check]")
    assert_equal title, form_node["data-challenge-title"]
    assert_operator html.index('id="flag-synthetic-long"') - html.index('<form'), :>, 400
    rows = JSON.parse(File.read(File.join(@dest, "challenges.json")))
    assert_equal [{ "id" => "synthetic-long", "page" => "/preview/challenges/fixture/long-title/", "title" => title,
                    "aliases" => [], "sha256" => HASH, "salt" => "a" * 32 }], rows
  end

  def test_index_reads_inputs_beyond_the_old_form_header_bound
    html = '<form data-flag-check data-sha256="' + HASH + '"><label>' + "padding " * 100 + '</label><input data-flag-input id="flag-late-id"></form>'
    assert_operator html.index('<input'), :>, 400
    rows = index({ "challenge.html" => "<h2>Legacy late input</h2>#{html}" })
    assert_equal ["late-id"], rows.map { |row| row.fetch("id") }
    assert_equal "Legacy late input", rows.first["title"]
  end

  def test_index_prefers_and_decodes_explicit_title
    title = 'A & B < C "D" \'E\''
    rows = index({ "challenge.html" => "<h2>Check your flag</h2>" + form("explicit", title: title) })
    assert_equal title, rows.first["title"]
  end

  def test_index_legacy_headings_use_nearest_preceding_h2_or_h3
    rows = index({ "legacy.html" => "<h2>First <em>legacy</em></h2>#{form('first')}<h3>Second <span>legacy</span></h3>#{form('second', hash: 'b' * 64)}<h2>Following heading</h2>" })
    assert_equal ["First legacy", "Second legacy"], rows.map { |row| row["title"] }
    assert_equal ["/legacy.html", "/legacy.html"], rows.map { |row| row["page"] }
  end

  def test_index_falls_back_to_page_title_then_id
    rows = index({ "a.html" => "<title>Page fallback / Fixture</title>#{form('page')}",
                   "b.html" => form("id-fallback", hash: "b" * 64) })
    assert_equal ["Page fallback", "id-fallback"], rows.map { |row| row["title"] }
  end

  def test_index_preserves_seven_practice_and_seven_authored_ids
    authored = CATALOG.fetch("entries").filter_map { |entry| entry["checker"]&.fetch("id") }
    assert_equal 7, authored.size
    ids = PRACTICE_IDS + authored
    pages = ids.each_with_index.to_h do |id, n|
      ["challenges/fixture/case-#{n.to_s.rjust(2, '0')}/index.html",
       form(id, hash: Digest::SHA256.hexdigest("synthetic-#{n}"), salt: n.to_s(16).rjust(32, "0"))]
    end
    rows = index(pages, baseurl: "/preview")
    assert_equal ids, rows.map { |row| row["id"] }
    assert rows.all? { |row| row["aliases"].empty? }
    assert rows.all? { |row| row["page"].start_with?("/preview/challenges/") && row["page"].end_with?("/") }
    refute rows.any? { |row| row["page"].include?("index.html") || row["page"].include?("/preview/preview/") }
  end

  def test_index_deduplicates_identical_hash_and_salt
    rows = index({ "a.html" => form("primary", salt: "a" * 32), "b.html" => form("alias", salt: "a" * 32) })
    assert_equal 1, rows.size
    assert_equal "primary", rows.first["id"]
    assert_equal ["alias"], rows.first["aliases"]
    assert_equal "/a.html", rows.first["page"]
    assert_equal "a" * 32, rows.first["salt"]
  end

  def test_index_does_not_merge_equal_hashes_with_different_salts
    # Synthetic metadata, not a claim of a SHA-256 collision. Checker identity
    # includes salt even when two authored records carry the same digest.
    rows = index({ "a.html" => form("salt-a", salt: "a" * 32), "b.html" => form("salt-b", salt: "b" * 32) })
    assert_equal ["salt-a", "salt-b"], rows.map { |row| row["id"] }, "different salts must remain separate checker records"
    assert_equal [[], []], rows.map { |row| row["aliases"] }
  end

  def test_index_does_not_merge_salted_and_unsalted_checkers
    rows = index({ "a.html" => form("unsalted"), "b.html" => form("salted", salt: "a" * 32) })
    assert_equal ["unsalted", "salted"], rows.map { |row| row["id"] }
  end

  def test_index_merges_missing_and_empty_salts_for_legacy_hashes
    legacy = '<form data-flag-check data-sha256="' + HASH + '"><input id="flag-missing-salt" data-flag-input></form>'
    rows = index({ "a.html" => legacy, "b.html" => form("empty-salt", salt: "") })
    assert_equal 1, rows.size
    assert_equal ["empty-salt"], rows.first["aliases"]
    refute rows.first.key?("salt")
  end

  def test_index_different_hashes_and_plaintext_ids_remain_separate
    rows = index({ "a.html" => form("hash-a", salt: "a" * 32) + form("hash-b", hash: "b" * 64, salt: "a" * 32) +
                   form("plain-a", hash: nil, answer: "flag{synthetic-legacy}") + form("plain-b", hash: nil, answer: "flag{synthetic-legacy}") })
    assert_equal %w[hash-a hash-b plain-a plain-b], rows.map { |row| row["id"] }
    refute rows.last.key?("sha256")
    refute JSON.generate(rows).include?("flag{synthetic-legacy}")
  end

  def test_index_excludes_unlisted_pages_before_aliasing
    hidden_paths = ["locked/hidden/index.html", "locked/hidden-file.html"]
    pages = { "public/index.html" => form("visible") }
    hidden_paths.each_with_index { |path, n| pages[path] = form("hidden-#{n}") }
    rows = index(pages, unlisted: hidden_paths, baseurl: "/preview")
    assert_equal ["visible"], rows.map { |row| row["id"] }
    assert_equal [], rows.first["aliases"]
    assert_equal "/preview/public/", rows.first["page"]
  end

  def test_index_ignores_forms_without_input_ids_and_non_html_files
    rows = index({ "empty.html" => '<form data-flag-check><input data-flag-input></form>',
                   "not-html.txt" => form("not-html") })
    assert_equal [], rows
  end

  def test_include_hash_mode_has_no_plaintext_and_keeps_accessibility_attributes
    node = parse(include_html(id: "fixture", hash: HASH, salt: "a" * 32, prefix: "SEKAI", title: "Fixture", answer: "flag{synthetic-do-not-ship}"))
    f = node.at_css("form")
    assert_equal HASH, f["data-sha256"]
    assert_equal "a" * 32, f["data-salt"]
    assert_equal "SEKAI", f["data-flag-prefix"]
    assert_equal "Fixture", f["data-challenge-title"]
    refute f.key?("data-answer")
    refute_includes node.to_html, "synthetic-do-not-ship"
    input = f.at_css("input[data-flag-input]")
    assert_equal "flag-fixture", input["id"]
    assert_equal input["id"], f.at_css("label")["for"]
    assert_equal input["id"], f.at_css("output")["for"]
    assert_equal "polite", f.at_css("output")["aria-live"]
    assert_equal "SEKAI{...}", input["placeholder"]
    assert_equal "none", input["autocapitalize"]
    assert_equal "false", input["spellcheck"]
    assert f.at_css('button[type="submit"]').key?("disabled")
    refute_nil f.at_css("noscript")
    refute f.key?("action")
  end

  def test_include_escapes_attribute_values
    unusual = 'test" <&> \'quoted\''
    node = parse(include_html(id: unusual, hash: HASH, salt: unusual, prefix: unusual, title: unusual))
    f = node.at_css("form")
    %w[data-salt data-flag-prefix data-challenge-title].each { |key| assert_equal unusual, f[key] }
    assert_equal "flag-#{unusual}", f.at_css("input")["id"]
    assert_equal "#{unusual}{...}", f.at_css("input")["placeholder"]
    assert_empty node.css("script")
    assert_equal 1, node.css("form").size
  end

  def test_include_legacy_plaintext_and_default_prefix_remain_supported
    answer = 'flag{synthetic-<&>"}'
    node = parse(include_html(id: "legacy", answer: answer))
    f = node.at_css("form")
    assert_equal answer, f["data-answer"]
    %w[data-sha256 data-salt data-flag-prefix data-challenge-title].each { |key| refute f.key?(key) }
    assert_empty node.css("[data-hint]")
  end

  def test_include_hints_are_hidden_ordered_and_id_scoped
    node = parse(include_html(id: "hint-fixture", hash: HASH, hints: "first clue|second clue"))
    hints = node.css("[data-hint]")
    assert_equal ["1", "2"], hints.map { |hint| hint["data-hint"] }
    assert_equal ["first clue", "second clue"], hints.map(&:text)
    assert hints.all? { |hint| hint.key?("hidden") && hint["data-hint-for"] == "hint-fixture" }
  end

  def test_global_feed_preserves_tied_archive_order_and_item_ids
    12.times do |i|
      post("_posts/ctf-tutorials/2024-06-21-tie-#{i.to_s.rjust(2, '0')}.md",
           { 'title' => "Tied post #{i}", 'description' => 'Synthetic description.' })
    end
    write('feed.xml', File.read(File.join(ROOT, 'feed.xml')))
    write('order.html', "---\n---\n{% for p in site.posts %}<a href=\"{{ p.url | absolute_url }}\">{{ p.id | absolute_url }}</a>{% endfor %}")
    site('/preview').process
    order = parse(File.read(File.join(@dest, 'order.html'))).css('a').first(10)
    entries = parse(File.read(File.join(@dest, 'feed.xml'))).css('entry')
    assert_equal 10, entries.size
    assert_equal order.map { |n| n['href'] }, entries.map { |n| n.at_css('link')['href'] }
    assert_equal order.map(&:text), entries.map { |n| n.at_css('id').text }
    assert entries.all? { |n| n.at_css('summary').text == 'Synthetic description.' }
  end
end
