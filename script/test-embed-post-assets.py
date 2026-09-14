#!/usr/bin/env python3
"""Synthetic, offline tests for the private asset bundler and encryption handoff."""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

sys.dont_write_bytecode = True
from embed_post_assets import BundleError, Bundler, bundle_file, private_path, write_private

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'agent_out' / 'asset-bundler'
RUBY = shutil.which('ruby') or str(ROOT / '.toolchain/bin/ruby')
HAS_RUBY = os.access(RUBY, os.X_OK)
CHROME = ROOT / '.toolchain/verify/browser/chrome-linux64/chrome'
PUPPETEER = next((ROOT / folder / 'puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js'
                  for folder in ('node_modules', '.toolchain/node_modules', '.toolchain/verify/lighthouse-node_modules')
                  if (ROOT / folder / 'puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js').is_file()), None)
CHECKER = '''<form class="flag-check" data-flag-check data-sha256="DIGEST" data-salt="SALT">
  <label for="flag-bundle-test">Enter the flag</label>
  <div class="flag-check__controls">
    <input id="flag-bundle-test" data-flag-input type="text" autocomplete="off" autocapitalize="none" spellcheck="false">
    <button type="submit" disabled>Check flag</button>
  </div>
  <output for="flag-bundle-test" aria-live="polite">The check runs locally in your browser.</output>
  <noscript>The local SHA-256 checker requires JavaScript.</noscript>
</form>'''.replace('DIGEST', 'ab' * 32).replace('SALT', 'cd' * 16)
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCr8AAAAASUVORK5CYII=')


def unpack(uri):
    return base64.b64decode(uri.split(',', 1)[1].split('#', 1)[0], validate=True)


