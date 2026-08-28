#!/usr/bin/env python3
"""Exercise fail-closed behavior in the history sanitization verifier."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

VERIFIER = Path(__file__).with_name("verify-history-sanitization.py").resolve()
ABSENT_TIP = "0" * 40
ABSENT_BLOB = "1" * 40


def run(command: list[str], *, cwd: Path | None = None, input_text: str | None = None) -> str:
    env = os.environ.copy()
    env.update({
        "GIT_AUTHOR_NAME": "History gate fixture",
        "GIT_AUTHOR_EMAIL": "fixture@example.invalid",
        "GIT_COMMITTER_NAME": "History gate fixture",
        "GIT_COMMITTER_EMAIL": "fixture@example.invalid",
        "GIT_AUTHOR_DATE": "2024-01-01T00:00:00+00:00",
        "GIT_COMMITTER_DATE": "2024-01-01T00:00:00+00:00",
    })
    completed = subprocess.run(
        command,
        cwd=cwd,
        input=input_text,
        text=True,
        env=env,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return completed.stdout.strip()


def git(repo: Path, *args: str, input_text: str | None = None) -> str:
    return run(["git", "-C", str(repo), *args], input_text=input_text)


def commit_tree(repo: Path, tree: str, *parents: str, message: str) -> str:
    args = ["commit-tree", tree]
    for parent in parents:
        args.extend(["-p", parent])
    return git(repo, *args, input_text=f"{message}\n")


class HistorySanitizationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="history-gate-")
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.manifest_path = self.root / "manifest.json"
        run(["git", "init", "--initial-branch=main", str(self.repo)])
        (self.repo / "source.txt").write_text("fixture\n", encoding="utf-8")
        git(self.repo, "add", "source.txt")
        git(self.repo, "commit", "-m", "Root source")
        self.root_commit = git(self.repo, "rev-parse", "HEAD")
        tree = git(self.repo, "rev-parse", "HEAD^{tree}")
        self.imported_commit = commit_tree(self.repo, tree, message="Imported source")
        self.merge_commit = commit_tree(
            self.repo,
            tree,
            self.root_commit,
            self.imported_commit,
            message="Attach imported history",
        )
        git(self.repo, "update-ref", "refs/heads/main", self.merge_commit)
        self.manifest = {
            "version": 2,
            "required_ancestors": {
                "root": self.root_commit,
                "imported": self.imported_commit,
            },
            "attachment_merges": {
                "imported": {
                    "commit": self.merge_commit,
                    "second_parent": "imported",
                }
            },
            "forbidden_tips": {"unsafe-original": ABSENT_TIP},
            "forbidden_blob_oids": {"unsafe": [ABSENT_BLOB]},
            "forbidden_value_hashes": [],
        }
        self.write_manifest()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_manifest(self) -> None:
        self.manifest_path.write_text(
            json.dumps(self.manifest, indent=2) + "\n",
            encoding="utf-8",
        )

    def verify(self, repo: Path | None = None) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                str(VERIFIER),
                "--repo",
                str(repo or self.repo),
                "--manifest",
                str(self.manifest_path),
            ],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def test_baseline_and_attachment_topology_pass(self) -> None:
        result = self.verify()
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["attachment_merges_checked"], 1)
        self.assertEqual(report["scanned_commits"], 3)

    def test_forbidden_value_in_side_ref_commit_message_fails(self) -> None:
        token = b"fixture_value_12345678"
        tree = git(self.repo, "rev-parse", "HEAD^{tree}")
        side_commit = commit_tree(
            self.repo,
            tree,
            self.merge_commit,
            message=token.decode("ascii"),
        )
        git(self.repo, "update-ref", "refs/heads/side", side_commit)
        self.manifest["forbidden_value_hashes"] = [{
            "bytes": len(token),
            "sha256": hashlib.sha256(token).hexdigest(),
            "source": "fixture",
        }]
        self.write_manifest()

        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ref-reachable objects", result.stderr)
        self.assertIn('"type": "commit"', result.stderr)

    def test_unreachable_forbidden_object_id_fails(self) -> None:
        tree = git(self.repo, "rev-parse", "HEAD^{tree}")
        detached = commit_tree(self.repo, tree, self.merge_commit, message="Detached unsafe tip")
        self.manifest["forbidden_tips"] = {"unsafe-original": detached}
        self.write_manifest()

        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("forbidden_objects", result.stderr)

    def test_wrong_attachment_second_parent_fails(self) -> None:
        self.manifest["attachment_merges"]["imported"]["second_parent"] = "root"
        self.write_manifest()

        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("second parent is not the required source tip", result.stderr)

    def test_shallow_repository_fails_before_ancestry_scan(self) -> None:
        shallow = self.root / "shallow"
        run([
            "git",
            "clone",
            "--quiet",
            "--depth=1",
            f"file://{self.repo}",
            str(shallow),
        ])
        result = self.verify(shallow)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("complete, non-shallow repository", result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
