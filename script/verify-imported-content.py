#!/usr/bin/env python3
"""Verify imported authored content and attachments against their recorded bytes."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = Path(__file__).with_name("imported-content-manifest.json")
COMMIT = re.compile(r"^[0-9a-f]{40}$")

manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
rows = manifest.get("files", [])
paths = [item.get("path") for item in rows]
if not rows or len(paths) != len(set(paths)) or any(not isinstance(path, str) for path in paths):
    raise SystemExit("content manifest contains missing or duplicate paths")

expected: dict[str, dict] = {}
for item in rows:
    rel = item["path"]
    pure = PurePosixPath(rel)
    if pure.is_absolute() or ".." in pure.parts or "." in pure.parts or "\\" in rel:
        raise SystemExit(f"content manifest has an unsafe path: {rel!r}")
    section = item.get("section")
    if section not in manifest["sources"]:
        raise SystemExit(f"content manifest has an unknown section: {section!r}")
    commit = item.get("source_commit")
    if not commit:
        source = manifest["sources"][section]
        commit = source.get("commit") or source.get("local_additions_commit")
    if not isinstance(commit, str) or not COMMIT.fullmatch(commit):
        raise SystemExit(f"content manifest has an invalid source commit: {rel}")
    if not isinstance(item.get("bytes"), int) or item["bytes"] < 0:
        raise SystemExit(f"content manifest has an invalid byte count: {rel}")
    if not isinstance(item.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
        raise SystemExit(f"content manifest has an invalid digest: {rel}")
    expected[rel] = item

section_counts: dict[str, int] = {}
for item in rows:
    section_counts[item["section"]] = section_counts.get(item["section"], 0) + 1
for section, source in manifest["sources"].items():
    if source.get("files") != section_counts.get(section, 0):
        raise SystemExit(f"content manifest source count drift: {section}")
if manifest["sources"]["WriteUps"].get("public_files") != sum(
    item["section"] == "WriteUps" and item.get("source_commit") == manifest["sources"]["WriteUps"].get("public_commit")
    for item in rows
):
    raise SystemExit("WriteUps public-source count drift")
if manifest["sources"]["WriteUps"].get("local_addition_files") != (
    section_counts["WriteUps"] - manifest["sources"]["WriteUps"]["public_files"]
):
    raise SystemExit("WriteUps local-addition count drift")

missing: list[str] = []
changed: list[str] = []
for rel, item in expected.items():
    path = ROOT / rel
    if not path.is_file() or path.is_symlink():
        missing.append(rel)
        continue
    data = path.read_bytes()
    if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
        changed.append(rel)

protected_roots = ("_posts", "_legacy_authored", "assigments", "ctf-tutorials/assigments")
actual_protected = {
    path.relative_to(ROOT).as_posix()
    for root_name in protected_roots
    for path in (ROOT / root_name).rglob("*")
    if path.is_file()
}
expected_protected = {
    rel for rel in expected
    if any(rel == root_name or rel.startswith(f"{root_name}/") for root_name in protected_roots)
}
added = sorted(actual_protected - expected_protected)
uncovered = sorted(expected_protected - actual_protected)
if missing or changed or added or uncovered:
    raise SystemExit(
        "content integrity failed: "
        f"missing={missing[:10]} changed={changed[:10]} added={added[:10]} uncovered={uncovered[:10]}"
    )

print(json.dumps({
    "status": "pass",
    "files": len(expected),
    "sections": section_counts,
    "protected_roots": list(protected_roots),
}, indent=2))