class AssetTests(unittest.TestCase):
    def setUp(self):
        OUT.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=OUT, prefix='fixture-')
        self.root = Path(self.temp.name)
        self.source = self.root / 'body.html'
        self.image = self.root / 'pic.png'; self.image.write_bytes(PNG)
        self.css = self.root / 'css'; self.css.mkdir()
        (self.css / 'main.css').write_text('@import "nested.css" screen; .photo { background:url(../pic.png?v=1) }')
        (self.css / 'nested.css').write_text('@font-face {font-family: Test; src: url(../test.woff2)}')
        (self.root / 'test.woff2').write_bytes(b'wOF2synthetic-byte-test-not-a-renderable-font')
        (self.root / 'file.txt').write_text('private attachment bytes\n')

    def tearDown(self): self.temp.cleanup()

    def bundle(self, text, **kwargs):
        self.source.write_text(text)
        return bundle_file(self.source, **kwargs)

    def rejects(self, text, pattern=None, **kwargs):
        with self.assertRaisesRegex((BundleError, ValueError), pattern or '.'):
            self.bundle(text, **kwargs)

    def generated_checker(self):
        answer = 'flag{synthetic-bundle-checker-answer}'
        hints = 'Inspect <bytes> & "quotes"|Try {{ XOR }}|{% literal %}'
        result = subprocess.run([RUBY, str(ROOT / 'script/new_challenge.rb'), '--html'],
                                input=f'asset-bundle-checker-fixture\n{answer}\n{hints}\n',
                                text=True, capture_output=True, cwd=ROOT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn(answer, result.stdout + result.stderr)
        fragment = result.stdout[result.stdout.index('<form '):result.stdout.index('\nsalted digest:')].strip()
        salt = re.search(r'data-salt="([0-9a-f]{32})"', fragment)[1]
        digest = re.search(r'data-sha256="([0-9a-f]{64})"', fragment)[1]
        self.assertEqual(digest, hashlib.sha256((answer + salt).encode()).hexdigest())
        self.assertEqual(fragment.count('data-hint-for="asset-bundle-checker-fixture"'), 3)
        self.assertIn('&#123;&#123; XOR &#125;&#125;', fragment)
        return fragment

    def test_passive_checker_contract_and_sibling_assets(self):
        hints = '<p class="challenge-hint" data-hint="1" data-hint-for="bundle-test" hidden>Try XOR</p>'
        result = self.bundle('<article>' + CHECKER + hints + '<img src="pic.png"><a download href="file.txt">note</a></article>')
        self.assertIn(CHECKER + hints, result.html)
        self.assertEqual(unpack(re.search(r'<img src="([^"]+)', result.html)[1]), PNG)
        self.assertEqual(unpack(re.search(r'href="(data:[^"]+)', result.html)[1]), (self.root / 'file.txt').read_bytes())
        for salt in (None, 'AB' * 8, 'ef' * 16):
            for kind in ('text', 'password'):
                with self.subTest(salt=salt, kind=kind):
                    text = CHECKER.replace(' data-salt="' + 'cd' * 16 + '"', '' if salt is None else f' data-salt="{salt}"')
                    text = text.replace('type="text"', f'type="{kind}"').replace('ab' * 32, 'AB' * 32)
                    self.assertEqual(self.bundle(text).html, text)
        metadata = CHECKER.replace('data-flag-check', 'title="Local check" aria-label="Flag" data-flag-prefix="ctf" data-challenge-title="Bytes" data-flag-check')
        self.assertEqual(self.bundle(metadata).html, metadata)
        # No other widgets are needed: the label, controls wrapper and fallback
        # may be omitted, but the three required controls cannot be omitted.
        minimal = re.sub(r'  <label[^\n]+\n|  <div[^\n]+\n|  </div>\n|  <noscript[^\n]+\n', '', CHECKER)
        self.assertEqual(self.bundle(minimal).html, minimal)
        pair = CHECKER + CHECKER.replace('flag-bundle-test', 'flag-second-checker')
        self.assertEqual(self.bundle(pair).html, pair)

    def test_generic_forms_and_standalone_noscript_stay_rejected(self):
        for text in ('<form></form>', '<form><input name="key"><button>Send</button></form>',
                     '<form action="/submit"><input name="key"></form>', '<form data-flag-check></form>',
                     '<form data-sha256="' + 'ab' * 32 + '"></form>', '<form/>', '</form>',
                     '<noscript>Fallback</noscript>', '<div data-flag-check></div>', '<input data-flag-input>'):
            with self.subTest(text=text): self.rejects(text)

    def test_checker_hash_salt_and_metadata_are_allowlisted(self):
        for field, original, values in (
            ('data-sha256', 'ab' * 32, ['', 'ab' * 31, 'ab' * 33, 'g' * 64, 'ab' * 32 + ' ', '\n' + 'ab' * 32]),
            ('data-salt', 'cd' * 16, ['', 'cd' * 7, 'cd' * 9, 'cd' * 15, 'cd' * 17, 'g' * 32, 'cd' * 16 + '\n']),
        ):
            for value in values:
                with self.subTest(field=field, value=value):
                    self.rejects(CHECKER.replace(f'{field}="{original}"', f'{field}="{value}"'))
            self.rejects(CHECKER.replace(f'{field}="{original}"', field))
        self.rejects(CHECKER.replace('data-flag-check', 'data-flag-check="true"'))
        for attr in ('action="/leak"', 'action', 'method="post"', 'target="_blank"', 'name="key"',
                     'id="elsewhere"', 'form="elsewhere"', 'enctype="text/plain"', 'onsubmit="f()"',
                     'OnSubmit', 'data-answer="plaintext"', 'data-unknown="x"', 'style="color:red"',
                     'data-challenge-id="other"', 'data-sha256="' + 'ab' * 32 + '"'):
            with self.subTest(attr=attr): self.rejects(CHECKER.replace('<form ', '<form ' + attr + ' ', 1))

    def test_checker_controls_cannot_submit_named_keys_or_override_form(self):
        for tag in ('input', 'button', 'label', 'output', 'div', 'noscript'):
            for attr in ('name="key"', 'NAME', 'form="outside"', 'form', 'formaction="/leak"',
                         'formmethod="post"', 'formenctype="text/plain"', 'formtarget="_blank"',
                         'formnovalidate', 'oninput="f()"', 'onclick', 'src="pic.png"', 'srcset="pic.png"',
                         'data-src="pic.png"', 'style="background:url(pic.png)"', 'is="other-widget"',
                         'dirname="key"', 'value="prefilled"', 'contenteditable', 'autofocus'):
                with self.subTest(tag=tag, attr=attr):
                    self.rejects(CHECKER.replace('<' + tag, '<' + tag + ' ' + attr, 1))
        for kind in ('image', 'hidden', 'submit', 'file', 'checkbox', '', ' text', 'search'):
            with self.subTest(kind=kind): self.rejects(CHECKER.replace('type="text"', f'type="{kind}"'))
        for ident in ('other', 'flag-', 'flag-bad id', 'flag-__proto__', 'flag-constructor',
                      'flag-prototype', 'flag-a/b', 'flag-' + 'a' * 129):
            with self.subTest(ident=ident): self.rejects(CHECKER.replace('flag-bundle-test', ident))
        for original, changed in ((' data-flag-input', ''), ('data-flag-input', 'data-flag-input="true"'),
                                  (' type="text"', ''), (' disabled', ''), ('disabled', 'disabled="false"'),
                                  ('type="submit"', 'type="button"'), ('type="submit"', ''),
                                  ('autocomplete="off"', 'autocomplete="on"'),
                                  ('for="flag-bundle-test"', 'for="flag-other"')):
            with self.subTest(original=original, changed=changed): self.rejects(CHECKER.replace(original, changed))
        for tag in ('input name="key"', 'button name="key"', 'output', 'fieldset', 'object'):
            external = f'<{tag} form="outside">'
            with self.subTest(external=external):
                self.rejects(external + CHECKER)
                self.rejects(CHECKER + external)
        self.rejects('<input name="key" FORM>' + CHECKER)
        self.rejects(CHECKER + '<img src="pic.png" form="outside">')

    def test_checker_structure_and_parser_contexts_are_strict(self):
        for tag in ('input', 'button', 'output', 'label', 'div', 'noscript'):
            pattern = r'<input\b[^>]*>' if tag == 'input' else rf'<{tag}\b[^>]*>[\s\S]*?</{tag}>'
            element = re.search(pattern, CHECKER)[0]
            with self.subTest(tag=tag):
                self.rejects(CHECKER.replace(element, element + element))
                if tag in ('input', 'button', 'output'):
                    self.rejects(CHECKER.replace(element, ''))
        for extra in ('<form></form>', CHECKER, '<input name="key">', '<button>Extra</button>',
                      '<textarea></textarea>', '<select></select>', '<script></script>',
                      '<img src="pic.png">', '<link rel="stylesheet" href="css/main.css">',
                      '<style>.x {color:red}</style>', '<svg></svg>', '<span>widget</span>',
                      '<!-- comment -->', 'unexpected text'):
            with self.subTest(extra=extra): self.rejects(CHECKER.replace('</form>', extra + '</form>'))
        for tag in ('label', 'button', 'output', 'noscript'):
            self.rejects(CHECKER.replace(f'</{tag}>', f'<img src="https://example.invalid/p.png"></{tag}>'))
        for text in (CHECKER.replace('</form>', ''), CHECKER.replace('</div>', ''),
                     CHECKER.replace('</div>', '</form></div>'), CHECKER.replace('</button>', '</output>'),
                     CHECKER.replace('</form>', '</article></form>'), CHECKER.replace('<noscript>', '<noscript/>'),
                     CHECKER.replace('</noscript>', '</noscript></noscript>'),
                     CHECKER.replace('Check flag', '<broken'), CHECKER.replace('</form>', '</input></form>')):
            with self.subTest(text=text): self.rejects(text)
        for tag in ('svg', 'math', 'table', 'tbody', 'tr', 'p', 'button', 'label', 'a', 'custom-widget'):
            with self.subTest(tag=tag):
                self.rejects(f'<{tag}>' + CHECKER + f'</{tag}>')
                # HTML non-void tags ignore a trailing slash, unlike SVG/MathML.
                if tag not in ('svg', 'math'): self.rejects(f'<{tag}/>' + CHECKER)
        self.rejects('<div><table></div>' + CHECKER + '</table>')
        self.rejects('<b></i></b>' + CHECKER)
        self.rejects(CHECKER + CHECKER)
        for outside in ('<p id="flag-bundle-test">duplicate</p>', '<input id="flag-bundle-test">'):
            self.rejects(outside + CHECKER)
            self.rejects(CHECKER + outside)
        self.assertIn(CHECKER, self.bundle('<svg/>' + CHECKER).html)

    def test_checker_noscript_text_does_not_allow_active_fallback(self):
        text = CHECKER.replace('The local SHA-256 checker requires JavaScript.',
                               'Use &lt;script&gt; as text &amp; &#123;&#123; literal &#125;&#125;.')
        self.assertEqual(self.bundle(text).html, text)
        for fallback in ('<img src="pic.png">', '<!--<img src="pic.png">-->',
                         '<noscript>nested</noscript>', '<input name="key">', '<style>body{}</style>'):
            with self.subTest(fallback=fallback):
                self.rejects(CHECKER.replace('The local SHA-256 checker requires JavaScript.', fallback))

    @unittest.skipUnless(HAS_RUBY, 'local Ruby required for author helper output')
    def test_actual_ruby_html_checker_bundles_without_markup_changes(self):
        checker = self.generated_checker()
        result = self.bundle(checker + '<img src="pic.png"><a download="file.txt" href="file.txt">note</a>')
        self.assertTrue(result.html.startswith(checker))
        self.assertEqual({asset['path'] for asset in result.assets}, {'pic.png', 'file.txt'})
        self.assertEqual(unpack(re.search(r'<img src="([^"]+)', result.html)[1]), PNG)
        self.assertEqual(unpack(re.search(r'href="(data:[^"]+)', result.html)[1]), (self.root / 'file.txt').read_bytes())

    @unittest.skipUnless(HAS_RUBY and shutil.which('node') and CHROME.is_file() and PUPPETEER,
                         'cached Ruby, Chromium and Puppeteer required; no downloads')
    def test_native_checker_has_no_key_bearing_submission_without_javascript(self):
        checker = self.generated_checker()
        # Outside controls must not become members of the checker form.
        fixtures = [self.bundle(checker.replace('type="text"', f'type="{kind}"') +
                               '<input name="external" value="outside">').html
                    for kind in ('text', 'password')]
        program = r'''const fs = require('node:fs'), assert = require('node:assert/strict');
const x = JSON.parse(fs.readFileSync(0, 'utf8'));
const puppeteer = require(x.puppeteer);
(async () => {
 const browser = await puppeteer.launch({executablePath:x.chrome, userDataDir:x.profile, headless:true, protocolTimeout:10000,
  args:['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking',
        '--disable-component-update','--disable-sync','--no-first-run',
        '--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=<-loopback>',
        '--host-resolver-rules=MAP * ~NOTFOUND']});
 try {
  const page = await browser.newPage(), requests = [];
  page.setDefaultTimeout(5000);
  await page.setRequestInterception(true);
  page.on('request', request => {
   if (request.url().startsWith('data:')) return void request.continue();
   requests.push(request.url()); void request.abort();
  });
  for (const enabled of [false, true]) {
   await page.setJavaScriptEnabled(enabled); // No checker engine in either case.
   for (const body of x.fixtures) {
    await page.goto('data:text/html;charset=utf-8;base64,' + Buffer.from(body).toString('base64'));
    await page.evaluate(() => document.querySelector('[data-flag-input]').focus());
    await page.keyboard.type('flag{synthetic-native-submission-key}');
    const state = await page.evaluate(() => {
     const f = document.querySelector('form'), i = f.querySelector('input'), b = f.querySelector('button');
     const originalDisabled = b.disabled;
     b.disabled = false; // Even a partial engine failure cannot serialize the key.
     const entries = [...new FormData(f, b)]; b.disabled = originalDisabled;
     const rect = b.getBoundingClientRect();
     return {forms:document.forms.length, members:[...f.elements].map(e => e.tagName),
             value:i.value, buttonX:rect.x+rect.width/2, buttonY:rect.y+rect.height/2,
             disabled:b.disabled, names:[i.name,b.name], owner:i.form===f,
             external:document.querySelector('[name="external"]').form===null, entries,
             hints:[...document.querySelectorAll('[data-hint-for]')].map(h => h.textContent),
             fallback:f.querySelector('noscript').textContent};
    });
    assert.equal(state.forms, 1); assert.deepEqual(state.members, ['INPUT','BUTTON','OUTPUT']);
    assert.equal(state.value, 'flag{synthetic-native-submission-key}');
    assert.equal(state.disabled, true); assert.deepEqual(state.names, ['', '']);
    assert.equal(state.owner, true); assert.equal(state.external, true); assert.deepEqual(state.entries, []);
    assert.deepEqual(state.hints, ['Inspect <bytes> & "quotes"','Try {{ XOR }}','{% literal %}']);
    assert.match(state.fallback, /requires JavaScript/);
    let navigations = 0; const onNavigation = () => { navigations++; };
    page.on('framenavigated', onNavigation);
    await page.keyboard.press('Enter');
    await page.mouse.click(state.buttonX, state.buttonY);
    await new Promise(resolve => setTimeout(resolve, 100));
    page.off('framenavigated', onNavigation);
    assert.equal(navigations, 0); assert.deepEqual(requests, []);
   }
  }
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });'''
        # Keep Chromium sockets short and shared-memory files in a directory
        # owned by this test's user, even in a checkout owned by someone else.
        browser_tmp = tempfile.TemporaryDirectory(dir=ROOT / 'agent_out', prefix='cb-')
        self.addCleanup(browser_tmp.cleanup)
        env = {**os.environ, 'TMPDIR': browser_tmp.name, 'XDG_CONFIG_HOME': str(self.root / 'config'),
               'XDG_CACHE_HOME': str(self.root / 'cache'),
               'LD_LIBRARY_PATH': os.pathsep.join(filter(None, [os.environ.get('LD_LIBRARY_PATH'),
                   str(ROOT / '.toolchain/verify/browser/sysroot/usr/lib/x86_64-linux-gnu')]))}
        result = subprocess.run(['node', '-e', program], input=json.dumps({
            'puppeteer': str(PUPPETEER), 'chrome': str(CHROME), 'profile': str(self.root / 'browser-profile'),
            'fixtures': fixtures}), text=True, capture_output=True, env=env, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_img_bytes_labels_entities_and_svg_case(self):
        result = self.bundle('<p>A &amp; B: &lt;img src="example"&gt;</p><img src="pic.png" alt="A &amp; B"><svg viewBox="0 0 4 4"><title>Test</title><rect width="4" height="4"/></svg>')
        self.assertIn('viewBox="0 0 4 4"', result.html)
        self.assertIn('A &amp; B', result.html)
        self.assertIn('&lt;img src="example"&gt;', result.html)
        self.assertEqual(unpack(re.search(r'<img src="([^"]+)', result.html)[1]), PNG)
        self.assertEqual(len(result.assets), 1)

    def test_root_relative_percent_encoded_and_cache_query(self):
        (self.root / 'sp ace.png').write_bytes(PNG)
        for url in ['/pic.png?v=42', './pic.png?width=10', 'sp%20ace.png', '%70ic.png']:
            with self.subTest(url=url):
                self.assertEqual(unpack(re.search(r'src="([^"]+)', self.bundle(f'<img src="{url}">').html)[1]), PNG)

    def test_nested_source_root_is_explicit(self):
        nested = self.root / 'text'; nested.mkdir(); self.source = nested / 'post.html'
        self.rejects('<img src="../pic.png">', 'escapes')
        result = self.bundle('<img src="../pic.png"><img src="/pic.png">', asset_root=self.root)
        self.assertEqual(result.html.count('data:image/png;base64,'), 2)

    def test_srcset_includes_data_uri_commas(self):
        data = 'data:image/png;base64,' + base64.b64encode(PNG).decode()
        result = self.bundle(f'<picture><source srcset="{data} 1x, pic.png 2x"><img src="pic.png" srcset="pic.png 100w, pic.png 200w" sizes="100vw"></picture>')
        self.assertEqual(result.html.count('data:image/png;base64,'), 5)
        self.assertIn('100w', result.html)
        for value in ['pic.png 0x', 'pic.png 1q', 'pic.png 1x, pic.png 1x', 'pic.png 10w, pic.png 2x', '']:
            with self.subTest(value=value): self.rejects(f'<img srcset="{value}">')

    def test_css_imports_fonts_and_urls_resolve_per_stylesheet(self):
        result = self.bundle('<link rel="stylesheet" href="css/main.css" media="screen">')
        self.assertIn('<style media="screen">', result.html)
        uri = re.search(r'@import url\("([^"]+)"\)', result.html)[1]
        imported = unpack(uri).decode()
        self.assertIn('data:font/woff2;base64,', imported)
        self.assertIn('data:image/png;base64,', result.html)
        self.assertEqual({row['path'] for row in result.assets}, {'css/main.css', 'css/nested.css', 'pic.png', 'test.woff2'})

    def test_css_escape_handling_and_inline_styles(self):
        result = self.bundle(r'<p style="background: u\72l(\70 ic.png)">ok</p><style>/*url(missing.png)*/ .x {background:URL("pic.png")} .x::before {content:"url(not-a-fetch.png)"}</style>')
        self.assertEqual(result.html.count('data:image/png;base64,'), 2)
        self.assertIn('url(not-a-fetch.png)', result.html)
        self.rejects(r'<style>@\69mport "https://example.invalid/s.css";</style>', 'not fetched')
        self.rejects(r'<style>.x {background:u\72l(\68 ttps://example.invalid/a.png)}</style>', 'not fetched')

    def test_style_breakout_and_fragment_quotes_do_not_generate_markup(self):
        (self.css / 'safe.css').write_text('.x::before {content:"</STYLE><img src=remote>"}')
        result = self.bundle('<link rel="stylesheet" href="css/safe.css">')
        self.assertEqual(result.html.lower().count('</style>'), 1)
        self.assertIn('\\3c /STYLE', result.html)
        (self.css / 'main.css').write_text("@import 'safe.css#\"); @import url(https://example.invalid/x)/*';")
        result = self.bundle('<link rel="stylesheet" href="css/main.css">')
        self.assertNotIn('); @import url(https', result.html)
        self.assertIn('%22', result.html)

    def test_svg_nested_image_css_and_fragment(self):
        (self.root / 'figure.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><title>Label</title><defs><clipPath id="c"><rect width="1" height="1"/></clipPath></defs><image href="pic.png" style="clip-path:url(#c)"/></svg>')
        result = self.bundle('<img src="figure.svg#c">')
        uri = re.search(r'src="([^"]+)', result.html)[1]
        svg = unpack(uri).decode()
        ET.fromstring(svg)
        self.assertIn('data:image/png;base64,', svg)
        self.assertIn('url("#c")', svg.replace('&quot;', '"'))
        self.assertTrue(uri.endswith('#c'))
        self.assertIn('viewBox', svg)

    def test_svg_href_and_xlink_fallback_are_both_embedded(self):
        (self.root / 'both.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image href="pic.png" xlink:href="pic.png"/></svg>')
        result = self.bundle('<img src="both.svg">')
        svg = ET.fromstring(unpack(re.search(r'src="([^"]+)', result.html)[1]))
        self.assertEqual(len(svg[0].attrib), 2)
        self.assertTrue(all(value.startswith('data:image/png;base64,') for value in svg[0].attrib.values()))

    def test_inline_svg_image_and_local_symbol(self):
        result = self.bundle('<svg viewBox="0 0 10 10"><image href="pic.png"/><use href="#local"/></svg>')
        self.assertIn('data:image/png;base64,', result.html)
        self.assertIn('href="#local"', result.html)
        self.rejects('<svg><use href="figure.svg#x"/></svg>', 'inline SVG')
        self.rejects('<svg><style><img src="https://example.invalid/x"></style></svg>', 'inline SVG style')

    def test_existing_svg_data_uri_is_checked_recursively(self):
        for svg in ['<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/a"/></svg>',
                    '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>',
                    '<svg xmlns="http://www.w3.org/2000/svg" xml:base="https://example.invalid/"><use href="#x"/></svg>']:
            data = base64.b64encode(svg.encode()).decode()
            with self.subTest(svg=svg): self.rejects(f'<img src="data:image/svg+xml;base64,{data}">')
        data = base64.b64encode(b'<svg xmlns="http://www.w3.org/2000/svg"><image href="pic.png"/></svg>').decode()
        result = self.bundle(f'<img src="data:image/svg+xml;base64,{data}">')
        self.assertIn(b'data:image/png;base64,', unpack(re.search(r'src="([^"]+)', result.html)[1]))

    def test_svg_dtd_animation_foreign_content_and_external_refs_rejected(self):
        for body in ['<!DOCTYPE svg [<!ENTITY x "x">]><svg xmlns="http://www.w3.org/2000/svg"/>',
                     '<svg xmlns="http://www.w3.org/2000/svg"><animate attributeName="href"/></svg>',
                     '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>',
                     '<svg xmlns="http://www.w3.org/2000/svg"><use href="other.svg#id"/></svg>']:
            (self.root / 'bad.svg').write_text(body)
            with self.subTest(body=body): self.rejects('<img src="bad.svg">')

    def test_explicit_download_and_optional_local_file_links(self):
        result = self.bundle('<a download href="file.txt">Download</a><a href="file.txt">File</a><a href="https://example.invalid/paper.pdf">Paper</a>')
        self.assertIn('data:text/plain;base64,', result.html)
        self.assertIn('href="file.txt"', result.html)
        self.assertIn('download="file.txt"', result.html)
        self.assertEqual(result.retained_links, 2)
        result = self.bundle('<a href="file.txt">File</a><a href="/article.html">Article</a>', linked_files=True)
        self.assertIn('download="file.txt"', result.html)
        self.assertIn('/article.html', result.html)
        self.assertEqual(result.retained_links, 1)
        self.rejects('<a download href="https://example.invalid/file.txt">Download</a>', 'not fetched')

    def test_media_and_track_bytes(self):
        for filename, data in [('movie.mp4', b'\x00\x00\x00\x18ftypisomsynthetic'), ('audio.mp3', b'ID3synthetic'), ('captions.vtt', b'WEBVTT\n\n')]:
            (self.root / filename).write_bytes(data)
        result = self.bundle('<video poster="pic.png"><source src="movie.mp4"><track src="captions.vtt"></video><audio src="audio.mp3"></audio>')
        for mime in ['image/png', 'video/mp4', 'text/vtt', 'audio/mpeg']:
            self.assertIn('data:' + mime + ';base64,', result.html)

    def test_remote_schemes_controls_and_root_escapes_rejected(self):
        (self.root.parent / (self.root.name + '-outside.png')).write_bytes(PNG)
        self.addCleanup((self.root.parent / (self.root.name + '-outside.png')).unlink)
        (self.root / 'escape.png').symlink_to(self.root.parent / (self.root.name + '-outside.png'))
        for url in ['https://example.invalid/a.png', '//example.invalid/a.png', 'file:///etc/passwd',
                    'blob:example', 'javascript:alert(1)', '../' + self.root.name + '-outside.png',
                    '%2e%2e/' + self.root.name + '-outside.png', 'escape.png', '..%5csecret.png',
                    '%00.png', 'https:&#10;//example.invalid/p.png']:
            with self.subTest(url=url): self.rejects(f'<img src="{url}">')

    def test_repeated_slashes_do_not_disguise_remote_assets_as_local(self):
        (self.root / 'example.invalid').mkdir()
        (self.root / 'example.invalid' / 'pic.png').write_bytes(PNG)
        for prefix in ['//', '///', '////']:
            with self.subTest(prefix=prefix):
                self.rejects(f'<img src="{prefix}example.invalid/pic.png">', 'not fetched')
                result = self.bundle(f'<a href="{prefix}example.invalid/pic.png">reference</a>', linked_files=True)
                self.assertEqual(result.assets, [])
                self.assertEqual(result.retained_links, 1)

    def test_active_or_unknown_loading_constructs_rejected(self):
        for text in ['<script src="file.txt"></script>', '<iframe src="file.txt"></iframe>',
                     '<object data="file.txt"></object>', '<img onerror="f()" src="pic.png">',
                     '<img src="pic.png" SRC="remote">', '<foo src="pic.png">', '<img src>',
                     '<img data-src="pic.png">',
                     '<base href="https://example.invalid/">', '<link rel="preload" href="pic.png">',
                     '<meta http-equiv="refresh" content="0;url=remote">', '<a href="javascript:f()">x</a>',
                     '<a href="/" ping="https://example.invalid/">x</a>', '<!--><img src="pic.png">-->',
                     '<style>.x {background:image-set("pic.png" 1x)}</style>']:
            with self.subTest(text=text): self.rejects(text)

    def test_missing_wrong_type_and_empty_data_fail(self):
        (self.root / 'fake.png').write_text('<svg>not a PNG</svg>')
        for text in ['<img src="missing.png">', '<img src="file.txt">', '<img src="fake.png">',
                     '<img src="data:image/png;base64,invalid!">', '<img src="data:text/html;base64,WA==">',
                     '<img src="">', '<img src="#x">']:
            with self.subTest(text=text): self.rejects(text)

    def test_cycles_and_budgets_fail(self):
        (self.css / 'a.css').write_text('@import "b.css";')
        (self.css / 'b.css').write_text('@import "a.css";')
        self.rejects('<link rel="stylesheet" href="css/a.css">', 'cyclic')
        self.rejects('<img src="pic.png">', 'limit', max_asset_bytes=8)
        self.rejects('<img src="pic.png"><img src="pic.png">', 'limit', max_output_bytes=180)
        self.rejects('<img srcset="pic.png 1x, pic.png 2x">', 'limit', max_output_bytes=180)

    def test_private_guards_symlinks_and_atomic_output(self):
        for path in [ROOT / '_posts' / 'private.html', ROOT / 'assets' / 'agent_out' / 'private.html']:
            with self.subTest(path=path), self.assertRaises(BundleError): private_path(path)
        output = self.root / 'packed.html'
        write_private(output, b'first')
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        with self.assertRaises(BundleError): write_private(output, b'second')
        self.assertEqual(output.read_bytes(), b'first')
        write_private(output, b'third', force=True)
        self.assertEqual(output.read_bytes(), b'third')
        symlink = self.root / 'link'; symlink.symlink_to(output)
        with self.assertRaises(BundleError): write_private(symlink, b'bad', force=True)
        self.assertEqual(output.read_bytes(), b'third')

    def test_standalone_cli_no_partial_file_on_failure(self):
        self.source.write_text('<img src="https://example.invalid/p.png">')
        output = self.root / 'packed.html'
        command = [sys.executable, str(ROOT / 'script/embed_post_assets.py'), '--html', str(self.source), '--out', str(output)]
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertFalse(output.exists())
        self.source.write_text('<img src="pic.png">')
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('still private plaintext', result.stdout)

    def test_symlinked_assets_and_html_keep_logical_url_bases(self):
        (self.css / 'pic.png').write_bytes(PNG + b'other-image-bytes')
        (self.css / 'alias-target.css').write_text('.x {background:url(pic.png)}')
        (self.root / 'alias.css').symlink_to(self.css / 'alias-target.css')
        result = self.bundle('<link rel="stylesheet" href="alias.css"><link rel="stylesheet" href="css/alias-target.css">')
        images = re.findall(r'url\("(data:image/png;[^"]+)"\)', result.html)
        self.assertEqual([unpack(x) for x in images], [PNG, PNG + b'other-image-bytes'])
        svg = '<svg xmlns="http://www.w3.org/2000/svg"><image href="pic.png"/></svg>'
        (self.css / 'target.svg').write_text(svg)
        (self.root / 'alias.svg').symlink_to(self.css / 'target.svg')
        result = self.bundle('<img src="alias.svg">')
        embedded = unpack(re.search(r'src="([^"]+)', result.html)[1]).decode()
        self.assertEqual(unpack(re.search(r'href="([^"]+)', embedded)[1]), PNG)
        (self.css / 'target.html').write_text('<img src="pic.png">')
        alias = self.root / 'alias.html'; alias.symlink_to(self.css / 'target.html')
        result = bundle_file(alias, asset_root=self.root)
        self.assertEqual(unpack(re.search(r'src="([^"]+)', result.html)[1]), PNG)

    def test_recursive_read_reservations_enforce_exact_cap(self):
        for i in range(15):
            (self.css / f'chain{i}.css').write_text(f'@import "chain{i+1}.css";' if i < 14 else '')
        for i in range(114): (self.css / f'leaf{i}.css').write_text(f'.x{i} {{color: red}}')
        last = self.css / 'chain14.css'
        last.write_text(''.join(f'@import "leaf{i}.css";' for i in range(113)))
        result = self.bundle('<link rel="stylesheet" href="css/chain0.css">')
        self.assertEqual(len(result.assets), 128)
        last.write_text(last.read_text() + '@import "leaf113.css";')
        self.rejects('<link rel="stylesheet" href="css/chain0.css">', '128')

    def test_canonical_cycle_detection_with_logical_aliases(self):
        (self.css / 'cycle.css').write_text('@import "alias.css";')
        (self.css / 'alias.css').symlink_to(self.css / 'cycle.css')
        self.rejects('<link rel="stylesheet" href="css/cycle.css">', 'cyclic')

    def test_foreign_style_contexts_and_bad_declarations_fail(self):
        for text in ['<math><style>/*<img src="https://example.invalid/x">*/</style></math>',
                     '<select><style>/*<img src="https://example.invalid/x">*/</style></select>',
                     '<![not-a-valid-declaration]>']:
            with self.subTest(text=text): self.rejects(text)

    def test_public_alias_of_private_input_is_rejected(self):
        import embed_post_assets as module
        from unittest.mock import patch
        fake = self.root / 'fake'; scratch = fake / 'agent_out'; public = fake / 'assets'
        scratch.mkdir(parents=True); public.mkdir()
        plain = scratch / 'body.html'; plain.write_text('private')
        alias = public / 'exposed.html'; alias.symlink_to(plain)
        with patch.object(module, 'REPO', fake):
            with self.assertRaises(BundleError): private_path(alias)
            self.assertEqual(private_path(plain), plain)

    def test_markdown_is_not_rendered(self):
        result = self.bundle('![Not HTML](pic.png)\n')
        self.assertEqual(result.html, '![Not HTML](pic.png)\n')
        self.assertEqual(result.assets, [])

    @unittest.skipUnless(importlib.util.find_spec('cryptography') and shutil.which('node') and HAS_RUBY, 'real AES backend, Node and local Ruby required for producer/WebCrypto test')
    def test_actual_encryptor_to_webcrypto_and_failure_side_effects(self):
        project = self.root / 'isolated-repo'; (project / 'script').mkdir(parents=True)
        (project / '_data').mkdir(); work = project / 'agent_out'; work.mkdir()
        for file in ['encrypt_post.py', 'embed_post_assets.py']:
            shutil.copyfile(ROOT / 'script' / file, project / 'script' / file)
        (work / 'pic.png').write_bytes(PNG)
        checker = self.generated_checker()
        original_html = checker + '<img src="pic.png" alt="private"><a download href="note.txt">note</a>'
        source = work / 'body.html'; source.write_text(original_html)
        attachment = b'synthetic private attachment\n' + bytes(range(256))
        (work / 'note.txt').write_bytes(attachment)
        expected = bundle_file(source).html
        self.assertTrue(expected.startswith(checker))
        post = project / '_posts' / '2099-01-01-synthetic.md'
        command = [sys.executable, str(project / 'script/encrypt_post.py'), '--plaintext', str(source), '--embed-assets',
                   '--answer', 'synthetic-only', '--out', str(post), '--title', 'Synthetic', '--force',
                   '--needs', 'synthetic-private-check']
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        text = post.read_text()
        self.assertNotIn('data:image/png', text); self.assertNotIn('synthetic private attachment', text)
        payload = re.search(r'aria-live="polite">([^<]+)', text)[1]
        salt = re.search(r'data-salt="([^"]+)', text)[1]
        program = '''const fs = require('node:fs');
const c = require('node:crypto').webcrypto;
(async () => {
 const x=JSON.parse(fs.readFileSync(0,'utf8'));
 const material=await c.subtle.importKey('raw',new TextEncoder().encode(x.answer),'PBKDF2',false,['deriveKey']);
 const key=await c.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:Buffer.from(x.salt,'hex'),iterations:x.version===2 ? x.iterations : 120000},material,{name:'AES-GCM',length:256},false,['decrypt']);
 const wire=Buffer.from(x.payload,'base64');
 const algorithm={name:'AES-GCM',iv:wire.subarray(0,12)};
 if(x.version===2) algorithm.additionalData=new TextEncoder().encode(JSON.stringify(
   x.aad || ['deuterium-argon',2,x.iterations,x.salt.toLowerCase(),x.needs]));
 const plain=await c.subtle.decrypt(algorithm,key,wire.subarray(12));
 process.stdout.write(Buffer.from(plain));
})().catch(e=>{process.stderr.write(e.name);process.exitCode=1});'''
        self.assertIn('data-version="2" data-iterations="200000"', text)
        fixture = {'answer': 'synthetic-only', 'payload': payload, 'salt': salt,
                   'version': 2, 'iterations': 200000, 'needs': 'synthetic-private-check'}
        decrypted = subprocess.run(['node', '-e', program], input=json.dumps(fixture), capture_output=True, text=True)
        self.assertEqual(decrypted.returncode, 0, decrypted.stderr)
        self.assertEqual(decrypted.stdout.encode('utf-8'), expected.encode('utf-8'))
        self.assertTrue(decrypted.stdout.startswith(checker))
        self.assertEqual(unpack(re.search(r'<img src="([^"]+)', decrypted.stdout)[1]), PNG)
        self.assertEqual(unpack(re.search(r'href="(data:[^"]+)', decrypted.stdout)[1]), attachment)
        header = ['deuterium-argon', 2, 200000, salt.lower(), 'synthetic-private-check']
        for index, replacement in enumerate(['other-domain', 1, 120000, '0' * 32, 'other-private-check']):
            altered = header.copy(); altered[index] = replacement
            changed = {**fixture, 'aad': altered}
            result = subprocess.run(['node', '-e', program], input=json.dumps(changed), capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0, f'AAD field {index} was not bound')
            self.assertEqual(result.stdout, '')
        for mutation in ({'needs': 'other-private-check'}, {'salt': '0' * 32},
                         {'version': 1}, {'iterations': 120000},
                         {'payload': base64.b64encode(base64.b64decode(payload)[:-1] + bytes([base64.b64decode(payload)[-1] ^ 1])).decode()}):
            result = subprocess.run(['node', '-e', program], input=json.dumps({**fixture, **mutation}),
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, '')
        fixture['answer'] = 'wrong-synthetic-answer'
        wrong = subprocess.run(['node', '-e', program], input=json.dumps(fixture), capture_output=True, text=True)
        self.assertNotEqual(wrong.returncode, 0)
        stdin_command = command.copy()
        at = stdin_command.index('--answer')
        stdin_command[at:at+2] = ['--answer-stdin']
        from_stdin = subprocess.run(stdin_command, input='synthetic-only\n', capture_output=True, text=True)
        self.assertEqual(from_stdin.returncode, 0, from_stdin.stderr)
        self.assertNotIn('synthetic-only', from_stdin.stdout)
        new_text = post.read_text()
        self.assertNotEqual(re.search(r'data-salt="([^"]+)', new_text)[1], salt)
        self.assertNotEqual(re.search(r'aria-live="polite">([^<]+)', new_text)[1], payload)
        fixture.update(answer='synthetic-only', payload=re.search(r'aria-live="polite">([^<]+)', new_text)[1],
                       salt=re.search(r'data-salt="([^"]+)', new_text)[1])
        decrypted = subprocess.run(['node', '-e', program], input=json.dumps(fixture), capture_output=True, text=True)
        self.assertEqual(decrypted.returncode, 0, decrypted.stderr)
        self.assertEqual(decrypted.stdout, expected)
        before = post.read_bytes()
        too_long = subprocess.run(stdin_command, input='x' * 4097 + '\n', capture_output=True, text=True)
        self.assertNotEqual(too_long.returncode, 0)
        self.assertEqual(post.read_bytes(), before)
        for value in [' synthetic-only\n', 'synthetic-only \n', '\ufeffsynthetic-only\n', 'synthetic\ronly\n']:
            rejected = subprocess.run(stdin_command, input=value, capture_output=True, text=True)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn('browser trims', rejected.stderr)
            self.assertEqual(post.read_bytes(), before)
        chain = project / '_data' / 'arg_chain.yml'
        before_post = post.read_bytes(); before_chain = chain.read_bytes()
        for options in (['--needs', 'bad id'], ['--needs', 'a' * 129], ['--needs', 'x" data-needs="y'],
                        ['--salt', '00 ' * 16], ['--salt', 'g' * 32], ['--salt', ''],
                        ['--previous', '//example.invalid/2099/01/01/a.html'],
                        ['--previous', '/2099/01/01/a.html?x=1'],
                        ['--previous', '/2099/01/01/../a.html'],
                        ['--previous', '/2099/01/01/%2e%2e.html'],
                        ['--previous', '/2099/02/30/a.html'],
                        ['--previous', '/2099/01/01/missing.html'],
                        ['--previous', '/2099/01/01/synthetic.html']):
            with self.subTest(options=options):
                rejected = subprocess.run(command + options, capture_output=True, text=True)
                self.assertNotEqual(rejected.returncode, 0)
                self.assertEqual(post.read_bytes(), before_post)
                self.assertEqual(chain.read_bytes(), before_chain)
        for suffix in ('  needs: duplicate\n', '  unknown: field\n',
                       '- post: /2099/01/01/synthetic.html\n  salt: bad\n'):
            malformed = before_chain + suffix.encode()
            chain.write_bytes(malformed)
            rejected = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertEqual(post.read_bytes(), before_post)
            self.assertEqual(chain.read_bytes(), malformed)
        chain.write_bytes(before_chain)
        for invalid in ('<img src="https://example.invalid/private.png">', '<form><input name="key"></form>',
                        checker.replace('data-flag-input', 'data-flag-input name="key"'),
                        checker.replace(' disabled', ''), checker.replace('</form>', '')):
            with self.subTest(invalid=invalid):
                source.write_text(invalid)
                failed = subprocess.run(command, capture_output=True, text=True)
                self.assertNotEqual(failed.returncode, 0)
                self.assertEqual(post.read_bytes(), before_post)
                self.assertEqual(chain.read_bytes(), before_chain)

        source.write_text(original_html)
        hidden = project / 'locked/2099/01/02/follow-up.md'
        unlisted = stdin_command + ['--unlisted', '--section', 'tutorials', '--previous', '/2099/01/01/synthetic.html']
        unlisted[unlisted.index('--out') + 1] = str(hidden)
        result = subprocess.run(unlisted, input='synthetic-only\n', capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        hidden_text = hidden.read_text()
        for marker in ['unlisted: true', 'sitemap: false', 'noindex: true', 'layout: locked',
                       'permalink: /locked/2099/01/02/follow-up.html', '<span hidden>', '<noscript>']:
            self.assertIn(marker, hidden_text)
        self.assertNotIn('data:image/png', hidden_text)
        fixture.update(answer='synthetic-only', payload=re.search(r'<span hidden>([^<]+)', hidden_text)[1],
                       salt=re.search(r'data-salt="([^"]+)', hidden_text)[1])
        recovered = subprocess.run(['node', '-e', program], input=json.dumps(fixture), capture_output=True, text=True)
        self.assertEqual(recovered.returncode, 0, recovered.stderr)
        self.assertEqual(recovered.stdout, expected)
        fixture['answer'] = 'wrong-synthetic-answer'
        wrong = subprocess.run(['node', '-e', program], input=json.dumps(fixture), capture_output=True, text=True)
        self.assertNotEqual(wrong.returncode, 0)
        self.assertEqual(post.read_bytes(), before_post)
        self.assertIn('- post: /locked/2099/01/02/follow-up.html\n', chain.read_text())
        before_chain = chain.read_bytes(); before_hidden = hidden.read_bytes()
        alias = project / 'locked/escape'; alias.symlink_to(work, target_is_directory=True)
        for target in [post, project / 'ramblings/2099/01/02/bad.md',
                       project / 'locked/../_posts/2099-01-02-bad.md', alias / '2099/01/02/bad.md']:
            bad = unlisted.copy(); bad[bad.index('--out') + 1] = str(target)
            result = subprocess.run(bad, input='synthetic-only\n', capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('must be under locked/', result.stderr)
            self.assertEqual(chain.read_bytes(), before_chain)
            self.assertEqual(post.read_bytes(), before_post)
            self.assertEqual(hidden.read_bytes(), before_hidden)
        for mode in [[], ['--page']]:
            bad = [arg for arg in unlisted if arg != '--unlisted'] + mode
            result = subprocess.run(bad, input='synthetic-only\n', capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('requires --unlisted', result.stderr)
            self.assertEqual(chain.read_bytes(), before_chain)
            self.assertEqual(hidden.read_bytes(), before_hidden)

        # Legacy output remains versionless and interoperates without AAD.
        legacy = subprocess.run(unlisted + ['--legacy'], input='synthetic-only\n', capture_output=True, text=True)
        self.assertEqual(legacy.returncode, 0, legacy.stderr)
        legacy_text = hidden.read_text()
        self.assertNotIn('data-version=', legacy_text)
        fixture.update(version=1, answer='synthetic-only',
                       payload=re.search(r'<span hidden>([^<]+)', legacy_text)[1],
                       salt=re.search(r'data-salt="([^"]+)', legacy_text)[1])
        recovered = subprocess.run(['node', '-e', program], input=json.dumps(fixture), capture_output=True, text=True)
        self.assertEqual(recovered.returncode, 0, recovered.stderr)
        self.assertEqual(recovered.stdout, expected)


if __name__ == '__main__': unittest.main(verbosity=2)
