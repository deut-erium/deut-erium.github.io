#!/usr/bin/env python3
"""Exercise the archive gate against isolated, deliberately broken catalogs."""
import copy
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile

root=Path(__file__).resolve().parents[1];out=root/'agent_out/challenge-archive-tests'
out.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('archive_check',root/'script/verify-challenge-archive.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
base=json.loads((root/'_data/authored_challenges.json').read_text())
results=[]
with tempfile.TemporaryDirectory(dir=out) as tmp:
    fixture=Path(tmp);shutil.copytree(root/'challenges',fixture/'challenges');(fixture/'_data').mkdir()
    mod.ROOT=fixture
    def check(label,mutate,success=False):
        data=copy.deepcopy(base);mutate(data)
        (fixture/'_data/authored_challenges.json').write_text(json.dumps(data))
        passed=True
        try:mod.verify()
        except (SystemExit,ValueError,KeyError):passed=False
        assert passed==success,label
        results.append({'case':label,'pass':True})
    check('valid catalog',lambda d:None,True)
    check('coauthor retained',lambda d:d['entries'][0]['authors'].append('coauthor-fixture'),True)
    check('missing entry',lambda d:d['entries'].pop())
    check('duplicate ID',lambda d:d['entries'][0].update(id=d['entries'][1]['id']))
    check('wrong event title',lambda d:d['entries'][0].update(title='Other challenge'))
    check('wrong author',lambda d:d['entries'][0].update(authors=['someone else']))
    check('flag in metadata',lambda d:d['entries'][0].update(statement='CTF{synthetic-test-value}'))
    check('active statement markup',lambda d:d['entries'][0].update(statement='<script>bad()</script>'))
    check('unpinned archive',lambda d:d['entries'][0].update(archive_url=d['entries'][0]['archive_url'].replace(d['entries'][0]['revision'],'main')))
    check('foreign handout',lambda d:d['entries'][0]['files'][0].update(url='https://example.invalid/file.py'))
    check('server source labeled handout',lambda d:next(e for e in d['entries'] if e['slug']=='failproof')['files'][0].update(kind='handout'))
    check('bad digest',lambda d:d['entries'][0]['files'][0].update(sha256='abc'))
    check('empty file',lambda d:d['entries'][0]['files'][0].update(bytes=0))
    def same_version(d):
        e=next(e for e in d['entries'] if e['slug']=='law-and-order');e['files'][1]['sha256']=e['files'][0]['sha256']
    check('Law and Order versions conflated',same_version)
    check('Law and Order warning missing',lambda d:next(e for e in d['entries'] if e['slug']=='law-and-order').update(notes=['A challenge.']))
    stray=fixture/'challenges/accidental-source.py';stray.write_text('not a page')
    check('unregistered source in publication directory',lambda d:None)
(out/'source-mutations.json').write_text(json.dumps({'pass':True,'cases':results},indent=2)+'\n')
print('Passed',len(results),'source-gate cases.')
