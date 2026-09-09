#!/usr/bin/env python3
"""Offline source and rendered contracts for the 18 authored tutorial posts.

Only public catalog/post/output files are read. Downloads are parsed, never run.
The small baselines below pin identity, provenance and verified event dates, not
editorial paragraphs or private answers. Pass a site directory to check a build.
"""
from collections import Counter
from datetime import datetime
import hashlib
from html import unescape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shlex
import sys
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
POST_ROOT = '_posts/ctf-tutorials/challenges'
ORIGIN = 'https://deut-erium.github.io'
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
# Verified event starts (UTC); these are not challenge release timestamps.
EVENT_STARTS = {
    'google-ctf-2024': '2024-06-21T18:00:00+00:00',
    'sekaictf-2022': '2022-09-30T16:00:00+00:00',
    'sekaictf-2023': '2023-08-25T16:00:00+00:00',
    'sekaictf-2024': '2024-08-23T16:00:00+00:00',
    'sekaictf-2025': '2025-08-16T01:00:00+00:00',
    'zh3r0-2021': '2021-06-04T10:30:00+00:00',
    'cyber-apocalypse-2023': '2023-03-18T13:00:00+00:00',
}
REVISIONS = {
    'google-ctf-2024': ('google/google-ctf', '067421eb7e918c29e39f187fac5a0f0d72a6ab83'),
    'sekaictf-2022': ('project-sekai-ctf/sekaictf-2022', '383b16da68c438c5d516e6f00b2716210141f7a4'),
    'sekaictf-2023': ('project-sekai-ctf/sekaictf-2023', '4dc0f1fb2836c64b3a502e2538ba32530996b8c9'),
    'sekaictf-2024': ('project-sekai-ctf/sekaictf-2024', 'e7c9183860a846dd2c4e0d1fd5d5a1fe468e1244'),
    'sekaictf-2025': ('project-sekai-ctf/sekaictf-2025', '683dd81ae520581add40ec21c4819866e28cbde4'),
    'zh3r0-2021': ('zh3r0/zh3r0-ctf', '7fd08591b088215d58aefdc3b0f64c4a9de80f5d'),
    'cyber-apocalypse-2023': ('cyberkarta/HTBCyberApocalypse2023', 'd3fc66c54303eb6f2a6cd831c786f054bb8214c6'),
}
OFFLINE = {
    'google-ctf-2024-mceliece': 'CTF',
    'sekaictf-2022-failproof': 'SEKAI',
    'sekaictf-2022-failproof-revenge': 'SEKAI',
    'sekaictf-2024-some-trick': 'SEKAI',
    'zh3r0-2021-1n-jection': 'zh3r0',
    'zh3r0-2021-import-numpy-as-mt': 'zh3r0',
    'zh3r0-2021-twist-and-shout': 'zh3r0',
}
FIXED = {
    'sekaictf-2022-failproof': (1576, '15632ae2a4ba1f1cc14a5c508c32617f07c4d6d16949ec30593840203fbb671c'),
    'sekaictf-2022-failproof-revenge': (9008, '447bcf2520cceda24115e5d31faff6c1ef0fe1334b46bc05bf5488a6745d01fc'),
    'sekaictf-2024-some-trick': (1065, 'bfdf22675055bf94ea7b161901affcf3cfcc446f5efcfbd0b66a41f5ee343f8b'),
    'zh3r0-2021-import-numpy-as-mt': (257, '465c3b9fd394dea2de40a1df5581798b3182e8b8f3dd966dd76df80b9330cc25'),
    'zh3r0-2021-twist-and-shout': (6700, '898a7067d8e4fcf757ea59050015390d643fe39305f63fd1799e4072a41cf529'),
}
PRACTICE_IDS = {'assignment000001-0', 'assignment000001-1', 'assignment000001-2',
                'assignment000002-0', 'assignment000003-0', 'assignment000004-0', 'assignment000005-0'}
PRACTICE_URLS = {'/2021/04/08/challenges.html', '/2021/07/25/injection.html',
                 '/2021/07/25/wiki-mersenne.html', '/2021/07/25/untwist-me.html',
                 '/2021/07/25/mersenne-seed-recovery.html'}
