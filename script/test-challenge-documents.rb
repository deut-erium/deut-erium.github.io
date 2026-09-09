#!/usr/bin/env ruby
# frozen_string_literal: true

# Offline tests: public catalog metadata and synthetic files/posts only.
# Fixtures and build outputs stay under agent_out; no event answers are read.
require "fileutils"
require "json"
require "tmpdir"
require "digest"
require "yaml"
require "minitest/autorun" # Bundled with the pinned Ruby, outside the Gemfile.
require "bundler/setup"
require "jekyll"
require_relative "../_plugins/challenge_documents"
require_relative "../_plugins/challenges_index"

class ChallengeDocumentsTest < Minitest::Test
  Documents = DeuteriumSite::ChallengeDocuments
  ROOT = File.expand_path("..", __dir__)
  SCRATCH = File.join(ROOT, "agent_out/challenge-hosting/documents/fixtures")
  PUBLIC_CATALOG = File.read(File.join(ROOT, "_data/authored_challenges.json"), encoding: "UTF-8").freeze
  HOST = "https://fixture.invalid:8443"
  RECORD_KEYS = %w[id title challenge_name year category authors mode event article_url article_path
                   text_url text_path json_url json_path statement notes files spoilers licenses].sort.freeze
  FILE_KEYS = %w[name label kind url path bytes sha256 upstream_url].sort.freeze
  LICENSE_KEYS = %w[url path name bytes sha256 upstream_url].sort.freeze
  SENTINEL = "synthetic-do-not-export"

  def setup
    FileUtils.mkdir_p(SCRATCH)
    @source = Dir.mktmpdir("jekyll-", SCRATCH)
    @dest = File.join(@source, "agent_out/site")
    FileUtils.mkdir_p(File.join(@source, "_plugins"))
    @catalog = JSON.parse(PUBLIC_CATALOG)
  end

  def teardown
    FileUtils.remove_entry(@source) if @source && File.directory?(@source)
  end

  def site(baseurl = "", **overrides)
    Jekyll::Site.new(Jekyll.configuration({
      "source" => @source, "destination" => @dest, "config" => [],
      "plugins" => [], "plugins_dir" => "_plugins", "quiet" => true,
      "disable_disk_cache" => true, "future" => true, "url" => HOST,
      "baseurl" => baseurl, "exclude" => ["agent_out"],
      "defaults" => [{ "scope" => { "path" => "" }, "values" => { "layout" => "shell" } }],
    }.merge(overrides)))
  end

  def unit_site(baseurl = "", **overrides)
    s = site(baseurl, **overrides)
    s.data["authored_challenges"] = @catalog
    s
  end

  def records(baseurl = "", **overrides)
    Documents.records(unit_site(baseurl, **overrides))
  end

  def write(path, bytes, root: @source)
    full = File.join(root, path.delete_prefix("/"))
    FileUtils.mkdir_p(File.dirname(full))
    File.binwrite(full, bytes)
  end

  def read_output(route)
    File.read(File.join(@dest, route.delete_prefix("/")), encoding: "UTF-8")
  end

  def assert_invalid(pattern = nil)
    error = assert_raises(Documents::InvalidCatalog) { yield }
    assert_match(pattern, error.message) if pattern
    error
  end

  def install_fixture
    write("_layouts/shell.html", "---\n---\n<html><script>LAYOUT_SENTINEL</script>{{ content }}</html>")
    write("scoreboard/index.html", '<script id="scoreboard-known" type="application/json">[]</script>')
    @catalog.fetch("entries").each do |entry|
      # Preserve public ids, routes, names and descriptions, never real graders.
      body = "Synthetic article."
      if entry["checker"]
        checker = entry["checker"] = {
          "id" => entry.fetch("checker").fetch("id"),
          "sha256" => Digest::SHA256.hexdigest("synthetic-checker-#{entry.fetch('id')}"),
          "salt" => "0" * 32, "prefix" => "TEST",
        }
        body += %(\n\n<form data-flag-check data-sha256="#{checker.fetch('sha256')}" data-salt="#{checker.fetch('salt')}"><input data-flag-input id="flag-#{checker.fetch('id')}"></form>)
      end
      header = { "title" => entry.fetch("post_title"), "permalink" => entry.fetch("url") }
      write(entry.fetch("post_path"), "#{header.to_yaml}---\n#{body}\n")
      (entry.fetch("files") + [entry["organizer_download"]].compact).each { |file| install_file(file) }
    end
    @catalog.fetch("licenses").each { |license| install_file(license) }
    write("_data/authored_challenges.json", JSON.pretty_generate(@catalog))
  end

  def install_file(file)
    bytes = "Synthetic public fixture: #{file.fetch('url')}\n"
    file["bytes"], file["sha256"] = bytes.bytesize, Digest::SHA256.hexdigest(bytes)
    write(file.fetch("url"), bytes)
  end

  def document_bytes
    Dir.glob(File.join(@dest, "challenges/**/*.{json,txt}")).sort.to_h do |path|
      [path.delete_prefix(@dest), File.binread(path)]
    end
  end

  ["", "/preview"].each do |baseurl|
    define_method("test_integration_18_records_37_artifacts_#{baseurl.empty? ? 'root' : 'preview'}") do
      install_fixture
      before = JSON.generate(@catalog)
      s = site(baseurl)
      s.process
      index = JSON.parse(read_output("/challenges/index.json"))
      assert_equal 18, index.size
      assert_equal 37, document_bytes.size
      assert_equal 18, s.posts.docs.size
      assert_equal before, JSON.generate(@catalog)
      expected = @catalog.fetch("entries").to_h { |entry| [entry.fetch("id"), entry] }
      index.each do |record|
        entry = expected.fetch(record.fetch("id"))
        route = entry.fetch("url")
        assert_equal RECORD_KEYS, record.keys.sort
        assert_equal entry.fetch("post_title"), record.fetch("title")
        assert_equal entry.fetch("title"), record.fetch("challenge_name")
        assert_equal @catalog.fetch("events").find { |event| event["id"] == entry["event_id"] }, record.fetch("event")
        assert_equal record, JSON.parse(read_output(route + "challenge.json"))
        text = read_output(route + "challenge.txt")
        assert text.valid_encoding?
        assert text.start_with?(entry.fetch("post_title") + "\n")
        assert_includes text, "Authors: #{entry.fetch('authors').join(', ')}"
        assert_includes text, "Mode: #{entry.fetch('mode')}"
        assert_includes text, record.fetch("statement").fetch("text")
        assert_includes text, "No live challenge service"
        assert_includes text, "SPOILERS - organizer files and solutions"
        refute_match(/<html|<script|LAYOUT_SENTINEL|\{%|\{\{/, text)
        %w[article text json].each do |kind|
          suffix = kind == "article" ? "" : "challenge.#{kind == 'text' ? 'txt' : 'json'}"
          assert_equal baseurl + route + suffix, record.fetch("#{kind}_path")
          assert_equal HOST + baseurl + route + suffix, record.fetch("#{kind}_url")
        end
        # Each public download resolves inside this synthetic build, with the
        # advertised bytes and hash. No retained real handout is needed.
        (record.fetch("files") + record.fetch("spoilers").fetch("files") + record.fetch("licenses")).each do |file|
          assert file.fetch("path").start_with?(baseurl + "/assets/challenges/")
          assert_equal HOST + file.fetch("path"), file.fetch("url")
          assert_includes text, file.fetch("url")
          assert_includes text, file.fetch("sha256")
          bytes = File.binread(File.join(@dest, file.fetch("path").delete_prefix(baseurl).delete_prefix("/")))
          assert_equal file.fetch("bytes"), bytes.bytesize
          assert_equal file.fetch("sha256"), Digest::SHA256.hexdigest(bytes)
        end
      end
      # /challenges.json remains the separate progress index from the original
      # hook. Only the seven synthetic event forms belong there.
      checkers = @catalog.fetch("entries").filter_map { |entry| entry["checker"] }
      assert_equal 7, checkers.size
      progress_bytes = read_output("/challenges.json")
      progress = JSON.parse(progress_bytes)
      assert_equal checkers.map { |checker| checker.fetch("id") }.sort, progress.map { |row| row.fetch("id") }.sort
      checkers.each do |checker|
        row = progress.find { |candidate| candidate["id"] == checker["id"] }
        assert_equal checker.fetch("sha256"), row.fetch("sha256")
        assert_equal checker.fetch("salt"), row.fetch("salt")
        refute_includes document_bytes.values.join, checker.fetch("sha256")
        refute_includes document_bytes.values.join, checker.fetch("id")
      end
      assert progress.all? { |row| row.fetch("page").start_with?(baseurl + "/challenges/") }
      first = document_bytes
      site(baseurl).process
      assert_equal first, document_bytes, "clean builds must be byte-identical"
      assert_equal progress_bytes, read_output("/challenges.json")
      refute File.exist?(File.join(@dest, "preview")), "baseurl is a serving prefix, not an output directory"
    end
  end

  def test_real_catalog_projection_is_whitelisted_and_does_not_mutate_metadata
    before = JSON.generate(@catalog)
    rows = records
    assert_equal 18, rows.length
    @catalog.fetch("entries").each do |entry|
      record = rows.find { |row| row["id"] == entry["id"] }
      assert_equal entry.fetch("files").map { |file| file.fetch("download_name") }, record.fetch("files").map { |file| file.fetch("name") }
      entry.fetch("files").zip(record.fetch("files")).each do |source, file|
        assert_equal source.fetch("label"), file.fetch("label")
        %w[kind bytes sha256].each { |key| assert_equal source.fetch(key), file.fetch(key) }
        assert_equal FILE_KEYS - (source["upstream_url"] ? [] : ["upstream_url"]), file.keys.sort
      end
      record.fetch("licenses").each { |license| assert_equal LICENSE_KEYS, license.keys.sort }
      assert_equal entry.fetch("license", {}).fetch("local_urls", []).length, record.fetch("licenses").length
      Documents::SPOILER_LINKS.each do |key|
        refute record.key?(key)
        if entry[key]
          assert_equal entry.fetch(key), record.fetch("spoilers").fetch(key)
        else
          refute record.fetch("spoilers").key?(key)
        end
      end
    end
    assert_equal before, JSON.generate(@catalog)
  end

  def test_organizer_download_is_only_in_explicit_spoilers
    row = records.find { |record| record["id"] == "zh3r0-2021-b00tleg" }
    assert_empty row.fetch("files")
    organizer = row.fetch("spoilers").fetch("files").fetch(0)
    original = @catalog.fetch("entries").find { |entry| entry["id"] == row["id"] }.fetch("organizer_download")
    assert_equal (FILE_KEYS + %w[modification upstream_bytes upstream_sha256]).sort, organizer.keys.sort
    %w[modification upstream_sha256 upstream_bytes].each { |key| assert_equal original.fetch(key), organizer.fetch(key) }
    assert_match(/dummy reward/, organizer.fetch("modification"))
    assert_match(/Level answers remain/, organizer.fetch("modification"))
    text = Documents.plain_text(row)
    primary, spoilers = text.split("SPOILERS - organizer files and solutions", 2)
    refute_includes primary, organizer.fetch("url")
    assert_includes primary, "No player handout"
    assert_includes spoilers, organizer.fetch("url")
    assert_includes spoilers, organizer.fetch("modification")
    assert_includes spoilers, organizer.fetch("upstream_sha256")
    assert_includes spoilers, organizer.fetch("upstream_bytes").to_s
  end

  def test_fixed_outputs_and_released_vs_corrected_source_remain_distinct
    rows = records
    fixed = rows.select { |row| row.fetch("files").any? { |file| file["kind"] == "fixed-instance" } }
    assert_equal 5, fixed.length
    fixed.each do |row|
      assert_match(/not a recording from the competition/, row.fetch("notes").join(" "))
      assert_includes Documents.plain_text(row), "fixed-instance"
      row.fetch("files").select { |file| file["kind"] == "fixed-instance" }.each do |file|
        refute file.key?("upstream_url")
      end
    end
    law = rows.find { |row| row["id"] == "sekaictf-2025-law-and-order" }
    assert_equal %w[released-chall.py corrected-chall.py], law.fetch("files").map { |file| file.fetch("name") }
    assert_equal %w[handout server-source], law.fetch("files").map { |file| file.fetch("kind") }
    assert_match(/incorrect version/, Documents.plain_text(law))
    assert_match(/corrected server source/, Documents.plain_text(law))
  end

  def test_diffecient_token_uses_the_catalog_article_and_configured_origin
    @catalog.fetch("entries").find { |entry| entry["id"] == "sekaictf-2022-diffecient" }["url"] = "/challenges/fixture/relocated/"
    row = records("/preview").find { |record| record["id"] == "sekaictf-2023-diffecientwo" }
    assert_includes row.fetch("statement").fetch("text"), "#{HOST}/preview/challenges/fixture/relocated/"
    refute_includes Documents.json_bytes(row), Documents::DIFFECIENT_TOKEN
    refute_includes Documents.plain_text(row), Documents::DIFFECIENT_TOKEN
    @catalog.fetch("entries").reject! { |entry| entry["id"] == "sekaictf-2022-diffecient" }
    assert_invalid(/missing Diffecient/) { records }
  end

  def test_unicode_quotes_and_template_syntax_are_data_not_executed
    entry = @catalog.fetch("entries").first
    title = "Challenge archive: CTF - café 雪 <cipher> & \"quotes\" \\ line\nsecond"
    statement = "UTF-8: λ 🧪\nLiteral {{ site.title }} and {% include missing-file %}.\nA < B & C > D."
    entry["post_title"], entry["statement"] = title, statement
    entry["authors"] = ["Zoë", "雪 & <test>"]
    write("_data/authored_challenges.json", JSON.generate(@catalog))
    site.process
    row = JSON.parse(read_output(entry.fetch("url") + "challenge.json"))
    assert_equal title, row.fetch("title")
    assert_equal statement, row.fetch("statement").fetch("text")
    text = read_output(entry.fetch("url") + "challenge.txt")
    assert text.valid_encoding?
    assert_includes text, title
    assert_includes text, statement
    refute_includes text, "&lt;"
  end

  def test_arbitrary_extras_and_checker_fields_never_serialize
    extras = { "checker" => { "sha256" => SENTINEL, "salt" => SENTINEL },
               "flag" => "flag{#{SENTINEL}}", "answer" => SENTINEL, "private_path" => SENTINEL,
               "post_path" => SENTINEL, "runtime" => SENTINEL, "arbitrary" => { "nested" => SENTINEL } }
    @catalog.merge!(extras)
    @catalog.fetch("events").each { |event| event.merge!(extras) }
    @catalog.fetch("licenses").each { |license| license.merge!(extras) }
    @catalog.fetch("entries").each do |entry|
      entry.merge!(extras)
      entry["license"]&.merge!(extras)
      (entry.fetch("files") + [entry["organizer_download"]].compact).each { |file| file.merge!(extras) }
    end
    rows = records
    refute_includes Documents.json_bytes(rows), SENTINEL
    rows.each do |row|
      assert_equal RECORD_KEYS, row.keys.sort
      refute_includes Documents.plain_text(row), SENTINEL
    end
    # Even a whitelisted field cannot smuggle an arbitrary nested object.
    @catalog.fetch("entries").first["authors"] = [extras]
    assert_invalid(/author/) { records }
  end

  def test_missing_catalog_is_a_noop_and_empty_catalog_emits_an_empty_array
    s = site("", "url" => "")
    assert_empty Documents.records(s)
    Documents::Generator.new.generate(s)
    assert_empty s.static_files
    write("plain.txt", "untouched")
    s.process
    refute File.exist?(File.join(@dest, "challenges/index.json"))
    assert_equal [], JSON.parse(read_output("/challenges.json"))
    @catalog = { "entries" => [], "events" => [], "licenses" => [] }
    s = unit_site
    Documents::Generator.new.generate(s)
    assert_equal 1, s.static_files.length
    s.static_files.first.write(@dest)
    assert_equal [], JSON.parse(read_output("/challenges/index.json"))
  end

  def test_output_is_deterministic_under_catalog_object_and_entry_reordering
    rows = records
    assert_equal [2025, 2024, 2023, 2022, 2021], rows.map { |row| row.fetch('year') }.uniq
    rows.group_by { |row| row.fetch('year') }.each_value do |year|
      names = year.map { |row| row.fetch('challenge_name').downcase }
      assert_equal names.sort, names
    end
    expected = Documents.json_bytes(rows)
    @catalog = reorder_objects(@catalog)
    %w[entries events licenses].each { |key| @catalog.fetch(key).reverse! }
    assert_equal expected, Documents.json_bytes(records)
  end

  def reorder_objects(value)
    case value
    when Hash then value.to_a.reverse.to_h.transform_values { |child| reorder_objects(child) }
    when Array then value.map { |child| reorder_objects(child) }
    else value
    end
  end

  def test_origin_and_baseurl_normalization
    assert_equal records, records("/", "url" => HOST + "/")
    assert_equal records("/preview"), records("/preview/", "url" => HOST + "/")
    assert records("/one/two").all? { |row| row.fetch("article_path").start_with?("/one/two/challenges/") }
    ["", "ftp://fixture.invalid", "//fixture.invalid", "https://fixture.invalid/path",
     "https://user:password@fixture.invalid", "https://fixture.invalid?query", "https://fixture.invalid/#fragment",
     "https://fixture.invalid\n", "https://"].each do |url|
      assert_invalid { records("", "url" => url) }
    end
    ["preview", "//preview", "/preview//", "/a/../b", "/%2e%2e", "/a\\b", "/a?x", "/a#x", "/a\n", false].each do |base|
      assert_invalid(/baseurl/) { records(base) }
    end
  end

  def test_unsafe_entry_routes_and_ids_are_rejected_before_artifacts_are_added
    bad_routes = [nil, "", "challenges/event/name/", "//evil.invalid/a/", "https://evil.invalid/a/",
                  "/challenges/event/name", "/challenges/event/name/index.html", "/challenges/event/../",
                  "/challenges//name/", "/challenges/event/a%2fb/", "/challenges/event/%252e%252e/",
                  "/challenges/event/a\\b/", "/challenges/event/name/?x=1", "/challenges/event/name/#x",
                  "/challenges/event/name/\n", "/challenges/Event/name/", "/challenges/event/a_b/"]
    original = @catalog.fetch("entries").last.fetch("url")
    bad_routes.each do |route|
      @catalog.fetch("entries").last["url"] = route
      s = unit_site
      assert_invalid(/unsafe entry route/) { Documents::Generator.new.generate(s) }
      assert_empty s.static_files
    end
    @catalog.fetch("entries").last["url"] = original
    [nil, "../secret", "a/b", "a%2fb", "a\n", "a_b"].each do |id|
      @catalog.fetch("entries").last["id"] = id
      assert_invalid(/unsafe entry id/) { records }
    end
  end

  def test_files_must_be_local_named_downloads_in_the_entry_directory
    entry = @catalog.fetch("entries").first
    file = entry.fetch("files").first
    original = file.dup
    [nil, "https://evil.invalid/chall.py", "//evil.invalid/chall.py", "/assets/challenges/other/chall.py",
     "/assets/challenges/#{entry.fetch('id')}/../chall.py", original.fetch("url") + "?raw=1",
     original.fetch("url") + "#x", original.fetch("url") + "\n", "/preview" + original.fetch("url")].each do |url|
      file["url"] = url
      assert_invalid(/file route/) { records }
    end
    file.replace(original)
    [nil, "", ".", "..", ".hidden", "../secret", "a/b", "a\\b", "a%2fb", "a?b", "a#b", "a\n", "a."].each do |name|
      file["download_name"] = name
      file["url"] = "/assets/challenges/#{entry.fetch('id')}/#{name}"
      assert_invalid(/download name/) { records }
    end
  end

  def test_invalid_metadata_and_missing_license_records_fail_closed
    mutations = [
      -> { @catalog["events"] = nil },
      -> { @catalog["entries"] = {} },
      -> { @catalog["licenses"] = {} },
      -> { @catalog.fetch("entries").first.delete("post_title") },
      -> { @catalog.fetch("entries").first["event_id"] = "unknown" },
      -> { @catalog.fetch("entries").first["year"] = 1900 },
      -> { @catalog.fetch("entries").first["mode"] = "simulator" },
      -> { @catalog.fetch("entries").first["statement"] = "NUL\0" },
      -> { @catalog.fetch("entries").first.fetch("files").first["sha256"] = "not-a-hash" },
      -> { @catalog.fetch("entries").first.fetch("files").first["bytes"] = -1 },
      -> { @catalog.fetch("entries").first.fetch("files").first["bytes"] = "123" },
      -> { @catalog.fetch("entries").first.fetch("files").first["kind"] = "organizer-source" },
      -> { @catalog.fetch("entries").first.fetch("files").first["modification"] = "changed" },
      -> { @catalog.fetch("entries").first["solution_url"] = "javascript:bad()" },
      -> { @catalog.fetch("entries").first["source_url"] = false },
      -> { @catalog.fetch("entries").first.fetch("files").first["upstream_url"] = false },
      -> { @catalog.fetch("entries").first["organizer_download"] = false },
      -> { @catalog.fetch("entries").first["license"] = false },
      -> { @catalog.fetch("licenses").first["upstream_url"] = false },
      -> { @catalog.delete("licenses") },
      -> { @catalog.fetch("licenses").first["url"] = "https://evil.invalid/license" },
      -> { @catalog.fetch("entries").first.fetch("license")["local_urls"] = ["/assets/challenges/licenses/unknown.txt"] },
      -> { @catalog.fetch("entries").find { |entry| entry["organizer_download"] }.fetch("organizer_download").delete("upstream_sha256") },
      -> { @catalog.fetch("entries").find { |entry| entry["organizer_download"] }.fetch("organizer_download")["url"] = "https://evil.invalid/organizer.py" },
    ]
    mutations.each do |mutate|
      @catalog = JSON.parse(PUBLIC_CATALOG)
      mutate.call
      assert_invalid { records }
    end
  end

  def test_duplicate_catalog_routes_ids_files_and_licenses_are_rejected
    mutations = [
      -> { @catalog.fetch("entries").last["id"] = @catalog.fetch("entries").first.fetch("id") },
      -> { @catalog.fetch("entries").last["url"] = @catalog.fetch("entries").first.fetch("url") },
      -> { @catalog.fetch("events") << @catalog.fetch("events").first.dup },
      -> { @catalog.fetch("licenses") << @catalog.fetch("licenses").first.dup },
      -> { @catalog.fetch("entries").first.fetch("files") << @catalog.fetch("entries").first.fetch("files").first.dup },
      -> { @catalog.fetch("entries").first.fetch("license").fetch("local_urls") << @catalog.fetch("licenses").first.fetch("url") },
    ]
    mutations.each do |mutate|
      @catalog = JSON.parse(PUBLIC_CATALOG)
      mutate.call
      assert_invalid(/duplicate/) { records }
    end
  end

  def test_primary_and_organizer_cannot_alias_the_same_download
    entry = @catalog.fetch("entries").find { |row| row["organizer_download"] }
    file = entry.fetch("organizer_download").slice("url", "bytes", "sha256", "download_name", "upstream_url")
    file["kind"] = "handout"
    entry.fetch("files") << file
    assert_invalid(/duplicate primary or organizer/) { records }
  end

  def test_static_page_post_and_collection_output_collisions_abort_the_build
    route = @catalog.fetch("entries").first.fetch("url") + "challenge.json"
    cases = [
      ["challenges/index.json", "existing static file"],
      [route, "existing static file"],
      [route.sub(/\.json\z/, ".txt"), "existing text file"],
      ["collision.html", "---\npermalink: #{route}\n---\nPage collision."],
      ["_posts/2024-01-01-collision.md", "---\npermalink: #{route}\n---\nPost collision."],
      ["_fixtures/collision.md", "---\npermalink: #{route}\n---\nCollection collision."],
      ["challenges", "ancestor file blocks every document"],
      [route + "/child.txt", "descendant blocks generated file"],
      ["challenges/INDEX.JSON", "case-folded collision"],
      ["collision.html", "---\npermalink: /challenges/%69ndex.json\n---\nEncoded collision."],
    ]
    write("_data/authored_challenges.json", JSON.generate(@catalog))
    cases.each do |path, bytes|
      write(path, bytes)
      assert_invalid(/collision/) { site("/preview", "collections" => { "fixtures" => { "output" => true } }).process }
      refute File.exist?(File.join(@dest, "challenges/index.json")), "collision must abort before writing"
      FileUtils.rm_rf(File.join(@source, path.delete_prefix("/")))
      # Remove empty ancestor directories so the later ancestor-file case is valid.
      Dir.glob(File.join(@source, "challenges/**/*")).sort.reverse_each do |directory|
        Dir.rmdir(directory) if File.directory?(directory) && Dir.empty?(directory)
      end
      directory = File.join(@source, "challenges")
      Dir.rmdir(directory) if File.directory?(directory) && Dir.empty?(directory)
    end
  end

  def test_post_render_rechecks_collisions_from_late_generators
    s = unit_site
    Documents::Generator.new.generate(s)
    late = Jekyll::PageWithoutAFile.new(s, @source, "challenges", "index.json")
    s.pages << late
    assert_invalid(/collision/) { Jekyll::Hooks.trigger(:site, :post_render, s) }
    refute File.exist?(File.join(@dest, "challenges/index.json"))
  end

  def test_symlink_and_filesystem_output_collisions_are_rejected_without_writing
    s = unit_site
    Documents::Generator.new.generate(s)
    artifact = s.static_files.grep(Documents::Artifact).first
    outside = File.join(@source, "agent_out/other-fixture")
    FileUtils.mkdir_p(outside)
    FileUtils.mkdir_p(@dest)
    File.symlink(outside, File.join(@dest, "challenges"))
    assert_invalid(/symlink/) { artifact.write(@dest) }
    assert_empty Dir.children(outside)
    File.unlink(File.join(@dest, "challenges"))
    write("challenges/index.json", "preserve this target", root: outside)
    FileUtils.mkdir_p(File.join(@dest, "challenges"))
    File.symlink(File.join(outside, "challenges/index.json"), File.join(@dest, "challenges/index.json"))
    assert_invalid(/symlink/) { artifact.write(@dest) }
    assert_equal "preserve this target", File.read(File.join(outside, "challenges/index.json"))
    File.unlink(File.join(@dest, "challenges/index.json"))
    FileUtils.mkdir_p(File.join(@dest, "challenges/index.json"))
    assert_invalid(/collision/) { artifact.write(@dest) }
  end
end
