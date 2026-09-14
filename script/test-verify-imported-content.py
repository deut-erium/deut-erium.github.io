#!/usr/bin/env python3
"""Offline additive authoring and pin-preservation tests in disposable trees."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'agent_out/authoring/imported'
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('imported_gate', ROOT / 'script/verify-imported-content.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
spec = importlib.util.spec_from_file_location('encryptor', ROOT / 'script/encrypt_post.py')
encryptor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(encryptor)
UNLISTED = 'locked/2031/01/02/chain-followup.md'
PAYLOAD = base64.b64encode(bytes(range(64))).decode('ascii')
SALT = '0123456789abcdef' * 2


def unlisted(rel=UNLISTED, *, payload=PAYLOAD, salt=SALT, teaser='A public teaser with **Markdown**.'):
    # Use the real producer template, but deliberately arbitrary envelope bytes.
    # Acceptance here says nothing about successful encryption/authentication.
    return encryptor.UNLISTED_TEMPLATE.format(
        title='Synthetic followup', date='-'.join(Path(rel).parts[1:4]),
        section='ramblings', tags='challenges crypto', description='Public description.',
        route='/' + str(Path(rel).with_suffix('.html')), teaser=teaser,
        salt=salt, needs='synthetic-entry', payload=payload,
    ).encode('utf-8')


def write(root, rel, data=b'Public synthetic fixture.\n'):
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


class ImportedTests(unittest.TestCase):
    def setUp(self):
        OUT.mkdir(parents=True, exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=OUT)
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        names = (
            '_posts/2020-01-01-pinned.md', '_posts/WriteUps/old/2020-01-01-pinned.md',
            '_posts/WriteUps/old/handout.txt', '_posts/ctf-tutorials/challenges/2020-01-01-pinned.md',
            'assets/challenges/pinned.txt', 'challenges/index.html', 'locked/pinned.html',
            'locked/2030/01/02/pinned.md',
            'assigments/pinned.py', 'ctf-tutorials/assigments/pinned.txt', 'assets/pinned.txt',
        )
        rows = []
        for name in names:
            data = b'---\ntitle: Pinned fixture\n---\n' if name.endswith('.md') else b'Pinned fixture.\n'
            if name.startswith('locked/') and name.endswith('.md'):
                data = unlisted(name)
            write(self.root, name, data)
            rows.append({'path': name, 'section': 'WriteUps', 'bytes': len(data),
                         'sha256': hashlib.sha256(data).hexdigest()})
        # A new synthetic manifest, never a rewritten historical manifest.
        self.manifest = write(self.root, 'script/imported-content-manifest.json', json.dumps({
            'sources': {'WriteUps': {'commit': '1' * 40, 'public_commit': '2' * 40,
                                    'files': len(rows), 'public_files': 0, 'local_addition_files': len(rows)}},
            'files': rows,
        }).encode())
        self.original_manifest = self.manifest.read_bytes()
        self.before = {row['path']: (self.root / row['path']).read_bytes() for row in rows}
        self.check()

    def check(self):
        self.assertEqual(self.manifest.read_bytes(), self.original_manifest)
        return gate.verify(self.root, self.manifest)

    def test_add_remove_root_and_section_posts_with_new_sidecar(self):
        posts = [write(self.root, rel, b'---\ntitle: Ordinary post\n---\nText.\n') for rel in (
            '_posts/2031-01-02-ordinary.md', '_posts/new-topic/2031-01-02-other.markdown',
            '_posts/ramblings/2031-01-02-note.md', '_posts/ctf-tutorials/2031-01-02-note.md',
            '_posts/WriteUps/new-event/2031-01-02-note.md',
        )]
        attachment = write(self.root, '_posts/WriteUps/new-event/handout.txt')
        public_asset = write(self.root, 'assets/posts/new-topic/attachment.txt')
        result = self.check()
        self.assertEqual((result['new_posts'], result['new_postfiles']), (len(posts), 1))
        for path in [*posts, attachment, public_asset]:
            path.unlink()
        self.assertEqual((self.check()['new_posts'], self.check()['new_postfiles']), (0, 0))
        self.assertEqual({rel: (self.root / rel).read_bytes() for rel in self.before}, self.before)

    def test_root_post_does_not_open_root_or_historical_sidecar_directories(self):
        write(self.root, '_posts/2031-01-02-ordinary.md', b'---\ntitle: Ordinary\n---\n')
        for rel in ('_posts/answer.txt', '_posts/private/answer.txt', '_posts/WriteUps/old/answer.txt'):
            with self.subTest(rel=rel):
                path = write(self.root, rel)
                with self.assertRaisesRegex(SystemExit, 'added='):
                    self.check()
                path.unlink()

    def test_archived_roots_remain_closed(self):
        for rel in ('locked/new.md', 'challenges/new.md', 'assets/challenges/new.txt',
                    'assigments/new.txt', 'ctf-tutorials/assigments/new.txt',
                    '_posts/ctf-tutorials/challenges/2031-01-02-new.md'):
            with self.subTest(rel=rel):
                path = write(self.root, rel, b'---\ntitle: Ordinary\n---\n')
                with self.assertRaisesRegex(SystemExit, 'added='):
                    self.check()
                path.unlink()

    def test_private_scratch_and_dangling_sidecars_rejected(self):
        post = write(self.root, '_posts/new/2031-01-02-public.md', b'---\ntitle: Public\n---\n')
        for rel in ('_posts/new/.env', '_posts/new/.secret.md', '_posts/new/_secret.txt',
                    '_posts/flags/2031-01-02-public.md', '_posts/new/notes.bak', '_posts/new/service.html'):
            with self.subTest(rel=rel):
                path = write(self.root, rel, b'---\ntitle: Fixture\n---\n')
                with self.assertRaisesRegex(SystemExit, 'added='):
                    self.check()
                path.unlink()
        write(self.root, '_posts/new/handout.txt')
        self.check()
        post.unlink()
        with self.assertRaisesRegex(SystemExit, 'added='):
            self.check()

    def test_private_flags_are_not_read_or_registered(self):
        write(self.root, 'assigments/flags/local-only', b'Synthetic private test data.\n')
        self.check()

    def test_every_pin_still_rejects_changes_and_removal(self):
        for rel, data in self.before.items():
            with self.subTest(rel=rel):
                path = self.root / rel
                path.write_bytes(data + b'changed\n')
                with self.assertRaisesRegex(SystemExit, 'changed=\\[.*' + rel.replace('.', r'\.')):
                    self.check()
                path.unlink()
                with self.assertRaisesRegex(SystemExit, 'missing=\\[.*' + rel.replace('.', r'\.')):
                    self.check()
                path.write_bytes(data)

    def test_symlink_files_and_ancestors_rejected(self):
        post = write(self.root, '_posts/new/2031-01-02-public.md', b'---\ntitle: Public\n---\n')
        for name in ('link.txt', 'dangling.txt'):
            link = self.root / '_posts/new' / name
            link.symlink_to(post if name == 'link.txt' else 'absent')
            with self.assertRaisesRegex(SystemExit, 'unsafe file'):
                self.check()
            link.unlink()
        original = self.root / '_posts/WriteUps/old'
        target = self.root / 'public-copy'
        original.rename(target)
        original.symlink_to(target, target_is_directory=True)
        with self.assertRaisesRegex(SystemExit, 'unsafe file'):
            self.check()

    def test_add_remove_producer_shaped_unlisted_page_without_changing_pins(self):
        for body in (unlisted(), unlisted().replace(b'\n', b'\r\n'),
                     unlisted(salt=SALT.upper(), teaser='<p>A public HTML teaser.</p>\n\nMore text.')):
            with self.subTest(body=body):
                page = write(self.root, UNLISTED, body)
                result = self.check()
                self.assertEqual((result['new_unlisted_pages'], result['new_posts'], result['new_postfiles']), (1, 0, 0))
                self.assertEqual({rel: (self.root / rel).read_bytes() for rel in self.before}, self.before)
                page.unlink()
                self.assertEqual(self.check()['new_unlisted_pages'], 0)

    def test_unlisted_exception_does_not_open_sidecar_directories(self):
        write(self.root, UNLISTED, unlisted())
        for name in ('answer.txt', 'image.png', 'draft.md', 'page.markdown', 'page.html',
                     'page.htm', '.env', '_secret', 'notes.bak'):
            with self.subTest(name=name):
                path = write(self.root, str(Path(UNLISTED).with_name(name)), unlisted())
                with self.assertRaisesRegex(SystemExit, 'added='):
                    self.check()
                path.unlink()

    def test_unlisted_requires_canonical_path_and_real_date(self):
        for rel in ('locked/new.md', 'locked/31/01/02/followup.md', 'locked/2031/1/02/followup.md',
                    'locked/2031/01/2/followup.md', 'locked/2031/01/02/deeper/followup.md',
                    'locked/2031/01/02/followup.MD', 'locked/2031/01/02/followup.markdown',
                    'locked/2031/01/02/followup.html', 'locked/2031/01/02/.draft.md',
                    'locked/2031/01/02/_draft.md', 'locked/2031/01/02/has space.md',
                    'locked/2031/01/02/bad%2fslug.md', 'locked/2031/01/02/bad\\slug.md',
                    'locked/0000/01/02/followup.md', 'locked/2031/00/02/followup.md',
                    'locked/2031/13/02/followup.md', 'locked/2031/01/00/followup.md',
                    'locked/2031/01/32/followup.md', 'locked/2031/02/29/followup.md',
                    'locked/2031/04/31/followup.md', 'locked/２０３１/01/02/followup.md'):
            with self.subTest(rel=rel):
                path = write(self.root, rel, unlisted(rel))
                with self.assertRaisesRegex(SystemExit, 'added='):
                    self.check()
                path.unlink()
        leap = 'locked/2032/02/29/leap-day.md'
        write(self.root, leap, unlisted(leap))
        self.assertEqual(self.check()['new_unlisted_pages'], 1)

    def test_unlisted_flags_are_explicit_unique_and_not_yaml_strings(self):
        for key, value, wrong in (('unlisted', 'true', 'false'), ('sitemap', 'false', 'true'),
                                  ('noindex', 'true', 'false'), ('layout', 'locked', 'article')):
            line = f'{key}: {value}\n'.encode()
            for replacement in (b'', f'{key}: {wrong}\n'.encode(), f'{key}: "{value}"\n'.encode(),
                                line + f'{key}: {wrong}\n'.encode(), b'# ' + line, b'  ' + line,
                                f'{key}: &alias {value}\n'.encode()):
                with self.subTest(key=key, replacement=replacement):
                    write(self.root, UNLISTED, unlisted().replace(line, replacement))
                    with self.assertRaisesRegex(SystemExit, 'added='):
                        self.check()

    def test_unlisted_body_and_metadata_require_producer_shape(self):
        good = unlisted()
        body_start = good.index(b'---\n\n') + len(b'---\n\n')
        cases = [b'Raw plaintext.', b'<html>Raw HTML</html>', b'\xff\xfe',
                 good[:body_start] + b'Only plaintext Markdown.\n',
                 good.replace(b'<span hidden>', b'<span>'),
                 good.replace(b'<span hidden>', b'').replace(b'</span>', b''),
                 good.replace(b'class="argon"', b'class="other"'),
                 good.replace(b' data-salt="' + SALT.encode() + b'"', b''),
                 good.replace(b'<!--more-->', b''),
                 good.replace(b'<noscript>', b'<script>'),
                 good + b'Plaintext appended outside the template.\n',
                 good.replace(b'date: 2031-01-02', b'date: 2031-01-03'),
                 good.replace(b'permalink: /locked/', b'permalink: /elsewhere/'),
                 unlisted(teaser=' ')]
        for body in cases:
            with self.subTest(body=body):
                write(self.root, UNLISTED, body)
                with self.assertRaisesRegex(SystemExit, 'added='):
                    self.check()

    def test_unlisted_base64_and_salt_boundaries(self):
        for length in (0, 1, 12, 16, 27, 28, 29, 1024):
            with self.subTest(length=length):
                write(self.root, UNLISTED, unlisted(payload=base64.b64encode(b'x' * length).decode()))
                if length < 28:
                    with self.assertRaisesRegex(SystemExit, 'added='):
                        self.check()
                else:
                    self.assertEqual(self.check()['new_unlisted_pages'], 1)
        # Invalid alphabet, padding, noncanonical pad bits and markup cannot
        # masquerade as a base64 GCM envelope merely by being long enough.
        for payload in (PAYLOAD[:-1], PAYLOAD + '=', PAYLOAD + 'AAAA', PAYLOAD[:8] + '\n' + PAYLOAD[8:],
                        '!' * 64, '_' * 64, '=' * 64, 'AAAA=' * 16,
                        'A' * 37 + 'B==', '<b>' + PAYLOAD + '</b>'):
            with self.subTest(payload=payload):
                write(self.root, UNLISTED, unlisted(payload=payload))
                with self.assertRaisesRegex(SystemExit, 'added='):
                    self.check()
        for salt in ('', 'a' * 16, 'a' * 31, 'a' * 33, 'a' * 64, 'g' * 32, '00 ' * 16):
            with self.subTest(salt=salt):
                write(self.root, UNLISTED, unlisted(salt=salt))
                with self.assertRaisesRegex(SystemExit, 'added='):
                    self.check()

    def test_matching_unlisted_shape_cannot_bypass_a_historical_pin(self):
        rel = 'locked/2030/01/02/pinned.md'
        write(self.root, rel, unlisted(rel, teaser='Another public teaser.'))
        self.assertTrue(gate.unlisted_page(self.root, rel))
        with self.assertRaisesRegex(SystemExit, 'changed=\\[.*locked/'):
            self.check()

    def test_locked_symlinks_and_special_files_rejected(self):
        page = write(self.root, UNLISTED, unlisted())
        for target in (page, page.parent, self.root / 'absent', self.root):
            with self.subTest(target=target):
                link = page.with_name('link.md')
                link.symlink_to(target)
                with self.assertRaisesRegex(SystemExit, 'unsafe file'):
                    self.check()
                link.unlink()
        # Reject each directory ancestor, including the locked root itself.
        for rel in ('locked/2031/01/02', 'locked/2031/01', 'locked/2031', 'locked'):
            with self.subTest(rel=rel):
                original = self.root / rel
                target = self.root / 'moved-directory'
                original.rename(target)
                original.symlink_to(target, target_is_directory=True)
                with self.assertRaisesRegex(SystemExit, 'unsafe file'):
                    self.check()
                original.unlink()
                target.rename(original)
        fifo = page.with_name('raw.md')
        import os
        os.mkfifo(fifo)
        with self.assertRaisesRegex(SystemExit, 'unsafe file'):
            self.check()

    def test_new_post_requires_front_matter(self):
        write(self.root, '_posts/2031-01-02-invisible.md')
        with self.assertRaisesRegex(SystemExit, 'added='):
            self.check()


if __name__ == '__main__':
    unittest.main(verbosity=2)