SPOILER_KEYS = ('archive_url', 'source_url', 'solution_url', 'credit_url', 'contributor_url')
PIN = re.compile(r'^https://(?:raw\.githubusercontent\.com/[^/]+/[^/]+/|github\.com/[^/]+/[^/]+/(?:blob|tree)/)[0-9a-f]{40}(?:/|#|$)')
FLAG = re.compile(r'(?:CTF|SEKAI|HTB|zh3r0|flag)\{(?!\.\.\.\})', re.I)
LIQUID_URL = re.compile(r'\{\{\s*([\'"])(/[^\'"\s]+)\1\s*\|\s*(relative_url|absolute_url)\s*\}\}')
FENCE = re.compile(r'^```(sh|bash)\s*\n(.*?)^```\s*$', re.M | re.S)


def require(condition, message):
    if not condition:
        raise SystemExit('challenge archive: ' + message)


def no_flags(text, where):
    # Do not print the matched text: a failed gate must not leak an answer.
    require(not FLAG.search(unescape(text)), 'flag in ' + where)


def slug(title):
    return re.sub(r'[_ ]', '-', title.lower())


def original_files(e):
    """Pinned original paths and roles, independent of the editable catalog."""
    event, name = e['event_id'], e['slug']
    if event == 'google-ctf-2024':
        names = ['chall.sage', 'flag_enc.sobj', 'params.sobj', 'pubkey.sobj'] if name == 'mceliece' else ['chall.py']
        paths = [f'2024/quals/crypto-{name}/attachments/{n}' for n in names]
    elif event == 'zh3r0-2021':
        if name == 'b00tleg':
            paths = []
        elif name == 'cheater-mind':
            paths = ['V2/misc/cheater-mind/public/cheater-mind-76c6bf15e3b565583a26f5936b9faef6a7ee2c46.tar.gz']
        else:
            folder = {'1n-jection': '1n_jection', 'import-numpy-as-mt': 'import_numpy_as_MT',
                      'real-mersenne': 'real_mersenne', 'twist-and-shout': 'twist_and_shout'}.get(name, name)
            paths = [f'V2/crypto/{folder}/public/challenge.py']
    elif event == 'cyber-apocalypse-2023':
        paths = ['crypto_blokechain.zip']
    elif event == 'sekaictf-2022':
        paths = [f'crypto/{name}/challenge/app/' + ('diffecient.py' if name == 'diffecient' else 'source.py')]
    elif name == 'law-and-order':
        paths = ['crypto/law-and-order/dist/chall.py', 'crypto/law-and-order/challenge/app/chall.py']
    else:
        filename = {'diffecientwo': 'diffecientwo.py', 'randsubware': 'chall.py', 'some-trick': 'sometrick.py'}[name]
        paths = [f'crypto/{name}/dist/{filename}']
    repo, revision = REVISIONS[event]
    return [(f'https://raw.githubusercontent.com/{repo}/{revision}/{p}',
             'server-source' if '/challenge/app/' in p else 'handout') for p in paths]


def front_matter(text, ident):
    match = re.match(r'\A---\n(.*?)\n---\n(.*)\Z', text, re.S)
    require(match is not None, 'front matter for ' + ident)
    pairs = [line.split(': ', 1) for line in match[1].splitlines()]
    require(all(len(p) == 2 for p in pairs), 'JSON-compatible front matter for ' + ident)
    require(len({p[0] for p in pairs}) == len(pairs), 'duplicate metadata key for ' + ident)
    return {k: json.loads(v) for k, v in pairs}, match[2]


class Node:
    def __init__(self, tag, attrs=None, parent=None):
        self.tag, self.attrs, self.parent = tag, attrs or {}, parent
        self.children = []

    def nodes(self, tag=None, attr=None):
        result = []
        for child in self.children:
            if isinstance(child, Node):
                if (tag is None or child.tag == tag) and (attr is None or attr in child.attrs):
                    result.append(child)
                result.extend(child.nodes(tag, attr))
        return result

    def text(self):
        return ''.join(c.text() if isinstance(c, Node) else c for c in self.children)

    def inside(self, tag=None, attr=None):
        p = self.parent
        while p:
            if (tag is None or p.tag == tag) and (attr is None or attr in p.attrs):
                return True
            p = p.parent
        return False


