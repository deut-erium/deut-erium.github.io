#!/usr/bin/env python3
"""Check rendered routes and analytics without making network requests."""
import argparse
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
import json

class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts, self.pixels, self.links = [], [], []
        self.redirect = False
        self.noscript = 0
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'noscript': self.noscript += 1
        if tag == 'script': self.scripts.append(attrs)
        if tag == 'a': self.links.append(attrs.get('href', ''))
        if tag == 'img' and '.goatcounter.com/count' in attrs.get('src', ''):
            self.pixels.append((attrs, self.noscript > 0))
        if tag == 'meta' and attrs.get('http-equiv', '').lower() == 'refresh': self.redirect = True
    def handle_endtag(self, tag):
        if tag == 'noscript': self.noscript -= 1

parser = argparse.ArgumentParser()
parser.add_argument('site', type=Path)
parser.add_argument('--disabled', action='store_true')
args = parser.parse_args()
routes = json.loads(Path('_data/tetrasquares_routes.json').read_text())
assert not (args.site / 'new-tetris').exists()
for source, target in routes.items():
    assert (args.site / target).is_file(), target
    if source != target: assert not (args.site / source).exists(), source

counts = Counter()
for path in sorted(args.site.rglob('*.html')):
    name = path.relative_to(args.site).as_posix()
    page = Page(); page.feed(path.read_text())
    scripts = [s for s in page.scripts if s.get('src') == 'https://gc.zgo.at/count.js']
    exempt = page.redirect or name in {'google98b86655786074b6.html', 'yandex_0a37c4f8df609655.html'}
    if args.disabled or exempt:
        assert not scripts and not page.pixels, name
        counts['disabled' if args.disabled else 'excluded'] += 1
    else:
        assert len(scripts) == len(page.pixels) == 1, name
        script, (pixel, in_noscript) = scripts[0], page.pixels[0]
        assert script['data-goatcounter'] == 'https://deuterium.goatcounter.com/count', name
        assert 'async' in script and in_noscript, name
        counts['wired'] += 1
        if name in routes.values():
            expected = '/' + name.removesuffix('index.html')
            settings = json.loads(script['data-goatcounter-settings'])
            assert settings['path'] == expected and settings['title'].startswith('Tetrasquares'), name
            assert parse_qs(urlsplit(pixel['src']).query)['p'] == [expected], name
            assert not any('/assets/js/theme.js' in s.get('src', '') for s in page.scripts), name
    assert not any(urlsplit(link).path.startswith('/new-tetris/') for link in page.links), name

root = Page(); root.feed((args.site / 'tetrasquares/index.html').read_text())
assert '/tetrasquares/catalog/' in root.links
assert '/tetrasquares/scoring/' in root.links
catalog = Page(); catalog.feed((args.site / 'tetrasquares/catalog/index.html').read_text())
assert '/tetrasquares/' in catalog.links and '/tetrasquares/scoring/' in catalog.links
scoring = Page(); scoring.feed((args.site / 'tetrasquares/scoring/index.html').read_text())
assert '/tetrasquares/' in scoring.links and '/tetrasquares/catalog/' in scoring.links
print(json.dumps({'status': 'pass', 'counts': dict(counts), 'entry_pages': len(routes), 'analytics_disabled': args.disabled}, indent=2))
