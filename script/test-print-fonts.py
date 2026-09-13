#!/usr/bin/env python3
"""Offline print/font checks; --browser adds local Chromium cascade checks.

No build, downloads, or PDF generation. Browser fixtures contain no scripts;
fonts are embedded from local files and non-data requests are blocked.
Browser scratch files stay under agent_out/print-paper-pro/.
"""
import gzip
import hashlib
import json
from html.parser import HTMLParser
import re
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
BROWSER = "--browser" in sys.argv
if BROWSER:
    sys.argv.remove("--browser")


def source(path):
    return (ROOT / path).read_text(encoding="utf-8")


def uncomment(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def faces(css):
    return [dict(re.findall(r"([\w-]+)\s*:\s*([^;]+);", block))
            for block in re.findall(r"@font-face\s*{([^{}]*)}", css)]


class Links(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.links = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        if tag == "link":
            self.links.append(dict(attrs))


class PrintFontTests(unittest.TestCase):
    def test_native_print_link_after_all_head_styles(self):
        head = source("_includes/head.html")
        links = Links(head).links
        sheets = [link for link in links if link.get("rel") == "stylesheet"]
        prints = [link for link in sheets if "/assets/css/print.css" in link.get("href", "")]
        self.assertEqual(len(prints), 1)
        self.assertEqual(sheets[-1], prints[0])
        self.assertEqual(prints[0].get("media"), "print")
        self.assertEqual(prints[0].get("id"), "print-stylesheet")
        self.assertNotIn("onload", prints[0])
        self.assertNotIn("disabled", prints[0])
        self.assertIn("relative_url", prints[0]["href"])
        self.assertIn("asset_v", prints[0]["href"])
        self.assertGreater(head.index('id="print-stylesheet"'), head.index("page.stylesheets"))
        self.assertGreater(head.index('id="print-stylesheet"'), head.index('id="skin-stylesheet"'))

    def test_no_unconditional_font_preload(self):
        links = Links(source("_includes/head.html")).links
        self.assertFalse([link for link in links if link.get("rel") == "preload"
                          and link.get("as") == "font"])

    def test_preserved_local_faces_and_weights(self):
        found = faces(source("assets/css/main.css"))
        self.assertEqual(len(found), 16)
        weights = {}
        native_files = set()
        for face in found:
            family = face["font-family"].strip('"')
            weights.setdefault(family, set()).add(face.get("font-weight", "400"))
            self.assertEqual(face.get("font-style", "normal"), "normal")
            self.assertEqual(face["font-display"], "optional")
            url = re.search(r'url\("([^"\n]+)"\)', face["src"]).group(1)
            font = ROOT / "assets/css" / url
            self.assertTrue(font.is_file(), url)
            native_files.add(font.resolve())
            self.assertEqual(font.read_bytes()[:4], b"wOF2", url)
        self.assertEqual(weights["Atkinson Hyperlegible"], {"400", "700"})
        self.assertEqual(weights["Silkscreen"], {"400", "700"})
        self.assertEqual(weights["Theme Doto"], {"700 900"})
        self.assertEqual(weights["Theme Unbounded"], {"600 900"})
        self.assertEqual(len(native_files), 16)
        # The original global faces stay unchanged. Selected skins may declare
        # additional, explicitly inventoried fonts without preloading them.
        adopted = json.loads(source("assets/fonts/theme-library/PROVENANCE.json"))
        selected_files = {(ROOT / entry["path"]).resolve() for entry in adopted["files"]
                          if entry["path"].endswith(".woff2")}
        self.assertTrue(selected_files)
        self.assertTrue(all(path.is_relative_to(ROOT / "assets/fonts/theme-library")
                            for path in selected_files))
        self.assertFalse(native_files & selected_files)
        installed = {path.resolve() for path in (ROOT / "assets/fonts").rglob("*.woff2")}
        self.assertEqual(installed, native_files | selected_files)

    def test_selected_theme_font_evidence(self):
        # Screen font evidence follows the committed manifest. Print still uses
        # its original serif, tested independently below.
        output = subprocess.run(
            ["node", "--input-type=module", "-e",
             "import {loadThemes} from './script/test-theme-redesign-static.mjs';"
             "console.log(JSON.stringify(loadThemes()));"],
            cwd=ROOT, text=True, capture_output=True, check=True, timeout=30)
        themes = json.loads(output.stdout)
        self.assertEqual(len(themes), 47)
        for theme in themes.values():
            found = faces(source(theme["file"]))
            if theme.get("retained"):
                self.assertEqual(found, [], theme["id"])
                self.assertEqual(hashlib.sha256((ROOT / theme["file"]).read_bytes()).hexdigest(),
                                 theme["retained"]["sha256"])
                self.assertIn(theme["retained"]["display"], source(theme["file"]))
                continue
            self.assertEqual({face["font-family"].strip('\"\'') for face in found},
                             set(theme["families"]), theme["id"])
            for face in found:
                family = face["font-family"].strip('\"\'')
                self.assertEqual(face["font-display"],
                                 "swap" if family == theme["display"] else "optional")

    def test_grimoire_uses_existing_euler_fraktur(self):
        css = source("assets/css/skins/03-the-exploit-grimoire.css")
        displays = re.findall(r'--display:\s*([^;]+);', css)
        self.assertEqual(len(displays), 2)
        self.assertTrue(all(value.startswith('"Theme Euler Fraktur",') for value in displays))
        self.assertNotIn('"Theme Fascinate"', css)
        self.assertIn('--body: "Theme Computer Modern", Georgia, serif;', css)

    def test_one_small_print_sheet(self):
        css = source("assets/css/print.css")
        bare = uncomment(css).strip()
        self.assertTrue(bare.startswith("@media print {"))
        self.assertEqual(bare.count("@media print"), 1)
        self.assertEqual(bare.count("@layer print"), 1)
        self.assertNotIn("@media print", source("assets/css/main.css"))
        self.assertEqual(bare.count("{"), bare.count("}"))
        self.assertNotIn("@import", bare)
        self.assertNotIn("reset-size", bare)  # KaTeX ratios belong to math.css.
        self.assertLess(len(css.encode()), 11000)
        self.assertLess(len(gzip.compress(css.encode(), mtime=0)), 3000)
        for selector in (".site-header", ".site-footer", "[data-toybox]", ".skin-dice",
                         ".code-frame__gutter", ".record-grid > .record-index"):
            self.assertIn(selector, bare)
        # Preserve print's existing serif face, without replacing KaTeX fonts.
        self.assertEqual(len(faces(css)), 1)
        self.assertEqual(faces(css)[0]["font-family"], '"Theme Computer Modern"')
        self.assertIn(":not(:where(.katex, .katex *, svg, svg *))", css)

    def test_reading_and_pagination_contract(self):
        # Use the repository's CSS scanner, not brace counts, to enforce that
        # every declaration stays inside print media and the priority layer.
        output = subprocess.run(
            ["node", "--input-type=module", "-e", r'''
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {rules, declarations} from './script/test-article-css.mjs';
const top = rules(fs.readFileSync('assets/css/print.css', 'utf8'));
assert.deepEqual(top.map(r => r.prelude), ['@media print']);
const children = rules(top[0].body);
assert.deepEqual(children.map(r => r.prelude), ['@font-face', '@layer print']);
console.log(JSON.stringify(Object.fromEntries(rules(children[1].body).map(r =>
  [r.prelude, Object.fromEntries(declarations(r.body).map(d => [d.prop, d.value]))]))));
'''], cwd=ROOT, text=True, capture_output=True, check=True, timeout=30)
        rules = json.loads(output.stdout)
        self.assertEqual(rules['@page'], {'margin': '14mm'})  # No forced size.
        expected = {
            'html, body': {'font-size': '12pt !important', 'line-height': '1.55 !important'},
            '.record-head__key, .record-facts': {'font-size': '10pt !important'},
            '.prose :is(pre, code, kbd, samp, pre *, code *)': {'font-size': '10pt !important'},
            '.prose :is(p, li, dt, dd)': {'orphans': '3 !important', 'widows': '3 !important'},
            '.prose :is(p, ul, ol, dl, li, blockquote, table, tbody)': {'break-inside': 'auto !important'},
            'h1, h2, h3, h4, h5, h6': {'break-after': 'avoid-page !important', 'break-inside': 'avoid-page !important'},
            '.prose thead': {'display': 'table-header-group !important'},
            '.prose tfoot': {'display': 'table-footer-group !important'},
            '.prose :is(thead, tfoot, th)': {'position': 'static !important'},
            '.prose :is(tr, figure)': {'break-inside': 'avoid-page !important'},
            '.prose :is(caption, figcaption)': {'font-size': '10pt !important'},
            '.prose caption': {'break-after': 'avoid-page !important'},
            '.prose figcaption': {'break-before': 'avoid-page !important'},
            '.prose .katex-display': {'break-inside': 'avoid-page !important', 'overflow': 'visible !important'},
            '.prose a:not(:where(.katex, .katex *))': {'overflow-wrap': 'anywhere !important'},
        }
        for selector, properties in expected.items():
            for prop, value in properties.items():
                with self.subTest(selector=selector, property=prop):
                    self.assertEqual(rules[selector][prop], value)

    @unittest.skipUnless(BROWSER, "use --browser for installed Chromium; no downloads")
    def test_browser_cascade(self):
        subprocess.run(["node", "--input-type=module", "-"], input=BROWSER_CHECK,
                       cwd=ROOT, text=True, check=True, timeout=180)


BROWSER_CHECK = r'''
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(path.resolve('package.json'));
const cached = createRequire(path.resolve('.toolchain/package.json'));
const localPackage = name => {
  let resolved;
  try { resolved = require.resolve(name); }
  catch { resolved = cached.resolve(name); }
  return require(resolved);
};
const puppeteer = localPackage('puppeteer-core'), katex = localPackage('katex');
import {rulePreludes} from './script/css-rule-selectors.mjs';
const read = p => fs.readFileSync(p, 'utf8');
// Embed only repository WOFF2 files; no server or external font requests.
const css = p => read(p).replace(/url\(["']?([^\s)"']+\.woff2)["']?\)/g, (match, url) => {
  const file = path.resolve(path.dirname(p), url);
  assert.ok(file.startsWith(path.resolve('assets') + path.sep), 'font is local');
  return `url(data:font/woff2;base64,${fs.readFileSync(file).toString('base64')})`;
});
const main = css('assets/css/main.css'), print = css('assets/css/print.css');
const shared = [main, css('assets/css/theme-remediation.css'),
  css('assets/css/components/page-layout.css'), css('assets/css/components/article-layout.css'),
  css('assets/katex/katex.min.css'), css('assets/css/math.css'),
  css('assets/css/components/decorations.css')];
const skins = [null, ...fs.readdirSync('assets/css/skins').filter(f => f.endsWith('.css')).sort()];
const out = path.resolve('agent_out/print-paper-pro/browser');
fs.mkdirSync(out, {recursive: true});
const profile = fs.mkdtempSync(path.join(out, 'chrome-'));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_BIN || path.resolve('.toolchain/verify/browser/chrome-linux64/chrome'),
  userDataDir: profile, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
    '--disable-component-update', '--no-first-run', '--disable-domain-reliability',
    '--proxy-server=http://127.0.0.1:9', '--host-resolver-rules=MAP * ~NOTFOUND'],
  env: {...process.env, TMPDIR: out, LD_LIBRARY_PATH: [process.env.LD_LIBRARY_PATH,
    path.resolve('.toolchain/verify/browser/sysroot/usr/lib/x86_64-linux-gnu')].filter(Boolean).join(':')}
});
const formula = katex.renderToString(String.raw`\frac{x_i^2}{\sqrt{y}}+\begin{pmatrix}a&b\\c&d\end{pmatrix}`, {displayMode: true});
const fixture = `<body><button class="skin-dice">dice</button><button class="theme-toggle">theme</button>
<header class="site-header">header</header><div class="site-share">share</div><main class="record-page">
<header class="record-head"><h1>Article title</h1><p class="record-head__abstract">Abstract</p>
<dl class="record-facts"><div><dt>Published</dt><dd>2026-01-01</dd></div></dl></header>
<div class="record-grid"><article class="prose article__content"><h2>Heading <a class="heading-anchor">#</a></h2>
<p>Readable text with <code>inline_code</code>, <strong>bold</strong> and
<span id="inline-math">${katex.renderToString(String.raw`\alpha_i^2`)}</span>.</p><ul><li>A list item</li></ul>
<p id="long-link"><a href="#reference">https://example.invalid/${'long-url-'.repeat(40)}</a></p>
<blockquote><p>A quotation can continue across pages.</p></blockquote>
<pre id="raw"><code>${'x'.repeat(200)}</code></pre>
<div class="code-frame"><div class="code-frame__bar">copy</div><div class="code-frame__viewport">
<ol class="code-frame__gutter"><li>1</li></ol><div class="highlight"><pre><code><span class="k">${'y'.repeat(200)}</span></code></pre></div></div></div>
${formula}<table><caption>Table labels</caption><thead><tr><th>key</th><th>value</th></tr></thead>
<tbody>${'<tr><td>row</td><td>Readable table cell</td></tr>'.repeat(40)}</tbody>
<tfoot><tr><td colspan="2">Table footer</td></tr></tfoot></table>
<figure><svg width="240" height="80" viewBox="0 0 240 80"><g transform="translate(1 2)">
<rect width="230" height="70" fill="none" stroke="black"/></g></svg><figcaption>A figure and its caption</figcaption></figure>
</article><aside class="record-index">navigation</aside></div><footer class="record-end">footer</footer></main>
<footer class="site-footer">footer</footer><aside class="cookie-banner">cookies</aside><div data-toybox>toy</div></body>`;
try {
  const page = await browser.newPage();
  await page.setJavaScriptEnabled(false);
  await page.setRequestInterception(true);
  page.on('request', r => r.url().startsWith('data:') ? r.continue() : r.abort());
  const rules = [...rulePreludes(main), ...rulePreludes(print)];
  await page.evaluate(rules => {
    const sheet = new CSSStyleSheet();
    for (const {prelude} of rules) { sheet.insertRule(prelude + ' {}', 0); sheet.deleteRule(0); }
  }, rules);
  let checked = 0;
  const results = [];
  for (const skin of skins) {
    for (const mode of ['light', 'dark']) {
      const sheets = [shared[0], skin ? css('assets/css/skins/' + skin) : '', ...shared.slice(1)];
      const attr = skin ? `data-skin="${skin.slice(3, -4)}"` : '';
      const html = `<!doctype html><html ${attr} data-theme="${mode}"><head>${sheets.map(s => '<style>' + s + '</style>').join('')}</head>${fixture}</html>`;
      await page.setViewport({width: mode === 'light' ? 1440 : 768, height: 900});
      await page.emulateMediaType('screen');
      await page.setContent(html);
      await page.evaluate(() => document.fonts.ready);
      const screenStyles = () => page.evaluate(() => [...document.body.querySelectorAll('*')].map(e => {
        const s = getComputedStyle(e);
        return [...s].map(p => s.getPropertyValue(p)).join('|');
      }));
      const before = await screenStyles();
      await page.addStyleTag({content: print});
      assert.deepEqual(await screenStyles(), before, `screen unchanged: ${skin}/${mode}`);
      // Print is active before parsing the document: no beforeprint handler or
      // site JavaScript can repair a missing print rule in this fixture.
      await page.emulateMediaType('print');
      // A5 and A4 content widths at 96 CSS px/in, with 14 mm margins.
      const printWidth = Math.round(((mode === 'light' ? 148 : 210) - 28) * 96 / 25.4);
      await page.setViewport({width: printWidth, height: 1000});
      await page.setContent(html.replace('</head>', `<style media="print">${print}</style></head>`));
      await page.evaluate(() => document.fonts.ready);
      const failures = await page.evaluate(() => {
        const errors = [], check = (ok, message) => { if (!ok) errors.push(message); };
        const style = s => getComputedStyle(document.querySelector(s));
        for (const s of ['.skin-dice', '.theme-toggle', '.site-header', '.site-share', '.site-footer',
          '.record-index', '.record-end', '.heading-anchor', '.code-frame__bar', '.code-frame__gutter',
          '.cookie-banner', '[data-toybox]']) check(style(s).display === 'none', s + ' hidden');
        for (const s of ['main', '.record-grid', '.article__content', '.record-head', '.code-frame__viewport']) {
          check(style(s).display === 'block', s + ' single column');
          check(style(s).overflow === 'visible', s + ' not clipped');
        }
        for (const s of ['pre', 'pre code', '.highlight pre', '.highlight code']) {
          check(style(s).whiteSpace === 'pre-wrap', s + ' wraps');
          check(style(s).minWidth === '0px', s + ' shrinks');
          check(style(s).fontFamily.includes('monospace'), s + ' monospace');
        }
        for (const e of document.querySelectorAll('pre')) {
          check(e.scrollWidth <= e.clientWidth + 1, 'long code fits print width');
          check(e.getBoundingClientRect().height > 0, 'code remains visible');
        }
        check(style('body').fontSize === '16px', '12pt body');
        check(Math.abs(parseFloat(style('body').lineHeight) - 24.8) < .01, '1.55 body leading');
        for (const s of ['code', '.record-facts', 'caption', 'figcaption']) {
          check(Math.abs(parseFloat(style(s).fontSize) - 40 / 3) < .01, s + ' 10pt');
        }
        for (const s of ['.prose p', '.prose li']) {
          check(style(s).orphans === '3' && style(s).widows === '3', s + ' widow/orphan control');
        }
        for (const s of ['.prose p', '.prose ul', '.prose li', 'blockquote', 'table', 'tbody', 'pre', '.record-grid']) {
          check(style(s).breakInside === 'auto', s + ' can cross pages');
        }
        check(style('h2').breakAfter === 'avoid-page', 'heading stays with following text');
        for (const s of ['h2', 'tr', 'figure', '.katex-display']) {
          check(style(s).breakInside === 'avoid-page', s + ' kept together when possible');
        }
        check(style('thead').display === 'table-header-group', 'repeating table header');
        check(style('tfoot').display === 'table-footer-group', 'repeating table footer');
        check(style('th').position === 'static', 'table header not sticky');
        check(style('figcaption').breakBefore === 'avoid-page', 'caption follows figure');
        const link = document.querySelector('#long-link');
        check(link.scrollWidth <= link.clientWidth + 1, 'long URL fits print width');
        check(document.fonts.check('16px "Theme Computer Modern"'), 'print serif loaded');
        check(document.fonts.check('16px KaTeX_Main'), 'math face loaded');
        check(style('.highlight .k').color === 'rgb(0, 0, 0)', 'black code');
        check(style('.prose').fontFamily.includes('Theme Computer Modern'), 'print serif preserved');
        check(style('.katex').fontFamily.includes('KaTeX'), 'KaTeX font preserved');
        check(style('#inline-math .katex').display === 'inline', 'inline math stays in the line');
        check(style('.katex .vlist-s').fontSize === '1px', 'KaTeX vertical-list spacer preserved');
        const radical = document.querySelector('.katex .sqrt svg');
        check(radical !== null && radical.getBoundingClientRect().height > 0, 'radical SVG visible');
        check(style('.frac-line').borderBottomStyle === 'solid', 'fraction bar preserved');
        check(parseFloat(style('.frac-line').borderBottomWidth) > 0, 'fraction bar visible');
        check(style('svg g').transform !== 'none', 'SVG transform preserved');
        check(style('.katex-display').overflow === 'visible', 'math not clipped by viewport');
        check(style('.katex-display > .katex > .katex-html').whiteSpace === 'normal', 'display math allows line breaks');
        check(document.querySelectorAll('.katex-sizing').length > 0, 'script-size assertion exercised');
        for (const e of document.querySelectorAll('.katex-sizing')) {
          const own = parseFloat(getComputedStyle(e).fontSize);
          const parent = parseFloat(getComputedStyle(e.parentElement).fontSize);
          const expected = Number(getComputedStyle(e).getPropertyValue('--math-size')) /
            Number(getComputedStyle(e).getPropertyValue('--math-reset'));
          check(Math.abs(own / parent - expected) < .002, 'KaTeX script-size ratio');
        }
        check(style('.prose table').display === 'table', 'table layout');
        check(document.querySelector('main').getBoundingClientRect().width <= innerWidth, 'shell fits paper viewport');
        return errors;
      });
      assert.deepEqual(failures, [], `${skin}/${mode}`);
      results.push({skin: skin || 'default', mode, printWidth, pass: true});
      if (!skin && mode === 'light') {
        await page.screenshot({path: path.join(out, 'a5-print-media.png'), fullPage: true});
      }
      checked++;
    }
  }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({
    browser: await browser.version(), cases: results,
    limitations: ['Print media emulation, not paginated output or device testing.',
      'No PDF generation; page breaks and repeated table headers are style assertions.',
      'Synthetic article, not a full Jekyll build. Fonts embedded from local files.']
  }, null, 2) + '\n');
  console.log(`${rules.length} CSS rule preludes parsed; ${checked} script-free print/screen fixture cases passed.`);
} finally {
  await browser.close();
  fs.rmSync(profile, {recursive: true, force: true});
}
'''

if __name__ == "__main__":
    unittest.main(verbosity=2)
