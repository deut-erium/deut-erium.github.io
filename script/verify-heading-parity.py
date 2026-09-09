#!/usr/bin/env python3
"""Compare every authored ATX heading with its generated article heading."""

from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
import html
import json
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
    comment = False
    for line in path.read_text(encoding="utf-8").splitlines():
        if comment:
            if "-->" in line:
                comment = False
            continue
        if "<!--" in line and "-->" not in line:
            comment = True
            continue
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

    # The build keeps every heading's text and order, then clamps only levels
    # that would skip past the next available section depth below the page H1.
    normalized: list[tuple[int, str]] = []
    previous = 1
    for level, text in headings:
        level = min(level, previous + 1)
        normalized.append((level, text))
        previous = level
    return normalized


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


def fail(message: str) -> None:
    raise SystemExit(f"FAIL: {message}")


def registered_challenge_routes() -> dict[str, str]:
    """Read the narrow post-path override registry, not arbitrary permalinks."""
    entries = json.loads((SOURCE / "_data/authored_challenges.json").read_text(encoding="utf-8"))["entries"]
    routes: dict[str, str] = {}
    for entry in entries:
        path, url = entry.get("post_path"), entry.get("url")
        valid_path = isinstance(path, str) and re.fullmatch(r"_posts/ctf-tutorials/challenges/[^/\\]+\.md", path)
        if not valid_path or not DATE_POST.fullmatch(Path(path).name):
            fail(f"invalid registered challenge post path: {path}")
        if not isinstance(url, str) or not re.fullmatch(r"/challenges/[a-z0-9-]+/[a-z0-9-]+/", url):
            fail(f"invalid registered challenge URL: {url}")
        if url != f"/challenges/{entry.get('event_id')}/{entry.get('slug')}/":
            fail(f"registered challenge event/slug route mismatch: {path}")
        if path in routes or url in routes.values():
            fail(f"duplicate registered challenge route: {path}")
        if not (SOURCE / path).is_file():
            fail(f"registered challenge post missing: {path}")
        routes[path] = url
    members = {path.relative_to(SOURCE).as_posix() for path in (SOURCE / "_posts/ctf-tutorials/challenges").rglob("*.md")}
    if set(routes) != members:
        fail("registered challenge post membership drift")
    return routes


def post_output_path(route: str) -> str:
    """Convert a canonical post route to a build-relative file path."""
    return route.lstrip("/") + ("index.html" if route.endswith("/") else "")


def output_path(source: Path, match: re.Match[str], section: str, registered: dict[str, str]) -> Path:
    path = source.relative_to(SOURCE).as_posix()
    if path in registered:
        # The catalog holds canonical routes; heading parity reads build files.
        return SITE / post_output_path(registered[path])
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


registered = registered_challenge_routes()
failures = []
pages = headings = 0
for source in sorted((SOURCE / "_posts").rglob("*.md")):
    match = DATE_POST.match(source.name)
    if not match:
        continue
    first = source.relative_to(SOURCE / "_posts").parts[0]
    section = "writeups" if first == "WriteUps" else "tutorials" if first == "ctf-tutorials" else "ramblings" if first == "ramblings" else "root"
    expected = source_headings(source, section)
    destination = output_path(source, match, section, registered)
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
