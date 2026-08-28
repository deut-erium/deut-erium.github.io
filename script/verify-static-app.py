#!/usr/bin/env python3
"""Verify the recovered new-tetris application and its recorded local patches."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads(Path(__file__).with_name("static-app-manifest.json").read_text(encoding="utf-8"))
if manifest.get("version") != 2 or not re.fullmatch(r"[0-9a-f]{40}", manifest.get("source_commit", "")):
    raise SystemExit("unsupported static app manifest")
rows = manifest.get("files", [])
expected = {item["path"]: item for item in rows}
if len(expected) != len(rows):
    raise SystemExit("static app manifest contains duplicate paths")

patched = {path for patch in manifest.get("patches", []) for path in patch.get("paths", [])}
if not patched or not patched.issubset(expected):
    raise SystemExit("static app patch inventory is invalid")
for rel, item in expected.items():
    if rel in patched:
        if not isinstance(item.get("source_bytes"), int) or not re.fullmatch(r"[0-9a-f]{64}", item.get("source_sha256", "")):
            raise SystemExit(f"static app source provenance is missing: {rel}")
    elif "source_bytes" in item or "source_sha256" in item:
        raise SystemExit(f"unpatched static app file has source overrides: {rel}")

actual = {
    path.relative_to(ROOT).as_posix()
    for path in (ROOT / "new-tetris").rglob("*")
    if path.is_file()
}
missing = sorted(set(expected) - actual)
added = sorted(actual - set(expected))
changed = []
for rel, item in expected.items():
    path = ROOT / rel
    if not path.is_file():
        continue
    data = path.read_bytes()
    if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
        changed.append(rel)
if missing or added or changed:
    raise SystemExit(f"static app drift: missing={missing} added={added} changed={changed}")
print(json.dumps({
    "status": "pass",
    "files": len(expected),
    "source_commit": manifest["source_commit"],
    "locally_patched": len(patched),
}, indent=2))
