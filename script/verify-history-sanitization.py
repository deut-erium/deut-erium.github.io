#!/usr/bin/env python3
"""Verify attached source histories without storing forbidden credential values."""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = Path(__file__).with_name("history-sanitization.json")
OID = re.compile(r"[0-9a-f]{40}")
TOKEN = re.compile(rb"[A-Za-z0-9_-]{8,128}")
SCANNED_KINDS = {"blob", "commit", "tag"}


def git(
    repo: Path,
    *args: str,
    check: bool = True,
    text: bool = True,
) -> subprocess.CompletedProcess[str] | subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        check=check,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=text,
    )


def object_exists(repo: Path, oid: str) -> bool:
    return git(repo, "cat-file", "-e", oid, check=False).returncode == 0


def is_ancestor(repo: Path, ancestor: str, descendant: str = "HEAD") -> bool:
    return git(
        repo,
        "merge-base",
        "--is-ancestor",
        ancestor,
        descendant,
        check=False,
    ).returncode == 0


def load_manifest(path: Path) -> dict[str, object]:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if manifest.get("version") != 2:
        raise SystemExit("unsupported history sanitization manifest")

    required = manifest.get("required_ancestors")
    forbidden_tips = manifest.get("forbidden_tips")
    forbidden_blobs = manifest.get("forbidden_blob_oids")
    merges = manifest.get("attachment_merges")
    values = manifest.get("forbidden_value_hashes")
    if not all(isinstance(item, dict) for item in (required, forbidden_tips, forbidden_blobs, merges)):
        raise SystemExit("invalid history sanitization manifest maps")
    if not isinstance(values, list):
        raise SystemExit("invalid forbidden-value hash manifest")

    oids: list[object] = [*required.values(), *forbidden_tips.values()]
    for group in forbidden_blobs.values():
        if not isinstance(group, list):
            raise SystemExit("invalid forbidden blob group")
        oids.extend(group)
    for spec in merges.values():
        if not isinstance(spec, dict):
            raise SystemExit("invalid attachment merge specification")
        oids.append(spec.get("commit"))
        if spec.get("second_parent") not in required:
            raise SystemExit("attachment merge references an unknown required ancestor")
    if any(not isinstance(oid, str) or not OID.fullmatch(oid) for oid in oids):
        raise SystemExit("invalid object ID in history sanitization manifest")

    for item in values:
        if not isinstance(item, dict):
            raise SystemExit("invalid forbidden-value hash entry")
        length = item.get("bytes")
        digest = item.get("sha256")
        if not isinstance(length, int) or length < 8 or length > 128:
            raise SystemExit("invalid forbidden-value length")
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise SystemExit("invalid forbidden-value digest")
    return manifest


def verify_attachment_merges(repo: Path, manifest: dict[str, object]) -> int:
    required = manifest["required_ancestors"]
    merges = manifest["attachment_merges"]
    assert isinstance(required, dict) and isinstance(merges, dict)
    failures: dict[str, str] = {}

    for name, untyped_spec in merges.items():
        assert isinstance(name, str) and isinstance(untyped_spec, dict)
        commit = untyped_spec["commit"]
        second_parent_name = untyped_spec["second_parent"]
        assert isinstance(commit, str) and isinstance(second_parent_name, str)
        expected_second_parent = required[second_parent_name]
        assert isinstance(expected_second_parent, str)

        if not object_exists(repo, commit) or not is_ancestor(repo, commit):
            failures[name] = "merge commit is not an ancestor of HEAD"
            continue

        fields = git(repo, "rev-list", "--parents", "-n", "1", commit).stdout.strip().split()
        parents = fields[1:]
        if len(parents) != 2:
            failures[name] = f"expected two parents, found {len(parents)}"
            continue
        if parents[1] != expected_second_parent:
            failures[name] = "second parent is not the required source tip"
            continue

        merge_tree = git(repo, "rev-parse", f"{commit}^{{tree}}").stdout.strip()
        first_parent_tree = git(repo, "rev-parse", f"{parents[0]}^{{tree}}").stdout.strip()
        if merge_tree != first_parent_tree:
            failures[name] = "merge changed the first-parent tree"

    if failures:
        raise SystemExit(f"history attachment topology failed: {failures}")
    return len(merges)


