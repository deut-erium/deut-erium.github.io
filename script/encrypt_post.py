#!/usr/bin/env python3
"""Encrypt a locked (argon) writeup for the blog.

The locked-post design, fixed:

  * cipher: AES-256-GCM, no AAD
  * key: PBKDF2-HMAC-SHA256(answer, salt_bytes, 120000 iterations, 32 bytes)
  * answer: the full flag string of the challenge named by `needs`
    (a chain entry may document a different key source in `key_answer`)
  * payload handed to the browser: base64(nonce[12] || ciphertext || tag[16])
  * wrong key => GCM authentication failure => generic "wrong key" only

Ciphertext lives in the repository; the plaintext must never be committed.
This script reads the plaintext from a file outside the repo tree (agent_out/
is gitignored) and writes a normal Jekyll post whose body is the locked
payload div rendered by assets/js/features/argon.js.

It also maintains _data/arg_chain.yml: one {post, needs, salt} entry per
locked post (plus an optional key_answer note) for future tooling.

Delivery: the default writes a dated post under _posts/. The site's content
integrity gate (script/verify-imported-content.py) pins every file under
_posts/ to a byte-exact manifest, so --page writes the same locked body as a
section page at the same route instead; both render through layout: locked.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import os
import re
import secrets
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CHAIN_FILE = REPO / "_data" / "arg_chain.yml"
ITERATIONS = 120_000
KEY_BYTES = 32
NONCE_BYTES = 12
SALT_BYTES = 16
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

def load_backend():
    """Return an AES-256-GCM encrypt/decrypt pair from an available module."""
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError:
        pass
    else:
        return (
            lambda key, nonce, plaintext: AESGCM(key).encrypt(nonce, plaintext, None),
            lambda key, nonce, blob: AESGCM(key).decrypt(nonce, blob, None),
        ), "cryptography"
    try:
        from Cryptodome.Cipher import AES
    except ImportError:
        pass
    else:
        def enc(key, nonce, plaintext):
            return AES.new(key, AES.MODE_GCM, nonce=nonce).encrypt_and_digest(plaintext)

        def dec(key, nonce, blob):
            body, tag = blob[:-16], blob[-16:]
            return AES.new(key, AES.MODE_GCM, nonce=nonce).decrypt_and_verify(body, tag)

        return (enc, dec), "Cryptodome"
    sys.exit(
        "error: no AES backend. Install `cryptography` or `pycryptodome` "
        "(pip install cryptography) and re-run; the stdlib has no AES-GCM."
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--plaintext", required=True, help="file with the HTML body to encrypt (keep it out of the repo)")
    parser.add_argument("--answer", required=True, help="key material, usually the full previous flag, e.g. 'flag{...}'")
    parser.add_argument("--salt", help=f"hex-encoded {SALT_BYTES}-byte salt; random when omitted")
    parser.add_argument("--out", required=True, help="locked post file to write, e.g. _posts/ramblings/2026-09-05-the-first-door.md")
    parser.add_argument("--title", help="post title (default: slugified file name)")
    parser.add_argument("--tags", default="challenges crypto", help="space-separated tags (must already exist in the tag index)")
    parser.add_argument("--teaser", help="visible teaser paragraph written above the payload")
    parser.add_argument("--description", help="front-matter description (default: the teaser text)")
    parser.add_argument("--needs", default="", help="challenge id whose flag is the key, e.g. assignment000003-0; empty for a standalone lock")
    parser.add_argument("--key-answer", default="flag", help="chain-file note describing the key source: 'flag' or free text")
    parser.add_argument("--page", action="store_true", help="emit a section page (default: a dated post under _posts/)")
    parser.add_argument("--section", default="ramblings", help="section for --page output")
    parser.add_argument("--force", action="store_true", help="overwrite an existing locked post")
    return parser.parse_args()


def derive_key(answer: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", answer.encode("utf-8"), salt, ITERATIONS, dklen=KEY_BYTES)


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
        return "/" + "/".join(parts[2:-1] + [f"{slug}.html"])
    return f"/{year}/{match[2]}/{match[3]}/{slug}.html"

def update_chain(route: str, needs: str, salt_hex: str, key_answer: str) -> None:
    entry = f"- post: {route}\n  needs: {needs or 'null'}\n  salt: {salt_hex}\n  key_answer: {key_answer}\n"
    if not CHAIN_FILE.is_file():
        CHAIN_FILE.write_text(
            "# ARG chain of locked writeups, maintained by script/encrypt_post.py.\n"
            "# needs = challenge id (or null); its flag is the AES key for post.\n"
            + entry,
            encoding="utf-8",
        )
        return
    text = CHAIN_FILE.read_text(encoding="utf-8")
    pattern = re.compile(r"(?ms)^- post: " + re.escape(route) + r"\n(?:  .*\n)+")
    if pattern.search(text):
        text = pattern.sub(entry, text)
    else:
        text = text.rstrip("\n") + "\n" + entry
    CHAIN_FILE.write_text(text, encoding="utf-8")


def main() -> None:
    args = parse_args()
    plaintext_file = Path(args.plaintext)
    if not plaintext_file.is_file():
        sys.exit(f"error: plaintext file not found: {plaintext_file}")
    if plaintext_file.resolve().is_relative_to(REPO) and "agent_out" not in plaintext_file.parts:
        sys.exit("error: refuse to read plaintext from inside the repository (agent_out/ is the scratch area)")
    out_path = Path(args.out)
    if not out_path.is_absolute():
        out_path = REPO / out_path
    if out_path.exists() and not args.force:
        sys.exit(f"error: {out_path} already exists (use --force to rewrite)")

    salt_hex = args.salt or secrets.token_hex(SALT_BYTES)
    try:
        salt = bytes.fromhex(salt_hex)
    except ValueError:
        sys.exit("error: --salt must be hex")
    if len(salt) != SALT_BYTES:
        sys.exit(f"error: --salt must be {SALT_BYTES} bytes ({SALT_BYTES * 2} hex chars)")
    if not args.answer.strip():
        sys.exit("error: --answer is empty")

    plaintext = plaintext_file.read_bytes()
    if not plaintext.strip():
        sys.exit("error: plaintext file is empty")

    (encrypt, decrypt), backend = load_backend()
    key = derive_key(args.answer, salt)
    nonce = os.urandom(NONCE_BYTES)
    blob = encrypt(key, nonce, plaintext)  # ciphertext || tag
    assert plaintext == bytes(decrypt(key, nonce, blob)), "self-test failed: roundtrip mismatch"
    payload = base64.b64encode(nonce + blob).decode("ascii")

    slug = re.sub(r"^\d{2,4}-\d{2}-\d{2}-", "", out_path.with_suffix("").name).replace("-", " ")
    title = args.title or slug
    teaser = args.teaser or "This writeup is locked. Bring the key from the previous challenge in the chain."
    description = (args.description or re.sub(r"<[^>]+>", "", teaser)).strip()

    route = route_for(out_path, args.page)
    body = POST_TEMPLATE.format(
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
        body = PAGE_TEMPLATE.format(
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
    else:
        body += ""

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(body, encoding="utf-8")
    update_chain(route, args.needs, salt_hex, args.key_answer)

    print(f"locked post : {out_path.relative_to(REPO)}")
    print(f"route       : {route}")
    print(f"cipher      : AES-256-GCM via {backend}, PBKDF2-SHA256 x{ITERATIONS}, salt {salt_hex}")
    print(f"payload     : {len(plaintext)} plaintext bytes -> {len(payload)} base64 chars")


if __name__ == "__main__":
    main()
