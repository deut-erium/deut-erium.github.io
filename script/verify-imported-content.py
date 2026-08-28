#!/usr/bin/env python3
"""Verify that imported authored content and attachments remain byte-identical."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = Path(__file__).with_name("imported-content-manifest.json")

manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
expected = {item["path"]: item for item in manifest["files"]}
actual = {
    path.relative_to(ROOT).as_posix()
    for path in (ROOT / "_posts").rglob("*")
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
    raise SystemExit(
        f"content integrity failed: missing={missing[:10]} added={added[:10]} changed={changed[:10]}"
    )

sections: dict[str, int] = {}
for item in expected.values():
    sections[item["section"]] = sections.get(item["section"], 0) + 1
print(json.dumps({"status": "pass", "files": len(expected), "sections": sections}, indent=2))