class Page(HTMLParser):
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}

    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.root = self.current = Node('document')
        self.feed(text)
        self.close()

    def handle_starttag(self, tag, pairs):
        node = Node(tag, dict(pairs), self.current)
        self.current.children.append(node)
        if tag not in self.VOID:
            self.current = node

    def handle_startendtag(self, tag, pairs):
        self.handle_starttag(tag, pairs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        node = self.current
        while node.parent:
            if node.tag == tag:
                self.current = node.parent
                break
            node = node.parent

    def handle_data(self, data):
        self.current.children.append(data)

    def nodes(self, tag=None, attr=None):
        return self.root.nodes(tag, attr)


def expand_urls(text, baseurl='', origin=ORIGIN):
    return LIQUID_URL.sub(lambda m: (origin if m[3] == 'absolute_url' else '') + baseurl + m[2], text)


def downloads(e):
    return e['files'] + ([e['organizer_download']] if 'organizer_download' in e else [])


def commands(code, e, baseurl='', origin=ORIGIN):
    """Accept only directory setup and explicit GET downloads, not arbitrary shell.

    shlex checks quoted arguments without executing them. This allowlist also
    rejects curl config files, upload aliases, shell substitution and chaining.
    """
    ident = e['id']
    code = expand_urls(code, baseurl, origin)
    require(not re.search(r'[$`]', code), 'shell substitution for ' + ident)
    lines = [line.strip() for line in re.sub(r'\\\n\s*', ' ', code).splitlines() if line.strip()]
    tokens = [shlex.split(line) for line in lines]
    require(tokens[:2] == [['mkdir', '-p', ident], ['cd', ident]], 'download directory for ' + ident)
    actual = []
    for args in tokens[2:]:
        require(args and args[0] == 'curl', 'non-download command for ' + ident)
        name, urls = None, []
        i = 1
        while i < len(args):
            arg = args[i]
            if arg in {'--fail', '--location', '--get', '-f', '-L', '-fL', '-Lf'}:
                pass
            elif arg in {'--output', '-o', '--request', '-X'}:
                i += 1
                require(i < len(args), 'missing curl argument for ' + ident)
                if arg in {'--request', '-X'}:
                    require(args[i] == 'GET', 'non-GET curl for ' + ident)
                else:
                    require(name is None, 'duplicate curl output for ' + ident)
                    name = args[i]
            else:
                require(arg.startswith('https://'), 'unsafe curl argument for ' + ident)
                urls.append(arg)
            i += 1
        require(len(urls) == 1 and name, 'curl URL/output for ' + ident)
        actual.append((urls[0], name))
    expected = [(origin + baseurl + f['url'] if f['url'].startswith('/') else f['url'], f['download_name']) for f in downloads(e)]
    require(Counter(actual) == Counter(expected), 'download commands for ' + ident)
    return len(actual)


def file_inventory(root, directory):
    return {p.relative_to(root).as_posix() for p in (root/directory).rglob('*') if p.is_file() or p.is_symlink()}


def integrity(f, ident):
    require(type(f['bytes']) is int and f['bytes'] > 0 and
            isinstance(f['sha256'], str) and re.fullmatch(r'[0-9a-f]{64}', f['sha256']), 'file integrity metadata for ' + ident)
    require(isinstance(f['download_name'], str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', f['download_name']), 'download name for ' + ident)


def fixed_outputs(root, entries):
    intended = set()
    for e in entries:
        for f in e['files']:
            if f['kind'] != 'fixed-instance':
                continue
            path = f['url'].lstrip('/')
            intended.add(path)
            output = root/path
            require(output.is_file() and not output.is_symlink(), 'missing or symlinked fixed output for ' + e['id'])
            data = output.read_bytes()
            require((len(data), hashlib.sha256(data).hexdigest()) == (f['bytes'], f['sha256']), 'local output integrity for ' + e['id'])
            no_flags(data.decode('utf-8'), 'fixed output for ' + e['id'])
    require(file_inventory(root, 'assets/challenges') == intended, 'unexpected local output files')


def law_warning(text, where):
    # Check the distinction rather than freezing the whole warning paragraph.
    plain = ' '.join(text.lower().split())
    require(all(word in plain for word in ('incorrect', 'corrected', 'handout', 'server')), 'Law and Order warning in ' + where)


def organizer_disclosure(page, details, e):
    url = e['organizer_download']['url']
    require(page.root.text().count(url) == details.text().count(url) > 0 and
            all(n.inside('details', 'data-archive-spoilers') for n in page.nodes()
                if any(url in str(v) for v in n.attrs.values())), 'organizer URL outside disclosure for ' + e['id'])


def check_source_post(e, event):
    ident = e['id']
    path = ROOT/e['post_path']
    require(path.is_file() and not path.is_symlink(), 'missing or symlinked post for ' + ident)
    text = path.read_text()
    no_flags(text, 'post ' + ident)
    metadata, body = front_matter(text, ident)
    required = {'layout': 'article', 'title': e['title'], 'section': 'tutorials',
                'challenge_id': ident, 'challenge_year': e['year'],
                'challenge_checker': ident in OFFLINE, 'permalink': e['url']}
    require(all(metadata.get(k) == v for k, v in required.items()), 'post metadata for ' + ident)
    require(type(metadata['challenge_checker']) is bool and type(metadata['challenge_year']) is int, 'post metadata types for ' + ident)
    require(datetime.fromisoformat(metadata['date']) == datetime.fromisoformat(event['starts_at']), 'post date for ' + ident)
    require(isinstance(metadata.get('description'), str) and metadata['description'].strip(), 'description for ' + ident)
    tags = metadata.get('tags')
    require(isinstance(tags, list) and all(isinstance(t, str) and t.strip() == t and t for t in tags) and
            len(tags) == len(set(tags)) and 'challenges' in tags, 'post tags for ' + ident)
    require(metadata.keys() == required.keys() | {'date', 'description', 'tags'}, 'unsupported post control for ' + ident)
    assignments = re.findall(r'\{%\s*assign\s+event_challenge\s*=\s*(.*?)\s*%\}', body)
    require(len(assignments) == 1 and re.fullmatch(
        r'site\.data\.authored_challenges\.entries\s*\|\s*where:\s*[\'\"]id[\'\"],\s*page\.challenge_id\s*\|\s*first',
        assignments[0]), 'source catalog binding for ' + ident)
    page = Page(expand_urls(body))
    require([n.attrs['data-challenge-archive'] for n in page.nodes(attr='data-challenge-archive')] == [ident], 'source marker for ' + ident)
    require(not any(page.nodes(t) for t in ('script', 'iframe', 'object', 'embed', 'form')), 'source service/checker for ' + ident)
    require(not any(k.startswith('on') or k in {'data-answer', 'data-service-url'} for n in page.nodes() for k in n.attrs), 'active source markup for ' + ident)
    details = page.nodes('details', 'data-archive-spoilers')
    require(len(details) == 1 and 'open' not in details[0].attrs, 'source spoiler disclosure for ' + ident)
    includes = re.findall(r'\{%\s*include\s+([^%]+?)\s*%\}', body)
    require(all(s.split()[0] in {'challenge.html', 'challenge-sources.html'} for s in includes), 'unsupported source include for ' + ident)
    checkers = [s for s in includes if s.split()[0] == 'challenge.html']
    require(len(checkers) == int(ident in OFFLINE), 'source checker count for ' + ident)
    if checkers:
        args = dict(a.split('=', 1) for a in shlex.split(checkers[0])[1:])
        require(args == {'id': 'event_challenge.checker.id', 'hash': 'event_challenge.checker.sha256',
                         'salt': 'event_challenge.checker.salt', 'prefix': 'event_challenge.checker.prefix',
                         'title': 'page.title'}, 'source checker binding for ' + ident)
    require(sum(s == 'challenge-sources.html' for s in includes) == 1 and
            re.search(r'\{%\s*include\s+challenge-sources.html\s*%\}', details[0].text()), 'source credits disclosure for ' + ident)
    require('event_challenge.authors' in body and re.search(r'event_challenge\.authors\s*\|\s*join:.*?\|\s*escape', body), 'source creator/coauthor binding for ' + ident)
    links = page.nodes('a', 'data-file-kind')
    require([(n.attrs.get('href'), n.attrs['data-file-kind']) for n in links] == [(f['url'], f['kind']) for f in e['files']], 'source file links for ' + ident)
    blocks = list(FENCE.finditer(body))
    require(len(blocks) == 1 and len(re.findall(r'^```', body, re.M)) == 2, 'download block for ' + ident)
    require(not re.search(r'\bcurl\b', FENCE.sub('', body)), 'curl outside download block for ' + ident)
    commands(blocks[0][2], e)
    if 'organizer_download' in e:
        require(blocks[0][2] in details[0].text(), 'organizer command outside disclosure for ' + ident)
        organizer_disclosure(page, details[0], e)
    if e['slug'] == 'law-and-order':
        # File labels alone do not replace the version warning in the prose.
        prose = re.sub(r'<ul\b[^>]*data-archive-files.*?</ul>', '', FENCE.sub('', body), flags=re.S)
        law_warning(prose, 'post')
    return metadata


def verify_source():
    catalog = json.loads((ROOT/'_data/authored_challenges.json').read_text())
    no_flags(json.dumps(catalog), 'public metadata')
    entries, events = catalog['entries'], catalog['events']
    require(len(entries) == 18, 'review the intended inventory before changing its count')
    require(len(events) == len(EXPECTED) and {e['id'] for e in events} == set(EXPECTED), 'event list')
    require(len({e['id'] for e in entries}) == len(entries), 'duplicate IDs')
    require(len({e['url'] for e in entries}) == len(entries), 'duplicate URLs')
    require(Counter(p['url'] for p in catalog['practice']) == Counter(PRACTICE_URLS), 'practice listing')
    for event in events:
        ident = event['id']
        require(type(event['year']) is int and event['year'] == int(ident[-4:]), 'event year for ' + ident)
        require(event['starts_at'] == EVENT_STARTS[ident], 'verified event start for ' + ident)
        require({e['title'] for e in entries if e['event_id'] == ident} == EXPECTED[ident], 'titles for ' + ident)
    post_paths, metadata = set(), {}
    allowed_keys = {'id', 'event_id', 'slug', 'title', 'url', 'authors', 'category', 'statement', 'statement_label',
                    'files', 'notes', 'practice_url', 'repository', 'revision', 'license', 'contributor_note',
                    'solution_note', 'editorial_note', 'year', 'post_path', 'mode', 'checker', 'organizer_download', *SPOILER_KEYS}
    for e in entries:
        ident, event = e['id'], next(x for x in events if x['id'] == e['event_id'])
        require(e.keys() <= allowed_keys, 'unsupported catalog fields for ' + ident)
        require(e['slug'] == slug(e['title']) and ident == e['event_id'] + '-' + e['slug'], 'identity for ' + ident)
        require(e['url'] == f"/challenges/{e['event_id']}/{e['slug']}/", 'route for ' + ident)
        require(type(e['year']) is int and e['year'] == event['year'], 'entry year for ' + ident)
        require(e['post_path'] == f"{POST_ROOT}/{event['starts_at'][:10]}-{ident}.md", 'post path for ' + ident)
        require(e['mode'] == ('offline' if ident in OFFLINE else 'interactive'), 'mode for ' + ident)
        authors = e['authors']
        require(isinstance(authors, list) and all(isinstance(a, str) and a.strip() == a and a for a in authors) and
                any(a in {'deuterium', 'deut-erium'} for a in authors), 'credits for ' + ident)
        require(not re.search(r'<|\{[%{]', e['statement']), 'active markup in statement for ' + ident)
        require((e['repository'], e['revision']) == REVISIONS[e['event_id']], 'declared revision for ' + ident)
        for key in SPOILER_KEYS:
            if e.get(key):
                require(PIN.match(e[key]) is not None, 'unpinned ' + key + ' for ' + ident)
        if e.get('license'):
            require(PIN.match(e['license']['url']) is not None, 'unpinned license for ' + ident)
        if ident in OFFLINE:
            c = e.get('checker', {})
            require(set(c) == {'id', 'sha256', 'salt', 'prefix'} and c['id'] == 'authored-' + ident and
                    c['prefix'] == OFFLINE[ident] and re.fullmatch(r'[0-9a-f]{64}', c['sha256']) and
                    re.fullmatch(r'[0-9a-f]{32}', c['salt']), 'checker metadata for ' + ident)
        else:
            require('checker' not in e, 'unverified checker for ' + ident)
        require([(f['url'], f['kind']) for f in e['files'] if f['kind'] != 'fixed-instance'] == original_files(e), 'original file URLs/roles for ' + ident)
        local = [f for f in e['files'] if f['kind'] == 'fixed-instance']
        require(len(local) == int(ident in FIXED), 'fixed instance membership for ' + ident)
        if local:
            f = local[0]
            require(f['url'] == f'/assets/challenges/{ident}/output.txt' and
                    (f['bytes'], f['sha256']) == FIXED[ident] and f['download_name'] == 'output.txt', 'fixed instance metadata for ' + ident)
            require(f['generator_sha256'] == e['files'][0]['sha256'], 'fixed generator digest for ' + ident)
            require(datetime.fromisoformat(f['generated_at']).tzinfo is not None, 'fixed generation date for ' + ident)
        require(('organizer_download' in e) == (e['slug'] == 'b00tleg'), 'organizer download membership for ' + ident)
        if 'organizer_download' in e:
            f = e['organizer_download']
            expected_url = f"https://raw.githubusercontent.com/{e['repository']}/{e['revision']}/V2/crypto/b00tleg/admin/challenge.py"
            require(not e['files'] and f['url'] == expected_url and f['download_name'] == 'challenge.py', 'organizer source role for ' + ident)
        for f in downloads(e):
            integrity(f, ident)
        require(len({f['download_name'] for f in downloads(e)}) == len(downloads(e)), 'duplicate download names for ' + ident)
        post_paths.add(e['post_path'])
        metadata[ident] = check_source_post(e, event)
    require(file_inventory(ROOT, POST_ROOT) == post_paths, 'unexpected challenge post files')
    require(file_inventory(ROOT, 'challenges') == {'challenges/index.html'}, 'unexpected old archive source files')
    no_flags((ROOT/'challenges/index.html').read_text(), 'catalog source')
    fixed_outputs(ROOT, entries)
    law = next(e for e in entries if e['slug'] == 'law-and-order')
    require(len(law['files']) == 2 and law['files'][0]['sha256'] != law['files'][1]['sha256'], 'Law and Order versions')
    law_warning(' '.join(law['notes']), 'catalog')
    require(sum(len(e['files']) for e in entries) == 26, 'primary file inventory')
    return catalog, metadata


def canonical_path(value, baseurl='', origin=ORIGIN, absolute=False):
    """Normalize URL paths, never filesystem index.html paths or prefix matches."""
    parsed = urlsplit(value)
    require(not parsed.query and not parsed.fragment, 'noncanonical route')
    if parsed.netloc or parsed.scheme or absolute:
        require(parsed.scheme in {'https', 'http'} and f'{parsed.scheme}://{parsed.netloc}' == origin, 'route origin')
    require(parsed.path.startswith(baseurl + '/') and not parsed.path.startswith('//'), 'route baseurl')
    path = parsed.path[len(baseurl):]
    require(not re.search(r'[%\\]|//|(?:^|/)\.{1,2}(?:/|$)', path), 'malformed route')
    return path


def verify_rendered(site, baseurl, catalog, metadata):
    require(not baseurl or re.fullmatch(r'(?:/[A-Za-z0-9_-]+)+', baseurl), 'invalid baseurl argument')
    entries = catalog['entries']

    def load(route):
        path = site/route.lstrip('/')
        if route.endswith('/'):
            path /= 'index.html'
        require(path.is_file(), 'missing output ' + route)
        text = path.read_text()
        require('ARCHIVE_DIFFECIENT_URL' not in text, 'unexpanded description link')
        return text, Page(text)

    def hrefs(page):
        return [n.attrs.get('href') for n in page.nodes('a')]

    def membership(page, label, expected):
        links = []
        for row in page.nodes(attr='data-record'):
            anchors = row.nodes('a')
            require(anchors, 'empty post record in ' + label)
            route = canonical_path(anchors[0].attrs['href'], baseurl)
            if route.startswith('/challenges/'):
                require(row.attrs.get('data-section') == 'tutorials', 'post record section in ' + label)
            links.append(route)
        actual = [r for r in links if r.startswith('/challenges/')]
        require(Counter(actual) == Counter(expected), 'post membership in ' + label)

    index_text, index = load('/challenges/')
    no_flags(index_text, 'rendered catalog')
    no_flags(index.root.text(), 'rendered catalog')
    years = index.nodes('section', 'data-challenge-year')
    require([n.attrs['data-challenge-year'] for n in years] == ['2025', '2024', '2023', '2022', '2021'], 'catalog year groups')
    require(len(index.nodes('a', 'data-archive-entry')) == 18, 'catalog entry count')
    require(not index.nodes('form'), 'catalog checker/service')
    for group in years:
        year = int(group.attrs['data-challenge-year'])
        require([n.text().strip() for n in group.nodes('h2')] == [str(year)], 'catalog year heading')
        expected = sorted((e for e in entries if e['year'] == year), key=lambda e: e['title'].lower())
        actual = [(n.attrs.get('data-archive-entry'), n.attrs.get('href'), n.text().strip()) for n in group.nodes('a', 'data-archive-entry')]
        require(actual == [(e['id'], baseurl + e['url'], e['title']) for e in expected], 'alphabetical catalog membership in ' + str(year))
    require(file_inventory(site, 'challenges') == {'challenges/index.html'} |
            {e['url'].lstrip('/') + 'index.html' for e in entries}, 'unexpected rendered archive files')
    for e in entries:
        ident = e['id']
        text, page = load(e['url'])
        no_flags(text, 'rendered post ' + ident)
        no_flags(page.root.text(), 'rendered post ' + ident)
        require([n.text().strip() for n in page.nodes('h1')] == [e['title']], 'heading for ' + ident)
        bodies = page.nodes('body')
        require(len(bodies) == 1 and {'layout-article', 'section-tutorials'} <= set(bodies[0].attrs.get('class', '').split()), 'article/tutorial section for ' + ident)
        require([n.attrs['href'] for n in page.nodes('link') if n.attrs.get('rel') == 'canonical'] == [ORIGIN + baseurl + e['url']], 'canonical URL for ' + ident)
        articles = [n for n in page.nodes('article') if n.attrs.get('id') == 'article-body']
        require(len(articles) == 1, 'article body for ' + ident)
        article = articles[0]
        require([n.attrs['data-challenge-archive'] for n in article.nodes(attr='data-challenge-archive')] == [ident], 'entry marker for ' + ident)
        require(not any(article.nodes(t) for t in ('script', 'iframe', 'object', 'embed')), 'fabricated service for ' + ident)
        require(all(author in article.text() for author in e['authors']), 'rendered creator/coauthors for ' + ident)
        labels = [n.text().strip() for n in page.nodes('dt')]
        require('Event began' in labels and 'Published' not in labels, 'event date label for ' + ident)
        require(any(datetime.fromisoformat(n.attrs.get('datetime', '0001-01-01')) == datetime.fromisoformat(EVENT_STARTS[e['event_id']])
                    and 'itemprop' not in n.attrs for n in page.nodes('time')), 'rendered event date for ' + ident)
        details = page.nodes('details', 'data-archive-spoilers')
        require(len(details) == 1 and 'open' not in details[0].attrs and details[0].inside('article'), 'spoiler disclosure for ' + ident)
        require(any('spoiler' in n.text().lower() for n in details[0].nodes('summary')), 'spoiler summary for ' + ident)
        files = page.nodes('a', 'data-file-kind')
        require([(n.attrs.get('href'), n.attrs['data-file-kind']) for n in files] ==
                [(baseurl + f['url'] if f['url'].startswith('/') else f['url'], f['kind']) for f in e['files']], 'file links for ' + ident)
        require(all(n.inside('article') and not n.inside('details', 'data-archive-spoilers') for n in files), 'primary file placement for ' + ident)
        spoilers = [e[k] for k in SPOILER_KEYS if e.get(k)]
        if e.get('license'):
            spoilers.append(e['license']['url'])
        for url in spoilers:
            matching = [n for n in page.nodes('a') if n.attrs.get('href') == url]
            require(matching and all(n.inside('details', 'data-archive-spoilers') for n in matching), 'spoiler link outside disclosure for ' + ident)
        forms = page.nodes('form')
        require(len(forms) == int(ident in OFFLINE), 'checker count for ' + ident)
        if forms:
            form, c = forms[0], e['checker']
            require(form.inside('article') and 'data-flag-check' in form.attrs and 'data-answer' not in form.attrs and
                    form.attrs.get('action', '') in {'', '#'} and
                    all(form.attrs.get(k) == v for k, v in {'data-sha256': c['sha256'], 'data-salt': c['salt'],
                        'data-flag-prefix': c['prefix'], 'data-challenge-title': e['title']}.items()), 'quiz digest/attributes for ' + ident)
            inputs = form.nodes('input', 'data-flag-input')
            require(len(inputs) == 1 and inputs[0].attrs.get('id') == 'flag-' + c['id'] and 'name' not in inputs[0].attrs, 'quiz progress ID/input for ' + ident)
            require(any(n.attrs.get('type') == 'submit' and 'disabled' in n.attrs for n in form.nodes('button')), 'quiz submit guard for ' + ident)
        scripts = [urlsplit(n.attrs.get('src', '')).path for n in page.nodes('script')]
        require(scripts.count(baseurl + '/assets/js/article.js') == 1 and
                scripts.count(baseurl + '/assets/js/challenge.js') == int(ident in OFFLINE), 'article/checker scripts for ' + ident)
        blocks = article.nodes('pre')
        require(len(blocks) == 1, 'rendered command block for ' + ident)
        commands(blocks[0].text(), e, baseurl)
        if 'organizer_download' in e:
            require(blocks[0].inside('details', 'data-archive-spoilers'), 'rendered organizer command disclosure')
            organizer_disclosure(page, details[0], e)
        require(baseurl + '/challenges/' in hrefs(page) and baseurl + '/ctf-tutorials/' in hrefs(page), 'post return links for ' + ident)
        if e.get('practice_url'):
            require(baseurl + e['practice_url'] in hrefs(page), 'practice variant link for ' + ident)
        for href in hrefs(page):
            parsed = urlsplit(href or '')
            if parsed.path.startswith('/') and (not parsed.netloc or f'{parsed.scheme}://{parsed.netloc}' == ORIGIN):
                route = canonical_path(parsed._replace(query='', fragment='').geturl(), baseurl)
                path = site/route.lstrip('/')
                require(path.is_file() or (path/'index.html').is_file(), 'broken local link for ' + ident)
        if e['slug'] == 'law-and-order':
            law_warning(' '.join(n.text() for n in article.nodes('p')), 'rendered post')
    fixed_outputs(site, entries)
    _, assignments = load('/ctf-tutorials/assignments.html')
    require(all(baseurl + p['url'] in hrefs(assignments) for p in catalog['practice']), 'legacy practice listing')
    routes = [e['url'] for e in entries]
    for route in ('/archive.html', '/ctf-tutorials/', '/ctf-tutorials/archive.html', '/WriteUps/', '/ramblings/'):
        _, page = load(route)
        membership(page, route, routes if route in {'/archive.html', '/ctf-tutorials/', '/ctf-tutorials/archive.html'} else [])
    for route in ('/ctf-tutorials/', '/2021/04/08/challenges.html'):
        _, page = load(route)
        require(baseurl + '/challenges/' in hrefs(page), 'archive discovery link on ' + route)
    progress = json.loads((site/'challenges.json').read_text())
    authored = {'authored-' + ident for ident in OFFLINE}
    require(Counter(p['id'] for p in progress) == Counter(PRACTICE_IDS | authored), 'practice/authored progress IDs')
    for e in entries:
        if e['id'] not in OFFLINE:
            continue
        c = e['checker']
        record = next(p for p in progress if p['id'] == c['id'])
        # challenges_index emits canonical paths without baseurl, unlike index.json.
        require(record['page'] == e['url'] and record['title'] == e['title'] and
                record.get('sha256') == c['sha256'] and record.get('salt') == c['salt'] and not record['aliases'], 'authored progress entry for ' + e['id'])
    posts = json.loads((site/'index.json').read_text())
    require(len(posts) == 101, 'post index count')
    post_routes = [canonical_path(p['route'], baseurl, absolute=True) for p in posts]
    require(len(set(post_routes)) == len(post_routes), 'duplicate post index routes')
    require(Counter(r for r in post_routes if r.startswith('/challenges/')) == Counter(routes), 'post index archive membership')
    for e in entries:
        p = posts[post_routes.index(e['url'])]
        require(p['section'] == 'tutorials' and p['title'] == e['title'] and
                p['tags'] == metadata[e['id']]['tags'] and
                datetime.fromisoformat(p['date']) == datetime.fromisoformat(EVENT_STARTS[e['event_id']]) and
                p['has_code'] is True and p['has_math'] is False, 'post index metadata for ' + e['id'])
    require([json.loads(line) for line in (site/'index.jsonl').read_text().splitlines()] == posts, 'post JSONL parity')
    sitemap = ET.fromstring((site/'sitemap.xml').read_text())
    locations = [n.text for n in sitemap.iter() if n.tag.rsplit('}', 1)[-1] == 'loc']
    require(all(locations.count(ORIGIN + baseurl + e['url']) == 1 for e in entries), 'archive sitemap coverage')
    return {'rendered_entries': 18, 'practice_checkers': 7, 'authored_checkers': 7, 'posts': len(posts), 'baseurl': baseurl}


def verify(site=None, baseurl=''):
    try:
        catalog, metadata = verify_source()
        result = {'status': 'pass', 'source_entries': 18, 'file_links': 26, 'original_files': 21,
                  'fixed_outputs': 5, 'download_commands': 27, 'offline_checkers': 7}
        if site is not None:
            result.update(verify_rendered(Path(site), baseurl, catalog, metadata))
        return result
    except (ValueError, KeyError, TypeError, OSError, StopIteration, ET.ParseError) as error:
        # Fail closed without echoing potentially secret bytes.
        raise SystemExit('challenge archive: malformed input (' + type(error).__name__ + ')') from None


if __name__ == '__main__':
    print(json.dumps(verify(Path(sys.argv[1]) if len(sys.argv) > 1 else None,
                            sys.argv[2] if len(sys.argv) > 2 else ''), indent=2))
