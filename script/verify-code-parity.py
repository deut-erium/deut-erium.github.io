#!/usr/bin/env python3
"""Verify exact rendered source text for every imported WriteUps code block."""

from __future__ import annotations

import hashlib
import json
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else "_site").resolve() / "WriteUps"
MANIFEST = json.loads(Path(__file__).with_name("writeups-code-parity.json").read_text(encoding="utf-8"))


class Parser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.pre = 0
        self.code = 0
        self.current: list[str] | None = None
        self.blocks: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "pre":
            self.pre += 1
        elif tag == "code" and self.pre:
            self.code += 1
            if self.code == 1:
                self.current = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "code" and self.code:
            self.code -= 1
            if self.code == 0 and self.current is not None:
                self.blocks.append("".join(self.current))
                self.current = None
        elif tag == "pre" and self.pre:
            self.pre -= 1

    def handle_data(self, data: str) -> None:
        if self.code and self.current is not None:
            self.current.append(data)


def hashes(path: Path) -> list[str]:
    parser = Parser()
    parser.feed(path.read_text(encoding="utf-8"))
    parser.close()
    return [hashlib.sha256(text.encode("utf-8")).hexdigest() for text in parser.blocks]


failures = []
for route, expected in MANIFEST["routes"].items():
    path = ROOT / route
    if not path.is_file():
        failures.append({"route": route, "error": "missing"})
        continue
    actual = hashes(path)
    if actual != expected:
        failures.append({"route": route, "expected_blocks": len(expected), "actual_blocks": len(actual)})
if failures:
    raise SystemExit(f"code parity failed: {failures[:10]}")
print(json.dumps({"status": "pass", "pages": MANIFEST["pages"], "blocks": MANIFEST["blocks"]}, indent=2))
