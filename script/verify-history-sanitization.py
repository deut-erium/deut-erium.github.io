#!/usr/bin/env python3
"""Verify attached source histories without storing forbidden credential values."""

from __future__ import annotations

from pathlib import Path
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads(Path(__file__).with_name("history-sanitization.json").read_text(encoding="utf-8"))
TOKEN = re.compile(rb"[A-Za-z0-9_-]{8,128}")

if MANIFEST.get("version") != 1:
    raise SystemExit("unsupported history sanitization manifest")

lines = subprocess.check_output(
    ["git", "-C", str(ROOT), "rev-list", "--objects", "HEAD"],
    text=True,
).splitlines()
object_ids = {line.split(" ", 1)[0] for line in lines}

missing_ancestors = {
    name: commit for name, commit in MANIFEST["required_ancestors"].items()
    if commit not in object_ids
}
reachable_forbidden_tips = {
    name: commit for name, commit in MANIFEST["forbidden_tips"].items()
    if commit in object_ids
}
forbidden_blobs = {
    oid
    for values in MANIFEST["forbidden_blob_oids"].values()
    for oid in values
}
reachable_forbidden_blobs = sorted(forbidden_blobs.intersection(object_ids))
if missing_ancestors or reachable_forbidden_tips or reachable_forbidden_blobs:
    raise SystemExit(
        "history ancestry failed: "
        f"missing={missing_ancestors} forbidden_tips={reachable_forbidden_tips} "
        f"forbidden_blobs={reachable_forbidden_blobs}"
    )

forbidden_values = {
    (item["bytes"], item["sha256"])
    for item in MANIFEST["forbidden_value_hashes"]
}
if any(not isinstance(length, int) or not re.fullmatch(r"[0-9a-f]{64}", digest) for length, digest in forbidden_values):
    raise SystemExit("invalid forbidden-value hash manifest")
forbidden_lengths = {length for length, _ in forbidden_values}

process = subprocess.Popen(
    ["git", "-C", str(ROOT), "cat-file", "--batch"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
)
assert process.stdin is not None and process.stdout is not None
blob_count = 0
blob_bytes = 0
matches: list[str] = []
try:
    for oid in sorted(object_ids):
        process.stdin.write(f"{oid}\n".encode("ascii")); process.stdin.flush()
        header = process.stdout.readline().decode("ascii").strip().split()
        if len(header) != 3:
            raise SystemExit(f"invalid cat-file response for {oid}")
        _, kind, size_text = header
        size = int(size_text)
        data = process.stdout.read(size)
        if process.stdout.read(1) != b"\n":
            raise SystemExit(f"truncated cat-file response for {oid}")
        if kind != "blob":
            continue
        blob_count += 1
        blob_bytes += size
        for token in TOKEN.findall(data):
            if len(token) not in forbidden_lengths:
                continue
            digest = hashlib.sha256(token).hexdigest()
            if (len(token), digest) in forbidden_values:
                matches.append(oid)
                break
finally:
    process.stdin.close()
    process.wait(timeout=30)

if matches:
    raise SystemExit(f"forbidden credential value remains in reachable blobs: {sorted(set(matches))}")

commit_count = int(subprocess.check_output(
    ["git", "-C", str(ROOT), "rev-list", "--count", "HEAD"],
    text=True,
).strip())
print(json.dumps({
    "status": "pass",
    "commits": commit_count,
    "reachable_objects": len(object_ids),
    "scanned_blobs": blob_count,
    "scanned_blob_bytes": blob_bytes,
    "attached_histories": sorted(MANIFEST["required_ancestors"]),
    "forbidden_value_matches": 0,
}, indent=2))
