#!/usr/bin/env python3
"""Offline mutations of copied public sources and synthetic rendered contracts.

The HTML fixtures test the gate, not Jekyll or a browser. No challenge download,
answer file, legacy article body, dependency installation or build is needed.
"""
import copy
from html import escape
import importlib.util
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'agent_out/challenge-posts/archive-gates'
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
        files = e['files'] + ([e['organizer_download']] if 'organizer_download' in e else [])
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
                         f'data-flag-prefix="{c["prefix"]}" data-challenge-title="{escape(e["title"], quote=True)}">'
                         f'<input data-flag-input id="flag-{c["id"]}" placeholder="{c["prefix"]}{{...}}">'
                         '<button type="submit" disabled>Check flag</button></form>')
            progress.append({'id': c['id'], 'page': e['url'], 'title': e['title'], 'sha256': c['sha256'], 'salt': c['salt'], 'aliases': []})
        contents += '<details data-archive-spoilers><summary>Sources and solutions (spoilers)</summary>'
        if 'organizer_download' in e:
            contents += block
        for key in ('archive_url', 'source_url', 'solution_url', 'credit_url', 'contributor_url'):
            if e.get(key):
                contents += anchor(e[key], key)
        if e.get('license'):
            contents += anchor(e['license']['url'], e['license']['name'])
        contents += '</details>' + anchor(baseurl + '/challenges/', 'All challenges') + anchor(baseurl + '/ctf-tutorials/', 'Tutorials')
        if e.get('practice_url'):
            contents += anchor(baseurl + e['practice_url'], 'Practice variant')
        html = (f'<html><head><link rel="canonical" href="{ORIGIN}{baseurl}{e["url"]}"></head>'
                f'<body class="layout-article section-tutorials"><h1>{escape(e["title"])}</h1>'
                f'<dl><dt>Event began</dt><dd><time datetime="{date}">{date[:10]}</time></dd></dl>'
                f'<article id="article-body"><div data-challenge-archive="{ident}">{contents}</div></article>'
                f'<script src="{baseurl}/assets/js/article.js?v=fixture"></script>')
        if 'checker' in e:
            html += f'<script src="{baseurl}/assets/js/challenge.js?v=fixture"></script>'
        write(html_path(site, e['url']), html + '</body></html>')
        metadata, _ = gate.front_matter((source/e['post_path']).read_text(), ident)
        posts.append({'title': e['title'], 'date': date, 'route': ORIGIN + baseurl + e['url'],
                      'section': 'tutorials', 'tags': metadata['tags'], 'description': metadata['description'], 'has_code': True, 'has_math': False})
        rows.append('<li data-record data-section="tutorials">' + anchor(baseurl + e['url'], e['title']) + '</li>')
    catalog = ''
    for year in (2025, 2024, 2023, 2022, 2021):
        catalog += f'<section data-challenge-year="{year}"><h2>{year}</h2>'
        for e in sorted((e for e in data['entries'] if e['year'] == year), key=lambda e: e['title'].lower()):
            catalog += anchor(baseurl + e['url'], e['title'], f'data-archive-entry="{e["id"]}"')
        catalog += '</section>'
    write(site/'challenges/index.html', catalog)
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
                  'section': 'tutorials'} for i in range(83))
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
        cat('foreign handout URL', lambda d: entry(d)['files'][0].update(url='https://example.invalid/file.py'), 'original file URLs/roles')
        cat('changed pinned handout URL', lambda d: entry(d)['files'][0].update(url=entry(d)['files'][0]['url'].replace('chall.py', 'other.py')), 'original file URLs/roles')
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
        cat('organizer source relabeled handout', lambda d: entry(d, BOOTLEG)['files'].append(dict(entry(d, BOOTLEG)['organizer_download'], kind='handout', label='handout')), 'original file URLs/roles')
        cat('Law versions conflated', lambda d: entry(d, LAW)['files'][1].update(sha256=entry(d, LAW)['files'][0]['sha256']), 'Law and Order versions')
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
        src('wrong curl URL', lambda r: replace(post_path(r), '\n  "https://raw.githubusercontent.com/', '\n  "https://example.invalid/'), 'download commands')
        src('wrong curl output name', lambda r: replace(post_path(r), '--output chall.py', '--output other.py'), 'download commands')
        src('duplicate curl command', lambda r: replace(post_path(r), '\n```\n', '\ncurl --output chall.py "' + entry(BASE)['files'][0]['url'] + '"\n```\n'), 'download commands')
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
        src('fixed output missing on disk', lambda r: (r/f'assets/challenges/{FIXED}/output.txt').unlink(), 'missing or symlinked fixed output')
        src('unexpected post file', lambda r: write(r/gate.POST_ROOT/'unexpected.txt', 'fixture'), 'unexpected challenge post files')
        src('old empty stub reintroduced', lambda r: write(r/'challenges/event/stub.md', '---\n---\n'), 'unexpected old archive source files')
        src('unexpected local output', lambda r: write(r/'assets/challenges/stray.txt', 'fixture'), 'unexpected local output files')
        src('flag in catalog source', lambda r: write(r/'challenges/index.html', 'CTF{synthetic-test-value}'), 'flag in catalog source')

        def rendered(label, mutate, reason, baseurl=''):
            check(label, rendered=mutate, reason=reason, baseurl=baseurl, render=True)

        check('valid synthetic rendered root', render=True, valid=True)
        check('valid synthetic rendered baseurl', render=True, baseurl='/preview', valid=True)
        check('rendered coauthors retained', catalog=lambda d: entry(d)['authors'].append('coauthor-fixture'), render=True, valid=True)
        rendered('wrong rendered section', lambda s: replace(article_path(s), 'section-tutorials', 'section-root'), 'article/tutorial section')
        rendered('wrong rendered layout', lambda s: replace(article_path(s), 'layout-article', 'layout-page'), 'article/tutorial section')
        rendered('wrong rendered title', lambda s: replace(article_path(s), '<h1>desfunctional</h1>', '<h1>Other</h1>'), 'heading for')
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
