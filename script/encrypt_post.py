#!/usr/bin/env python3
"""Encrypt a locked (argon) writeup for the blog.

The locked-post design, fixed:

  * cipher: AES-256-GCM; v2 authenticates the compact JSON header as AAD
  * key: PBKDF2-HMAC-SHA256(answer, salt_bytes, 200000 iterations, 32 bytes)
  * answer: the full flag string of the challenge named by `needs`
    (a chain entry may document a different key source in `key_answer`)
  * payload handed to the browser: base64(nonce[12] || ciphertext || tag[16])
  * wrong key => GCM authentication failure => generic "wrong key" only

Ciphertext lives in the repository; the plaintext must never be committed.
This script reads the plaintext from a file outside the repo tree (agent_out/
is gitignored) and writes a normal Jekyll post whose body is the locked
payload div rendered by assets/js/features/argon.js.

It also maintains _data/arg_chain.yml: {post, needs, salt, key_answer, version,
iterations}, with optional previous. --previous is a public predecessor route;
omitting it preserves an existing predecessor, and --previous='' removes it.
Other metadata uses the documented defaults on replacement. --force always
reencrypts the entire body with a fresh nonce (and salt unless --salt is given).
--legacy emits the original versionless, 120000-iteration format without AAD.
The chain editor accepts the producer's flat YAML records (plain or JSON-quoted
scalars); unsupported YAML must be converted before invoking this script.

Use --unlisted for later chain entries: they are standalone pages under
locked/, not posts. Only the first entry needs to be in _posts/.

Delivery: the default writes a dated post under _posts/. New dated posts and
producer-format unlisted followups are supported by the authoring gates;
existing imported files retain byte-exact integrity pins. --page writes a
standalone dated section page; it is not an integrity-check bypass.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
from datetime import date
import os
import re
import secrets
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CHAIN_FILE = REPO / "_data" / "arg_chain.yml"
LEGACY_ITERATIONS = 120_000
ITERATIONS = 200_000
KEY_BYTES = 32
NONCE_BYTES = 12
TAG_BYTES = 16
SALT_BYTES = 16
# Match the browser/plugin wire limit, including the nonce and GCM tag.
MAX_PLAINTEXT_BYTES = 24 * 1024 * 1024 - NONCE_BYTES - TAG_BYTES
POST_TEMPLATE = """---
title: "{title}"
tags: {tags}
description: "{description}"
layout: locked
mathjax: true
---

{teaser}

<!--more-->

<div class="argon" data-salt="{salt}" data-needs="{needs}" aria-live="polite">{payload}</div>
"""

PAGE_TEMPLATE = """---
title: "{title}"
date: {date}
section: {section}
tags: {tags}
description: "{description}"
layout: locked
mathjax: true
permalink: {route}
---

{teaser}

<!--more-->

