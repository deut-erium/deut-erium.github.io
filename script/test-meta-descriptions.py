#!/usr/bin/env python3
"""Offline tests for the advisory metadata inventory."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('metadata_audit', Path(__file__).with_name('audit-meta-descriptions.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AuditTests(unittest.TestCase):
    def test_signals_and_exclusions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pages = {
                'one.html': '<meta name="description" content="Short &amp; useful">',
                'two.html': '<meta name="description" content="Short &amp; useful">',
                'missing.html': '<title>No description</title>',
                'redirect.html': '<meta http-equiv="refresh" content="0; url=/">',
                'private.html': '<meta name="robots" content="noindex, follow">',
                '404.html': '<title>Not found</title>',
                'google98b86655786074b6.html': 'verification',
                'yandex_0a37c4f8df609655.html': 'verification',
            }
            for name, content in pages.items():
                (root / name).write_text(content)
            result = module.audit(root)
            self.assertEqual(result['eligible_pages'], 3)
            self.assertEqual(result['excluded_pages'], 5)
            self.assertEqual(result['signals'], {'missing': 1, 'short-review': 2, 'duplicate-review': 2})
            self.assertEqual(result['pages'][1]['description'], 'Short & useful')

    def test_multiple_and_template(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'post.html').write_text('<meta name="description" content="Example, published in Blog."><meta name="description" content="Second">')
            row = module.audit(root)['pages'][0]
            self.assertIn('multiple-tags', row['signals'])
            self.assertIn('template-review', row['signals'])


if __name__ == '__main__':
    unittest.main()
