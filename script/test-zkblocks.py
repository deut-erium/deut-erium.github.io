#!/usr/bin/env python3
"""Check the replaceable zkblocks export and its blog integration contract."""

from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "_apps" / "zkblocks.html"
PAGE = ROOT / "zkblocks" / "index.html"
PLUGIN = ROOT / "_plugins" / "zkblocks_embed.rb"


class AppParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: list[str] = []
        self.tags: dict[str, int] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.tags[tag] = self.tags.get(tag, 0) + 1
        element_id = dict(attrs).get("id")
        if element_id:
            self.ids.append(element_id)


def fail(message: str) -> None:
    raise SystemExit(f"FAIL: {message}")


source = SOURCE.read_text(encoding="utf-8")
parser = AppParser()
parser.feed(source)
parser.close()

for tag, count in {"html": 1, "head": 1, "body": 1, "main": 1, "h1": 1}.items():
    if parser.tags.get(tag) != count:
        fail(f"standalone export must contain {count} {tag} element(s)")
if parser.tags.get("style", 0) < 2 or parser.tags.get("script", 0) < 1:
    fail("standalone export is missing embedded styles or scripts")
if len(parser.ids) != len(set(parser.ids)):
    fail("standalone export contains duplicate IDs")
for required in ("board", "newGame", "proofOptions", "embedded-runtime"):
    if required not in parser.ids:
        fail(f"standalone export is missing #{required}")
if "default-src 'none'" not in source or "base-uri 'none'" not in source or "form-action 'none'" not in source:
    fail("standalone export CSP safety floor changed")

page = PAGE.read_text(encoding="utf-8")
for required in (
    "permalink: /zkblocks/index.html",
    "analytics_path: /zkblocks/index.html",
    "{% zkblocks_embed %}",
    "/assets/css/features/zkblocks-host.css",
):
    if required not in page:
        fail(f"host page is missing {required}")

plugin = PLUGIN.read_text(encoding="utf-8")
if "html.rindex" not in plugin or "scope_css" not in plugin:
    fail("embedder must preserve the final script and scope app CSS")

print(
    f"PASS: /zkblocks/index.html contract "
    f"({parser.tags.get('script', 0)} scripts, {len(source.encode('utf-8'))} bytes)"
)
