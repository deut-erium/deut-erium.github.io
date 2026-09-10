#!/usr/bin/env ruby
# frozen_string_literal: true

require "bundler/setup"
require "jekyll"
require "fileutils"
require "tmpdir"
require "json"
require "open3"
require_relative "../_plugins/render_compatibility"
require_relative "../_plugins/article_contents"
require_relative "../_plugins/asset_version"
require_relative "../_plugins/katex_math"

ROOT = File.expand_path("..", __dir__)
OUT = File.join(ROOT, "agent_out/article-layout-rework/contents")
FileUtils.mkdir_p(OUT)
checks = 0
assert = lambda do |condition, message|
  raise message unless condition
  checks += 1
end
render = lambda do |html, section = "ramblings"|
  original = html.dup
  result = DeuteriumSite::ArticleContents.render(html.freeze, section)
  assert.call(html == original, "filter mutated its input")
  result
end
item = ->(level, href, title) { %(<li class="toc-h#{level}"><a href="#{href}">#{title}</a></li>) }

html = <<~HTML
  <h2 id="start"> Start <em>here</em> </h2>
  <h3 title="a > b" id='a&amp;b /%?#&quot;é'>Use <code>&lt;T&gt; &amp; x</code><!-- not a label --><br> now</h3>
  <h4 ID="punct!~*'()_-." >&#160;Math <math><mi>α</mi><mo>&lt;</mo><mn>2</mn></math> &copy; &#x1F600; &amp;lt;&#xFEFF;</h4>
  <h5 id="too-deep">Not in contents</h5><h2>No ID</h2><h3 id="">Empty ID</h3>
  <h2 id="empty"> &#160; </h2>
  <pre><code>&lt;h2 id="fake"&gt;not a heading&lt;/h2&gt; &amp;keep;</code></pre>
HTML
expected = "<ol>" + item.call(2, "#start", "Start here") +
  item.call(3, "#a%26b%20%2F%25%3F%23%22%C3%A9", "Use &lt;T&gt; &amp; x now") +
  item.call(4, "#punct!~*&#39;()_-.", "Math α&lt;2 © 😀 &amp;lt;") + "</ol>"
assert.call(render.call(html) == expected, "exact heading levels, labels, escaping or encoding differ")

[
  "", "<p>No sections.</p>", '<h2>No ID</h2>', '<h2 id="">Empty</h2>',
  '<h2 id="same">First</h2><h2 id="same">Second</h2>',
  '<p id="same">Earlier non-heading</p><h2 id="same">Heading</h2>',
  '<h2 id="same">Heading</h2><div id="s&#97;me">Later duplicate</div>',
  '<h2 id="article-body">Layout ID collision</h2>', '<h2 id="content">Main ID collision</h2>',
  '<!-- <h2 id="fake">Comment</h2> --><script>"<h2 id=bad>Script</h2>"</script>',
  '<style>/* <h2 id="fake">Style</h2> */</style>',
  '<template><h2 id="fake">Template</h2></template>',
  '<noscript><h2 id="fake">No-script-only target</h2></noscript>',
  '<template id="same"></template><h2 id="same">Container collision</h2>',
  '<textarea><h2 id="fake">Textarea</h2></textarea>',
  '<h2 id="first" id="second">Ambiguous attributes</h2>',
  '<h2 id="broken"><em>Unclosed markup</h2>'
].each do |input|
  assert.call(render.call(input) == "", "expected omitted contents: #{input}")
end
assert.call(render.call('<h2 id="&NotEqualTilde;&Afr;&#x80;">&NotEqualTilde; &Afr; &#128; &#0; &unknown;</h2>') ==
  "<ol>#{item.call(2, '#%E2%89%82%CC%B8%F0%9D%94%84%E2%82%AC', '≂̸ 𝔄 € � &amp;unknown;')}</ol>", "HTML5 or numeric entity decoding differs")
assert.call(render.call('<h2 id="same">A</h2><h2 id="same">B</h2><h2 id="ok">C</h2>') ==
  "<ol>#{item.call(2, '#ok', 'C')}</ol>", "duplicate IDs suppressed unrelated sections")
assert.call(render.call('<h2 id="raw">A  <span>B</span>\n C</h2>') ==
  "<ol>#{item.call(2, '#raw', 'A  B\n C')}</ol>", "internal whitespace changed")
assert.call(render.call('<H2 ID="upper">UPPER</H2>') ==
  "<ol>#{item.call(2, '#upper', 'UPPER')}</ol>", "uppercase tags or attributes lost")
assert.call(render.call('<h2 id=foo-bar>Hyphen</h2><h3 title="fake id=wrong >" id=a/b>Slash</h3>') ==
  "<ol>#{item.call(2, '#foo-bar', 'Hyphen')}#{item.call(3, '#a%2Fb', 'Slash')}</ol>", "unquoted ID or quoted attribute parsed incorrectly")
assert.call(render.call('<h2 id="raw-script"><script>"<h2 id=foo-bar>"</script>Label</h2>') ==
  "<ol>#{item.call(2, '#raw-script', '&quot;&lt;h2 id=foo-bar&gt;&quot;Label')}</ol>", "raw script text changed during parsing")
assert.call(render.call('<h2 id="rcdata"><textarea>&amp; <h2 id=fake></textarea></h2>') ==
  "<ol>#{item.call(2, '#rcdata', '&amp; &lt;h2 id=fake&gt;')}</ol>", "RCDATA label differs")
# The existing compatibility hook lowers tutorial headings, then clamps gaps.
assert.call(render.call('<h3 id="a">A</h3><h4 id="b">B</h4><h5 id="c">C</h5>', "tutorials") ==
  "<ol>#{item.call(2, '#a', 'A')}#{item.call(3, '#b', 'B')}#{item.call(4, '#c', 'C')}</ol>", "published tutorial levels differ")
assert.call(render.call('<h6 id="gap">Gap</h6>') ==
  "<ol>#{item.call(2, '#gap', 'Gap')}</ol>", "published outline clamp differs")

# Run the real converter (including build-time KaTeX), then the actual article
# layout in a small Jekyll site. Stub only the unrelated base layout/QR include.
markdown = <<~MD
  # Start `x < 2` & more

  Text.

  ## Math $$x^2 + 1$$

  ### Last

  ```html
  <h2 id="fake">Keep code & quotes exactly.</h2>
  ```

  <h2 id="special &amp; /%?#é">Special &amp; <code>&lt;x&gt;</code></h2>

  <h2 id="dup">First duplicate</h2><h2 id="dup">Second duplicate</h2>

  <h2 id="&NotEqualTilde;&Afr;&#x80;">&NotEqualTilde; &Afr; &#128; &#0; &unknown;</h2>
MD
browser_cases = []
Dir.mktmpdir("fixtures-", OUT) do |source|
  FileUtils.mkdir_p(File.join(source, "_layouts"))
  FileUtils.mkdir_p(File.join(source, "_includes"))
  FileUtils.cp(File.join(ROOT, "_layouts/article.html"), File.join(source, "_layouts"))
  File.write(File.join(source, "_layouts/base.html"), "<!doctype html><html><head><meta charset=\"utf-8\"></head><body>{{ content }}</body></html>")
  File.write(File.join(source, "_includes/qr-share.html"), "")
  metadata = "---\nlayout: article\ntitle: Contents fixture\nsection: tutorials\ndate: 2026-01-01\n---\n"
  File.write(File.join(source, "article.md"), metadata + markdown)
  File.write(File.join(source, "empty.md"), metadata + "No headings.\n")
  ["", "/preview"].each do |baseurl|
    config = Jekyll.configuration(
      "source" => source, "destination" => File.join(source, "agent_out", baseurl.empty? ? "root" : "baseurl"),
      "config" => [], "quiet" => true, "disable_disk_cache" => true,
      "url" => "https://example.invalid", "baseurl" => baseurl,
      "kramdown" => { "input" => "GFM", "header_offset" => 1, "math_engine" => "mathjax" }
    )
    site = Jekyll::Site.new(config)
    site.process
    output = File.read(File.join(site.dest, "article.html"), encoding: "UTF-8")
    empty = File.read(File.join(site.dest, "empty.html"), encoding: "UTF-8")
    converted = site.find_converter_instance(Jekyll::Converters::Markdown).convert(markdown)
    baseline = DeuteriumSite::ArticleContents::Projection.new(
      %(<main><article id="article-body">#{converted}</article></main>), { "section" => "tutorials" }
    )
    DeuteriumSite::RenderCompatibility.restore_heading_levels(baseline)
    DeuteriumSite::RenderCompatibility.normalize_heading_outline(baseline)
    article = output[/<article\b[^>]*>(.*?)<\/article>/m, 1]
    assert.call(article == baseline.output[/<article\b[^>]*>(.*?)<\/article>/m, 1], "layout/filter changed article bytes")
    assert.call(article.include?('class="katex"'), "math fixture did not render KaTeX")
    assert.call(output.include?('<nav class="js-toc-root" data-toc-built aria-label="Table of contents"><ol>'), "static contents missing")
    assert.call(!output.include?("Enable JavaScript"), "JS-only fallback remains")
    assert.call(!empty.include?('class="record-toc"'), "empty article has a contents disclosure")
    assert.call(empty.include?('class="related-records"'), "empty contents removed related navigation")
    assert.call(output.include?(%(src="#{baseurl}/assets/js/article.js?)), "asset baseurl changed")
    assert.call(output.include?('href="#special%20%26%20%2F%25%3F%23%C3%A9"'), "local fragment was prefixed or misencoded")
    assert.call(!output.include?('href="#dup"'), "duplicate target linked")
    browser_cases << { html: output, empty: empty, url: "http://contents.invalid#{baseurl}/article.html" }
  end
end
puts "Passed #{checks} Ruby/filter/Jekyll assertions (root and /preview)."

# Optional, offline browser checks using the already-installed verification
# toolchain. Requests are fulfilled in memory or aborted; no server is needed.
if ARGV.include?("--browser")
  browser_test = <<~'JS'
    import fs from 'node:fs';
    import path from 'node:path';
    import assert from 'node:assert/strict';
    import puppeteer from 'puppeteer-core';
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const browser = await puppeteer.launch({
      executablePath: process.env.CHROME_BIN || path.resolve('.toolchain/verify/browser/chrome-linux64/chrome'),
      headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking'],
      env: { ...process.env, LD_LIBRARY_PATH: path.resolve('.toolchain/verify/browser/sysroot/usr/lib/x86_64-linux-gnu') }
    });
    let cases = 0;
    try {
      for (const fixture of input.cases) for (const width of [390, 1440]) for (const js of [false, true]) {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.setViewport({width, height: 900});
        await page.setJavaScriptEnabled(js);
        await page.setRequestInterception(true);
        page.on('request', r => {
          if (r.url() === fixture.url) r.respond({status: 200, contentType: 'text/html', body: fixture.html});
          else if (r.url().includes('/assets/js/article.js?')) r.respond({status: 200, contentType: 'text/javascript', body: input.script});
          else r.abort();
        });
        await page.goto(fixture.url, {waitUntil: 'load'});
        const state = await page.evaluate(() => {
          const article = document.querySelector('article');
          const headings = [...article.querySelectorAll('h2[id], h3[id], h4[id]')];
          const counts = new Map();
          document.querySelectorAll('[id]').forEach(n => counts.set(n.id, (counts.get(n.id) || 0) + 1));
          const eligible = headings.filter(h => h.id && counts.get(h.id) === 1 && h.textContent.trim());
          const expected = eligible.map(h => {
            const copy = h.cloneNode(true);
            copy.querySelectorAll('.heading-anchor').forEach(a => a.remove());
            return {href: '#' + encodeURIComponent(h.id), title: copy.textContent.trim(), className: 'toc-' + h.localName};
          });
          const actual = [...document.querySelectorAll('.js-toc-root li')].map(li => ({
            href: li.firstElementChild.getAttribute('href'), title: li.textContent, className: li.className
          }));
          window.savedList = document.querySelector('.js-toc-root ol');
          window.savedArticle = article.innerHTML;
          return {expected, actual, anchors: article.querySelectorAll('.heading-anchor').length,
            open: document.querySelector('.record-toc').open, code: article.querySelector('pre code').textContent};
        });
        assert.deepEqual(state.actual, state.expected, 'build output differs from browser headings');
        assert.equal(state.open, !js || width === 1440);
        assert.equal(state.anchors, js ? state.expected.length : 0);
        assert.equal(state.code, '<h2 id="fake">Keep code & quotes exactly.</h2>\n');
        if (!state.open) await page.click('.record-toc summary');
        const special = '.js-toc-root a[href="#special%20%26%20%2F%25%3F%23%C3%A9"]';
        await page.click(special);
        assert.equal(await page.evaluate(() => location.href), fixture.url + '#special%20%26%20%2F%25%3F%23%C3%A9');
        assert.equal(await page.$eval(':target', n => n.id), 'special & /%?#é');
        if (js) {
          await page.evaluate(input.script);
          assert.equal(await page.evaluate(() => window.savedList === document.querySelector('.js-toc-root ol')), true);
          assert.equal(await page.evaluate(() => window.savedArticle === document.querySelector('article').innerHTML), true);
          assert.equal(await page.$eval('.record-toc', n => n.open), true, 'second boot collapsed user-opened contents');
        }
        await page.click('.record-toc summary');
        assert.equal(await page.$eval('.record-toc', n => n.open), false);
        await page.click('.record-toc summary');
        assert.equal(await page.$eval('.record-toc', n => n.open), true);
        assert.deepEqual(errors, []);
        await page.close();
        cases++;
      }
      // Shared JS must still enhance the unowned writeup layout's fallback.
      const page = await browser.newPage();
      await page.setContent('<article class="js-article-content"><h2 id="old">Old layout</h2></article><details open><nav class="js-toc-root"><p>Enable JavaScript</p></nav></details>');
      await page.evaluate(input.script);
      await page.evaluate(input.script);
      assert.equal(await page.$$eval('.js-toc-root a', ns => ns.length), 1);
      assert.equal(await page.$$eval('.heading-anchor', ns => ns.length), 1);
      assert.equal(await page.$eval('.js-toc-root a', n => n.textContent), 'Old layout');
      await page.close();
      console.log(`Passed ${cases} offline browser cases plus legacy fallback/repeated boot.`);
    } finally { await browser.close(); }
  JS
  stdout, stderr, status = Open3.capture3("node", "--input-type=module", "-e", browser_test,
    stdin_data: JSON.generate(cases: browser_cases, script: File.read(File.join(ROOT, "assets/js/article.js"))), chdir: ROOT)
  puts stdout
  warn stderr unless stderr.empty?
  raise "browser checks failed" unless status.success?
end