def scan_forbidden_values(
    repo: Path,
    object_ids: set[str],
    forbidden_values: set[tuple[int, str]],
) -> tuple[Counter[str], Counter[str], list[tuple[str, str]]]:
    forbidden_lengths = {length for length, _ in forbidden_values}
    process = subprocess.Popen(
        ["git", "-C", str(repo), "cat-file", "--batch"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
    )
    assert process.stdin is not None and process.stdout is not None
    counts: Counter[str] = Counter()
    byte_counts: Counter[str] = Counter()
    matches: list[tuple[str, str]] = []

    try:
        for oid in sorted(object_ids):
            process.stdin.write(f"{oid}\n".encode("ascii"))
            process.stdin.flush()
            header = process.stdout.readline().decode("ascii").strip().split()
            if len(header) != 3:
                raise SystemExit(f"invalid cat-file response for {oid}")
            _, kind, size_text = header
            size = int(size_text)
            data = process.stdout.read(size)
            if process.stdout.read(1) != b"\n":
                raise SystemExit(f"truncated cat-file response for {oid}")
            if kind not in SCANNED_KINDS:
                continue

            counts[kind] += 1
            byte_counts[kind] += size
            for token in TOKEN.findall(data):
                if len(token) not in forbidden_lengths:
                    continue
                digest = hashlib.sha256(token).hexdigest()
                if (len(token), digest) in forbidden_values:
                    matches.append((oid, kind))
                    break
    finally:
        process.stdin.close()
        return_code = process.wait(timeout=30)
        if return_code != 0:
            raise SystemExit(f"git cat-file failed with status {return_code}")

    return counts, byte_counts, matches


def verify(repo: Path, manifest_path: Path) -> dict[str, object]:
    manifest = load_manifest(manifest_path)
    if git(repo, "rev-parse", "--is-shallow-repository").stdout.strip() != "false":
        raise SystemExit("history verification requires a complete, non-shallow repository")

    required = manifest["required_ancestors"]
    forbidden_tips = manifest["forbidden_tips"]
    forbidden_blob_groups = manifest["forbidden_blob_oids"]
    value_entries = manifest["forbidden_value_hashes"]
    assert isinstance(required, dict)
    assert isinstance(forbidden_tips, dict)
    assert isinstance(forbidden_blob_groups, dict)
    assert isinstance(value_entries, list)

    missing_ancestors = {
        name: commit
        for name, commit in required.items()
        if not isinstance(commit, str) or not object_exists(repo, commit) or not is_ancestor(repo, commit)
    }
    forbidden_objects = {
        name: commit
        for name, commit in forbidden_tips.items()
        if isinstance(commit, str) and object_exists(repo, commit)
    }
    for name, values in forbidden_blob_groups.items():
        assert isinstance(values, list)
        present = [oid for oid in values if isinstance(oid, str) and object_exists(repo, oid)]
        if present:
            forbidden_objects[f"{name}-blobs"] = present
    if missing_ancestors or forbidden_objects:
        raise SystemExit(
            "history ancestry failed: "
            f"missing={missing_ancestors} forbidden_objects={forbidden_objects}"
        )

    topology_count = verify_attachment_merges(repo, manifest)

    lines = git(repo, "rev-list", "--objects", "--all", "HEAD").stdout.splitlines()
    object_ids = {line.split(" ", 1)[0] for line in lines}
    forbidden_values = {
        (item["bytes"], item["sha256"])
        for item in value_entries
        if isinstance(item, dict)
    }
    counts, byte_counts, matches = scan_forbidden_values(repo, object_ids, forbidden_values)
    refs = git(repo, "for-each-ref", "--format=%(refname)").stdout.splitlines()
    commit_count = int(git(repo, "rev-list", "--count", "HEAD").stdout.strip())
    all_commit_count = int(git(repo, "rev-list", "--count", "--all", "HEAD").stdout.strip())
    if counts["commit"] != all_commit_count:
        raise SystemExit(
            "history object scan was incomplete: "
            f"expected_commits={all_commit_count} scanned_commits={counts['commit']}"
        )
    if matches:
        locations = [{"oid": oid, "type": kind} for oid, kind in sorted(set(matches))]
        raise SystemExit(
            "forbidden credential value remains in ref-reachable objects: "
            + json.dumps(locations, sort_keys=True)
        )

    return {
        "status": "pass",
        "commits": commit_count,
        "ref_reachable_commits": all_commit_count,
        "refs_scanned": len(refs),
        "reachable_objects": len(object_ids),
        "scanned_blobs": counts["blob"],
        "scanned_blob_bytes": byte_counts["blob"],
        "scanned_commits": counts["commit"],
        "scanned_commit_bytes": byte_counts["commit"],
        "scanned_tags": counts["tag"],
        "scanned_tag_bytes": byte_counts["tag"],
        "attachment_merges_checked": topology_count,
        "attached_histories": sorted(required),
        "forbidden_value_matches": 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=ROOT)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    args = parser.parse_args()
    print(json.dumps(verify(args.repo.resolve(), args.manifest.resolve()), indent=2))


if __name__ == "__main__":
    main()
