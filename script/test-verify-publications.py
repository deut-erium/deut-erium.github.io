#!/usr/bin/env python3
"""Exercise missing-PDF and privacy failures without a build or browser."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('publications', Path(__file__).with_name('verify-publications.py'))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class VerificationTests(unittest.TestCase):
    def setUp(self):
        scratch = Path(__file__).resolve().parents[1] / 'agent_out/publications/tests'
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch)
        self.site = Path(self.temp.name)
        self.row = dict(url='/post.html', bib_url='/post.bib', pdf_url='/post.pdf',
                        canonical_url='https://example.invalid/post.html', title='Post',
                        publication_date='2026-01-01')
        (self.site / 'publications.json').write_text(json.dumps(dict(version=1, baseurl='', posts=[self.row])))
        (self.site / 'post.bib').write_text('@misc{post-fixture,\n}\n')
        self.html = ('<meta name="citation_title" content="Post">'
                     '<meta name="citation_publication_date" content="2026-01-01">'
                     '<meta name="citation_abstract_html_url" content="https://example.invalid/post.html">'
                     '<link rel="alternate" type="application/x-bibtex" href="/post.bib">')
        self.write()

    def tearDown(self):
        self.temp.cleanup()

    def write(self, extra=''):
        (self.site / 'post.html').write_text(self.html + extra)

    def test_citation_only(self):
        self.assertEqual(mod.verify(self.site)['citations'], 1)
        with self.assertRaises(AssertionError):
            mod.verify(self.site, True)

    def test_missing_advertised_pdf(self):
        self.write('<link rel="alternate" type="application/pdf" href="/post.pdf">')
        with self.assertRaises(FileNotFoundError):
            mod.verify(self.site)
        (self.site / 'post.pdf').write_bytes(b'%PDF-1.4\nfixture\n%%EOF')
        self.assertEqual(mod.verify(self.site, True)['advertised_pdfs'], 1)

    def test_private_metadata_rejected(self):
        for extra in ['<meta name="robots" content="noindex">', '<div class="argon">ciphertext</div>']:
            self.write(extra)
            with self.assertRaises(AssertionError):
                mod.verify(self.site)

    def test_unregistered_metadata_rejected(self):
        (self.site / 'other.html').write_text(self.html)
        with self.assertRaises(AssertionError):
            mod.verify(self.site)


if __name__ == '__main__':
    unittest.main()
