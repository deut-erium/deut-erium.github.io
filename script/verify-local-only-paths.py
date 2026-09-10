#!/usr/bin/env python3
"""Reject private answers, local scratch, and editor files from the Git index."""

from __future__ import annotations

from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_PREFIXES = ("agent_out/", ".vimsessions/", "assigments/flags/")


def git_paths(*args: str) -> list[str]:
    output = subprocess.check_output(
        ["git", "-C", str(ROOT), *args, "-z"],
        stderr=subprocess.STDOUT,
    )
    return [item.decode("utf-8", "surrogateescape") for item in output.split(b"\0") if item]


tracked = git_paths("ls-files")
forbidden = sorted(path for path in tracked if path.startswith(FORBIDDEN_PREFIXES))
ignored = sorted(git_paths("ls-files", "-ci", "--exclude-standard"))
if forbidden or ignored:
    raise SystemExit(
        "local-only paths are tracked: "
        f"forbidden={forbidden[:20]} ignored={ignored[:20]}"
    )

print(f"Local-only path check passed for {len(tracked)} tracked files.")
