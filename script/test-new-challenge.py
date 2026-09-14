#!/usr/bin/env python3
"""Test authoring output with public synthetic answers; no TTY or network."""
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUBY = shutil.which('ruby') or str(ROOT / '.toolchain/bin/ruby')


def helper(ident='author-fixture-checker', hints='Inspect the bytes|Try XOR'):
    answer = 'synthetic-test-answer-only'
    result = subprocess.run([RUBY, str(ROOT / 'script/new_challenge.rb')],
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
        for ident in ('bad id', 'bad"id', '{%broken%}', ''):
            self.assertNotEqual(helper(ident)[0].returncode, 0)
        for hints in ('one|two|three|four', 'a"b', 'a\\b', '{{ site.title }}', '{% include x %}'):
            self.assertNotEqual(helper(hints=hints)[0].returncode, 0)


if __name__ == '__main__':
    unittest.main()
