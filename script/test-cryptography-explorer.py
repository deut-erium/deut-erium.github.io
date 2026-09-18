#!/usr/bin/env python3
"""Check the replaceable source contract for the cryptography explorer."""

from html.parser import HTMLParser
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "_explorations" / "cryptography.html"
PAGE = ROOT / "cryptography" / "index.html"
PLUGIN = ROOT / "_plugins" / "cryptography_explorer.rb"


class ExplorerParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: list[str] = []
        self.details = 0
        self.searchable_details = 0
        self.outlines = 0
        self.scripts = 0
        self.styles = 0
        self.bodies = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = dict(attrs)
        if data.get("id"):
            self.ids.append(data["id"] or "")
        if tag == "details":
            self.details += 1
            if data.get("data-search") is not None:
                self.searchable_details += 1
        elif tag == "main" and data.get("id") == "outline":
            self.outlines += 1
        elif tag == "script":
            self.scripts += 1
        elif tag == "style":
            self.styles += 1
        elif tag == "body":
            self.bodies += 1


def fail(message: str) -> None:
    raise SystemExit(f"FAIL: {message}")


source = SOURCE.read_text(encoding="utf-8")
parser = ExplorerParser()
parser.feed(source)
parser.close()

if parser.bodies != 1 or parser.outlines != 1:
    fail("source must be one standalone page containing main#outline")
if parser.details == 0 or parser.searchable_details != parser.details:
    fail("every explorer details element must have data-search")
if len(parser.ids) != len(set(parser.ids)):
    fail("source contains duplicate IDs")
for required in ("search", "clear", "collapse", "empty", "outline"):
    if required not in parser.ids:
        fail(f"source is missing #{required}")
if parser.scripts != 1 or parser.styles != 1:
    fail("standalone export must contain one style and one script")

page = PAGE.read_text(encoding="utf-8")
if "permalink: /cryptography/" not in page:
    fail("public route changed")
if page.count("{% cryptography_explorer %}") != 1:
    fail("page must embed the explorer exactly once")
if not (ROOT / "assets/css/features/cryptography-explorer.css").is_file():
    fail("theme stylesheet is missing")
if not (ROOT / "assets/js/cryptography-explorer.js").is_file():
    fail("explorer runtime is missing")

plugin = PLUGIN.read_text(encoding="utf-8")
if "_explorations', 'cryptography.html" not in plugin:
    fail("plugin no longer reads the replaceable source")
if not re.search(r"body\.gsub\(.+?<script", plugin, re.S):
    fail("plugin must discard source scripts")

print(
    f"PASS: /cryptography/ source contract "
    f"({parser.details} searchable entries, {len(source.encode('utf-8'))} bytes)"
)
