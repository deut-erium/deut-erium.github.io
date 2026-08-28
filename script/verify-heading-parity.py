#!/usr/bin/env python3
"""Compare every authored ATX heading with its generated article heading."""

from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
import html
import re
import sys

SOURCE = Path(__file__).resolve().parents[1]
SITE = Path(sys.argv[1] if len(sys.argv) > 1 else "_site").resolve()
DATE_POST = re.compile(r"^(?P<year>\d{4}|\d{2})-(?P<month>\d{2})-(?P<day>\d{2})-(?P<slug>.+)\.md$", re.I)
EMOJI = {
    "smile": "😄", "wink": "😉", "heart": "❤️", "metal": "🤘", "flushed": "😳",
    "disappointed": "😞", "triumph": "😤", "expressionless": "😑", "sad": "😢",
    "grin": "😁", "stuck_out_tongue": "😛",
}


def normalize(value: str) -> str:
    value = re.sub(r"!\[([^]]*)\]\([^)]*\)", r"\1", value)
    value = re.sub(r"\[([^]]+)\]\([^)]*\)", r"\1", value)
    value = re.sub(r"<[^>]+>", "", value)
    value = re.sub(r"`+([^`]*)`+", r"\1", value)
    for name, character in EMOJI.items():
        value = value.replace(f":{name}:", character)
    for marker in ("**", "__", "~~", "*", "_"):
        value = value.replace(marker, "")
    value = html.unescape(value).strip().rstrip("#").strip()
    value = value.translate(str.maketrans({"“": '"', "”": '"', "’": "'", "–": "-", "—": "-", "…": "..."}))
    return " ".join(value.split()).casefold()


def source_headings(path: Path, section: str) -> list[tuple[int, str]]:
    headings: list[tuple[int, str]] = []
    fence: str | None = None
    for line in path.read_text(encoding="utf-8").splitlines():
        fence_match = re.match(r"^\s*(`{3,}|~{3,})", line)
        if fence_match:
            marker = fence_match.group(1)[0]
            fence = None if fence == marker else marker if fence is None else fence
            continue
        if fence:
            continue
        match = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
        if not match:
            continue
        level = len(match.group(1))
        if section in {"writeups", "ramblings"}:
            level = min(6, level + 1)
        headings.append((level, normalize(match.group(2))))
    return headings


class HeadingParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_article = False
        self.level: int | None = None
        self.text: list[str] = []
        self.headings: list[tuple[int, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = dict(attrs)
        if tag == "article" and data.get("id") == "article-body":
            self.in_article = True
        elif self.in_article and re.fullmatch(r"h[1-6]", tag):
            self.level = int(tag[1])
            self.text = []

    def handle_data(self, data: str) -> None:
        if self.level is not None:
            self.text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if self.level is not None and tag == f"h{self.level}":
            self.headings.append((self.level, normalize("".join(self.text))))
            self.level = None
        if tag == "article":
            self.in_article = False


def output_path(source: Path, match: re.Match[str], section: str) -> Path:
    rel = source.relative_to(SOURCE / "_posts")
    if section == "writeups":
        return SITE / "WriteUps" / Path(*rel.parts[1:]).with_suffix(".html")
    if section in {"ramblings", "tutorials"}:
        directory = "ramblings" if section == "ramblings" else "ctf-tutorials"
        year = match["year"] if len(match["year"]) == 4 else f"20{match['year']}"
        slug = re.sub(r"\s+", "-", match["slug"])
        return SITE / directory / year / match["month"] / match["day"] / f"{slug}.html"
    slug = re.sub(r"\s+", "-", match["slug"])
    return SITE / match["year"] / match["month"] / match["day"] / f"{slug}.html"


failures = []
pages = headings = 0
for source in sorted((SOURCE / "_posts").rglob("*.md")):
    match = DATE_POST.match(source.name)
    if not match:
        continue
    first = source.relative_to(SOURCE / "_posts").parts[0]
    section = "writeups" if first == "WriteUps" else "tutorials" if first == "ctf-tutorials" else "ramblings" if first == "ramblings" else "root"
    expected = source_headings(source, section)
    destination = output_path(source, match, section)
    if not destination.is_file():
        failures.append({"source": str(source.relative_to(SOURCE)), "error": "missing output"})
        continue
    parser = HeadingParser(); parser.feed(destination.read_text(encoding="utf-8")); parser.close()
    if parser.headings != expected:
        failures.append({"source": str(source.relative_to(SOURCE)), "expected": len(expected), "actual": len(parser.headings)})
    pages += 1
    headings += len(expected)

if failures:
    raise SystemExit(f"heading parity failed: {failures[:10]}")
print(f"Validated {headings} authored headings across {pages} posts.")
