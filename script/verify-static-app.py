#!/usr/bin/env python3
"""Verify the imported new-tetris static application."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads(Path(__file__).with_name("static-app-manifest.json").read_text(encoding="utf-8"))
expected = {item["path"]: item for item in manifest["files"]}
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
print(json.dumps({"status": "pass", "files": len(expected), "source_commit": manifest["source_commit"]}, indent=2))