<div class="argon" data-salt="{salt}" data-needs="{needs}" aria-live="polite">{payload}</div>
"""

UNLISTED_TEMPLATE = PAGE_TEMPLATE.replace(
    "permalink: {route}\n", "permalink: {route}\nunlisted: true\nsitemap: false\nnoindex: true\n"
).replace("{payload}</div>", "<span hidden>{payload}</span></div>") + (
    "\n<noscript><p>Enable JavaScript to unlock this article.</p></noscript>\n"
)


# Keep the original constants byte-for-byte compatible with structural fixtures.
POST_TEMPLATE_V2 = POST_TEMPLATE.replace('data-salt=', 'data-version="2" data-iterations="200000" data-salt=')
PAGE_TEMPLATE_V2 = PAGE_TEMPLATE.replace('data-salt=', 'data-version="2" data-iterations="200000" data-salt=')
UNLISTED_TEMPLATE_V2 = UNLISTED_TEMPLATE.replace('data-salt=', 'data-version="2" data-iterations="200000" data-salt=')
NEEDS_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}")


def envelope_aad(salt_hex: str, needs: str) -> bytes:
    return json.dumps(["deuterium-argon", 2, ITERATIONS, salt_hex.lower(), needs],
                      ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def load_backend():
    """Return an AES-256-GCM encrypt/decrypt pair from an available module."""
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError:
        pass
    else:
        return (
            lambda key, nonce, plaintext, aad=None: AESGCM(key).encrypt(nonce, plaintext, aad),
            lambda key, nonce, blob, aad=None: AESGCM(key).decrypt(nonce, blob, aad),
        ), "cryptography"
    try:
        from Cryptodome.Cipher import AES
    except ImportError:
        pass
    else:
        def enc(key, nonce, plaintext, aad=None):
            cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
            if aad is not None:
                cipher.update(aad)
            body, tag = cipher.encrypt_and_digest(plaintext)
            return body + tag

        def dec(key, nonce, blob, aad=None):
            cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
            if aad is not None:
                cipher.update(aad)
            return cipher.decrypt_and_verify(blob[:-16], blob[-16:])

        return (enc, dec), "Cryptodome"
    sys.exit(
        "error: no AES backend. Install `cryptography` or `pycryptodome` "
        "(pip install cryptography) and re-run; the stdlib has no AES-GCM."
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--plaintext", required=True, help=f"UTF-8 HTML body to encrypt, at most {MAX_PLAINTEXT_BYTES} bytes after embedding (keep it out of the repo)")
    answer = parser.add_mutually_exclusive_group(required=True)
    answer.add_argument("--answer", help="key material (visible in process arguments; prefer --answer-stdin)")
    answer.add_argument("--answer-stdin", action="store_true", help="read the key from one stdin line, at most 4096 characters")
    parser.add_argument("--embed-assets", action="store_true", help="embed local HTML assets in memory before encryption (no network)")
    parser.add_argument("--asset-root", type=Path, help="private asset tree for --embed-assets; / URLs map here (default: plaintext directory)")
    parser.add_argument("--embed-linked-files", action="store_true", help="with --embed-assets, also package local file hyperlinks as downloads")
    parser.add_argument("--max-asset-bytes", type=int, default=8*1024*1024, help="per-asset limit with --embed-assets")
    parser.add_argument("--max-output-bytes", type=int, default=16*1024*1024, help="bundled HTML limit with --embed-assets")
    parser.add_argument("--salt", help=f"hex-encoded {SALT_BYTES}-byte salt; random when omitted")
    parser.add_argument("--out", required=True, help="locked post file to write, e.g. _posts/ramblings/2026-09-05-the-first-door.md")
    parser.add_argument("--title", help="post title (default: slugified file name)")
    parser.add_argument("--tags", default="challenges crypto", help="space-separated tags (must already exist in the tag index)")
    parser.add_argument("--teaser", help="visible teaser paragraph written above the payload")
    parser.add_argument("--description", help="front-matter description (default: the teaser text)")
    parser.add_argument("--needs", default="", help="challenge id whose flag is the key, e.g. assignment000003-0; empty for a standalone lock")
    parser.add_argument("--legacy", action="store_true", help="emit versionless v1: 120000 iterations, no AAD (default: v2)")
    parser.add_argument("--previous", help="public dated predecessor route; omitted preserves existing value; empty clears it")
    parser.add_argument("--key-answer", default="flag", help="chain-file note describing the key source: 'flag' or free text")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--page", action="store_true", help="emit a section page (default: a dated post under _posts/)")
    mode.add_argument("--unlisted", action="store_true", help="emit a followup page under locked/YYYY/MM/DD/slug.md, outside all post lists")
    parser.add_argument("--section", default="ramblings", help="section for --page or --unlisted output")
    parser.add_argument("--force", action="store_true", help="overwrite an existing locked post")
    args = parser.parse_args()
    if args.unlisted:
        args.page = True
    if args.answer_stdin:
        args.answer = sys.stdin.readline(4098)
        if len(args.answer.rstrip("\r\n")) > 4096:
            parser.error("stdin answer exceeds 4096 characters")
        args.answer = args.answer.rstrip("\r\n")
    return args


def derive_key(answer: str, salt: bytes, iterations: int = ITERATIONS) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", answer.encode("utf-8"), salt, iterations, dklen=KEY_BYTES)


def route_for(out_path: Path, page_mode: bool) -> str:
    """Public route: /relative/path.html for pages, post rules under _posts/."""
    rel = out_path.relative_to(REPO)
    parts = rel.parts
    if page_mode:
        if parts[0] == "_posts":
            sys.exit("error: --page output must not live under _posts/")
        return "/" + rel.with_suffix(".html").as_posix()
    if not parts or parts[0] != "_posts":
        sys.exit(f"error: {rel} is not under _posts/; pass --page for section pages")
    match = re.fullmatch(r"(\d{4}|\d{2})-(\d{2})-(\d{2})-(.+)\.md", out_path.name, re.I)
    if not match:
        sys.exit(f"error: {out_path.name} is not a dated post file name")
    year = match[1] if len(match[1]) == 4 else f"20{match[1]}"
    slug = re.sub(r"\s+", "-", match[4])
    section = parts[1] if len(parts) > 2 else ""
    if section in {"ramblings", "ctf-tutorials"}:
        return f"/{section}/{year}/{match[2]}/{match[3]}/{slug}.html"
    if section == "WriteUps":
        # SectionMetadata preserves the full dated source path for writeups.
        return "/" + rel.relative_to("_posts").with_suffix(".html").as_posix()
    return f"/{year}/{match[2]}/{match[3]}/{slug}.html"


def validate_route(route: str) -> None:
    if (not isinstance(route, str) or len(route) > 2048 or
            not re.fullmatch(r"/(?:[A-Za-z0-9][A-Za-z0-9_.-]*/)*[A-Za-z0-9][A-Za-z0-9_.-]*\.html", route)):
        raise ValueError("chain routes must be safe site-relative dated .html paths")
    match = (re.search(r"/([0-9]{4})/([0-9]{2})/([0-9]{2})/[^/]+\.html$", route) or
             re.search(r"/([0-9]{4})-([0-9]{2})-([0-9]{2})-[^/]+\.html$", route))
    if not match:
        raise ValueError("chain route needs a date")
    date(*(int(part) for part in match.groups()))


def safe_output(path: Path) -> None:
    relative = path.relative_to(REPO)
    if ".." in relative.parts:
        raise ValueError("output path contains traversal")
    current = REPO
    for part in relative.parts:
        current /= part
        if current.is_symlink():
            raise ValueError("output path contains a symlink")
    if path.exists() and (not path.is_file() or path.stat().st_nlink != 1):
        raise ValueError("output must be a regular, non-hard-linked file")


def read_chain(text: str) -> tuple[dict, dict]:
    """Parse only the maintained flat YAML subset; retain original record spans."""
    records, spans, record, start, offset = {}, {}, None, 0, 0

    def finish(end):
        if record is not None:
            route = record.get("post")
            validate_route(route)
            if route in records:
                raise ValueError("duplicate chain route")
            records[route], spans[route] = record, (start, end)

    for line in text.splitlines(keepends=True):
        if line.strip() and not line.lstrip().startswith("#"):
            match = re.fullmatch(r"(- post|  [a-z_]+):(?: (.*))?\r?\n?", line)
            if not match:
                raise ValueError("unsupported chain YAML; use flat producer records")
            field, value = match[1], (match[2] or "").strip()
            if field == "- post":
                finish(offset)
                record, start, field = {}, offset, "post"
            if record is None or field.strip() in record:
                raise ValueError("missing record or duplicate chain field")
            field = field.strip()
            if value.startswith('"'):
                value = json.loads(value)
            elif value in ("", "null", "~"):
                value = None
            elif field in ("version", "iterations"):
                value = int(value)
            elif not re.fullmatch(r"[A-Za-z0-9_./-]+", value):
                raise ValueError("unsupported chain scalar; use JSON-quoted text")
            record[field] = value
        offset += len(line)
    finish(offset)
    return records, spans


def validate_chain(records: dict) -> None:
    for route, row in records.items():
        validate_route(route)
        if set(row) - {"post", "needs", "salt", "key_answer", "previous", "version", "iterations"}:
            raise ValueError("unknown chain field")
        needs = row.get("needs")
        if needs is not None and (not isinstance(needs, str) or (needs and not NEEDS_PATTERN.fullmatch(needs))):
            raise ValueError("needs must be an ID of 1-128 ASCII letters, digits, underscores or hyphens, or empty")
        if not isinstance(row.get("salt"), str) or not re.fullmatch(r"[0-9a-fA-F]{32}", row["salt"]):
            raise ValueError("chain salt must be 32 hex characters")
        version = row.get("version", 1)
        iterations = row.get("iterations", LEGACY_ITERATIONS if version == 1 else None)
        if type(version) is not int or type(iterations) is not int or (version, iterations) not in ((1, LEGACY_ITERATIONS), (2, ITERATIONS)):
            raise ValueError("unsupported chain version/iterations")
        if "key_answer" in row and not isinstance(row["key_answer"], str):
            raise ValueError("key_answer must be a string")
        previous = row.get("previous")
        if previous is not None:
            validate_route(previous)
            if previous not in records:
                raise ValueError("missing chain predecessor")
    visited = set()
    for route in records:
        active = set()
        while route is not None and route not in visited:
            if route in active:
                raise ValueError("chain cycle")
            active.add(route)
            route = records[route].get("previous")
        visited.update(active)


def prepare_chain(route: str, needs: str, salt_hex: str, key_answer: str,
                  previous: str | None = None, version: int = 2) -> str:
    """Validate the full proposed chain before either public file is written."""
    safe_output(CHAIN_FILE)
    text = CHAIN_FILE.read_text(encoding="utf-8") if CHAIN_FILE.is_file() else (
        "# ARG chain of locked writeups, maintained by script/encrypt_post.py.\n"
        "# needs = challenge id (or null); its flag is the AES key for post.\n")
    records, spans = read_chain(text)
    validate_chain(records)
    if previous is None:
        previous = records.get(route, {}).get("previous")
    row = {"post": route, "needs": needs or None, "salt": salt_hex, "key_answer": key_answer}
    if version != 1:
        row.update(version=version, iterations=ITERATIONS)
    if previous:
        row["previous"] = previous
    records[route] = row
    validate_chain(records)
    entry = "- post: " + route + "\n" + "".join(
        f"  {field}: {json.dumps(value, ensure_ascii=True)}\n" for field, value in row.items() if field != "post")
    if route in spans:
        start, end = spans[route]
        # Preserve standalone comments and whitespace outside replaced fields.
        comments = "".join(line for line in text[start:end].splitlines(keepends=True)
                           if not line.strip() or line.lstrip().startswith("#"))
        return text[:start] + entry + comments + text[end:]
    return text.rstrip("\n") + "\n" + entry


def update_chain(route: str, needs: str, salt_hex: str, key_answer: str,
                 previous: str | None = None, version: int = 2) -> None:
    text = prepare_chain(route, needs, salt_hex, key_answer, previous, version)
    CHAIN_FILE.parent.mkdir(parents=True, exist_ok=True)
    CHAIN_FILE.write_text(text, encoding="utf-8")


def main() -> None:
    args = parse_args()
    plaintext_file = Path(args.plaintext)
    if not plaintext_file.is_file():
        sys.exit(f"error: plaintext file not found: {plaintext_file}")
    input_locations = (Path(os.path.abspath(plaintext_file)), plaintext_file.resolve(),
                       plaintext_file.parent.resolve() / plaintext_file.name)
    if any(path.is_relative_to(REPO) and not path.is_relative_to(REPO / "agent_out")
           for path in input_locations):
        sys.exit("error: refuse to read plaintext from inside the repository (agent_out/ is the scratch area)")
    out_path = Path(args.out)
    if not out_path.is_absolute():
        out_path = REPO / out_path
    if out_path.exists() and not args.force:
        sys.exit(f"error: {out_path} already exists (use --force to rewrite)")
    if args.unlisted:
        allowed = REPO / "locked"
        if not (Path(os.path.abspath(out_path)).is_relative_to(allowed)
                and out_path.resolve().is_relative_to(allowed)):
            sys.exit("error: --unlisted output must be under locked/YYYY/MM/DD/slug.md")
    elif Path(os.path.abspath(out_path)).is_relative_to(REPO / "locked"):
        sys.exit("error: output under locked/ requires --unlisted")

    try:
        safe_output(out_path)
        if args.needs and not NEEDS_PATTERN.fullmatch(args.needs):
            raise ValueError("--needs must be an ID of 1-128 ASCII letters, digits, underscores or hyphens")
        route = route_for(out_path, args.page)
        validate_route(route)
    except ValueError as error:
        sys.exit(f"error: {error}")
    salt_hex = args.salt if args.salt is not None else secrets.token_hex(SALT_BYTES)
    if not re.fullmatch(r"[0-9a-fA-F]{32}", salt_hex):
        sys.exit("error: --salt must be exactly 32 hex characters")
    salt_hex = salt_hex.lower()
    salt = bytes.fromhex(salt_hex)
    if not args.answer.strip():
        sys.exit("error: unlock key is empty")
    # The browser trims the key and uses a single-line text input.
    if (args.answer != args.answer.strip() or args.answer.startswith("\ufeff")
            or args.answer.endswith("\ufeff") or "\r" in args.answer or "\n" in args.answer):
        sys.exit("error: unlock key must be one line without surrounding whitespace (the browser trims it)")

    bundled = None
    if (args.asset_root is not None or args.embed_linked_files) and not args.embed_assets:
        sys.exit("error: asset options require --embed-assets")
    if args.embed_assets:
        from embed_post_assets import BundleError, bundle_file
        try:
            bundled = bundle_file(plaintext_file, asset_root=args.asset_root,
                                  linked_files=args.embed_linked_files,
                                  max_asset_bytes=args.max_asset_bytes,
                                  max_output_bytes=args.max_output_bytes)
        except (BundleError, OSError, ValueError) as error:
            sys.exit(f"error: asset embedding failed: {error}")
        plaintext = bundled.html.encode("utf-8")
    else:
        with plaintext_file.open("rb") as source:
            plaintext = source.read(MAX_PLAINTEXT_BYTES + 1)
    # Validate the final bytes in both modes before key derivation or writes.
    # --max-output-bytes cannot override the receiver's envelope size ceiling.
    if len(plaintext) > MAX_PLAINTEXT_BYTES:
        sys.exit(f"error: plaintext exceeds the {MAX_PLAINTEXT_BYTES}-byte limit (24 MiB including nonce and tag)")
    try:
        plaintext.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        sys.exit("error: plaintext HTML must use UTF-8")
    if not plaintext.strip():
        sys.exit("error: plaintext file is empty")

    (encrypt, decrypt), backend = load_backend()
    iterations = LEGACY_ITERATIONS if args.legacy else ITERATIONS
    aad = None if args.legacy else envelope_aad(salt_hex, args.needs)
    key = derive_key(args.answer, salt, iterations)
    nonce = os.urandom(NONCE_BYTES)
    blob = encrypt(key, nonce, plaintext, aad)  # ciphertext || tag
    assert plaintext == bytes(decrypt(key, nonce, blob, aad)), "self-test failed: roundtrip mismatch"
    payload = base64.b64encode(nonce + blob).decode("ascii")

    slug = re.sub(r"^\d{2,4}-\d{2}-\d{2}-", "", out_path.with_suffix("").name).replace("-", " ")
    title = args.title or slug
    teaser = args.teaser or "This writeup is locked. Bring the key from the previous challenge in the chain."
    description = (args.description or re.sub(r"<[^>]+>", "", teaser)).strip()

    body = (POST_TEMPLATE if args.legacy else POST_TEMPLATE_V2).format(
        title=title.replace('"', "'"),
        tags=" ".join(args.tags.split()),
        description=description.replace('"', "'"),
        teaser=teaser.strip(),
        salt=salt_hex,
        needs=args.needs,
        payload=payload,
    )
    if args.page:
        rel = out_path.relative_to(REPO).as_posix()
        match = re.fullmatch(r"(?:.+/)?(?P<year>\d{4}|\d{2})/(?P<month>\d{2})/(?P<day>\d{2})/(?P<slug>.+)\.md", rel, re.I)
        if not match:
            sys.exit(f"error: {rel} does not follow .../year/month/day/slug.md (the page route needs a date)")
        year = match["year"] if len(match["year"]) == 4 else f"20{match['year']}"
        template = (UNLISTED_TEMPLATE if args.unlisted else PAGE_TEMPLATE) if args.legacy else (
            UNLISTED_TEMPLATE_V2 if args.unlisted else PAGE_TEMPLATE_V2)
        body = template.format(
            title=title.replace('"', "'"),
            date=f"{year}-{match['month']}-{match['day']}",
            section=args.section,
            tags=" ".join(args.tags.split()),
            description=description.replace('"', "'"),
            route=route,
            teaser=teaser.strip(),
            salt=salt_hex,
            needs=args.needs,
            payload=payload,
        )

    try:
        chain_text = prepare_chain(route, args.needs, salt_hex, args.key_answer,
                                   args.previous, 1 if args.legacy else 2)
    except (ValueError, OSError) as error:
        sys.exit(f"error: chain validation failed: {error}")
    # All path, metadata, plaintext and crypto checks precede public writes.
    CHAIN_FILE.parent.mkdir(parents=True, exist_ok=True)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(body, encoding="utf-8")
    CHAIN_FILE.write_text(chain_text, encoding="utf-8")

    print(f"locked post : {out_path.relative_to(REPO)}")
    print(f"route       : {route}")
    print(f"cipher      : AES-256-GCM via {backend}, PBKDF2-SHA256 x{iterations}, salt {salt_hex}")
    print(f"payload     : {len(plaintext)} plaintext bytes -> {len(payload)} base64 chars")
    if bundled is not None:
        print(f"assets      : {len(bundled.assets)} local asset reads embedded; {bundled.retained_links} ordinary links retained")
        print("Original files are unchanged. Embedding does not remove public copies.")


if __name__ == "__main__":
    main()
