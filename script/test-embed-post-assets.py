#!/usr/bin/env python3
"""Synthetic, offline tests for the private asset bundler and encryption handoff."""
import base64
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

from embed_post_assets import BundleError, Bundler, bundle_file, private_path, write_private

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'agent_out' / 'asset-bundler'
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

    @unittest.skipUnless(importlib.util.find_spec('cryptography') and shutil.which('node'), 'real AES backend and Node required for producer/WebCrypto test')
    def test_actual_encryptor_to_webcrypto_and_failure_side_effects(self):
        project = self.root / 'isolated-repo'; (project / 'script').mkdir(parents=True)
        (project / '_data').mkdir(); work = project / 'agent_out'; work.mkdir()
        for file in ['encrypt_post.py', 'embed_post_assets.py']:
            shutil.copyfile(ROOT / 'script' / file, project / 'script' / file)
        (work / 'pic.png').write_bytes(PNG)
        source = work / 'body.html'; source.write_text('<img src="pic.png" alt="private"><a download href="note.txt">note</a>')
        (work / 'note.txt').write_text('synthetic private attachment')
        expected = bundle_file(source).html
        post = project / '_posts' / '2099-01-01-synthetic.md'
        command = [sys.executable, str(project / 'script/encrypt_post.py'), '--plaintext', str(source), '--embed-assets',
                   '--answer', 'synthetic-only', '--out', str(post), '--title', 'Synthetic', '--force']
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
 const key=await c.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:Buffer.from(x.salt,'hex'),iterations:120000},material,{name:'AES-GCM',length:256},false,['decrypt']);
 const wire=Buffer.from(x.payload,'base64');
 const plain=await c.subtle.decrypt({name:'AES-GCM',iv:wire.subarray(0,12)},key,wire.subarray(12));
 process.stdout.write(Buffer.from(plain));
})().catch(e=>{process.stderr.write(e.name);process.exitCode=1});'''
        fixture = {'answer': 'synthetic-only', 'payload': payload, 'salt': salt}
        decrypted = subprocess.run(['node', '-e', program], input=json.dumps(fixture), capture_output=True, text=True)
        self.assertEqual(decrypted.returncode, 0, decrypted.stderr)
        self.assertEqual(decrypted.stdout, expected)
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
        fixture.update(answer='synthetic-only', payload=re.search(r'aria-live="polite">([^<]+)', new_text)[1],
                       salt=re.search(r'data-salt="([^"]+)', new_text)[1])
        decrypted = subprocess.run(['node', '-e', program], input=json.dumps(fixture), capture_output=True, text=True)
        self.assertEqual(decrypted.returncode, 0, decrypted.stderr)
        self.assertEqual(decrypted.stdout, expected)
        before = post.read_bytes()
        too_long = subprocess.run(stdin_command, input='x' * 4097 + '\n', capture_output=True, text=True)
        self.assertNotEqual(too_long.returncode, 0)
        self.assertEqual(post.read_bytes(), before)
        chain = project / '_data' / 'arg_chain.yml'
        before_post = post.read_bytes(); before_chain = chain.read_bytes()
        source.write_text('<img src="https://example.invalid/private.png">')
        failed = subprocess.run(command, capture_output=True, text=True)
        self.assertNotEqual(failed.returncode, 0)
        self.assertEqual(post.read_bytes(), before_post)
        self.assertEqual(chain.read_bytes(), before_chain)


if __name__ == '__main__': unittest.main(verbosity=2)
