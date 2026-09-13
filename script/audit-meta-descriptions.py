#!/usr/bin/env python3
"""Report description quality signals in a local build; length is advisory."""
import argparse
from collections import Counter
from html.parser import HTMLParser
import json
from pathlib import Path


class Metadata(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.descriptions = []
        self.excluded = False
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag != 'meta':
            return
        name = attrs.get('name', '').lower()
        if name == 'description':
            self.descriptions.append(attrs.get('content', '').strip())
        if (name == 'robots' and 'noindex' in attrs.get('content', '').lower()) or attrs.get('http-equiv', '').lower() == 'refresh':
            self.excluded = True


def audit(root):
    rows = []
    excluded = 0
    for path in sorted(root.rglob('*.html')):
        metadata = Metadata(path.read_text(errors='replace'))
        # Ownership verification responses are not reader-facing search pages.
        verification = path.name in {'google98b86655786074b6.html', 'yandex_0a37c4f8df609655.html'}
        if metadata.excluded or path.name == '404.html' or verification:
            excluded += 1
            continue
        description = metadata.descriptions[0] if metadata.descriptions else ''
        rows.append({'path': path.relative_to(root).as_posix(), 'description': description,
                     'length': len(description), 'tags': len(metadata.descriptions)})
    counts = Counter(row['description'].casefold() for row in rows if row['description'])
    for row in rows:
        text = row['description']
        row['signals'] = []
        if not text:
            row['signals'].append('missing')
        elif len(text) < 80:
            row['signals'].append('short-review')
        if counts[text.casefold()] > 1:
            row['signals'].append('duplicate-review')
        if ', published in ' in text or ' writeup: ' in text:
            row['signals'].append('template-review')
        if row['tags'] > 1:
            row['signals'].append('multiple-tags')
    return {'eligible_pages': len(rows), 'excluded_pages': excluded,
            'signals': dict(Counter(signal for row in rows for signal in row['signals'])),
            'pages': rows}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('site', type=Path)
    args = parser.parse_args()
    if not args.site.is_dir():
        parser.error('site must be an existing local build directory')
    print(json.dumps(audit(args.site), indent=2))
