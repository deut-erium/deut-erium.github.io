#!/usr/bin/env python3
"""Catch specific removed development notes in rendered blog copy, not writing style."""

from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys

# Deliberately specific regressions. Words such as CI, tests, and verification
# belong in technical articles; this is not an AI detector or a word blacklist.
REMOVED_NOTES = (
    'that claim is checked by CI on every build',
    'This is not a promise on a banner; it is an assertion in CI',
    'The plan is that you take it from here',
    'Smoke harness',
    'agent_out/z3-check/',
    'static highlight',
)


class ReaderText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = None

    def handle_starttag(self, tag, attrs):
        if self.skip:
            return
        if tag in {'script', 'style', 'pre'}:
            self.skip = tag
        if tag == 'meta':
            data = dict(attrs)
            if data.get('name') == 'description':
                self.parts.append(data.get('content', ''))

    def handle_endtag(self, tag):
        if tag == self.skip:
            self.skip = None

    def handle_data(self, text):
        if not self.skip:
            self.parts.append(text)


def removed_notes(source):
    parser = ReaderText()
    parser.feed(source)
    text = re.sub(r'\s+', ' ', ' '.join(parser.parts)).casefold()
    return [note for note in REMOVED_NOTES if note.casefold() in text]


def verify(root):
    pages = sorted(root.rglob('*.html'))
    if not pages:
        raise SystemExit(f'No rendered HTML found under {root}')
    failures = {}
    for page in pages:
        found = removed_notes(page.read_text(encoding='utf-8'))
        if found:
            failures[page.relative_to(root).as_posix()] = found
    security = root / '.well-known/security.txt'
    if security.is_file() and 'TODO: PGP key pending' in security.read_text():
        failures['.well-known/security.txt'] = ['Published PGP TODO']
    result = {'status': 'fail' if failures else 'pass', 'html_files_checked': len(pages), 'regressions': failures}
    print(json.dumps(result, indent=2))
    return bool(failures)


if __name__ == '__main__':
    if sys.argv[1:] == ['--self-test']:
        for note in REMOVED_NOTES:
            assert removed_notes(f'<aside hidden><p>{note}</p></aside>') == [note]
            assert removed_notes(f'<meta name="description" content="{note}">') == [note]
            assert not removed_notes(f'<script>console.log({note!r})</script>')
            assert not removed_notes(f'<pre><code>{note}</code></pre>')
            assert not removed_notes(f'<!-- {note} -->')
        assert removed_notes('<p>The plan is that\n<strong>you take it from here</strong>.</p>')
        assert not removed_notes('<p>This article discusses verifier testing and CI.</p>')
        print('Reader-copy regression self-tests passed.')
    else:
        raise SystemExit(verify(Path(sys.argv[1] if len(sys.argv) > 1 else '_site')))
