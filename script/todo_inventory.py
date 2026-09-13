#!/usr/bin/env python3
"""Inventory TODO checkboxes and literal markers without modifying source files."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLAN_FILES = (Path("agent_out/TODO.md"), Path("agent_out/ROADMAP.md"))
MARKER_RE = re.compile(r"\b(?:TODO|FIXME|TBD)\b")
CHECKBOX_RE = re.compile(r"^\s*- \[(?P<state>[ xX])\]\s+(?P<text>.*)$")


def tracked_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "-z"], cwd=ROOT, check=True, capture_output=True
    )
    return [Path(raw.decode()) for raw in result.stdout.split(b"\0") if raw]


def readable_lines(path: Path) -> list[str] | None:
    data = (ROOT / path).read_bytes()
    if b"\0" in data:
        return None
    try:
        return data.decode("utf-8").splitlines()
    except UnicodeDecodeError:
        return data.decode("utf-8", errors="replace").splitlines()


def marker_scope(path: Path, line: int) -> str:
    value = path.as_posix()
    if value.startswith("assets/vendor/"):
        return "upstream-vendor"
    if value.startswith("_posts/WriteUps/"):
        return "archived-or-pedagogical-content"
    if value == "script/todo_inventory.py":
        return "scanner-mechanics"
    if value == "script/verify-reader-copy.py" and line in (64, 65):
        return "scanner-sentinel"
    return "first-party"


def collect() -> dict[str, object]:
    tracked = tracked_files()
    checkbox_files = list(tracked)
    for path in PLAN_FILES:
        if (ROOT / path).is_file() and path not in checkbox_files:
            checkbox_files.append(path)

    checkboxes: list[dict[str, object]] = []
    for path in checkbox_files:
        if path.suffix.lower() != ".md":
            continue
        lines = readable_lines(path)
        if lines is None:
            continue
        for number, text in enumerate(lines, 1):
            match = CHECKBOX_RE.match(text)
            if match:
                checkboxes.append(
                    {
                        "path": path.as_posix(),
                        "line": number,
                        "state": "open" if match.group("state") == " " else "done",
                        "text": match.group("text").strip(),
                    }
                )

    markers: list[dict[str, object]] = []
    binary_marker_files: list[str] = []
    for path in tracked:
        lines = readable_lines(path)
        if lines is None:
            data = (ROOT / path).read_bytes()
            if MARKER_RE.search(data.decode("latin-1", errors="ignore")):
                binary_marker_files.append(path.as_posix())
            continue
        for number, text in enumerate(lines, 1):
            found = sorted(set(MARKER_RE.findall(text)))
            if found:
                markers.append(
                    {
                        "path": path.as_posix(),
                        "line": number,
                        "markers": found,
                        "scope": marker_scope(path, number),
                        "text": text.strip(),
                    }
                )

    revision = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, check=True, capture_output=True, text=True
    ).stdout.strip()
    return {
        "revision": revision,
        "summary": {
            "checkboxes": len(checkboxes),
            "open_checkboxes": sum(item["state"] == "open" for item in checkboxes),
            "done_checkboxes": sum(item["state"] == "done" for item in checkboxes),
            "literal_marker_lines": len(markers),
            "binary_marker_files": len(binary_marker_files),
        },
        "checkboxes": checkboxes,
        "literal_markers": markers,
        "binary_marker_files": binary_marker_files,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, help="write JSON here instead of stdout")
    args = parser.parse_args()
    payload = json.dumps(collect(), indent=2, sort_keys=False) + "\n"
    if args.output:
        target = args.output if args.output.is_absolute() else ROOT / args.output
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(payload)
    else:
        print(payload, end="")


if __name__ == "__main__":
    main()
