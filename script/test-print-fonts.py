#!/usr/bin/env python3
"""Offline print/font checks; --browser adds local Chromium cascade checks.

No build, downloads, or request-byte claims. Browser fixtures contain no scripts;
all requests are blocked. Browser scratch files stay under agent_out/.
"""
import gzip
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
        for face in found:
            family = face["font-family"].strip('"')
            weights.setdefault(family, set()).add(face.get("font-weight", "400"))
            self.assertEqual(face.get("font-style", "normal"), "normal")
            self.assertEqual(face["font-display"], "optional")
            url = re.search(r'url\("([^"\n]+)"\)', face["src"]).group(1)
            font = ROOT / "assets/css" / url
            self.assertTrue(font.is_file(), url)
            self.assertEqual(font.read_bytes()[:4], b"wOF2", url)
        self.assertEqual(weights["Atkinson Hyperlegible"], {"400", "700"})
        self.assertEqual(weights["Silkscreen"], {"400", "700"})
        self.assertEqual(weights["Theme Doto"], {"700 900"})
        self.assertEqual(weights["Theme Unbounded"], {"600 900"})
        self.assertEqual(len(list((ROOT / "assets/fonts").rglob("*.woff2"))), 16)

    def test_selected_theme_font_evidence(self):
        # These skins have no Atkinson reference; others still use it, so the
        # face must remain available through CSS, not be deleted globally.
        for filename in ("29-unknown-at-rf-0-73.css", "30-collision-atlas.css",
                         "36-margin-of-error.css", "45-magnetic-index.css"):
            css = source("assets/css/skins/" + filename)
            self.assertNotIn("Atkinson Hyperlegible", css)
            self.assertIn('"Theme Computer Modern"', css)
        self.assertIn('"Atkinson Hyperlegible"', source("assets/css/skins/01-grid-meltdown.css"))

    def test_grimoire_uses_existing_euler_fraktur(self):
        css = source("assets/css/skins/03-the-exploit-grimoire.css")
        displays = re.findall(r'--display:\s*([^;]+);', css)
        self.assertEqual(len(displays), 2)
        self.assertTrue(all(value.startswith('"Theme Euler Fraktur",') for value in displays))
        self.assertNotIn('"Theme Fascinate"', css)
        self.assertIn('--body: "Theme Computer Modern", Georgia, serif;', css)
        self.assertIn('font-family: "Theme Euler Fraktur";', source("assets/css/main.css"))

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

    @unittest.skipUnless(BROWSER, "use --browser for installed Chromium; no downloads")
    def test_browser_cascade(self):
        subprocess.run(["node", "--input-type=module", "-"], input=BROWSER_CHECK,
                       cwd=ROOT, text=True, check=True, timeout=180)


BROWSER_CHECK = r'''
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import katex from 'katex';
import {rulePreludes} from './script/css-rule-selectors.mjs';
const read = p => fs.readFileSync(p, 'utf8');
const main = read('assets/css/main.css'), print = read('assets/css/print.css');
const shared = [main, read('assets/css/theme-remediation.css'),
  read('assets/katex/katex.min.css'), read('assets/css/math.css')];
const skins = [null, ...fs.readdirSync('assets/css/skins').filter(f => f.endsWith('.css')).sort()];
const out = path.resolve('agent_out/article-layout-rework/loading');
fs.mkdirSync(out, {recursive: true});
const profile = fs.mkdtempSync(path.join(out, 'chrome-'));
const browser = await puppeteer.launch({
  executablePath: path.resolve('.toolchain/verify/browser/chrome-linux64/chrome'),
  userDataDir: profile, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking'],
  env: {...process.env, LD_LIBRARY_PATH: path.resolve('.toolchain/verify/browser/sysroot/usr/lib/x86_64-linux-gnu')}
});
const formula = katex.renderToString(String.raw`\frac{x_i^2}{\sqrt{y}}+\begin{pmatrix}a&b\\c&d\end{pmatrix}`, {displayMode: true});
const fixture = `<body><button class="skin-dice">dice</button><button class="theme-toggle">theme</button>
<header class="site-header">header</header><div class="site-share">share</div><main class="record-page">
<header class="record-head"><h1>Article title</h1><p class="record-head__abstract">Abstract</p></header>
<div class="record-grid"><article class="prose article__content"><h2>Heading <a class="heading-anchor">#</a></h2>
<p>Readable text with <code>inline_code</code> and <strong>bold</strong>.</p><ul><li>A list item</li></ul>
<pre id="raw"><code>${'x'.repeat(200)}</code></pre>
<div class="code-frame"><div class="code-frame__bar">copy</div><div class="code-frame__viewport">
<ol class="code-frame__gutter"><li>1</li></ol><div class="highlight"><pre><code><span class="k">${'y'.repeat(200)}</span></code></pre></div></div></div>
${formula}<table><thead><tr><th>key</th></tr></thead><tbody><tr><td>value</td></tr></tbody></table>
<svg viewBox="0 0 10 10"><g transform="translate(1 2)"><path d="M0 0L1 1"/></g></svg>
</article><aside class="record-index">navigation</aside></div><footer class="record-end">footer</footer></main>
<footer class="site-footer">footer</footer><aside class="cookie-banner">cookies</aside><div data-toybox>toy</div></body>`;
try {
  const page = await browser.newPage();
  await page.setJavaScriptEnabled(false);
  await page.setRequestInterception(true);
  page.on('request', r => r.abort()); // No local server or external resources.
  const rules = [...rulePreludes(main), ...rulePreludes(print)];
  await page.evaluate(rules => {
    const sheet = new CSSStyleSheet();
    for (const {prelude} of rules) { sheet.insertRule(prelude + ' {}', 0); sheet.deleteRule(0); }
  }, rules);
  let checked = 0;
  for (const skin of skins) {
    for (const mode of ['light', 'dark']) {
      const css = [shared[0], skin ? read('assets/css/skins/' + skin) : '', ...shared.slice(1)];
      const attr = skin ? `data-skin="${skin.slice(3, -4)}"` : '';
      const html = `<html ${attr} data-theme="${mode}"><head>${css.map(s => '<style>' + s + '</style>').join('')}</head>${fixture}</html>`;
      await page.setViewport({width: mode === 'light' ? 1440 : 768, height: 900});
      await page.emulateMediaType('screen');
      await page.setContent(html);
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
      await page.setContent(html.replace('</head>', `<style media="print">${print}</style></head>`));
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
        check(style('.highlight .k').color === 'rgb(0, 0, 0)', 'black code');
        check(style('.prose').fontFamily.includes('Theme Computer Modern'), 'print serif preserved');
        check(style('.katex').fontFamily.includes('KaTeX'), 'KaTeX font preserved');
        check(style('.frac-line').borderBottomStyle === 'solid', 'fraction bar preserved');
        check(parseFloat(style('.frac-line').borderBottomWidth) > 0, 'fraction bar visible');
        check(style('svg g').transform !== 'none', 'SVG transform preserved');
        check(style('.katex-display').overflow === 'visible', 'math not clipped by viewport');
        check(style('.katex-display > .katex > .katex-html').whiteSpace === 'normal', 'display math allows line breaks');
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
      checked++;
    }
  }
  console.log(`${rules.length} CSS rule preludes parsed; ${checked} script-free print/screen fixture cases passed.`);
} finally {
  await browser.close();
  fs.rmSync(profile, {recursive: true, force: true});
}
'''

if __name__ == "__main__":
    unittest.main(verbosity=2)
