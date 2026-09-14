#!/usr/bin/env python3
"""Test authoring output with public synthetic answers; no TTY or network."""
import hashlib
from html.parser import HTMLParser
import html
import os
from pathlib import Path
import re
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUBY = shutil.which('ruby') or str(ROOT / '.toolchain/bin/ruby')


def helper(ident='author-fixture-checker', hints='Inspect the bytes|Try XOR', args=(), answer='synthetic-test-answer-only'):
    result = subprocess.run([RUBY, str(ROOT / 'script/new_challenge.rb'), *args],
                            input=f'{ident}\n{answer}\n{hints}\n',
                            text=True, capture_output=True, cwd=ROOT)
    return result, answer


class ChallengeAuthorTests(unittest.TestCase):
    def test_generated_salted_include(self):
        result, answer = helper()
        self.assertEqual(result.returncode, 0, result.stderr)
        salt = re.search(r'salt="([0-9a-f]{32})"', result.stdout).group(1)
        digest = re.search(r'hash="([0-9a-f]{64})"', result.stdout).group(1)
        self.assertEqual(digest, hashlib.sha256((answer + salt).encode()).hexdigest())
        self.assertNotIn(answer, result.stdout + result.stderr)
        self.assertIn('hints="Inspect the bytes|Try XOR"', result.stdout)
        other, _ = helper()
        self.assertNotEqual(salt, re.search(r'salt="([0-9a-f]{32})"', other.stdout).group(1))

    def test_rejects_bad_ids_and_hints(self):
        for ident in ('bad id', 'bad"id', '{%broken%}', '', '__proto__', 'prototype', 'constructor', 'a' * 129):
            self.assertNotEqual(helper(ident)[0].returncode, 0)
        for hints in ('one|two|three|four', 'a"b', 'a\\b', '{{ site.title }}', '{% include x %}'):
            self.assertNotEqual(helper(hints=hints)[0].returncode, 0)

    def test_rejects_browser_trimmed_unicode_boundaries_without_checker_output(self):
        # ECMAScript trim includes NBSP/BOM and these Unicode spaces, unlike
        # Ruby String#strip. Exercise both boundaries after ASCII trimming.
        boundaries = ('\u00a0', '\u1680', *(chr(c) for c in range(0x2000, 0x200b)),
                      '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff')
        for args in ((), ('--html',)):
            for char in boundaries:
                for answer in (char + 'synthetic-answer', 'synthetic-answer' + char,
                               ' \t' + char + 'synthetic-answer' + char + '\t ', char):
                    with self.subTest(args=args, boundary=ascii(char), answer=ascii(answer)):
                        result, _ = helper(args=args, answer=answer)
                        self.assertNotEqual(result.returncode, 0)
                        self.assertIn('browser trims', result.stderr)
                        for forbidden in (answer, 'salted digest:', '{% include', '<form', 'Paste this'):
                            self.assertNotIn(forbidden, result.stdout + result.stderr)

    def test_ascii_trimming_and_internal_unicode_match_browser_hashing(self):
        for args in ((), ('--html',)):
            for answer in (' \t\v\fsynthetic-answer\f\v\t ',
                           'synthetic-\u00a0-middle-\ufeff-answer', '\u200bsynthetic-answer\u200b',
                           '\u0085synthetic-answer\u0085', '\u180esynthetic-answer\u180e'):
                with self.subTest(args=args, answer=ascii(answer)):
                    result, _ = helper(args=args, answer=answer)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    salt = re.search(r'salt="([0-9a-f]{32})"', result.stdout).group(1)
                    digest = re.search(r'(?:hash|data-sha256)="([0-9a-f]{64})"', result.stdout).group(1)
                    self.assertEqual(digest, hashlib.sha256((answer.strip(' \t\v\f') + salt).encode()).hexdigest())

    def test_html_form_has_no_liquid_dependency_or_plaintext_answer(self):
        result, answer = helper(args=('--html',))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('{% include', result.stdout)
        self.assertNotIn(answer, result.stdout + result.stderr)
        self.assertIn('data-flag-check', result.stdout)
        self.assertIn('id="flag-author-fixture-checker"', result.stdout)
        self.assertIn('for="flag-author-fixture-checker"', result.stdout)
        salt = re.search(r'data-salt="([0-9a-f]{32})"', result.stdout).group(1)
        digest = re.search(r'data-sha256="([0-9a-f]{64})"', result.stdout).group(1)
        self.assertEqual(digest, hashlib.sha256((answer + salt).encode()).hexdigest())
        self.assertEqual(result.stdout.count('data-hint-for="author-fixture-checker"'), 2)
        self.assertIn('type="submit" disabled', result.stdout)
        self.assertNotIn('data-answer=', result.stdout)

    def test_html_hints_are_text_escaped_with_cgi(self):
        hints = '<img src=x onerror="bad()"> & \'quoted\' \\\\|{{ literal }}|{% literal %}'
        result, _ = helper(hints=hints, args=('--html',))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('&lt;img', result.stdout)
        self.assertIn('&quot;', result.stdout)
        self.assertIn('&#39;', result.stdout)
        self.assertIn('&amp;', result.stdout)
        self.assertNotIn('<img', result.stdout)
        self.assertNotIn('{', result.stdout)
        self.assertNotIn('}', result.stdout)
        self.assertIn('&#123;&#123; literal &#125;&#125;', result.stdout)
        self.assertIn('&#123;% literal %&#125;', result.stdout)
        hint_text = re.findall(r'<p class="challenge-hint"[^>]*>(.*?)</p>', result.stdout)
        self.assertEqual([html.unescape(value) for value in hint_text], hints.split('|'))
        class Tags(HTMLParser):
            def __init__(self):
                super().__init__()
                self.names = []
            def handle_starttag(self, tag, attrs):
                self.names.append(tag)
        parser = Tags()
        parser.feed(result.stdout)
        self.assertNotIn('img', parser.names)
        self.assertNotIn('script', parser.names)

    def test_html_blank_hints_and_bounds(self):
        result, _ = helper(hints='', args=('--html',))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('data-hint=', result.stdout)
        self.assertNotEqual(helper(hints='one|two|three|four', args=('--html',))[0].returncode, 0)
        self.assertNotEqual(helper(answer='x' * 4097)[0].returncode, 0)
        self.assertNotEqual(helper(answer='')[0].returncode, 0)
        self.assertNotEqual(helper(args=('--unknown',))[0].returncode, 0)
        self.assertNotEqual(helper(args=('--html', '--html'))[0].returncode, 0)


if __name__ == '__main__':
    unittest.main()
