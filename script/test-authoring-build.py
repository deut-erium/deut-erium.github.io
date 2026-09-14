#!/usr/bin/env python3
"""Build a copied checkout before, during and after disposable authoring changes.

Uses installed Ruby/Node dependencies only. No Git writes or network requests.
The checkout and logs stay under agent_out/authoring/build.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'agent_out/authoring/build'
SOURCE = OUT / 'source'
SITE = SOURCE / 'agent_out/site'
RESULTS = []


def run(args, label, *, accept=True, input_text=None):
    proc = subprocess.run(args, cwd=SOURCE, env=ENV, text=True, input=input_text,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (OUT / (label + '.log')).write_text(proc.stdout)
    if (proc.returncode == 0) != accept:
        raise AssertionError(f'{label}: unexpected exit {proc.returncode}; see {OUT / (label + ".log")}')
    RESULTS.append({'command': args, 'label': label, 'exit': proc.returncode, 'expected_accept': accept})
    return proc.stdout


def write(rel, text):
    path = SOURCE / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


def gates(label):
    source = json.loads(run([sys.executable, 'script/verify-imported-content.py'], label + '-imported'))
    site = json.loads(run([sys.executable, 'script/verify-site.py', str(SITE)], label + '-site'))
    challenge = json.loads(run([sys.executable, 'script/verify-challenge-archive.py', str(SITE)], label + '-challenge'))
    run([sys.executable, 'script/verify-code-parity.py', str(SITE)], label + '-code-parity')
    run([sys.executable, 'script/verify-publications.py', str(SITE)], label + '-publications')
    return source, site, challenge


def build(label):
    if SITE.exists():
        shutil.rmtree(SITE)
    run(['sh', 'script/build-site.sh', str(SITE)], label + '-build')
    return gates(label)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--committed-source', action='store_true',
                        help='use committed source fixtures plus current gates, not unrelated worktree edits')
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    if SOURCE.exists():
        shutil.rmtree(SOURCE)
    SOURCE.mkdir()
    if args.committed_source:
        # An explicit baseline fixture mode. The normal mode below still rejects
        # unrelated pin drift in the worktree; neither mode rewrites any pin.
        archive = OUT / 'committed-source.tar'
        with archive.open('wb') as output:
            subprocess.run(['git', '-C', str(ROOT), 'archive', '--format=tar', 'HEAD'], stdout=output, check=True)
        with tarfile.open(archive) as files:
            for member in files:
                name = Path(member.name)
                if name.is_absolute() or '..' in name.parts or not (member.isfile() or member.isdir()):
                    raise AssertionError('unsafe committed fixture member')
                target = SOURCE / name
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(files.extractfile(member).read())
        for name in ('verify-imported-content.py', 'verify-site.py', 'verify-challenge-archive.py'):
            shutil.copyfile(ROOT / 'script' / name, SOURCE / 'script' / name)
    else:
        names = subprocess.check_output(['git', '-C', str(ROOT), 'ls-files', '-z']).decode().split('\0')
        for name in filter(None, names):
            if name.startswith(('agent_out/', '.toolchain/', 'node_modules/', 'assigments/flags/')):
                continue
            original = ROOT / name
            if not original.is_file():
                raise AssertionError('missing tracked source: ' + name)
            target = SOURCE / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(original, target)
    (SOURCE / 'node_modules').symlink_to((ROOT / 'node_modules').resolve(), target_is_directory=True)
    manifest_path = SOURCE / 'script/imported-content-manifest.json'
    pins = json.loads(manifest_path.read_text())['files']
    protected = {row['path']: hashlib.sha256((SOURCE / row['path']).read_bytes()).hexdigest() for row in pins}
    manifest_bytes = manifest_path.read_bytes()
    catalog_bytes = (SOURCE / '_data/authored_challenges.json').read_bytes()
    chain_path = SOURCE / '_data/arg_chain.yml'
    chain_bytes = chain_path.read_bytes()
    baseline = build('baseline')
    baseline_publications = json.loads((SITE / 'publications.json').read_text())['posts']

    paths = []
    paths.append(write('_posts/2031-01-02-authoring-root.markdown', '''---
title: Ordinary root authoring fixture
tags: authoring_root ctf
---
An ordinary Markdown post with a new tag.
'''))
    paths.append(write('_posts/ramblings/2031-01-02-authoring-note.md', '''---
title: Ordinary section fixture
tags: [authoring_section, programming]
---
A section post that is not in the historical import manifest.
'''))
    paths.append(write('_posts/WriteUps/authoring-fixture/2031-01-03-authoring-attachment.md', '''---
title: Public attachment fixture
tags: [authoring_attachment, crypto]
mathjax: true
---
[Public attachment](handout.txt).

<img src="pixel.png" alt="Synthetic pixel" width="1" height="1">

```python
print("public synthetic example")
```

$$x^2 + 1$$
'''))
    paths.append(write('_posts/WriteUps/authoring-fixture/handout.txt', 'Public attachment, not a private answer.\n'))
    pixel = SOURCE / '_posts/WriteUps/authoring-fixture/pixel.png'
    pixel.write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='))
    paths.append(pixel)
    digest = hashlib.sha256(b'synthetic-value' + b'1234567890abcdef1234567890abcdef').hexdigest()
    paths.append(write('_posts/2031-01-04-authoring-checker.md', '''---
title: Public salted checker fixture
tags: [authoring_checker, challenges]
challenge_checker: true
---
## Public checker
This form contains only a digest and salt.

{% include challenge.html id="ordinary-authoring-checker" hash="''' + digest + '''" salt="1234567890abcdef1234567890abcdef" title="Public salted checker fixture" %}
'''))
    # Exercise the real producer in the disposable checkout, with synthetic
    # keys supplied on stdin. No plaintext or key is part of the public tree.
    entry_path = '_posts/ramblings/2031-01-04-authoring-chain-entry.md'
    followup_path = 'locked/2031/01/05/authoring-chain-followup.md'
    entry_route = '/ramblings/2031/01/04/authoring-chain-entry.html'
    followup_route = '/locked/2031/01/05/authoring-chain-followup.html'
    private_markers = ('flag{synthetic_authoring_entry_only}', 'flag{synthetic_authoring_followup_only}',
                       'SYNTHETIC_ENCRYPTED_BODY_DO_NOT_PUBLISH')
    private_body = write('agent_out/chain-plaintext.html',
                         '<p>' + ' '.join(private_markers) + '</p><p><a href="' + followup_route +
                         '">Continue to the synthetic followup</a></p>')
    paths.append(private_body)
    for label, rel, title, tags, mode, answer in (
        ('entry', entry_path, 'Listed encrypted authoring fixture', 'challenges crypto', [], private_markers[0]),
        ('followup', followup_path, 'Unlisted encrypted authoring fixture', 'authoring_unlisted_only',
         ['--unlisted'], private_markers[1]),
    ):
        run([sys.executable, 'script/encrypt_post.py', '--plaintext', str(private_body), '--answer-stdin',
             '--out', rel, '--title', title, '--teaser', 'A public synthetic chain teaser.',
             '--tags', tags, '--needs', 'ordinary-authoring-checker', '--section', 'ramblings',
             '--salt', '1234567890abcdef1234567890abcdef', *mode],
            'encrypt-' + label, input_text=answer + '\n')
        paths.append(SOURCE / rel)
    assert chain_path.read_bytes() != chain_bytes
    assert manifest_path.read_bytes() == manifest_bytes
    added = build('added')
    assert added[0]['new_posts'] == 5 and added[0]['new_postfiles'] == 2
    assert added[0]['new_unlisted_pages'] == baseline[0]['new_unlisted_pages'] + 1
    assert added[1]['posts'] == baseline[1]['posts'] + 5
    assert added[1]['listed_posts'] == baseline[1]['listed_posts'] + 5
    assert added[1]['challenge_forms'] == baseline[1]['challenge_forms'] + 1
    assert added[1]['code_frames'] == baseline[1]['code_frames'] + 1
    assert added[1]['math_expressions'] == baseline[1]['math_expressions'] + 1
    assert added[2]['new_checkers'] == baseline[2]['new_checkers'] + 1
    publications = json.loads((SITE / 'publications.json').read_text())['posts']
    assert len(publications) == len(baseline_publications) + 4
    publication_routes = {record['url'] for record in publications}
    assert not publication_routes.intersection((entry_route, followup_route))
    for route in (entry_route, followup_route):
        rendered = SITE / route.lstrip('/')
        text = rendered.read_text()
        assert 'class="argon"' in text and 'features/argon.js' in text
        assert 'A public synthetic chain teaser.' in text
        for token in ('class="publication-cite"', 'class="publication-pdf"', 'name="citation_',
                      'type="application/pdf"', 'type="application/x-bibtex"'):
            assert token not in text, (route, token)
        assert not rendered.with_suffix('.bib').exists()
        assert not rendered.with_suffix('.pdf').exists()
    hidden_html = (SITE / followup_route.lstrip('/')).read_text()
    assert '<span hidden>' in hidden_html or '<span hidden="">' in hidden_html
    assert 'content="noindex, follow"' in hidden_html
    # Only the entry belongs to the public lists. Scan every other rendered
    # HTML/JSON/XML/Bib file to cover pagination, related cards and index variants.
    for rel in ('index.json', 'index.jsonl', 'archive.html', 'feed.xml', 'sitemap.xml',
                'ramblings/index.html', 'ramblings/archive.html', 'ramblings/feed.xml',
                'ramblings/sitemap.xml'):
        assert entry_route in (SITE / rel).read_text(), rel
    for path in SITE.rglob('*'):
        if not path.is_file():
            continue
        data = path.read_bytes()
        assert all(marker.encode() not in data for marker in private_markers), path
        if path.suffix in ('.html', '.json', '.jsonl', '.xml', '.bib') and path != SITE / followup_route.lstrip('/'):
            for token in (followup_route, 'Unlisted encrypted authoring fixture', 'authoring_unlisted_only'):
                assert token.encode() not in data, (path, token)
    attachment = SITE / 'WriteUps/authoring-fixture/handout.txt'
    assert attachment.read_bytes() == paths[3].read_bytes()
    attachment.unlink()
    run([sys.executable, 'script/verify-site.py', str(SITE)], 'missing-new-attachment', accept=False)
    attachment.write_bytes(paths[3].read_bytes())
    # An omitted index post must fail even when HTML and source still exist.
    index_path = SITE / 'index.json'
    index_bytes = index_path.read_bytes()
    index = json.loads(index_bytes)
    index.pop(0)
    index_path.write_text(json.dumps(index))
    run([sys.executable, 'script/verify-site.py', str(SITE)], 'missing-new-index-post', accept=False)
    run([sys.executable, 'script/verify-challenge-archive.py', str(SITE)], 'missing-new-archive-index-post', accept=False)
    index_path.write_bytes(index_bytes)

    # Source shape is not route-collision validation. The Jekyll hook must
    # reject a second page targeting the otherwise valid followup's output.
    collision = write('authoring-collision.md', '---\nlayout: page\ntitle: Synthetic collision\npermalink: ' +
                      followup_route + '\n---\nPublic fixture.\n')
    run([sys.executable, 'script/verify-imported-content.py'], 'collision-source-shape')
    shutil.rmtree(SITE)
    rejection = run(['sh', 'script/build-site.sh', str(SITE)], 'collision-build', accept=False)
    assert any(message in rejection for message in (
        'unlisted page output collides', 'encryption chain: record must name exactly one rendered locked output'))
    assert not (SITE / followup_route.lstrip('/')).exists()
    collision.unlink()

    for path in paths:
        path.unlink()
    chain_path.write_bytes(chain_bytes)
    removed = build('removed')
    for layer, fields in ((0, ('new_posts', 'new_postfiles', 'new_unlisted_pages')), (1, ('posts', 'listed_posts', 'challenge_forms', 'code_frames', 'math_expressions')), (2, ('new_checkers', 'posts'))):
        for field in fields:
            assert removed[layer][field] == baseline[layer][field], field
    assert manifest_path.read_bytes() == manifest_bytes
    assert (SOURCE / '_data/authored_challenges.json').read_bytes() == catalog_bytes
    assert chain_path.read_bytes() == chain_bytes
    assert json.loads((SITE / 'publications.json').read_text())['posts'] == baseline_publications
    assert not (SITE / entry_route.lstrip('/')).exists()
    assert not (SITE / followup_route.lstrip('/')).exists()
    assert {rel: hashlib.sha256((SOURCE / rel).read_bytes()).hexdigest() for rel in protected} == protected
    (OUT / 'results.json').write_text(json.dumps({'pass': True, 'committed_source_fixture': args.committed_source, 'baseline': baseline, 'added': added, 'removed': removed, 'commands': RESULTS}, indent=2) + '\n')
    print('Three offline builds passed; a colliding unlisted route was rejected. Added/removed five posts, '
          'one encrypted unlisted page, two attachments and one salted checker; all historical pins unchanged.')


ENV = os.environ.copy()
ENV.update(PATH=f'{ROOT}/.toolchain/bin:{ROOT}/.toolchain/ruby-3.3.7/bin:' + ENV['PATH'],
           BUNDLE_PATH=str(ROOT / '.toolchain/vendor-bundle'),
           BUILD_TIME='2031-01-05T00:00:00+00:00', TMPDIR=str(OUT),
           PYTHONDONTWRITEBYTECODE='1')
if __name__ == '__main__':
    main()
