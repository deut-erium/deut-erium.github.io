#!/usr/bin/env python3
"""Offline mutations of copied public sources and synthetic rendered contracts.

The HTML fixtures test the gate, not Jekyll or a browser. Only public mirrored downloads are copied; they are never executed. No answer
file, legacy article body, dependency installation or build is needed.
"""
import copy
import hashlib
from html import escape
import importlib.util
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'agent_out/challenge-runtime/integration/archive-gates'
OUT.mkdir(parents=True, exist_ok=True)
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('archive_check', ROOT/'script/verify-challenge-archive.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
BASE = json.loads((ROOT/'_data/authored_challenges.json').read_text())
OFFLINE = 'google-ctf-2024-mceliece'
INTERACTIVE = 'google-ctf-2024-desfunctional'
LAW = 'sekaictf-2025-law-and-order'
BOOTLEG = 'zh3r0-2021-b00tleg'
FIXED = 'sekaictf-2022-failproof'
ORIGIN = 'https://deut-erium.github.io'
RESULTS = []


def entry(data, ident=INTERACTIVE):
    return next(e for e in data['entries'] if e['id'] == ident)


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def replace(path, old, new):
    text = path.read_text()
    assert old in text, 'fixture replacement target missing'
    path.write_text(text.replace(old, new))


def post_path(root, ident=INTERACTIVE):
    return root/entry(BASE, ident)['post_path']


def change_meta(root, key, value, ident=INTERACTIVE):
    path = post_path(root, ident)
    text = path.read_text()
    front, body = text.split('---', 2)[1:]
    metadata = dict((k, json.loads(v)) for k, v in (line.split(': ', 1) for line in front.strip().splitlines()))
    metadata[key] = value
    path.write_text('---\n' + '\n'.join(k + ': ' + json.dumps(v) for k, v in metadata.items()) + '\n---' + body)


def html_path(site, route):
    return site/route.lstrip('/')/('index.html' if route.endswith('/') else '')


def article_path(site, ident=INTERACTIVE):
    return html_path(site, entry(BASE, ident)['url'])


def anchor(url, text, attrs=''):
    return f'<a href="{escape(url, quote=True)}" {attrs}>{escape(text)}</a>'


def rendered_fixture(source, site, baseurl=''):
    """Minimal synthetic HTML/JSON, explicitly not a substitute release build."""
    data = json.loads((source/'_data/authored_challenges.json').read_text())
    posts, progress = [], []
    rows = []
    for e in data['entries']:
        ident = e['id']
        date = next(event['starts_at'] for event in data['events'] if event['id'] == e['event_id'])
        contents = '<p>By ' + escape(', '.join(e['authors'])) + '.</p>'
        contents += ''.join('<p>' + escape(note) + '</p>' for note in e['notes'])
        contents += '<ul>' + ''.join('<li>' + anchor(baseurl + f['url'] if f['url'].startswith('/') else f['url'], f['label'],
                                                    f'data-file-kind="{f["kind"]}"') + '</li>' for f in e['files']) + '</ul>'
        contents += ''.join(anchor(baseurl + route, 'Terminal representation') for route in gate.terminal_routes(e))
        # Stand-ins establish link/inventory coverage, not the separate terminal schema.
        for route in gate.terminal_routes(e):
            write(html_path(site, route), '{}\n' if route.endswith('.json') else e['post_title'] + '\n')
        files = gate.downloads(e) + [{'url': e['url'] + name, 'download_name': name}
                                    for name in ('challenge.txt', 'challenge.json')]
        code = 'mkdir -p ' + ident + '\ncd ' + ident + '\n'
        for f in files:
            url = ORIGIN + baseurl + f['url'] if f['url'].startswith('/') else f['url']
            code += f'curl --fail --location --output {f["download_name"]} \\\n  "{url}"\n'
        block = '<pre><code>' + escape(code) + '</code></pre>'
        if 'organizer_download' not in e:
            contents += block
        if 'checker' in e:
            c = e['checker']
            contents += (f'<form data-flag-check data-sha256="{c["sha256"]}" data-salt="{c["salt"]}" '
                         f'data-flag-prefix="{c["prefix"]}" data-challenge-title="{escape(e["post_title"], quote=True)}">'
                         f'<input data-flag-input id="flag-{c["id"]}" placeholder="{c["prefix"]}{{...}}">'
                         '<button type="submit" disabled>Check flag</button></form>')
            progress.append({'id': c['id'], 'page': baseurl + e['url'], 'title': e['post_title'], 'sha256': c['sha256'], 'salt': c['salt'], 'aliases': []})
        if 'browser_practice' in e:
            variants = ''.join(f'<option value="{v}">{v}</option>' for v in e['browser_practice']['variants'])
            contents += (f'<h2 id="browser-practice">Browser practice</h2>'
                         f'<section class="challenge-practice" data-challenge-practice data-runtime="{e["slug"]}" data-id="{ident}">'
                         '<p>Public dummy reward: practice{local_dummy_reward}. Console: window.challengePractice.</p>'
                         f'<select data-practice-variant disabled>{variants}</select>'
                         '<button type="button" data-practice-start disabled>Start</button>'
                         '<button type="button" data-practice-stop disabled>Stop</button>'
                         '<button type="button" data-practice-reset disabled>Reset</button>'
                         '<textarea data-practice-output readonly aria-label="Transcript"></textarea>'
                         '<form><textarea data-practice-input disabled aria-label="Input"></textarea>'
                         '<button type="submit" data-practice-send disabled>Send</button></form>'
                         '<p data-practice-status>Stopped</p><noscript>Enable JavaScript for practice.</noscript></section>')
        contents += '<details data-archive-spoilers><summary>Sources and solutions (spoilers)</summary>'
        if 'organizer_download' in e:
            contents += block + anchor(e['organizer_download']['upstream_url'], 'Original organizer source (spoilers)')
        for key in ('archive_url', 'source_url', 'solution_url', 'credit_url', 'contributor_url'):
            if e.get(key):
                contents += anchor(e[key], key)
        if e.get('license'):
            contents += anchor(e['license']['url'], e['license']['name'])
            contents += ''.join(anchor(baseurl + url, 'Local license') for url in e['license']['local_urls'])
        contents += '</details>' + anchor(baseurl + '/challenges/', 'All challenges') + anchor(baseurl + '/ctf-tutorials/', 'Tutorials')
        if e.get('practice_url'):
            contents += anchor(baseurl + e['practice_url'], 'Practice variant')
        html = (f'<html><head><link rel="canonical" href="{ORIGIN}{baseurl}{e["url"]}"></head>'
                f'<body class="layout-article section-tutorials"><h1>{escape(e["post_title"])}</h1>'
                f'<dl><dt>Event began</dt><dd><time datetime="{date}">{date[:10]}</time></dd></dl>'
                f'<article id="article-body"><div data-challenge-archive="{ident}">{contents}</div></article>'
                f'<script src="{baseurl}/assets/js/article.js?v=fixture"></script>')
        if 'checker' in e:
            html += f'<script src="{baseurl}/assets/js/challenge.js?v=fixture"></script>'
        if 'browser_practice' in e:
            html += (f'<script type="module" src="{baseurl}{gate.BROWSER_UI}?v=fixture"></script>'
                     f'<link rel="stylesheet" href="{baseurl}{gate.BROWSER_CSS}?v=fixture">')
        write(html_path(site, e['url']), html + '</body></html>')
        metadata, _ = gate.front_matter((source/e['post_path']).read_text(), ident)
        posts.append({'title': e['post_title'], 'date': date, 'route': ORIGIN + baseurl + e['url'],
                      'section': 'tutorials', 'tags': metadata['tags'], 'description': metadata['description'], 'has_code': True, 'has_math': False})
        rows.append('<li data-record data-section="tutorials">' + anchor(baseurl + e['url'], e['post_title']) + '</li>')
    catalog = ''
    for year in (2025, 2024, 2023, 2022, 2021):
        catalog += f'<section data-challenge-year="{year}"><h2>{year}</h2>'
        for e in sorted((e for e in data['entries'] if e['year'] == year), key=lambda e: e['title'].lower()):
            catalog += anchor(baseurl + e['url'], e['post_title'], f'data-archive-entry="{e["id"]}"')
        catalog += '</section>'
    write(site/'challenges/index.html', catalog)
    write(site/'challenges/index.json', '{}\n')
    for route in ('/archive.html', '/ctf-tutorials/', '/ctf-tutorials/archive.html'):
        write(html_path(site, route), '<ol>' + ''.join(rows) + '</ol>' + anchor(baseurl + '/challenges/', 'Challenges'))
    for route in ('/WriteUps/', '/ramblings/'):
        write(html_path(site, route), '<ol></ol>')
    practice_links = ''.join(anchor(baseurl + p['url'], p['title']) for p in data['practice'])
    write(site/'ctf-tutorials/assignments.html', practice_links)
    for p in data['practice']:
        write(html_path(site, p['url']), anchor(baseurl + '/challenges/', 'Challenges'))
    progress.extend({'id': ident, 'page': '/2021/04/08/challenges.html', 'title': 'Synthetic legacy fixture', 'aliases': []}
                    for ident in sorted(gate.PRACTICE_IDS))
    # Bodyless stand-ins: no original private/locked article content is read.
    posts.extend({'route': ORIGIN + baseurl + f'/legacy-fixture-{i}.html', 'title': 'Synthetic legacy post',
                  'section': 'tutorials'} for i in range(80))
    write(site/'index.json', json.dumps(posts))
    write(site/'index.jsonl', ''.join(json.dumps(p) + '\n' for p in posts))
    write(site/'challenges.json', json.dumps(progress))
    write(site/'sitemap.xml', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
          ''.join('<url><loc>' + ORIGIN + baseurl + e['url'] + '</loc></url>' for e in data['entries']) + '</urlset>')
    shutil.copytree(source/'assets/challenges', site/'assets/challenges')


def move_block_outside_spoiler(path, pattern):
    text = path.read_text()
    block = re.search(pattern, text, re.M | re.S)[0]
    text = text.replace(block, '', 1).replace('</details>', '</details>\n' + block, 1)
    path.write_text(text)


def swap_catalog_entries(site):
    path = site/'challenges/index.html'
    text = path.read_text()
    anchors = re.findall(r'<a [^>]*data-archive-entry[^>]*>.*?</a>', text)
    # The second and third entries are in the same year, with distinct titles.
    text = text.replace(anchors[1], 'SWAP_PLACEHOLDER').replace(anchors[2], anchors[1]).replace('SWAP_PLACEHOLDER', anchors[2])
    path.write_text(text)


def mutate_json(path, function):
    data = json.loads(path.read_text())
    function(data)
    path.write_text(json.dumps(data))


def co_mutate_bytes(root, select):
    """Change an artifact and its advertised hash/length, but never the gate pins."""
    path = root/'_data/authored_challenges.json'
    data = json.loads(path.read_text())
    record = select(data)
    payload = b'synthetic co-mutated artifact\n'
    (root/record['url'].lstrip('/')).write_bytes(payload)
    record.update(bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest())
    path.write_text(json.dumps(data))


def move_and_symlink(root, path):
    # Targets are public fixture copies, never private files or external paths.
    target = root/'symlink-target'
    path.rename(target)
    path.symlink_to(target, target_is_directory=target.is_dir())


def remove_source_command(path, name):
    text = path.read_text()
    pattern = r'^curl[^\n]*--output ' + re.escape(name) + r' \\\n[^\n]*\n'
    changed, count = re.subn(pattern, '', text, flags=re.M)
    assert count == 1, 'fixture command target missing'
    path.write_text(changed)


def run_case(template, root, label, catalog=None, source=None, rendered=None, valid=False, reason=None, baseurl='', render=False):
    if root.exists():
        shutil.rmtree(root)
    shutil.copytree(template, root)
    gate.ROOT = root
    data = copy.deepcopy(BASE)
    if catalog:
        catalog(data)
    write(root/'_data/authored_challenges.json', json.dumps(data))
    if source:
        source(root)
    site = root/'rendered-fixture'
    if render:
        rendered_fixture(root, site, baseurl)
    if rendered:
        rendered(site)
    rejection = None
    try:
        gate.verify(site if render else None, baseurl)
    except SystemExit as error:
        rejection = str(error)
    assert (rejection is None) == valid, f'{label}: unexpected result ({rejection})'
    if reason:
        assert rejection and reason in rejection, f'{label}: wrong rejection ({rejection})'
    RESULTS.append({'case': label, 'layer': 'synthetic-rendered' if render else 'source',
                    'expected': 'accept' if valid else 'reject', 'pass': True, 'rejection': rejection})


def main():
    with tempfile.TemporaryDirectory(dir=OUT, prefix='fixtures-') as tmp:
        temp = Path(tmp)
        template, root = temp/'baseline', temp/'work'
        for directory in ('challenges', gate.POST_ROOT, 'assets/challenges'):
            shutil.copytree(ROOT/directory, template/directory)
        write(template/'_data/authored_challenges.json', json.dumps(BASE))
        # Membership-only stubs. These tests do not render the actual include,
        # execute a module, or stand in for a real Jekyll build.
        for path in ('_includes/challenge-browser.html', gate.BROWSER_UI.lstrip('/'), gate.BROWSER_CSS.lstrip('/')):
            write(template/path, 'Synthetic integration membership fixture.\n')
        for runtime in gate.BROWSER_RUNTIMES.values():
            write(template/f'assets/js/challenge-practice/ports/{runtime}.mjs', '// Synthetic port membership fixture.\n')

        def check(label, **kwargs):
            run_case(template, root, label, **kwargs)

        def cat(label, mutate, reason):
            check(label, catalog=mutate, reason=reason)

        def src(label, mutate, reason):
            check(label, source=mutate, reason=reason)

        check('valid migrated source', valid=True)
        check('coauthor addition', catalog=lambda d: entry(d)['authors'].append('coauthor-fixture'), valid=True)
        check('alternate creator spelling', catalog=lambda d: entry(d).update(authors=['deut-erium', 'coauthor-fixture']), valid=True)
        check('editorial prose remains editable', source=lambda r: replace(post_path(r), '## Files', 'An editorial note.\n\n## Files'), valid=True)
        check('description remains editable', source=lambda r: change_meta(r, 'description', 'Revised public description.'), valid=True)
        check('explicit curl GET accepted', source=lambda r: replace(post_path(r), 'curl --fail', 'curl --request GET --fail'), valid=True)
        check('short curl flags accepted', source=lambda r: replace(post_path(r), '--fail --location --output', '-fL -o'), valid=True)
        cat('missing entry', lambda d: d['entries'].pop(), 'intended inventory')
        cat('duplicate ID', lambda d: entry(d).update(id=d['entries'][1]['id']), 'duplicate IDs')
        cat('duplicate URL', lambda d: entry(d).update(url=d['entries'][1]['url']), 'duplicate URLs')
        cat('wrong title', lambda d: entry(d).update(title='Other challenge'), 'titles for')
        cat('renamed slug', lambda d: entry(d).update(slug='renamed'), 'identity for')
        cat('creator removed', lambda d: entry(d).update(authors=['someone else']), 'credits for')
        cat('whitespace coauthor', lambda d: entry(d)['authors'].append(' bad '), 'credits for')
        cat('missing practice listing', lambda d: d['practice'].pop(), 'practice listing')
        cat('duplicate event', lambda d: d['events'].append(d['events'][0]), 'event list')
        cat('wrong event year', lambda d: d['events'][0].update(year=2023), 'event year')
        cat('event year string', lambda d: d['events'][0].update(year='2024'), 'event year')
        cat('changed verified start', lambda d: d['events'][0].update(starts_at='2024-06-22T18:00:00+00:00'), 'verified event start')
        cat('wrong entry year', lambda d: entry(d).update(year=2023), 'entry year')
        for bad in ('challenges/google-ctf-2024/desfunctional/', '//challenges/google-ctf-2024/desfunctional/',
                    '/challenges/google-ctf-2024/desfunctional/index.html', '/challenges/google-ctf-2024/desfunctional/?x=1',
                    '/challenges/google-ctf-2024/../desfunctional/', '/challenges/google-ctf-2024/desfunctional'):
            cat('malformed catalog route ' + bad, lambda d, bad=bad: entry(d).update(url=bad), 'route for')
        cat('post path traversal', lambda d: entry(d).update(post_path='../private.md'), 'post path')
        cat('old source root', lambda d: entry(d).update(post_path='challenges/google-ctf-2024/desfunctional.md'), 'post path')
        for mode in ('server', 'browser', 'offline', None):
            cat('interactive mode changed to ' + str(mode), lambda d, mode=mode: entry(d).update(mode=mode), 'mode for')
        cat('offline mode changed', lambda d: entry(d, OFFLINE).update(mode='interactive'), 'mode for')
        cat('fabricated service metadata', lambda d: entry(d).update(service_url='https://example.invalid/'), 'unsupported catalog fields')
        cat('offline checker missing', lambda d: entry(d, OFFLINE).pop('checker'), 'checker metadata')
        cat('browser metadata missing', lambda d: entry(d).pop('browser_practice'), 'browser metadata allowlist')
        for value in (None, False, True, 'desfunctional', {}, {'runtime': 'desfunctional'},
                      {'runtime': 'idea', 'variants': ['default']},
                      {'runtime': 'desfunctional', 'variants': 'default'},
                      {'runtime': 'desfunctional', 'variants': ['default', 'released']}):
            cat('invalid browser metadata ' + repr(value), lambda d, value=value: entry(d).update(browser_practice=value), 'browser metadata allowlist')
        for key, value in (('reward', 'synthetic'), ('seed', 1), ('state', {}), ('module_url', 'https://example.invalid/a.mjs'),
                           ('launch_path', '/wrong/'), ('answer', 'synthetic')):
            cat('browser extra metadata ' + key, lambda d, key=key, value=value: entry(d)['browser_practice'].update({key: value}), 'browser metadata allowlist')
        for runtime in ('../idea', '/assets/js/challenge-practice/ports/idea.mjs', 'https://example.invalid/a.mjs', '', None):
            cat('browser unsafe runtime ' + repr(runtime), lambda d, runtime=runtime: entry(d)['browser_practice'].update(runtime=runtime), 'browser metadata allowlist')
        for value in (None, False, {'runtime': 'mceliece', 'variants': ['default']}):
            cat('offline browser metadata ' + repr(value), lambda d, value=value: entry(d, OFFLINE).update(browser_practice=value), 'offline browser metadata')
        cat('Law variants reversed', lambda d: entry(d, LAW)['browser_practice'].update(variants=['released', 'corrected']), 'browser metadata allowlist')
        for value in (False, None, 'true', 1, 0):
            src('browser boolean ' + repr(value), lambda r, value=value: change_meta(r, 'challenge_browser', value),
                'post metadata types' if value == 1 else 'post metadata')
        src('browser flag missing', lambda r: replace(post_path(r), 'challenge_browser: true\n', ''), 'post metadata')
        src('offline browser flag', lambda r: change_meta(r, 'challenge_browser', True, OFFLINE), 'unsupported post control')
        src('browser include missing', lambda r: replace(post_path(r), '{% include challenge-browser.html %}', ''), 'source browser include')
        src('browser include arguments', lambda r: replace(post_path(r), '{% include challenge-browser.html %}', '{% include challenge-browser.html runtime="idea" %}'), 'source browser include')
        src('browser include duplicate', lambda r: replace(post_path(r), '{% include challenge-browser.html %}', '{% include challenge-browser.html %}\n{% include challenge-browser.html %}'), 'source browser include')
        src('offline browser include', lambda r: replace(post_path(r, OFFLINE), '## Files', '{% include challenge-browser.html %}\n## Files'), 'source browser include')
        src('browser heading missing', lambda r: replace(post_path(r), '## Browser practice', '## Practice'), 'source browser placement')
        src('browser include after Files', lambda r: replace(post_path(r), '{% include challenge-browser.html %}\n\n## Files', '## Files\n\n{% include challenge-browser.html %}'), 'source browser placement')
        src('direct browser form forbidden', lambda r: replace(post_path(r), '## Files', '<form data-practice-send></form>\n## Files'), 'source service/checker')
        for path in ('_includes/challenge-browser.html', gate.BROWSER_UI.lstrip('/'), gate.BROWSER_CSS.lstrip('/'),
                     'assets/js/challenge-practice/ports/desfunctional.mjs'):
            src('missing integration file ' + path, lambda r, path=path: (r/path).unlink(),
                'missing browser module' if '/ports/' in path else 'missing browser integration')
            src('symlinked integration file ' + path, lambda r, path=path: move_and_symlink(r, r/path), 'symlink in')
        cat('interactive checker added', lambda d: entry(d).update(checker=copy.deepcopy(entry(d, OFFLINE)['checker'])), 'unverified checker')
        for key, value in (('id', 'authored-other'), ('sha256', '0'*63), ('sha256', 'G'*64),
                           ('salt', 'a'*31), ('salt', 'A'*32), ('prefix', 'flag'), ('prefix', 'ctf'), ('answer', 'synthetic')):
            cat('malformed checker ' + key + ' ' + str(len(value)),
                lambda d, key=key, value=value: entry(d, OFFLINE)['checker'].update({key: value}), 'checker metadata')
        for field in ('statement', 'title', 'notes'):
            cat('synthetic flag in ' + field, lambda d, field=field: entry(d).update({field: ['CTF{synthetic-test-value}'] if field == 'notes' else 'CTF{synthetic-test-value}'}), 'flag in public metadata')
        cat('active statement markup', lambda d: entry(d).update(statement='<script>bad()</script>'), 'active markup')
        cat('unpinned archive', lambda d: entry(d).update(archive_url=entry(d)['archive_url'].replace(entry(d)['revision'], 'main')), 'unpinned archive_url')
        cat('unpinned credit', lambda d: entry(d, LAW).update(credit_url='https://github.com/example/repo/blob/main/README.md'), 'unpinned credit_url')
        cat('wrong declared revision', lambda d: entry(d).update(revision='0'*40), 'declared revision')
        cat('foreign handout URL', lambda d: entry(d)['files'][0].update(url='https://example.invalid/file.py'), 'original local URL')
        cat('changed pinned handout URL', lambda d: entry(d)['files'][0].update(url=entry(d)['files'][0]['url'].replace('chall.py', 'other.py')), 'original local URL')
        cat('server source mislabeled handout', lambda d: entry(d, FIXED)['files'][0].update(kind='handout'), 'original file URLs/roles')
        cat('handout mislabeled server source', lambda d: entry(d)['files'][0].update(kind='server-source'), 'original file URLs/roles')
        cat('unexpected file role', lambda d: entry(d)['files'][0].update(kind='answer'), 'original file URLs/roles')
        cat('bad file digest', lambda d: entry(d)['files'][0].update(sha256='abc'), 'file integrity metadata')
        cat('empty file', lambda d: entry(d)['files'][0].update(bytes=0), 'file integrity metadata')
        cat('boolean byte length', lambda d: entry(d)['files'][0].update(bytes=True), 'file integrity metadata')
        cat('duplicate download names', lambda d: entry(d, LAW)['files'][1].update(download_name='released-chall.py'), 'duplicate download names')
        cat('download name traversal', lambda d: entry(d)['files'][0].update(download_name='../chall.py'), 'download name')
        cat('changed fixed digest', lambda d: entry(d, FIXED)['files'][1].update(sha256='0'*64), 'fixed instance metadata')
        cat('changed fixed byte count', lambda d: entry(d, FIXED)['files'][1].update(bytes=1), 'fixed instance metadata')
        cat('wrong fixed URL', lambda d: entry(d, FIXED)['files'][1].update(url='/assets/challenges/other/output.txt'), 'fixed instance metadata')
        cat('fixed output removed', lambda d: entry(d, FIXED)['files'].pop(), 'fixed instance membership')
        cat('wrong fixed generator', lambda d: entry(d, FIXED)['files'][1].update(generator_sha256='0'*64), 'fixed generator digest')
        cat('organizer source missing', lambda d: entry(d, BOOTLEG).pop('organizer_download'), 'organizer download membership')
        cat('organizer source on another post', lambda d: entry(d).update(organizer_download=entry(d, BOOTLEG)['organizer_download']), 'organizer download membership')
        cat('wrong organizer URL', lambda d: entry(d, BOOTLEG)['organizer_download'].update(url='https://example.invalid/challenge.py'), 'organizer source role')
        cat('organizer source relabeled handout', lambda d: entry(d, BOOTLEG)['files'].append(dict(entry(d, BOOTLEG).pop('organizer_download'), kind='handout', label='handout')), 'original file URLs/roles')
        cat('Law versions conflated', lambda d: entry(d, LAW)['files'][1].update(sha256=entry(d, LAW)['files'][0]['sha256']), 'original file integrity pins')
        cat('Law warning removed', lambda d: entry(d, LAW).update(notes=['A challenge.']), 'Law and Order warning')
        for key, value in (('layout', 'challenge_archive'), ('section', 'root'), ('permalink', '/bad/'),
                           ('date', '2024-06-22T18:00:00+00:00'), ('date', 'not-a-date'),
                           ('challenge_id', 'other'), ('challenge_year', 2023), ('challenge_checker', True),
                           ('challenge_checker', 0), ('tags', ['crypto']), ('unlisted', True), ('sha256hash', '0'*64)):
            src('post metadata ' + key + ' ' + str(value), lambda r, key=key, value=value: change_meta(r, key, value),
                'post date' if key == 'date' and value != 'not-a-date' else 'malformed input' if value == 'not-a-date' else
                'post metadata types' if key == 'challenge_checker' and value == 0 else 'post tags' if key == 'tags' else
                'unsupported post control' if key in {'unlisted', 'sha256hash'} else 'post metadata')
        src('post missing', lambda r: post_path(r).unlink(), 'missing or symlinked post')
        src('empty stub body', lambda r: post_path(r).write_text('---' + post_path(r).read_text().split('---', 2)[1] + '---\n'), 'source catalog binding')
        src('wrong source marker', lambda r: replace(post_path(r), 'data-challenge-archive="' + INTERACTIVE, 'data-challenge-archive="wrong'), 'source marker')
        src('plaintext synthetic flag in post', lambda r: change_meta(r, 'description', 'CTF{synthetic-test-value}'), 'flag in post')
        src('creator binding removed', lambda r: replace(post_path(r), 'event_challenge.authors', 'page.author'), 'source creator/coauthor binding')
        src('catalog lookup uses another challenge', lambda r: replace(post_path(r), "where: 'id', page.challenge_id", "where: 'id', page.other_id"), 'source catalog binding')
        src('opened source spoiler', lambda r: replace(post_path(r), '<details data-archive-spoilers>', '<details data-archive-spoilers open>'), 'source spoiler disclosure')
        src('credits include removed', lambda r: replace(post_path(r), '{% include challenge-sources.html %}', ''), 'source credits disclosure')
        src('extra unverified include', lambda r: replace(post_path(r), '## Files', '{% include checkflag.html %}\n## Files'), 'unsupported source include')
        src('raw service iframe', lambda r: replace(post_path(r), '## Files', '<iframe src="https://example.invalid/"></iframe>\n## Files'), 'source service/checker')
        src('raw checker form', lambda r: replace(post_path(r), '## Files', '<form data-flag-check></form>\n## Files'), 'source service/checker')
        src('offline checker unbound hash', lambda r: replace(post_path(r, OFFLINE), 'hash=event_challenge.checker.sha256', 'hash=page.sha256hash'), 'source checker binding')
        src('offline checker removed', lambda r: replace(post_path(r, OFFLINE), re.search(r'{% include challenge.html .*?%}', post_path(r, OFFLINE).read_text())[0], ''), 'source checker count')
        src('source file role mismatch', lambda r: replace(post_path(r), 'data-file-kind="handout"', 'data-file-kind="server-source"'), 'source file links')
        src('wrong curl URL', lambda r: replace(post_path(r), "' | absolute_url }}", "-wrong' | absolute_url }}"), 'download commands')
        src('wrong curl output name', lambda r: replace(post_path(r), '--output chall.py', '--output other.py'), 'download commands')
        src('duplicate curl command', lambda r: replace(post_path(r), '\n```\n', '\ncurl --output chall.py "' + ORIGIN + entry(BASE)['files'][0]['url'] + '"\n```\n'), 'download commands')
        for option in ('-T local.txt', '-F x=y', '--data x', '-d x', '-X POST', '--request PUT', '-X PATCH', '--json x', '--config local.cfg'):
            src('upload/config curl option ' + option, lambda r, option=option: replace(post_path(r), 'curl --fail', 'curl ' + option + ' --fail'), 'non-GET curl' if option.startswith(('-X', '--request')) else 'unsafe curl argument')
        src('shell command chaining', lambda r: replace(post_path(r), 'cd ' + INTERACTIVE, 'cd ' + INTERACTIVE + '; echo bad'), 'download directory')
        src('shell substitution', lambda r: replace(post_path(r), '--output chall.py', '--output $(echo chall.py)'), 'shell substitution')
        src('non-curl network command', lambda r: replace(post_path(r), 'curl --fail', 'wget --fail'), 'non-download command')
        src('missing code block', lambda r: replace(post_path(r), '```sh', '```python'), 'download block')
        src('curl outside code block', lambda r: replace(post_path(r), '## Files', 'curl https://example.invalid/\n## Files'), 'curl outside')
        src('organizer command moved outside spoiler', lambda r: move_block_outside_spoiler(post_path(r, BOOTLEG), r'^```sh\n.*?^```'), 'organizer command outside')
        src('Law source warning removed', lambda r: replace(post_path(r, LAW), 'incorrect', 'released'), 'Law and Order warning')
        src('Law labels cannot replace source warning', lambda r: replace(post_path(r, LAW), entry(BASE, LAW)['notes'][0], ''), 'Law and Order warning')
        src('organizer link exposed outside spoiler', lambda r: replace(post_path(r, BOOTLEG), '## Files', anchor(entry(BASE, BOOTLEG)['organizer_download']['url'], 'Source') + '\n## Files'), 'organizer URL outside disclosure')
        src('fixed output changed on disk', lambda r: (r/f'assets/challenges/{FIXED}/output.txt').write_bytes(b'synthetic corruption\n'), 'local output integrity')
        src('fixed output missing on disk', lambda r: (r/f'assets/challenges/{FIXED}/output.txt').unlink(), 'missing local download')
        src('unexpected post file', lambda r: write(r/gate.POST_ROOT/'unexpected.txt', 'fixture'), 'unexpected challenge post files')
        src('old empty stub reintroduced', lambda r: write(r/'challenges/event/stub.md', '---\n---\n'), 'unexpected old archive source files')
        src('unexpected local output', lambda r: write(r/'assets/challenges/stray.txt', 'fixture'), 'unexpected local output files')
        src('flag in catalog source', lambda r: write(r/'challenges/index.html', 'CTF{synthetic-test-value}'), 'flag in catalog source')

        # Hosting and descriptive-title regressions. Every co-mutation uses the
        # real public fixture bytes plus editable metadata, not patched baselines.
        with patch.object(gate, 'no_flags', wraps=gate.no_flags) as scan:
            check('original placeholders and license prose excluded from flag scan', valid=True)
        scanned = [call.args[1] for call in scan.call_args_list]
        assert sorted(scanned) == sorted(['public metadata', 'catalog source'] +
               ['post ' + e['id'] for e in BASE['entries']] + ['fixed output for ' + ident for ident in gate.FIXED])
        check('license record order remains editable', catalog=lambda d: d['licenses'].reverse(), valid=True)
        check('public dummy reward prose accepted', source=lambda r: replace(post_path(r, BOOTLEG),
              '## Files', 'Public reward: practice{local_dummy_reward}.\n\n## Files'), valid=True)
        for ident in (INTERACTIVE, FIXED, BOOTLEG, 'cyber-apocalypse-2023-blokechain'):
            cat('short display title rejected ' + ident, lambda d, ident=ident: entry(d, ident).update(post_title=entry(d, ident)['title']), 'descriptive post title')
        cat('post title missing', lambda d: entry(d).pop('post_title'), 'malformed input')
        cat('co-mutated event series and post title', lambda d: (d['events'][0].update(series='Other event'),
            entry(d).update(post_title='Challenge archive: Other event 2024 - desfunctional')), 'descriptive post title')
        src('front matter uses short identity', lambda r: change_meta(r, 'title', entry(BASE)['title']), 'post metadata')
        cat('unexpected top-level catalog control', lambda d: d.update(service_url='https://example.invalid/'), 'unsupported catalog controls')
        for key, value in (('upstream_url', 'https://example.invalid/chall.py'),
                           ('upstream_url', entry(BASE)['files'][0]['upstream_url'].replace(entry(BASE)['revision'], 'main'))):
            cat('original provenance changed ' + value, lambda d, key=key, value=value: entry(d)['files'][0].update({key: value}), 'original file URLs/roles')
        cat('original provenance missing', lambda d: entry(d)['files'][0].pop('upstream_url'), 'original file URLs/roles')
        cat('original file claims modification', lambda d: entry(d)['files'][0].update(modification='Replaced the reward.'), 'original file fields/modification')
        cat('original file extra metadata', lambda d: entry(d)['files'][0].update(command='python chall.py'), 'original file fields/modification')
        cat('fixed output claims upstream origin', lambda d: entry(d, FIXED)['files'][1].update(upstream_url=entry(d, FIXED)['files'][0]['upstream_url']), 'fixed instance fields')
        for url in ('/assets/challenges/../chall.py', '/assets/challenges/%2e%2e/chall.py',
                    '//assets/challenges/chall.py', '/assets/challenges/other/chall.py',
                    entry(BASE)['files'][0]['url'] + '?x=1', entry(BASE)['files'][0]['url'] + '#fragment'):
            cat('invalid local download path ' + url, lambda d, url=url: entry(d)['files'][0].update(url=url), 'original local URL')
        for name in ('..', '../chall.py', 'sub/chall.py', 'sub\\chall.py', '%2e%2e', 'challenge.txt'):
            cat('unsafe or unapproved download name ' + name, lambda d, name=name: entry(d)['files'][0].update(download_name=name),
                'original file integrity pins' if name == 'challenge.txt' else 'download name')
        for e in BASE['entries']:
            for index, f in enumerate(e['files']):
                reason = 'fixed instance metadata' if f['kind'] == 'fixed-instance' else 'original file integrity pins'
                src('co-mutated bytes and metadata ' + e['id'] + '/' + f['download_name'],
                    lambda r, ident=e['id'], index=index: co_mutate_bytes(r, lambda d: entry(d, ident)['files'][index]), reason)
        for index, f in enumerate(BASE['licenses']):
            src('co-mutated license bytes and metadata ' + f['id'],
                lambda r, index=index: co_mutate_bytes(r, lambda d: d['licenses'][index]), 'license metadata pins')
        src('co-mutated organizer practice bytes and metadata',
            lambda r: co_mutate_bytes(r, lambda d: entry(d, BOOTLEG)['organizer_download']), 'organizer practice integrity pin')
        for field, value in (('kind', 'handout'), ('download_name', 'challenge.py'),
                             ('upstream_url', 'https://example.invalid/challenge.py'), ('upstream_bytes', 1),
                             ('upstream_sha256', '0'*64), ('sha256', '0'*64),
                             ('modification', 'Unchanged original source.'), ('modification', '')):
            reason = ('organizer source role' if field in {'kind', 'download_name'} else
                      'organizer upstream provenance' if field.startswith('upstream_') else
                      'organizer practice integrity pin' if field == 'sha256' else 'organizer modification')
            cat('organizer practice metadata ' + field + ' ' + str(value),
                lambda d, field=field, value=value: entry(d, BOOTLEG)['organizer_download'].update({field: value}), reason)
        cat('organizer modification missing', lambda d: entry(d, BOOTLEG)['organizer_download'].pop('modification'), 'organizer source fields')
        cat('organizer checker fabricated', lambda d: entry(d, BOOTLEG).update(checker=entry(d, OFFLINE)['checker']), 'unverified checker')
        for field in ('id', 'name', 'url', 'upstream_url', 'sha256', 'bytes'):
            cat('license metadata changed ' + field, lambda d, field=field: d['licenses'][0].update({field: 1 if field == 'bytes' else 'wrong'}), 'license metadata pins')
        cat('license missing', lambda d: d['licenses'].pop(), 'license inventory')
        cat('license duplicated', lambda d: d['licenses'].__setitem__(1, copy.deepcopy(d['licenses'][0])), 'license metadata pins')
        cat('license extra fields', lambda d: d['licenses'][0].update(modification='Unchanged'), 'license metadata pins')
        cat('license byte count boolean', lambda d: d['licenses'][0].update(bytes=True), 'license integrity metadata')
        cat('license record null', lambda d: d['licenses'].__setitem__(0, None), 'license integrity metadata')
        cat('applicable license missing', lambda d: entry(d).pop('license'), 'applicable license metadata')
        cat('applicable license copies missing', lambda d: entry(d)['license'].pop('local_urls'), 'applicable license metadata')
        cat('applicable license copy wrong', lambda d: entry(d)['license'].update(local_urls=[d['licenses'][1]['url']]), 'applicable license metadata')
        cat('applicable license copies incomplete', lambda d: entry(d, FIXED)['license']['local_urls'].pop(), 'applicable license metadata')
        cat('unverified license added', lambda d: entry(d, BOOTLEG).update(license=entry(d)['license']), 'applicable license metadata')
        for f, label in ((entry(BASE)['files'][0], 'original'), (entry(BASE, BOOTLEG)['organizer_download'], 'organizer'),
                         (BASE['licenses'][0], 'license')):
            src(label + ' missing on disk', lambda r, f=f: (r/f['url'].lstrip('/')).unlink(), 'missing local download')
            src(label + ' corrupted on disk', lambda r, f=f: (r/f['url'].lstrip('/')).write_bytes(b'corruption'), 'local output integrity')
        for path in (entry(BASE)['files'][0]['url'].lstrip('/'), entry(BASE, FIXED)['files'][1]['url'].lstrip('/'),
                     entry(BASE, BOOTLEG)['organizer_download']['url'].lstrip('/'), BASE['licenses'][0]['url'].lstrip('/'),
                     'assets/challenges/' + INTERACTIVE, 'assets/challenges/licenses', 'assets/challenges',
                     entry(BASE)['post_path'], gate.POST_ROOT, '_data/authored_challenges.json'):
            src('source symlink rejected ' + path, lambda r, path=path: move_and_symlink(r, r/path), 'symlink in')
        src('dangling artifact symlink', lambda r: (r/'assets/challenges/dangling').symlink_to('missing'), 'symlink in')
        src('extra empty artifact directory', lambda r: (r/'assets/challenges/empty').mkdir(), 'unexpected local output directories')
        src('source primary URL missing relative filter', lambda r: replace(post_path(r),
            "{{ '" + entry(BASE)['files'][0]['url'] + "' | relative_url }}", entry(BASE)['files'][0]['url']), 'source file links')
        src('source primary URL uses absolute filter', lambda r: replace(post_path(r),
            "{{ '" + entry(BASE)['files'][0]['url'] + "' | relative_url }}",
            "{{ '" + entry(BASE)['files'][0]['url'] + "' | absolute_url }}"), 'source file links')
        src('source primary download reverted upstream', lambda r: replace(post_path(r),
            "{{ '" + entry(BASE)['files'][0]['url'] + "' | absolute_url }}", entry(BASE)['files'][0]['upstream_url']), 'download commands')
        src('source commands omit absolute filter', lambda r: replace(post_path(r), '| absolute_url', '| relative_url'), 'unsafe curl argument')
        src('source command hardcodes root origin', lambda r: replace(post_path(r),
            "{{ '" + entry(BASE)['files'][0]['url'] + "' | absolute_url }}", ORIGIN + entry(BASE)['files'][0]['url']), 'download commands')
        src('source bash fence instead of sh', lambda r: replace(post_path(r), '```sh', '```bash'), 'download block')
        src('source second sh fence', lambda r: replace(post_path(r), '## Files', '```sh\necho fixture\n```\n\n## Files'), 'download block')
        src('source return link lost', lambda r: replace(post_path(r), "'/challenges/' | relative_url", "'/missing/' | relative_url"), 'source return links')
        for name in ('challenge.txt', 'challenge.json'):
            src('source terminal command missing ' + name, lambda r, name=name: remove_source_command(post_path(r), name), 'download commands')
            src('source terminal output wrong ' + name, lambda r, name=name: replace(post_path(r), '--output ' + name, '--output wrong-' + name), 'download commands')
            src('source terminal link missing ' + name, lambda r, name=name: replace(post_path(r),
                "'" + entry(BASE)['url'] + name + "' | relative_url", "'/missing/' | relative_url"), 'source terminal links')
        src('upstream organizer link exposed outside disclosure', lambda r: replace(post_path(r, BOOTLEG), '## Files',
            anchor(entry(BASE, BOOTLEG)['organizer_download']['upstream_url'], 'Original source') + '\n## Files'), 'organizer URL outside disclosure')

        def rendered(label, mutate, reason, baseurl=''):
            check(label, rendered=mutate, reason=reason, baseurl=baseurl, render=True)

        check('valid synthetic rendered root', render=True, valid=True)
        for old, new, reason in (
            ('data-challenge-practice ', 'data-wrong-practice ', 'browser widget count'),
            ('data-runtime="desfunctional"', 'data-runtime="idea"', 'browser widget binding'),
            ('data-id="' + INTERACTIVE + '"', 'data-id="other"', 'browser widget binding'),
            ('id="browser-practice"', 'id="wrong-heading"', 'browser heading'),
            ('<form>', '<form action="https://example.invalid/">', 'browser form attributes'),
            ('<form>', '<form name="practice">', 'browser form attributes'),
            ('data-practice-input disabled', 'data-practice-input name="input" disabled', 'browser form attributes'),
            ('data-practice-send disabled', 'data-practice-send formaction="/" disabled', 'browser form attributes'),
            ('data-practice-start disabled', 'data-practice-start', 'browser button guard'),
            ('data-practice-input disabled', 'data-practice-input', 'browser input guard'),
            ('data-practice-output readonly', 'data-practice-output', 'browser output guard'),
            ('aria-label="Transcript"', '', 'browser accessible name'),
            ('data-practice-stop', 'data-wrong-stop', 'browser control count'),
            ('value="default"', 'value="released"', 'browser variants'),
            ('Public dummy reward', 'Reward', 'browser practice disclosure'),
            ('<script type="module"', '<script type="text/javascript"', 'browser module placement/type'),
            ('rel="stylesheet"', 'rel="modulepreload"', 'browser stylesheet placement/type'),
        ):
            rendered('browser rendered mutation ' + old + ' -> ' + new,
                     lambda s, old=old, new=new: replace(article_path(s), old, new), reason)
        rendered('Law released selected by default', lambda s: replace(article_path(s, LAW), 'value="released"', 'value="released" selected'), 'browser variants')
        rendered('browser output adds pre block', lambda s: replace(article_path(s), '<p data-practice-status>', '<pre>Extra</pre><p data-practice-status>'), 'browser widget active/code markup')
        rendered('browser inline handler', lambda s: replace(article_path(s), 'data-practice-start disabled', 'data-practice-start onclick="bad()" disabled'), 'browser form attributes')
        rendered('browser script inside body', lambda s: replace(article_path(s), '</article>', '<script type="module" src="/assets/js/challenge-practice/ui.mjs"></script></article>'), 'fabricated service')
        rendered('browser CSS inside body', lambda s: replace(article_path(s), '</article>', '<link rel="stylesheet" href="/assets/css/features/challenge-practice.css"></article>'), 'browser asset scope')
        for resource in (f'<script type="module" src="{gate.BROWSER_UI}"></script>',
                         f'<link rel="stylesheet" href="{gate.BROWSER_CSS}">'):
            rendered('duplicate browser resource ' + resource, lambda s, resource=resource: replace(article_path(s), '</body>', resource + '</body>'), 'browser asset scope')
            for route in (entry(BASE, OFFLINE)['url'], '/challenges/', '/archive.html', '/2021/04/08/challenges.html'):
                rendered('browser resource outside intended pages ' + route + resource,
                         lambda s, route=route, resource=resource: write(html_path(s, route), html_path(s, route).read_text() + resource), 'browser asset scope')
        for resource in (f'<script type="module" src="/assets/js/challenge-practice/ports/idea.mjs"></script>',
                         '<link rel="modulepreload" href="/assets/js/challenge-practice/worker.mjs">'):
            rendered('eager port/Worker resource ' + resource, lambda s, resource=resource: replace(article_path(s), '</body>', resource + '</body>'), 'unexpected browser resource')
        for path in (gate.BROWSER_UI, gate.BROWSER_CSS):
            rendered('foreign browser resource ' + path, lambda s, path=path: replace(article_path(s), path, 'https://example.invalid' + path), 'unexpected browser resource')
            rendered('browser resource missing ' + path, lambda s, path=path: replace(article_path(s), path, '/wrong-asset'), 'browser asset scope')
            rendered('browser resource missing baseurl ' + path, lambda s, path=path: replace(article_path(s), '/preview' + path, path), 'browser asset scope', '/preview')
        check('valid synthetic rendered baseurl', render=True, baseurl='/preview', valid=True)
        check('rendered coauthors retained', catalog=lambda d: entry(d)['authors'].append('coauthor-fixture'), render=True, valid=True)
        rendered('wrong rendered section', lambda s: replace(article_path(s), 'section-tutorials', 'section-root'), 'article/tutorial section')
        rendered('wrong rendered layout', lambda s: replace(article_path(s), 'layout-article', 'layout-page'), 'article/tutorial section')
        rendered('wrong rendered title', lambda s: replace(article_path(s), '<h1>' + entry(BASE)['post_title'] + '</h1>', '<h1>Other</h1>'), 'heading for')
        rendered('missing rendered marker', lambda s: replace(article_path(s), 'data-challenge-archive', 'data-wrong-marker'), 'entry marker')
        rendered('synthetic flag split across elements', lambda s: replace(article_path(s), '</article>', '<p>CTF<span>{synthetic-test-value}</span></p></article>'), 'flag in rendered post')
        rendered('published label restored', lambda s: replace(article_path(s), '<dt>Event began</dt>', '<dt>Published</dt>'), 'event date label')
        rendered('wrong rendered date', lambda s: replace(article_path(s), 'datetime="2024-06-21T18:00:00+00:00"', 'datetime="2024-06-22T18:00:00+00:00"'), 'rendered event date')
        rendered('wrong canonical route', lambda s: replace(article_path(s), f'{ORIGIN}/challenges/google-ctf-2024/desfunctional/', f'{ORIGIN}/challenges/google-ctf-2024/desfunctional/index.html'), 'canonical URL')
        rendered('open rendered spoilers', lambda s: replace(article_path(s), '<details data-archive-spoilers>', '<details data-archive-spoilers open>'), 'spoiler disclosure')
        rendered('spoiler URL outside disclosure', lambda s: replace(article_path(s), '</article>', anchor(entry(BASE)['archive_url'], 'Leaked source') + '</article>'), 'spoiler link outside')
        rendered('missing primary file link', lambda s: replace(article_path(s), 'data-file-kind="handout"', 'data-wrong-kind="handout"'), 'file links')
        rendered('wrong primary file role', lambda s: replace(article_path(s), 'data-file-kind="handout"', 'data-file-kind="server-source"'), 'file links')
        rendered('fixed link lacks baseurl', lambda s: replace(article_path(s, FIXED), f'href="/preview/assets/challenges/{FIXED}/output.txt"', f'href="/assets/challenges/{FIXED}/output.txt"'), 'file links', '/preview')
        rendered('local command lacks baseurl', lambda s: replace(article_path(s, FIXED), ORIGIN + '/preview/assets/challenges/', ORIGIN + '/assets/challenges/'), 'download commands', '/preview')
        rendered('fabricated interactive checker', lambda s: replace(article_path(s), '</article>', '<form data-flag-check></form></article>'), 'checker count')
        rendered('fabricated live service', lambda s: replace(article_path(s), '</article>', '<iframe src="https://example.invalid/"></iframe></article>'), 'fabricated service')
        for attr, value in (('data-sha256', '0'*64), ('data-salt', '0'*32), ('data-flag-prefix', 'flag'), ('data-challenge-title', 'Other')):
            rendered('rendered quiz wrong ' + attr,
                     lambda s, attr=attr, value=value: article_path(s, OFFLINE).write_text(re.sub(attr + r'="[^"]*"', attr + '="' + value + '"', article_path(s, OFFLINE).read_text())), 'quiz digest/attributes')
        rendered('quiz plaintext answer attribute', lambda s: replace(article_path(s, OFFLINE), '<form ', '<form data-answer="synthetic" '), 'quiz digest/attributes')
        rendered('quiz external form action', lambda s: replace(article_path(s, OFFLINE), '<form ', '<form action="https://example.invalid/" '), 'quiz digest/attributes')
        rendered('quiz renamed progress ID', lambda s: replace(article_path(s, OFFLINE), 'id="flag-authored-', 'id="flag-wrong-'), 'quiz progress ID/input')
        rendered('quiz submit enabled', lambda s: replace(article_path(s, OFFLINE), ' disabled', ''), 'quiz submit guard')
        rendered('quiz script on interactive post', lambda s: replace(article_path(s), '</body>', '<script src="/assets/js/challenge.js"></script></body>'), 'article/checker scripts')
        rendered('rendered upload command', lambda s: replace(article_path(s), 'curl --fail', 'curl -X POST --fail'), 'non-GET curl')
        rendered('rendered organizer disclosure moved', lambda s: move_block_outside_spoiler(article_path(s, BOOTLEG), r'<pre>.*?</pre>'), 'rendered organizer command disclosure')
        rendered('rendered Law warning removed', lambda s: replace(article_path(s, LAW), 'incorrect', 'released'), 'Law and Order warning')
        rendered('Law labels cannot replace rendered warning', lambda s: replace(article_path(s, LAW), escape(entry(BASE, LAW)['notes'][0]), ''), 'Law and Order warning')
        rendered('rendered organizer link exposed', lambda s: replace(article_path(s, BOOTLEG), '</article>', anchor(entry(BASE, BOOTLEG)['organizer_download']['url'], 'Source') + '</article>'), 'organizer URL outside disclosure')
        rendered('stray rendered archive file', lambda s: write(s/'challenges/unregistered.html', 'fixture'), 'unexpected rendered archive files')
        rendered('wrong rendered output hash', lambda s: (s/f'assets/challenges/{FIXED}/output.txt').write_bytes(b'fixture changed\n'), 'local output integrity')
        rendered('stray rendered output', lambda s: write(s/'assets/challenges/stray.txt', 'fixture'), 'unexpected local output files')
        rendered('catalog duplicate entry', lambda s: replace(s/'challenges/index.html', '</section>', anchor(entry(BASE)['url'], 'Duplicate', 'data-archive-entry="duplicate"') + '</section>'), 'catalog entry count')
        rendered('catalog wrong year sequence', lambda s: replace(s/'challenges/index.html', 'data-challenge-year="2025"', 'data-challenge-year="2020"'), 'catalog year groups')
        rendered('catalog wrong alphabetical order', swap_catalog_entries, 'alphabetical catalog membership')
        rendered('catalog missing baseurl', lambda s: replace(s/'challenges/index.html', 'href="/preview/challenges/', 'href="/challenges/'), 'alphabetical catalog membership', '/preview')
        for route in ('/archive.html', '/ctf-tutorials/', '/ctf-tutorials/archive.html'):
            rendered('missing authored post in ' + route, lambda s, route=route: replace(html_path(s, route), 'data-record data-section', 'data-omitted data-section'), 'post membership')
        rendered('authored post leaked to WriteUps', lambda s: write(s/'WriteUps/index.html', '<li data-record data-section="tutorials">' + anchor(entry(BASE)['url'], 'Wrong section') + '</li>'), 'post membership')
        rendered('wrong tutorial record section', lambda s: replace(s/'ctf-tutorials/index.html', 'data-section="tutorials"', 'data-section="root"'), 'post record section')
        rendered('missing legacy practice link', lambda s: write(s/'ctf-tutorials/assignments.html', ''), 'legacy practice listing')
        rendered('lost old progress ID', lambda s: mutate_json(s/'challenges.json', lambda p: p.pop()), 'practice/authored progress IDs')
        rendered('lost authored progress ID', lambda s: mutate_json(s/'challenges.json', lambda p: p.pop(0)), 'practice/authored progress IDs')
        rendered('extra progress ID', lambda s: mutate_json(s/'challenges.json', lambda p: p.append({'id': 'fabricated'})), 'practice/authored progress IDs')
        rendered('wrong progress digest', lambda s: mutate_json(s/'challenges.json', lambda p: p[0].update(sha256='0'*64)), 'authored progress entry')
        rendered('wrong progress canonical page', lambda s: mutate_json(s/'challenges.json', lambda p: p[0].update(page=p[0]['page'] + 'index.html')), 'authored progress entry')
        rendered('authored progress alias loss', lambda s: mutate_json(s/'challenges.json', lambda p: p[0].update(aliases=['other'])), 'authored progress entry')
        rendered('absolute index route removed', lambda s: mutate_json(s/'index.json', lambda p: p[0].update(route=entry(BASE)['url'])), 'route origin')
        rendered('absolute index wrong host', lambda s: mutate_json(s/'index.json', lambda p: p[0].update(route='https://example.invalid' + entry(BASE)['url'])), 'route origin')
        rendered('absolute index route changed to file path', lambda s: mutate_json(s/'index.json', lambda p: p[0].update(route=p[0]['route'] + 'index.html')), 'post index archive membership')
        rendered('absolute index route wrong baseurl', lambda s: mutate_json(s/'index.json', lambda p: p[0].update(route=p[0]['route'].replace('/preview/', '/previewish/'))), 'route baseurl', '/preview')
        rendered('absolute index route query', lambda s: mutate_json(s/'index.json', lambda p: p[0].update(route=p[0]['route'] + '?x=1')), 'noncanonical route')
        rendered('index duplicate route', lambda s: mutate_json(s/'index.json', lambda p: p[0].update(route=p[1]['route'])), 'duplicate post index routes')
        rendered('index tutorial section lost', lambda s: mutate_json(s/'index.json', lambda p: p[0].update(section='root')), 'post index metadata')
        rendered('index event date lost', lambda s: mutate_json(s/'index.json', lambda p: p[0].update(date='2020-01-01T00:00:00+00:00')), 'post index metadata')
        rendered('index tags lost', lambda s: mutate_json(s/'index.json', lambda p: p[0].update(tags=[])), 'post index metadata')
        rendered('index count reduced', lambda s: mutate_json(s/'index.json', lambda p: p.pop()), 'post index count')
        rendered('JSONL differs', lambda s: write(s/'index.jsonl', '{}\n'), 'post JSONL parity')
        rendered('sitemap entry missing', lambda s: replace(s/'sitemap.xml', ORIGIN + entry(BASE)['url'], ORIGIN + '/wrong/'), 'archive sitemap coverage')
        rendered('catalog short identity instead of post title', lambda s: replace(s/'challenges/index.html', entry(BASE)['post_title'], entry(BASE)['title']), 'alphabetical catalog membership')
        rendered('progress short identity instead of post title', lambda s: mutate_json(s/'challenges.json', lambda p: p[0].update(title=entry(BASE, OFFLINE)['title'])), 'authored progress entry')
        rendered('post index short identity instead of post title', lambda s: mutate_json(s/'index.json', lambda p: p[0].update(title=entry(BASE)['title'])), 'post index metadata')
        rendered('original rendered link lacks baseurl', lambda s: replace(article_path(s), 'href="/preview/assets/challenges/', 'href="/assets/challenges/'), 'file links', '/preview')
        rendered('original rendered link reverted upstream', lambda s: replace(article_path(s),
            'href="' + entry(BASE)['files'][0]['url'] + '"', 'href="' + entry(BASE)['files'][0]['upstream_url'] + '"'), 'file links')
        rendered('missing upstream organizer spoiler link', lambda s: replace(article_path(s, BOOTLEG),
            entry(BASE, BOOTLEG)['organizer_download']['upstream_url'], 'https://example.invalid/'), 'spoiler link outside disclosure')
        rendered('upstream organizer link exposed', lambda s: replace(article_path(s, BOOTLEG), '</article>',
            anchor(entry(BASE, BOOTLEG)['organizer_download']['upstream_url'], 'Original source') + '</article>'), 'spoiler link outside disclosure')
        rendered('missing local license link', lambda s: replace(article_path(s), 'href="' + BASE['licenses'][0]['url'] + '"', 'href="/wrong-license.txt"'), 'spoiler link outside disclosure')
        rendered('local license link lacks baseurl', lambda s: replace(article_path(s), 'href="/preview/assets/challenges/licenses/', 'href="/assets/challenges/licenses/'), 'spoiler link outside disclosure', '/preview')
        for name in ('challenge.txt', 'challenge.json'):
            route = entry(BASE)['url'] + name
            rendered('rendered terminal artifact missing ' + name, lambda s, route=route: html_path(s, route).unlink(), 'unexpected rendered archive files')
            rendered('rendered terminal link missing ' + name, lambda s, route=route: replace(article_path(s), 'href="' + route + '"', 'href="/wrong"'), 'rendered terminal links')
            rendered('rendered terminal link lacks baseurl ' + name, lambda s, route=route: replace(article_path(s), 'href="/preview' + route + '"', 'href="' + route + '"'), 'rendered terminal links', '/preview')
            rendered('rendered terminal command lacks baseurl ' + name, lambda s, route=route: replace(article_path(s), ORIGIN + '/preview' + route, ORIGIN + route), 'download commands', '/preview')
            rendered('rendered terminal command output wrong ' + name, lambda s, name=name: replace(article_path(s), '--output ' + name, '--output wrong-' + name), 'download commands')
        rendered('rendered catalog JSON missing', lambda s: (s/'challenges/index.json').unlink(), 'unexpected rendered archive files')
        rendered('unregistered terminal format', lambda s: write(html_path(s, entry(BASE)['url'] + 'challenge.xml'), '<fixture/>'), 'unexpected rendered archive files')
        rendered('broken local body link', lambda s: replace(article_path(s), '</article>', anchor('/missing-local-file.txt', 'Missing') + '</article>'), 'broken local link')
        for path in (entry(BASE)['files'][0]['url'].lstrip('/'), BASE['licenses'][0]['url'].lstrip('/'),
                     'assets/challenges/' + INTERACTIVE, 'assets/challenges/licenses',
                     entry(BASE)['url'].lstrip('/') + 'challenge.txt', entry(BASE)['url'].lstrip('/'),
                     'challenges/index.json'):
            rendered('rendered symlink rejected ' + path, lambda s, path=path: move_and_symlink(s, s/path), 'symlink in')
        for f, label in ((entry(BASE)['files'][0], 'original'), (entry(BASE, BOOTLEG)['organizer_download'], 'organizer'),
                         (BASE['licenses'][0], 'license')):
            rendered('rendered ' + label + ' corrupted', lambda s, f=f: (s/f['url'].lstrip('/')).write_bytes(b'corruption'), 'local output integrity')
        rendered('rendered original missing', lambda s: (s/entry(BASE)['files'][0]['url'].lstrip('/')).unlink(), 'broken local link')
        rendered('rendered license missing', lambda s: (s/BASE['licenses'][0]['url'].lstrip('/')).unlink(), 'broken local link')
        rendered('extra empty rendered artifact directory', lambda s: (s/'assets/challenges/empty').mkdir(), 'unexpected local output directories')
        rendered('unexpanded rendered command', lambda s: replace(article_path(s), ORIGIN + entry(BASE)['files'][0]['url'],
            "{{ '" + entry(BASE)['files'][0]['url'] + "' | absolute_url }}"), 'unexpanded rendered commands')
    gate.ROOT = ROOT
    counts = {layer: sum(r['layer'] == layer for r in RESULTS) for layer in ('source', 'synthetic-rendered')}
    report = {'pass': True, 'cases': len(RESULTS), 'counts': counts,
              'accepted': sum(r['expected'] == 'accept' for r in RESULTS),
              'rejected': sum(r['expected'] == 'reject' for r in RESULTS), 'results': RESULTS}
    (OUT/'mutations.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f"Passed {len(RESULTS)} cases: {counts['source']} source, {counts['synthetic-rendered']} synthetic-rendered; "
          f"{report['accepted']} accepted, {report['rejected']} rejected as expected.")


if __name__ == '__main__':
    main()
