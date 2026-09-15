#!/usr/bin/env ruby
# frozen_string_literal: true

# Offline: use the site's installed Ruby/Jekyll gems. All fixtures stay local.
require "minitest/autorun"
require "fileutils"
require "tmpdir"
require "open3"
require "cgi"
require "bundler/setup"
require "jekyll"
# Match alphabetical load order: delegation must work even when loaded first.
require_relative "../_plugins/markov_titles"
require_relative "../_plugins/publications"
require_relative "../_plugins/asset_version"
require_relative "../_plugins/section_metadata"

class MarkovFixturePrivacy < Jekyll::Generator
  priority :low

  def generate(site)
    return unless site.config["markov_fixture"]

    site.posts.docs.each { |post| post.data["hidden"] = true if post.data["fixture_hide"] }
  end
end

class MarkovTitlesTest < Minitest::Test
  Markov = DeuteriumSite::MarkovTitles
  ROOT = File.expand_path("..", __dir__)
  SCRATCH = File.join(ROOT, "agent_out/markov-man/tests")
  PUBLIC = ["Red river flows", "Blue river freezes"].freeze
  PRIVATE = [
    { "layout" => "locked" }, { "layout" => "redirect" }, { "layout" => "page" },
    { "hidden" => true }, { "unlisted" => true }, { "noindex" => true },
    { "published" => false }, { "sitemap" => false }, { "locked" => true },
    { "redirect" => true }, { "redirect_to" => "/elsewhere/" },
  ].freeze
  ASSETS = %w[assets/js/features/markov-404.js assets/css/features/markov-404.css].freeze
  ROUTES = %w[404.html WriteUps/404.html ctf-tutorials/404.html ramblings/404.html].freeze

  class TitleOnlyPost
    attr_reader :data
    def initialize(data) = @data = data
    def content = raise("generator read a body")
    def output = raise("generator read rendered content")
    def excerpt = raise("generator read an excerpt")
  end

  def posts(titles)
    titles.map { |title| TitleOnlyPost.new({ "layout" => "article", "title" => title }) }
  end

  def test_determinism_recombination_and_no_original_sequences
    docs = posts(PUBLIC)
    expected = ["Blue river flows", "Red river freezes"].sort
    assert_equal expected, Markov.generate(docs).sort
    baseline = Markov.generate(docs)
    12.times do |seed|
      assert_equal baseline, Markov.generate(docs.shuffle(random: Random.new(seed)))
    end
    assert_equal baseline, Markov.generate(docs + posts([PUBLIC.first]))
    assert_equal baseline, Markov.generate(docs)
  end

  def test_bounds_and_multi_source_edges
    titles = 20.times.map { |i| "Start#{i} shared end#{i}" }
    result = Markov.generate(posts(titles))
    assert_equal Markov::LIMIT, result.length
    keys = result.map { |title| Markov.normalize(title) }
    sequences = result.map { |title| Markov.word_sequence(title) }
    assert_equal sequences.uniq, sequences
    assert_empty sequences & titles.map { |title| Markov.word_sequence(title) }
    assert_equal keys.uniq, keys
    assert_empty keys & titles.map { |title| Markov.normalize(title) }
    source_edges = titles.map { |title| (["START"] + title.downcase.split + ["END"]).each_cons(2).to_a }
    result.each do |title|
      assert_operator title.length, :<=, Markov::MAX_CHARS
      assert_operator title.split.length, :<=, Markov::MAX_WORDS
      edges = (["START"] + title.downcase.split + ["END"]).each_cons(2).to_a
      assert edges.all? { |edge| source_edges.any? { |source| source.include?(edge) } }
      refute source_edges.any? { |source| edges.all? { |edge| source.include?(edge) } }, "single-source path"
    end
    long = posts(["#{'x' * 200} shared end", "Other shared #{'y' * 200}"])
    assert_equal ["Other shared end"], Markov.generate(long)
  end

  def test_word_limit_requires_a_real_end_marker_and_bounds_cycles
    middle = 14.times.map { |i| "w#{i}" }.join(" ")
    exact = Markov.generate(posts(["Alpha #{middle} end", "Beta #{middle} stop"]))
    assert_equal 2, exact.length
    assert exact.all? { |title| title.split.length == Markov::MAX_WORDS }
    assert_empty Markov.generate(posts(["Alpha extra #{middle} end", "Beta extra #{middle} stop"]))
    cyclic = Markov.generate(posts(["Red loop red loop end", "Blue loop blue loop stop"]))
    refute_empty cyclic
    assert cyclic.all? { |title| title.split.length <= Markov::MAX_WORDS }
    assert cyclic.all? { |title| title.end_with?(" end", " stop") }
  end

  def test_normalization_rejects_cosmetic_duplicates_and_identical_word_sequences
    assert_equal "alpha beta", Markov.normalize("  Ａlpha,\tBETA! ")
    assert_equal Markov.normalize("Straße: a--b"), Markov.normalize("STRASSE a b")
    assert_empty Markov.generate(posts(["Alpha, beta!", "ALPHA beta", "Ａlpha\tBETA"]))
    titles = ["Red river flows", "Blue river freezes", "RED: river freezes!", "Blue river flows."]
    assert_empty Markov.generate(posts(titles))
    assert_empty Markov.generate(posts(["Start loop loop finish", "Other isolated ending"]))
    assert_empty Markov.generate(posts(["Can't river flows", "Cant river freezes", "Can't river freezes"]))
    assert_empty Markov.generate(posts(["Foo-bar baz", "Foo bar baz", "Foobar baz", "Far bar baz"]))
  end

  def test_empty_tiny_and_disconnected_corpora
    [[], ["Only"], ["One little title"], ["Alpha", "Beta"],
     ["One river", "Two mountains"], [nil, "", "   ", "---", 23, "\xff".b.force_encoding("UTF-8")]].each do |titles|
      assert_empty Markov.generate(posts(titles))
    end
    assert_equal ["Blue river flows"], Markov.generate(posts(PUBLIC + ["Red river freezes"]))
  end

  def test_privacy_filters_before_title_access_and_matches_publications
    private_docs = PRIVATE.map do |flags|
      data = { "layout" => "article", "title" => "Private river sentinel" }.merge(flags)
      post = TitleOnlyPost.new(data)
      refute Markov.eligible?(post)
      refute Markov.fallback_eligible?(post)
      # Excluded metadata must not be sampled, even to derive the seed.
      def data.[](key)
        raise "read excluded title" if key == "title"
        super
      end
      post
    end
    assert_equal Markov.generate(posts(PUBLIC)), Markov.generate(posts(PUBLIC) + private_docs)
    ["article", "writeup"].each do |layout|
      post = TitleOnlyPost.new({ "layout" => layout, "title" => "Allowed",
                                 "hidden" => false, "unlisted" => false, "published" => true })
      assert Markov.eligible?(post)
      assert Markov.fallback_eligible?(post)
    end
    DeuteriumSite::Publications.stub(:eligible?, ->(_post) { false }) do
      assert_empty Markov.generate(posts(PUBLIC)), "must use shared eligibility when available"
    end
  end

  def test_standalone_policy_without_jekyll_or_publications
    code = <<~RUBY
      require #{File.join(ROOT, '_plugins/markov_titles.rb').inspect}
      post = Struct.new(:data)
      docs = #{PUBLIC.inspect}.map { |title| post.new({"layout" => "article", "title" => title}) }
      #{PRIVATE.inspect}.each do |flags|
        docs << post.new({"layout" => "article", "title" => "Private river sentinel"}.merge(flags))
      end
      puts JSON.generate(DeuteriumSite::MarkovTitles.generate(docs))
    RUBY
    # Preserve load paths for relocatable Ruby toolchains, without bundler's
    # inherited RUBYOPT. The child loads only the plugin and standard library.
    output, error, status = Open3.capture3({ "RUBYOPT" => nil }, RbConfig.ruby,
                                          "-I", $LOAD_PATH.join(File::PATH_SEPARATOR), "-e", code)
    assert status.success?, error
    assert_equal Markov.generate(posts(PUBLIC)), JSON.parse(output)
  end

  def test_dangerous_strings_round_trip_as_json_not_html
    titles = ["</script><script>alert('x') & \"quoted\"</script>", "<!-- > & ' \u2028 \u2029"]
    encoded = Markov.embedded_json(titles)
    assert_equal titles, JSON.parse(encoded)
    refute_match(/[<>&'\u2028\u2029]/, encoded)
    assert_includes encoded, '\\u003c/script\\u003e'
    assert_includes encoded, '\\u2028'
    assert_includes encoded, '\\u2029'
  end

  def fixture
    FileUtils.mkdir_p(SCRATCH)
    Dir.mktmpdir("site-", SCRATCH) do |source|
      @source = source
      @dest = File.join(source, "agent_out/site")
      write("_layouts/base.html", "---\n---\n<!doctype html><html><body>{{ content }}</body></html>")
      %w[article writeup locked page].each do |name|
        write("_layouts/#{name}.html", "---\nlayout: base\n---\n{{ content }}")
      end
      write("_layouts/404.html", File.read(File.join(ROOT, "_layouts/404.html")))
      ASSETS.each { |asset| write(asset, File.read(File.join(ROOT, asset))) }
      ROUTES.each do |route|
        write(route.sub(/html\z/, "md"), "---\npermalink: /404.html\n---\nAuthored recovery copy.\n")
      end
      write("ordinary.html", "---\nlayout: page\n---\nAn ordinary page.")
      yield
    end
  end

  def write(path, content)
    full = File.join(@source, path)
    FileUtils.mkdir_p(File.dirname(full))
    File.write(full, content)
  end

  def add_post(title, id, flags = {})
    data = { "layout" => "article", "title" => title }.merge(flags)
    write("_posts/2024-01-01-post#{id}.md", data.to_yaml + "---\nBodySentinelNeverSample.\n")
  end

  def build(baseurl = "")
    site = Jekyll::Site.new(Jekyll.configuration(
      "source" => @source, "destination" => @dest, "config" => [], "plugins" => [],
      "quiet" => true, "disable_disk_cache" => true, "exclude" => ["agent_out"],
      "url" => "https://fixture.invalid", "baseurl" => baseurl, "markov_fixture" => true,
      "unpublished" => true, "future" => true
    ))
    site.process
    site
  end

  def html(route = "404.html") = File.read(File.join(@dest, route))

  def candidates(page)
    JSON.parse(page[/<script id="markov-404-data" type="application\/json">(.*?)<\/script>/m, 1])
  end

  def test_jekyll_root_sections_baseurl_and_repeat_builds
    fixture do
      PUBLIC.each_with_index { |title, id| add_post(title, id) }
      # Section metadata deliberately sets post layouts; test non-article layouts
      # at the policy boundary above instead of undoing that production behavior.
      PRIVATE.reject { |flags| %w[page redirect].include?(flags["layout"]) }.each_with_index do |flags, i|
        add_post("Private#{i} river secret#{i}", i + 10, flags)
      end
      add_post("LatePrivate river secret", 99, { "fixture_hide" => true })
      write("private.html", "---\nlayout: locked\ntitle: PagePrivate river secret\nunlisted: true\n---\nNot a post.")
      ["", "/preview"].each do |baseurl|
        first = build(baseurl)
        expected = Markov.generate(posts(PUBLIC))
        assert_equal expected, first.data.fetch("markov_404").fetch("titles")
        snapshots = ROUTES.to_h { |route| [route, html(route)] }
        ROUTES.each do |route|
          page = html(route)
          assert_equal expected, candidates(page)
          assert_includes page, "Authored recovery copy."
          assert_includes page, %(href="#{baseurl}/">Return home)
          assert_includes page, %(href="#{baseurl}/archive.html">Search the archive)
          assert_includes page, "hidden disabled>Another nonexistent article</button>"
          assert_includes page, 'role="status" aria-live="polite" aria-atomic="true"'
          ASSETS.each do |asset|
            digest = Digest::SHA1.hexdigest(File.basename(asset) + File.binread(File.join(ROOT, asset)))[0, 8]
            assert_includes page, %(/#{asset}?v=#{digest}")
            assert_includes page, %(="#{baseurl}/#{asset}?v=)
          end
          refute_includes page, "{{"
          refute_match(/BodySentinel|Private|secret/, page)
          chosen = page[/<p id="markov-404-title"[^>]*>(.*?)<\/p>/m, 1]
          assert_equal expected.first, CGI.unescapeHTML(chosen)
        end
        refute_includes html("ordinary.html"), "markov-404"
        refute File.exist?(File.join(@dest, "markov-titles.json"))
        build(baseurl)
        assert_equal snapshots, ROUTES.to_h { |route| [route, html(route)] }
      end
    end
  end

  def test_jekyll_empty_and_tiny_fallbacks
    fixture do
      [[], ["One public title"], PUBLIC + ["Red river freezes"]].each do |titles|
        FileUtils.rm_rf(File.join(@source, "_posts"))
        titles.each_with_index { |title, id| add_post(title, id) }
        build
        if titles.length < 2
          assert_includes html, "No recombined title is available"
          refute_includes html, 'id="markov-404-title"'
          refute_includes html, 'id="markov-404-another"'
          refute_includes html, "/assets/js/features/markov-404.js"
          refute_includes html, "A made-up title"
        else
          assert_equal ["Blue river flows"], candidates(html)
          assert_includes html, "hidden disabled>Another nonexistent article</button>"
          refute_includes html, "Enable JavaScript"
        end
      end
    end
  end

  def test_jekyll_escapes_both_the_static_title_and_embedded_data
    fixture do
      ["</script><img/src=x/onerror=alert(1)> river freezes", "Blue river flows"].each_with_index do |title, id|
        add_post(title, id)
      end
      build("/preview")
      result = candidates(html)
      assert_equal 2, result.length
      assert result.any? { |title| title.include?("</script>") }
      assert_equal 2, html.scan(/<\/script>/).length
      refute_includes html, "<img"
      encoded = html[/type="application\/json">(.*?)<\/script>/m, 1]
      refute_match(/[<>&'\u2028\u2029]/, encoded)
      static = html[/<p id="markov-404-title"[^>]*>(.*?)<\/p>/m, 1]
      assert_equal result.first, CGI.unescapeHTML(static)
      refute_includes static, "<"
    end
  end
end
