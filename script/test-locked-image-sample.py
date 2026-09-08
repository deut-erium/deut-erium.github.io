#!/usr/bin/env python3
"""Check only the intentionally guessable Tux demo, never other locked posts."""
import argparse
import base64
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

REPO = Path(__file__).resolve().parents[1]
SOURCE = REPO / '_posts/2026-09-08-tux.md'
ROUTE = '/2026/09/08/tux.html'
PROMPT = 'what mode of AES reminds you of tux?'
IMAGE_SHA256 = '730bd3e6a187fac7a06af1023fe02c04257ab87ad9c35254c9563f1d74c7d429'

class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.payloads = []; self.payload = None; self.depth = 0
        self.images = []; self.links = []; self.text = []; self.scripts = []
        self.hidden_payload = False; self.canonical = []
    def handle_starttag(self, tag, attrs):
        data = dict(attrs)
        if tag == 'div' and 'argon' in data.get('class', '').split():
            assert self.payload is None
            self.payload = {'salt': data['data-salt'], 'needs': data['data-needs'], 'text': ''}
            self.depth = 1
        elif self.payload is not None:
            if tag not in {'br', 'img', 'input', 'meta', 'link', 'hr'}: self.depth += 1
            if tag == 'span' and 'hidden' in data: self.hidden_payload = True
        if tag == 'img': self.images.append(data)
        if tag == 'a': self.links.append(data)
        if tag == 'script': self.scripts.append(data)
        if tag == 'link' and data.get('rel') == 'canonical': self.canonical.append(data.get('href'))
    def handle_endtag(self, tag):
        if self.payload is not None:
            self.depth -= 1
            if self.depth == 0:
                self.payloads.append(self.payload); self.payload = None
    def handle_data(self, data):
        if self.payload is not None: self.payload['text'] += data
        else: self.text.append(data)

def parse(text):
    page = Page(); page.feed(text); page.close(); return page

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('site', nargs='?', type=Path)
args = parser.parse_args()
source = SOURCE.read_text()
page = parse(source)
assert PROMPT in source
assert len(page.payloads) == 1 and page.hidden_payload and not page.images
payload = page.payloads[0]
assert payload['needs'] == ''
assert len(bytes.fromhex(payload['salt'])) == 16
assert 'Enable JavaScript to unlock the image.' in source
assert 'mathjax: false' in source
assert 'sources/Tux_ecb.jpg' not in source

# Match the browser's WebCrypto parameters, without modifying the producer or key.
program = r'''
const fs = require('node:fs');
const c = require('node:crypto').webcrypto;
(async () => {
  const x = JSON.parse(fs.readFileSync(0, 'utf8'));
  const wire = Buffer.from(x.text.replace(/\s+/g, ''), 'base64');
  async function open(answer, data=wire) {
    const m = await c.subtle.importKey('raw', new TextEncoder().encode(answer.trim()), 'PBKDF2', false, ['deriveKey']);
    const key = await c.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:Buffer.from(x.salt,'hex'),iterations:120000},m,{name:'AES-GCM',length:256},false,['decrypt']);
    return Buffer.from(await c.subtle.decrypt({name:'AES-GCM',iv:data.subarray(0,12)},key,data.subarray(12))).toString('utf8');
  }
  const plain = await open('ECB');
  for (const wrong of ['ecb', 'CBC', 'wrong-demo-key']) {
    let rejected = false; try { await open(wrong); } catch { rejected = true; }
    if (!rejected) throw new Error('Wrong key accepted');
  }
  const corrupt = Buffer.from(wire); corrupt[corrupt.length-1] ^= 1;
  let rejected = false; try { await open('ECB', corrupt); } catch { rejected = true; }
  if (!rejected) throw new Error('Tampered ciphertext accepted');
  process.stdout.write(plain);
})().catch(e => {console.error(e); process.exitCode=1;});
'''
result = subprocess.run(['node', '-e', program], input=json.dumps(payload), capture_output=True, text=True)
assert result.returncode == 0, result.stderr
plain = result.stdout
unlocked = parse(plain)
assert len(unlocked.images) == 1
image = unlocked.images[0]
assert image['src'].startswith('data:image/jpeg;base64,')
assert image['id'] == 'encrypted-tux'
assert (image['width'], image['height']) == ('196', '216')
assert image['alt'].strip()
image_bytes = base64.b64decode(image['src'].split(',', 1)[1], validate=True)
assert hashlib.sha256(image_bytes).hexdigest() == IMAGE_SHA256
assert len(image_bytes) == 12824
assert 'Larry Ewing' in plain and 'User:Lunkwill' in plain
assert any(link.get('href') == 'https://commons.wikimedia.org/wiki/File:Tux_ecb.jpg' for link in unlocked.links)
assert 'AES-GCM' in plain and 'ECB' in plain
checks = ['hidden source payload', 'ECB WebCrypto decryption', 'three wrong answers rejected',
          'tampered ciphertext rejected', 'original JPEG bytes and dimensions', 'embedded attribution']

if args.site:
    built = (args.site / ROUTE.lstrip('/')).read_text()
    built_page = parse(built)
    assert built_page.payloads == page.payloads and built_page.hidden_payload
    assert PROMPT in ''.join(built_page.text)
    assert built_page.canonical == ['https://deut-erium.github.io' + ROUTE]
    assert 'assets/js/features/argon.js' in built
    assert not any('article.js' in script.get('src', '') or 'math.js' in script.get('src', '') for script in built_page.scripts)
    assert all('.goatcounter.com/count' in img.get('src', '') for img in built_page.images)
    assert 'data:image/jpeg;base64,' not in built and 'Tux_ecb.jpg' not in built
    entries = json.loads((args.site / 'index.json').read_text())
    matches = [entry for entry in entries if entry['route'].endswith(ROUTE)]
    assert len(matches) == 1 and matches[0]['title'] == 'Tux' and not matches[0]['has_math']
    assert ROUTE in (args.site / 'archive.html').read_text()
    ns = {'a':'http://www.w3.org/2005/Atom'}
    entries = ET.parse(args.site / 'feed.xml').findall('a:entry', ns)
    match = [entry for entry in entries if any(link.get('href', '').endswith(ROUTE) for link in entry.findall('a:link', ns))]
    assert len(match) == 1
    assert match[0].findtext('a:summary', namespaces=ns).strip() == 'An encrypted-image sample.'
    feed_entry = ET.tostring(match[0], encoding='unicode')
    assert 'data:image/jpeg;base64,' not in feed_entry
    assert payload['text'].strip() not in feed_entry
    assert ROUTE in (args.site / 'sitemap.xml').read_text()
    assert not (args.site / 'agent_out').exists()
    for file in args.site.rglob('*'):
        if file.is_file() and file.stat().st_size == len(image_bytes):
            assert hashlib.sha256(file.read_bytes()).hexdigest() != IMAGE_SHA256, f'Public raw image copy: {file}'
    checks += ['built payload parity and prompt', 'canonical/archive/index/feed/sitemap',
               'no unnecessary math/article scripts', 'no standalone JPEG in release']
print(json.dumps({'pass': True, 'checks': checks, 'plaintext_bytes': len(plain.encode()),
                  'image_bytes': len(image_bytes), 'image_sha256': IMAGE_SHA256,
                  'route': ROUTE, 'browser_rendering_tested': False}, indent=2))
