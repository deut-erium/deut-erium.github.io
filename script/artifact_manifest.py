#!/usr/bin/env python3
"""Create a deterministic manifest for every entry in a generated site tree."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
from typing import Iterator


class ManifestError(RuntimeError):
    """The artifact tree contains an unsupported or unstable entry."""


def mode_text(mode: int) -> str:
    return f"{stat.S_IMODE(mode):04o}"


def hash_regular_file(path: Path, expected: os.stat_result) -> str:
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags)
    digest = hashlib.sha256()
    try:
        with os.fdopen(descriptor, "rb", closefd=False) as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        actual = os.fstat(descriptor)
    finally:
        os.close(descriptor)

    stable_fields = ("st_dev", "st_ino", "st_mode", "st_size", "st_mtime_ns")
    if any(getattr(actual, field) != getattr(expected, field) for field in stable_fields):
        raise ManifestError(f"file changed while hashing: {path}")
    if not stat.S_ISREG(actual.st_mode):
        raise ManifestError(f"entry stopped being a regular file: {path}")
    return digest.hexdigest()


def manifest_entries(root: Path) -> Iterator[dict[str, object]]:
    root = root.absolute()
    root_stat = root.lstat()
    if not stat.S_ISDIR(root_stat.st_mode):
        raise ManifestError(f"artifact root is not a directory: {root}")
    if stat.S_ISLNK(root_stat.st_mode):
        raise ManifestError(f"artifact root is a symbolic link: {root}")

    def visit(directory: Path, relative: Path) -> Iterator[dict[str, object]]:
        directory_stat = directory.lstat()
        if not stat.S_ISDIR(directory_stat.st_mode) or stat.S_ISLNK(directory_stat.st_mode):
            raise ManifestError(f"directory changed while walking: {directory}")
        yield {
            "mode": mode_text(directory_stat.st_mode),
            "path": relative.as_posix(),
            "type": "directory",
        }

        with os.scandir(directory) as scan:
            children = sorted(scan, key=lambda item: item.name)
        for child in children:
            path = Path(child.path)
            child_relative = relative / child.name if relative != Path(".") else Path(child.name)
            child_stat = child.stat(follow_symlinks=False)
            if stat.S_ISDIR(child_stat.st_mode):
                yield from visit(path, child_relative)
            elif stat.S_ISREG(child_stat.st_mode):
                yield {
                    "mode": mode_text(child_stat.st_mode),
                    "path": child_relative.as_posix(),
                    "sha256": hash_regular_file(path, child_stat),
                    "size": child_stat.st_size,
                    "type": "file",
                }
            else:
                kind = "symbolic link" if stat.S_ISLNK(child_stat.st_mode) else "special file"
                raise ManifestError(f"artifact contains {kind}: {child_relative.as_posix()}")

    yield from visit(root, Path("."))


def write_manifest(root: Path) -> None:
    for entry in manifest_entries(root):
        print(json.dumps(entry, ensure_ascii=True, separators=(",", ":"), sort_keys=True))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    args = parser.parse_args()
    try:
        write_manifest(args.root)
    except (ManifestError, OSError) as error:
        raise SystemExit(f"artifact manifest failed: {error}") from error


if __name__ == "__main__":
    main()
