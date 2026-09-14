#!/usr/bin/env python3
"""Verify local citation outputs and require every advertised PDF to exist."""
import argparse
from html.parser import HTMLParser
import json
from pathlib import Path
from urllib.parse import unquote


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.meta = {}
        self.links = []
        self.private = False
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'meta':
            self.meta[a.get('name', a.get('property', ''))] = a.get('content', '')
            if a.get('http-equiv', '').lower() == 'refresh':
                self.private = True
        if tag == 'link':
            self.links.append(a)
        if 'argon' in a.get('class', '').split() or 'layout-locked' in a.get('class', '').split():
            self.private = True


def target(site, route, html=False):
    assert route.startswith('/') and not any(c in route for c in '?\\#'), route
    decoded = unquote(route)
    assert all(s not in ('.', '..') for s in decoded.split('/')), route
    path = site / decoded.lstrip('/')
    if html and route.endswith('/'):
        path /= 'index.html'
    assert path.resolve().is_relative_to(site.resolve()), route
    return path


def verify(site, require_pdfs=False):
    manifest = json.loads((site / 'publications.json').read_text())
    assert manifest['version'] == 1
    prefix = manifest['baseurl']
    posts = manifest['posts']
    seen = set()
    pdf_count = 0
    for record in posts:
        url = record['url']
        assert url not in seen, url
        seen.add(url)
        page = Page(target(site, url, html=True).read_text())
        assert not page.private and 'noindex' not in page.meta.get('robots', ''), url
        assert page.meta.get('citation_title') == record['title'], url
        assert page.meta.get('citation_abstract_html_url') == record['canonical_url'], url
        assert page.meta.get('citation_publication_date') == record.get('publication_date'), url
        assert any(link.get('rel') == 'alternate' and link.get('type') == 'application/x-bibtex'
                   and link.get('href') == prefix + record['bib_url'] for link in page.links), url
        bib = target(site, record['bib_url']).read_text()
        assert bib.startswith('@misc{post-') and bib.endswith('}\n'), url
        if record.get('date_note'):
            assert '  year = ' not in bib and 'Challenge event began' in bib, url
        pdf_link = [link for link in page.links if link.get('rel') == 'alternate' and link.get('type') == 'application/pdf']
        if require_pdfs:
            assert len(pdf_link) == 1, url
        if pdf_link:
            assert len(pdf_link) == 1 and pdf_link[0]['href'] == prefix + record['pdf_url'], url
            data = target(site, record['pdf_url']).read_bytes()
            assert data.startswith(b'%PDF-') and b'%%EOF' in data[-1024:], url
            pdf_count += 1
    # No private or non-manifest page may acquire citation discovery metadata.
    for file in site.rglob('*.html'):
        page = Page(file.read_text(errors='replace'))
        if 'citation_title' in page.meta:
            urls = [r['url'] for r in posts if target(site, r['url'], html=True) == file]
            assert len(urls) == 1 and not page.private, str(file)
    return {'citations': len(posts), 'advertised_pdfs': pdf_count, 'status': 'pass'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('site', type=Path)
    parser.add_argument('--require-pdfs', action='store_true')
    args = parser.parse_args()
    print(json.dumps(verify(args.site, args.require_pdfs), indent=2))
