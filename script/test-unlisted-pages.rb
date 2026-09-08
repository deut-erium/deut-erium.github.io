#!/usr/bin/env ruby
# frozen_string_literal: true

# Local Jekyll publication tests. Ciphertext here is a structural placeholder;
# test-embed-post-assets.py covers the real producer/WebCrypto roundtrip.
require "fileutils"
require "json"
require "tmpdir"
require "jekyll"

root = File.expand_path("..", __dir__)
scratch = File.join(root, "agent_out", "unlisted-tests")
FileUtils.mkdir_p(scratch)
checks = 0
assert = lambda do |condition, message|
  raise message unless condition
  checks += 1
end

Dir.mktmpdir("jekyll-", scratch) do |source|
  %w[_layouts _includes].each { |name| FileUtils.cp_r(File.join(root, name), source) }
  FileUtils.mkdir_p(File.join(source, "_plugins"))
  %w[asset_version section_metadata index_json challenges_index unlisted_pages].each do |name|
    FileUtils.cp(File.join(root, "_plugins", "#{name}.rb"), File.join(source, "_plugins"))
  end
  FileUtils.cp(File.join(root, "_config.yml"), source)
  write = lambda do |path, bytes|
    path = File.join(source, path)
    FileUtils.mkdir_p(File.dirname(path))
    File.write(path, bytes)
  end
  payload = '<div class="argon" data-salt="00000000000000000000000000000000" data-needs="fixture" aria-live="polite"><span hidden>c3RydWN0dXJhbC1maXh0dXJl</span></div>'
  page = lambda do |title, metadata = "", body = payload|
    "---\ntitle: #{title}\nlayout: locked\ndate: 2099-01-01\nsection: ramblings\n#{metadata}---\n#{body}\n"
  end
  form = lambda do |name, digit|
    %(<form data-flag-check data-sha256="#{digit * 64}"><input id="flag-#{name}" data-flag-input></form>)
  end
  first_path = "_posts/ramblings/2099-01-01-chain-entry.md"
  first = page.call("Visible entry", "tags: visible\n", form.call("visible-fixture", "1") + payload)
  write.call(first_path, first)
  write.call("_posts/ramblings/2098-12-31-control.md", page.call("Visible control", "tags: visible\n"))
  write.call("index.html", "---\nlayout: home\n---\n")
  write.call("archive.html", "---\nlayout: archive\n---\n")
  write.call("ramblings/index.html", "---\nlayout: section_home\nsection: ramblings\ntitle: Ramblings\n---\n")
  write.call("scoreboard/index.html", '<script id="scoreboard-known" type="application/json">[]</script>')
  write.call("ramblings/feed.xml", "---\nlayout: null\nsection: ramblings\nsection_home: /ramblings/\npermalink: /ramblings/feed.xml\n---\n{% include section-feed.xml %}")
  write.call("ramblings/sitemap.xml", "---\nlayout: null\nsection: ramblings\nsection_home: /ramblings/\n---\n{% include section-sitemap.xml %}")

  hidden_path = "locked/2099/01/02/hidden-one.md"
  hidden_url = "/locked/2099/01/02/hidden-one.html"
  second_url = "/locked/2099/01/03/hidden-two.html"
  hidden = page.call("Unlisted fixture one", "unlisted: true\ntags: hidden-only\n", form.call("unlisted-fixture", "0") + payload)
  write.call(hidden_path, hidden)
  # No explicit visibility flags: the production directory defaults must apply.
  write.call("locked/2099/01/03/hidden-two.md", page.call("Unlisted fixture two", "tags: hidden-only\n"))
  public_url = "/ramblings/2099/01/01/public-page.html"
  write.call("ramblings/2099/01/01/public-page.md", page.call("Public standalone"))
  write.call("_data/arg_chain.yml", [hidden_url, second_url, public_url].map { |url| "- post: #{url}\n  needs: fixture\n" }.join)

  config = Jekyll.configuration(
    "source" => source, "destination" => File.join(source, "agent_out", "site"),
    "config" => File.join(source, "_config.yml"), "quiet" => true,
    "disable_disk_cache" => true, "paginate" => 1, "goatcounter_site" => ""
  )
  build = lambda do
    FileUtils.rm_rf(config.fetch("destination"))
    site = Jekyll::Site.new(config)
    site.process
    site
  end
  build.call
  dest = config.fetch("destination")
  read = ->(path) { File.read(File.join(dest, path)) }
  [hidden_url, second_url].each do |url|
    html = read.call(url.delete_prefix("/"))
    assert.call(html.include?('content="noindex, follow"'), "missing noindex: #{url}")
    assert.call(html.include?('class="argon"'), "missing locked payload: #{url}")
    assert.call(html.include?('features/argon.js'), "missing unlocker: #{url}")
  end
  # Check all rendered lists/related cards, not just the homepage. Public links
  # authored deliberately are allowed; none are added in this fixture.
  Dir.glob(File.join(dest, "**", "*.{html,json,jsonl,xml}")).each do |path|
    route = "/" + path.delete_prefix(dest + "/")
    next if [hidden_url, second_url].include?(route)
    text = File.read(path)
    [hidden_url, second_url, "Unlisted fixture", "hidden-only", "unlisted-fixture"].each do |token|
      assert.call(!text.include?(token), "unlisted entry leaked into #{route}: #{token}")
    end
  end
  assert.call(JSON.parse(read.call("index.json")).length == 2, "post count changed")
  assert.call(read.call("index.jsonl").lines.length == 2, "JSONL count changed")
  assert.call(read.call("archive.html").include?('js-result-count">2</span>'), "archive count changed")
  assert.call(read.call("archive.html").include?('All tags <span>1</span>'), "unlisted tags leaked")
  assert.call(read.call("page2/index.html").include?("Visible control"), "pagination dropped a listed post")
  assert.call(read.call("feed.xml").include?("Visible entry"), "entry missing from root feed")
  assert.call(read.call("ramblings/feed.xml").include?("Visible entry"), "entry missing from section feed")
  assert.call(read.call("ramblings/index.html").include?(public_url), "ordinary --page listing disappeared")
  assert.call(read.call("ramblings/index.html").include?("1 sealed"), "locked listing counted unlisted pages")
  assert.call(JSON.parse(read.call("challenges.json")).map { |row| row["id"] } == ["visible-fixture"], "challenge index membership changed")
  assert.call(read.call("scoreboard/index.html").include?("visible-fixture"), "visible challenge absent from scoreboard")

  write.call(hidden_path, hidden.sub("unlisted: true", "unlisted: true\nsitemap: true\nnoindex: false"))
  build.call
  assert.call(read.call(hidden_url.delete_prefix("/")).include?('content="noindex, follow"'), "noindex override bypass")
  assert.call(!read.call("sitemap.xml").include?(hidden_url), "sitemap override bypass")
  write.call(hidden_path, hidden)

  failures = {
    "string flag" => [hidden_path, hidden.sub("unlisted: true", 'unlisted: "true"'), "YAML boolean"],
    "false flag" => [hidden_path, hidden.sub("unlisted: true", "unlisted: false"), "must be unlisted"],
    "wrong layout" => [hidden_path, hidden.sub("layout: locked", "layout: article"), "standalone locked page"],
    "missing payload" => [hidden_path, hidden.sub(payload, "<p>Plaintext draft.</p>"), "has no payload"],
    "unlisted post" => [first_path, first.sub("layout: locked", "layout: locked\nunlisted: true"), "not a post"],
    "output collision" => [hidden_path, hidden.sub("unlisted: true", "unlisted: true\npermalink: /ramblings/2099/01/01/chain-entry.html"), "collides"],
    "raw asset" => ["locked/private.txt", "Unencrypted asset", "only encrypted pages"]
  }
  failures.each do |name, (path, bytes, expected)|
    write.call(path, bytes)
    error = begin
      build.call
      nil
    rescue StandardError => e
      e
    end
    assert.call(error && error.message.include?(expected), "#{name}: wrong error #{error&.message.inspect}")
    assert.call(!File.exist?(File.join(dest, hidden_url.delete_prefix("/"))), "#{name}: wrote page before rejecting")
    if path == first_path
      write.call(first_path, first)
    elsif path == hidden_path
      write.call(hidden_path, hidden)
    else
      File.unlink(File.join(source, path))
    end
  end
end
puts JSON.pretty_generate({ "pass" => true, "assertions" => checks, "rejected_configurations" => 7 })
