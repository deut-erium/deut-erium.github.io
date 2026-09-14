#!/usr/bin/env python3
"""Verify imported authored content and attachments against their recorded bytes."""

from __future__ import annotations

import base64
import binascii
from datetime import date
import hashlib
import json
import re
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = Path(__file__).with_name("imported-content-manifest.json")
COMMIT = re.compile(r"^[0-9a-f]{40}$")

DATED_POST = re.compile(r"(?:\d{4}|\d{2})-\d{2}-\d{2}-.+\.(?:md|markdown)", re.I)
UNLISTED_PATH = re.compile(
    r"locked/(?P<year>[0-9]{4})/(?P<month>[0-9]{2})/(?P<day>[0-9]{2})/"
    r"[a-zA-Z0-9][a-zA-Z0-9_-]*\.md"
)
# A narrow producer-format check, not a YAML parser or an encryption verifier.
# Keep the explicit flags and hidden payload from encrypt_post.py --unlisted.
# Jekyll's UnlistedPages hook still validates visibility and output collisions.
UNLISTED_PAGE = re.compile(
    r'---\n'
    r'title: "[^"\\\x00-\x1f]*"\n'
    r'date: (?P<date>[0-9]{4}-[0-9]{2}-[0-9]{2})\n'
    r'section: [a-zA-Z0-9_-]+\n'
    r'tags: [^\n]*\n'
    r'description: "[^"\\\x00-\x1f]*"\n'
    r'layout: locked\n'
    r'mathjax: true\n'
    r'permalink: (?P<route>/locked/[^\n]+\.html)\n'
    r'unlisted: true\n'
    r'sitemap: false\n'
    r'noindex: true\n'
    r'---\n\n'
    r'(?P<teaser>.+?)\n\n<!--more-->\n\n'
    r'<div class="argon" '
    r'(?P<v2>data-version="2" data-iterations="200000" )?'
    r'data-salt="(?P<salt>[0-9a-fA-F]{32})" '
    r'data-needs="(?P<needs>[^"><\n]*)" aria-live="polite">'
    r'<span hidden>(?P<payload>[A-Za-z0-9+/]+={0,2})</span></div>\n\n'
    r'<noscript><p>Enable JavaScript to unlock this article\.</p></noscript>\n',
    re.S,
)


def under(path: str, roots: tuple[str, ...]) -> bool:
    return any(path == name or path.startswith(name + "/") for name in roots)


def public_path(rel: str) -> bool:
    # Reject local scratch and private-looking additions without reading them.
    parts = Path(rel).parts[1:]
    reserved = {"private", "secrets", "flags", "agent_out", "node_modules", "vendor"}
    return all(not part.startswith((".", "_")) and part.lower() not in reserved and
               not part.endswith(("~", ".swp", ".bak")) for part in parts)


def unlisted_page(root: Path, rel: str) -> bool:
    """Accept the producer's envelope shape; no key or GCM tag is verified.

    The teaser is deliberately public and may contain Markdown or HTML. A
    matching envelope cannot prove that it, or the encoded bytes, is secret.
    Handwritten YAML variants are outside this additive exception.
    """
    path = UNLISTED_PATH.fullmatch(rel)
    if not path or not public_path(rel):
        return False
    try:
        day = date(*(int(path[name]) for name in ("year", "month", "day")))
        text = (root / rel).read_text(encoding="utf-8")
    except (ValueError, OSError):
        return False
    page = UNLISTED_PAGE.fullmatch(text)
    if not page or not page["teaser"].strip():
        return False
    if page["v2"] and page["needs"] and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", page["needs"]):
        return False
    if page["date"] != day.isoformat() or page["route"] != "/" + rel.removesuffix(".md") + ".html":
        return False
    try:
        payload = base64.b64decode(page["payload"], validate=True)
    except binascii.Error:
        return False
    # AES-GCM envelope: nonce[12] || ciphertext || tag[16]. Require canonical
    # base64 too: validate=True alone accepts nonzero padding bits.
    return len(payload) >= 12 + 16 and base64.b64encode(payload).decode("ascii") == page["payload"]


def verify(root: Path = ROOT, manifest_path: Path = MANIFEST) -> dict:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
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
        path = root / rel
        if not path.is_file() or any(part.is_symlink() for part in [path, *path.parents]):
            missing.append(rel)
            continue
        data = path.read_bytes()
        if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
            changed.append(rel)

    protected_roots = ("_posts", "locked", "challenges", "assets/challenges", "assigments", "ctf-tutorials/assigments")
    closed_roots = (*protected_roots[1:], "_posts/ctf-tutorials/challenges")
    private_local_prefixes = ("assigments/flags/",)
    if any(rel.startswith(private_local_prefixes) for rel in expected):
        raise SystemExit("private local content must not appear in the imported-content manifest")
    actual_protected = set()
    for root_name in protected_roots:
        folder = root / root_name
        for path in [folder, *folder.rglob("*")]:
            rel = path.relative_to(root).as_posix()
            if rel.startswith(private_local_prefixes):
                continue
            if path.is_symlink() or (path.exists() and not path.is_file() and not path.is_dir()):
                raise SystemExit(f"content integrity failed: unsafe file: {rel}")
            if path.is_file():
                actual_protected.add(rel)
    expected_protected = {rel for rel in expected if under(rel, protected_roots)}
    additions = actual_protected - expected_protected
    # New root posts do not register _posts itself as a public attachment
    # directory. Sidecars need their own new directory with an ordinary post;
    # all existing pins and the archive's closed inventories remain mandatory.
    posts = {rel for rel in additions if under(rel, ("_posts",)) and
             not under(rel, closed_roots) and public_path(rel) and
             DATED_POST.fullmatch(Path(rel).name) and
             re.match(r"\A---\r?\n", (root / rel).read_text(encoding="utf-8"))}
    historical_dirs = {str(parent) for rel in expected for parent in Path(rel).parents}
    attachment_dirs = {str(Path(rel).parent) for rel in posts} - historical_dirs - {"_posts"}
    assets = {rel for rel in additions - posts if public_path(rel) and
              not under(rel, closed_roots) and str(Path(rel).parent) in attachment_dirs and
              Path(rel).suffix.lower() not in {".md", ".markdown", ".html", ".htm"}}
    # Only unpinned producer-shaped pages get the locked/ exception. Existing
    # locked pins above are still byte-exact, and no sidecar directory is opened.
    unlisted = {rel for rel in additions if under(rel, ("locked",)) and unlisted_page(root, rel)}
    added = sorted(additions - posts - assets - unlisted)
    uncovered = sorted(expected_protected - actual_protected)
    if missing or changed or added or uncovered:
        raise SystemExit(
            "content integrity failed: "
            f"missing={missing[:10]} changed={changed[:10]} added={added[:10]} uncovered={uncovered[:10]}"
        )
    return {
        "status": "pass", "files": len(expected), "sections": section_counts,
        "protected_roots": list(protected_roots),
        "new_posts": len(posts), "new_postfiles": len(assets),
        "new_unlisted_pages": len(unlisted),
    }


if __name__ == "__main__":
    print(json.dumps(verify(), indent=2))
