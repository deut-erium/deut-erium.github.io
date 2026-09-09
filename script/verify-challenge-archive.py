#!/usr/bin/env python3
"""Offline checks for the authored archive catalog and rendered pages."""
from collections import Counter
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = {
    'google-ctf-2024': {'desfunctional', 'IDEA', 'McEliece'},
    'sekaictf-2022': {'FaILProof', 'Diffecient', 'FaILProof Revenge'},
    'sekaictf-2023': {'Diffecientwo', 'RandSubWare'},
    'sekaictf-2024': {'Some Trick'},
    'sekaictf-2025': {'Law and Order'},
    'zh3r0-2021': {'1n_jection', 'b00tleg', 'chaos', 'import numpy as MT',
                   'real_mersenne', 'twist_and_shout', 'cheater mind'},
    'cyber-apocalypse-2023': {'Blokechain'},
}
PIN = re.compile(r'^https://(?:raw\.githubusercontent\.com/[^/]+/[^/]+/|github\.com/[^/]+/[^/]+/(?:blob|tree)/)[0-9a-f]{40}(?:/|#|$)')


def require(condition, message):
    if not condition:
        raise SystemExit('challenge archive: ' + message)


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.stack, self.links, self.markers, self.details, self.forms, self.headings = [], [], [], [], [], []
        self.feed(text)

    def handle_starttag(self, tag, pairs):
        attrs = dict(pairs)
        if tag == 'a':
            self.links.append((attrs, any(t == 'details' and 'data-archive-spoilers' in a for t, a in self.stack)))
        if 'data-challenge-archive' in attrs:
            self.markers.append(attrs['data-challenge-archive'])
        if tag == 'details' and 'data-archive-spoilers' in attrs:
            self.details.append(attrs)
        if tag == 'form':
            self.forms.append(attrs)
        if tag == 'h1':
            self.headings.append('')
        if tag not in {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}:
            self.stack.append((tag, attrs))

    def handle_endtag(self, tag):
        for i in range(len(self.stack)-1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        if self.headings and any(t == 'h1' for t, _ in self.stack):
            self.headings[-1] += data


def verify(site=None, baseurl=''):
    catalog = json.loads((ROOT/'_data/authored_challenges.json').read_text())
    entries = catalog['entries']
    require(len(entries) == 18, 'review the intended inventory before changing its count')
    require({e['id'] for e in catalog['events']} == set(EXPECTED), 'event list')
    require(len({e['id'] for e in entries}) == len(entries), 'duplicate IDs')
    require(len({e['url'] for e in entries}) == len(entries), 'duplicate URLs')
    for event, titles in EXPECTED.items():
        require({e['title'] for e in entries if e['event_id'] == event} == titles, 'titles for ' + event)
    source_paths = {'challenges/index.html'}
    for e in entries:
        ident = e['id']
        require(re.fullmatch(r'[a-z0-9-]+', e['slug']) is not None, 'slug for ' + ident)
        require(e['url'] == f"/challenges/{e['event_id']}/{e['slug']}/", 'route for ' + ident)
        require(any(a in {'deuterium', 'deut-erium'} for a in e['authors']) and all(isinstance(a, str) and a.strip() == a and a for a in e['authors']), 'credits for ' + ident)
        require(not re.search(r'<|\{[%{]', e['statement']), 'active markup in statement for ' + ident)
        require(not re.search(r'(?:CTF|SEKAI|HTB|zh3r0|flag)\{', json.dumps(e)), 'flag in public metadata')
        for key in ['archive_url', 'source_url', 'solution_url', 'credit_url', 'contributor_url']:
            if e.get(key):
                require(PIN.match(e[key]) is not None, 'unpinned ' + key + ' for ' + ident)
        prefix = f"https://raw.githubusercontent.com/{e['repository']}/{e['revision']}/"
        for f in e['files']:
            require(f['url'].startswith(prefix), 'file outside declared revision for ' + ident)
            require(f['kind'] in {'handout', 'server-source'}, 'file role for ' + ident)
            path = urlsplit(f['url']).path
            if f['kind'] == 'handout':
                require(any('/'+part+'/' in path for part in ['attachments','public','dist']) or
                        (ident == 'cyber-apocalypse-2023-blokechain' and path.endswith('/crypto_blokechain.zip')), 'organizer source mislabeled as handout for ' + ident)
            else:
                require('/challenge/app/' in path, 'unexpected server source path for ' + ident)
            require(f['bytes'] > 0 and re.fullmatch(r'[0-9a-f]{64}', f['sha256']), 'file integrity metadata for ' + ident)
        path = f"challenges/{e['event_id']}/{e['slug']}.md"
        source_paths.add(path)
        text = (ROOT/path).read_text()
        metadata = dict((k, json.loads(v)) for k, v in (line.split(': ', 1) for line in text.split('---', 2)[1].strip().splitlines()))
        require(metadata == {'layout': 'challenge_archive', 'title': e['title'],
                            'description': next(x['series']+' '+str(x['year'])+' - '+e['category']+'.' for x in catalog['events'] if x['id']==e['event_id']),
                            'section': 'tutorials', 'challenge_id': ident, 'permalink': e['url']}, 'page metadata for ' + ident)
        require(not text.split('---', 2)[2].strip(), 'unexpected duplicated page body for ' + ident)
    require({p.relative_to(ROOT).as_posix() for p in (ROOT/'challenges').rglob('*') if p.is_file()} == source_paths, 'unexpected archive source files')
    law = next(e for e in entries if e['slug'] == 'law-and-order')
    require(len(law['files']) == 2 and law['files'][0]['sha256'] != law['files'][1]['sha256'], 'Law and Order versions')
    require('incorrect' in law['notes'][0] and 'corrected' in law['notes'][0], 'Law and Order warning')
    if site is None:
        return {'status': 'pass', 'source_entries': len(entries), 'file_links': sum(len(e['files']) for e in entries)}

    def load(route):
        path = site / route.lstrip('/')
        if route.endswith('/'):
            path /= 'index.html'
        require(path.is_file(), 'missing output ' + route)
        text = path.read_text()
        require('ARCHIVE_DIFFECIENT_URL' not in text, 'unexpanded description link')
        return text, Page(text)

    _, index = load('/challenges/')
    links = [a['href'] for a, _ in index.links if 'data-archive-entry' in a]
    require(Counter(links) == Counter(baseurl+e['url'] for e in entries), 'catalog membership')
    for e in entries:
        text, page = load(e['url'])
        require(page.headings == [e['title']], 'heading for ' + e['id'])
        require(page.markers == [e['id']], 'entry marker for ' + e['id'])
        require(not page.forms, 'unverified flag checker for ' + e['id'])
        require(len(page.details) == 1 and 'open' not in page.details[0], 'spoiler disclosure for ' + e['id'])
        require([(a.get('href'), a.get('data-file-kind')) for a, _ in page.links if 'data-file-kind' in a] == [(f['url'],f['kind']) for f in e['files']], 'file links for ' + e['id'])
        for key in ['archive_url', 'source_url', 'solution_url', 'credit_url', 'contributor_url']:
            if e.get(key):
                require(any(a.get('href') == e[key] and hidden for a, hidden in page.links), 'spoiler link outside disclosure for ' + e['id'])
        for a, _ in page.links:
            href = a.get('href', '')
            if href.startswith(baseurl+'/') and not href.startswith('//'):
                route = urlsplit(href).path[len(baseurl):]
                path = site / route.lstrip('/')
                require(path.is_file() or (path/'index.html').is_file(), 'broken local link ' + href)
        require(any(a.get('href') == baseurl+'/challenges/' for a, _ in page.links), 'catalog return link')
        if e.get('practice_url'):
            require(any(a.get('href') == baseurl+e['practice_url'] for a, _ in page.links), 'practice variant link')
    _, assignments = load('/ctf-tutorials/assignments.html')
    require(all(any(a.get('href') == baseurl+p['url'] for a,_ in assignments.links) for p in catalog['practice']), 'legacy practice listing')
    for route in ['/ctf-tutorials/', '/2021/04/08/challenges.html']:
        _, p = load(route)
        require(any(a.get('href') == baseurl+'/challenges/' for a,_ in p.links), 'archive discovery link on '+route)
    progress = json.loads((site/'challenges.json').read_text())
    require({e['id'] for e in progress} == {'assignment000001-0','assignment000001-1','assignment000001-2','assignment000002-0','assignment000003-0','assignment000004-0','assignment000005-0'}, 'practice progress IDs changed')
    posts = json.loads((site/'index.json').read_text())
    require(not any(p['route'].startswith('/challenges/') for p in posts), 'archive entries leaked into posts')
    sitemap = (site/'sitemap.xml').read_text()
    require(all(baseurl+e['url'] in sitemap for e in entries), 'archive sitemap coverage')
    return {'status':'pass', 'source_entries':len(entries), 'rendered_entries':len(entries), 'file_links':sum(len(e['files']) for e in entries), 'practice_checkers':len(progress), 'posts':len(posts), 'baseurl':baseurl}


if __name__ == '__main__':
    print(json.dumps(verify(Path(sys.argv[1]) if len(sys.argv)>1 else None, sys.argv[2] if len(sys.argv)>2 else ''), indent=2))
