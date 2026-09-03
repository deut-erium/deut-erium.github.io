#!/usr/bin/env python3
"""Test deterministic artifact manifests and fail-closed entry handling."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

MANIFEST = Path(__file__).with_name("artifact_manifest.py").resolve()


class ArtifactManifestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="artifact-manifest-")
        self.root = Path(self.temp.name) / "site"
        (self.root / "assets").mkdir(parents=True)
        (self.root / "empty").mkdir()
        (self.root / "index.html").write_text("home\n", encoding="utf-8")
        (self.root / "assets" / "app.js").write_bytes(b"console.log('ok');\n")
        os.chmod(self.root / "index.html", 0o644)
        os.chmod(self.root / "assets" / "app.js", 0o755)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def run_manifest(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(MANIFEST), str(self.root)],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def test_manifest_covers_files_directories_modes_sizes_and_hashes(self) -> None:
        first = self.run_manifest()
        second = self.run_manifest()
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(first.stdout, second.stdout)
        entries = [json.loads(line) for line in first.stdout.splitlines()]
        by_path = {entry["path"]: entry for entry in entries}
        self.assertEqual(set(by_path), {".", "assets", "assets/app.js", "empty", "index.html"})
        self.assertEqual(by_path["assets/app.js"]["type"], "file")
        self.assertEqual(by_path["assets/app.js"]["mode"], "0755")
        self.assertEqual(by_path["assets/app.js"]["size"], 19)
        self.assertRegex(by_path["assets/app.js"]["sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(by_path["empty"]["type"], "directory")

    def test_mode_change_changes_manifest(self) -> None:
        before = self.run_manifest()
        self.assertEqual(before.returncode, 0, before.stderr)
        os.chmod(self.root / "index.html", 0o600)
        after = self.run_manifest()
        self.assertEqual(after.returncode, 0, after.stderr)
        self.assertNotEqual(before.stdout, after.stdout)

    def test_byte_change_changes_manifest(self) -> None:
        before = self.run_manifest()
        self.assertEqual(before.returncode, 0, before.stderr)
        (self.root / "index.html").write_text("changed\n", encoding="utf-8")
        after = self.run_manifest()
        self.assertEqual(after.returncode, 0, after.stderr)
        self.assertNotEqual(before.stdout, after.stdout)

    def test_directory_mode_change_changes_manifest(self) -> None:
        before = self.run_manifest()
        self.assertEqual(before.returncode, 0, before.stderr)
        os.chmod(self.root / "empty", 0o700)
        after = self.run_manifest()
        self.assertEqual(after.returncode, 0, after.stderr)
        self.assertNotEqual(before.stdout, after.stdout)

    def test_symbolic_link_root_fails(self) -> None:
        real_root = self.root.with_name("site-real")
        self.root.rename(real_root)
        self.root.symlink_to(real_root, target_is_directory=True)
        result = self.run_manifest()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("root is a symbolic link", result.stderr)

    def test_symbolic_link_fails(self) -> None:
        (self.root / "alias").symlink_to("index.html")
        result = self.run_manifest()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("symbolic link", result.stderr)

    @unittest.skipUnless(hasattr(os, "mkfifo"), "FIFO creation is unavailable")
    def test_special_file_fails(self) -> None:
        os.mkfifo(self.root / "pipe")
        result = self.run_manifest()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("special file", result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
