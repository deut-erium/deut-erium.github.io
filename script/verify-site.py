#!/usr/bin/env python3
"""Validate the unified root, WriteUps, tutorials, Ramblings, and static app."""

from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
import gzip
import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else "_site").resolve()
SOURCE = Path(__file__).resolve().parents[1]
HISTORICAL = json.loads(Path(__file__).with_name("historical-html-paths.json").read_text(encoding="utf-8"))
CONTENT = json.loads(Path(__file__).with_name("imported-content-manifest.json").read_text(encoding="utf-8"))
STATIC_APP = json.loads(Path(__file__).with_name("static-app-manifest.json").read_text(encoding="utf-8"))
DATE_POST = re.compile(r"^(?:\d{4})-\d{2}-\d{2}-.+\.(?:md|markdown)$", re.I)
TRACKERS = (
    "googletagmanager.com", "google-analytics.com", "ajax.googleapis.com",
    "cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com", "gitalk",
)


def fail(message: str) -> None:
    raise SystemExit(f"FAIL: {message}")


class Audit(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = self.h1 = self.main = self.description = self.canonical = 0
        self.ids: list[str] = []
        self.local: list[str] = []
        self.external_resources: list[str] = []
        self.handlers: list[str] = []
        self.bad_images: list[str] = []
        self.forms = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = dict(attrs)
        if tag == "title": self.title += 1
        if tag == "h1": self.h1 += 1
        if tag == "main": self.main += 1
        if tag == "meta" and data.get("name") == "description": self.description += 1
        if tag == "link" and data.get("rel") == "canonical": self.canonical += 1
        if data.get("id"): self.ids.append(data.get("id") or "")
        self.handlers.extend(name for name in data if name.lower().startswith("on"))
        if tag == "form" and "data-flag-check" in data: self.forms += 1
        if tag == "img" and (not data.get("src") or not data.get("alt") or not data.get("width") or not data.get("height")):
            self.bad_images.append(data.get("src") or "<missing>")

        refs = []
        if tag in {"a", "link"} and data.get("href"): refs.append(data["href"] or "")
        if tag in {"script", "img", "iframe", "source"} and data.get("src"): refs.append(data["src"] or "")
        automatic = tag in {"script", "img", "iframe", "source"} or (
            tag == "link" and any(value in (data.get("rel") or "").split() for value in ("stylesheet", "preload", "icon", "manifest"))
        )
        for ref in refs:
            scheme = urlsplit(ref).scheme.lower()
            if scheme in {"http", "https"}:
                if automatic: self.external_resources.append(ref)
            elif scheme not in {"mailto", "tel", "data", "javascript"} and not ref.startswith("#"):
                self.local.append(ref)


def resolves(page: Path, ref: str) -> bool:
    path = unquote(urlsplit(ref).path)
    if not path:
        return True
    candidate = ROOT / path.lstrip("/") if path.startswith("/") else page.parent / path
    candidates = [candidate]
    if path.endswith("/"):
        candidates.append(candidate / "index.html")
    if not Path(path).suffix:
        candidates.extend((Path(f"{candidate}.html"), candidate / "index.html"))
    return any(item.is_file() for item in candidates)


if not ROOT.is_dir():
    fail(f"missing build directory: {ROOT}")

for rel in HISTORICAL["html_paths"]:
    if not (ROOT / rel).is_file():
        fail(f"historical HTML path missing: {rel}")

required = (
    "index.html", "archive.html", "about.html", "404.html", "feed.xml", "sitemap.xml",
    "WriteUps/index.html", "WriteUps/archive.html", "WriteUps/about.html", "WriteUps/feed.xml",
    "ramblings/index.html", "ramblings/archive.html", "ramblings/about.html", "ramblings/feed.xml",
    "ctf-tutorials/index.html", "ctf-tutorials/archive.html", "ctf-tutorials/assignments.html", "ctf-tutorials/feed.xml",
    "new-tetris/index.html", "new-tetris/src/catalog/index.html", "new-tetris/src/scoring/index.html",
)
for rel in required:
    if not (ROOT / rel).is_file():
        fail(f"required output missing: {rel}")

pages = sorted(ROOT.rglob("*.html"))
shell_pages = [page for page in pages if "new-tetris" not in page.relative_to(ROOT).parts]
forms = challenge_scripts = article_scripts = theme_scripts = images = code_frames = math_expressions = 0
for page in pages:
    rel = page.relative_to(ROOT).as_posix()
    text = page.read_text(encoding="utf-8")
    audit = Audit(); audit.feed(text)
    if not text.lower().lstrip().startswith("<!doctype html>"):
        fail(f"doctype missing: {rel}")
    if rel.startswith("new-tetris/"):
        if audit.external_resources: fail(f"third-party resource in {rel}: {audit.external_resources}")
        broken = [ref for ref in audit.local if not resolves(page, ref)]
        if broken: fail(f"broken static-app link in {rel}: {broken[:10]}")
        continue
    if (audit.title, audit.h1, audit.main, audit.description, audit.canonical) != (1, 1, 1, 1, 1):
        fail(f"shell invariant failed: {rel}")
    if len(audit.ids) != len(set(audit.ids)): fail(f"duplicate id: {rel}")
    if audit.external_resources: fail(f"third-party resource in {rel}: {audit.external_resources}")
    if audit.handlers: fail(f"inline handler in {rel}: {audit.handlers}")
    if audit.bad_images: fail(f"image metadata missing in {rel}: {audit.bad_images}")
    broken = [ref for ref in audit.local if not resolves(page, ref)]
    if broken: fail(f"broken local links in {rel}: {broken[:10]}")
    if any(host in text for host in TRACKERS): fail(f"retired runtime service remains in {rel}")
    forms += audit.forms
    images += text.count("<img ")
    challenge_scripts += text.count('/assets/js/challenge.js')
    article_scripts += text.count('/assets/js/article.js')
    theme_scripts += text.count('/assets/js/theme.js')
    code_frames += text.count("data-code-frame")
    math_expressions += text.count('class="katex-mathml"')

if len(pages) != 138 or len(shell_pages) != 135:
    fail(f"HTML count drift: all={len(pages)} shell={len(shell_pages)}")
if (forms, challenge_scripts, article_scripts, code_frames, math_expressions, images) != (10, 6, 79, 328, 106, 61):
    fail(
        "content scoping drift: "
        f"forms={forms} challenge_js={challenge_scripts} article_js={article_scripts} "
        f"code_frames={code_frames} math={math_expressions} images={images}"
    )
if theme_scripts != len(shell_pages):
    fail(f"theme script scoping drift: {theme_scripts} != {len(shell_pages)}")

for rel in ("404.html", "WriteUps/404.html", "ramblings/404.html", "ctf-tutorials/404.html"):
    if "noindex" not in (ROOT / rel).read_text(encoding="utf-8"):
        fail(f"404 page is indexable: {rel}")

for rel in ("feed.xml", "sitemap.xml", "WriteUps/feed.xml", "WriteUps/sitemap.xml", "ramblings/feed.xml", "ramblings/sitemap.xml", "ctf-tutorials/feed.xml", "ctf-tutorials/sitemap.xml"):
    ET.parse(ROOT / rel)

for section, entries in (("WriteUps", 20), ("ramblings", 5), ("ctf-tutorials", 4)):
    tree = ET.parse(ROOT / section / "feed.xml")
    count = len(tree.findall("{http://www.w3.org/2005/Atom}entry"))
    if count != entries: fail(f"section feed drift for {section}: {count} != {entries}")

# Every imported WriteUps postfile must remain byte-identical at its public path.
current_postfiles = 0
for item in CONTENT["files"]:
    source_path = item["path"]
    if item["section"] != "WriteUps" or not source_path.startswith("_posts/WriteUps/"):
        continue
    if DATE_POST.match(Path(source_path).name):
        continue
    public = ROOT / source_path.removeprefix("_posts/")
    if not public.is_file(): fail(f"current postfile missing: {public.relative_to(ROOT)}")
    data = public.read_bytes()
    if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
        fail(f"current postfile drift: {public.relative_to(ROOT)}")
    current_postfiles += 1
if current_postfiles != 230:
    fail(f"current postfile count drift: {current_postfiles}")

legacy = json.loads((SOURCE / "_data/legacy_paths.json").read_text(encoding="utf-8"))
for item in legacy["attachments"]:
    path = ROOT / item["path"]
    if not path.is_file(): fail(f"legacy attachment missing: {item['path']}")
    data = path.read_bytes()
    if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
        fail(f"legacy attachment drift: {item['path']}")
for item in legacy["aliases"]:
    path = ROOT / item["path"]
    if not path.is_file() or "noindex" not in path.read_text(encoding="utf-8"):
        fail(f"legacy alias invalid: {item['path']}")

# The recovered static app is copied byte-for-byte into the combined artifact.
for item in STATIC_APP["files"]:
    path = ROOT / item["path"]
    if not path.is_file(): fail(f"static app file missing: {item['path']}")
    data = path.read_bytes()
    if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
        fail(f"static app file drift: {item['path']}")

archive = (ROOT / "archive.html").read_text(encoding="utf-8")
if "?tag=RSA" not in archive or "?tag=CTF" not in archive or "?tag=rsa" in archive or "?tag=ctfs" in archive:
    fail("tag alias merge drift")
if "130 merged tags" not in archive:
    fail("merged tag count drift")

css = ROOT / "assets/css/main.css"
for ref in re.findall(r"url\(['\"]?([^)\'\"]+)", css.read_text(encoding="utf-8")):
    if not (css.parent / ref).resolve().is_file(): fail(f"missing CSS resource: {ref}")

for forbidden in ("vendor", "node_modules", "Gemfile", "Gemfile.lock", "package.json", "package-lock.json"):
    if (ROOT / forbidden).exists(): fail(f"build leak: {forbidden}")

budgets = {
    "index.html": 10 * 1024,
    "archive.html": 14 * 1024,
    "WriteUps/index.html": 10 * 1024,
    "assets/css/main.css": 12 * 1024,
    "assets/js/article.js": 2 * 1024,
    "assets/js/archive.js": 2 * 1024,
    "assets/js/challenge.js": 2 * 1024,
    "assets/js/theme.js": 1 * 1024,
}
metrics = {}
for name, budget in budgets.items():
    data = (ROOT / name).read_bytes()
    compressed = len(gzip.compress(data, 9))
    if compressed > budget: fail(f"gzip budget exceeded for {name}: {compressed} > {budget}")
    metrics[name] = {"raw": len(data), "gzip": compressed, "budget": budget}

print(json.dumps({
    "status": "pass",
    "html_pages": len(pages),
    "historical_html_paths": len(HISTORICAL["html_paths"]),
    "posts": 78,
    "merged_tags": 130,
    "current_postfiles": current_postfiles,
    "legacy_attachment_aliases": len(legacy["attachments"]),
    "legacy_html_aliases": len(legacy["aliases"]),
    "code_frames": code_frames,
    "math_expressions": math_expressions,
    "challenge_forms": forms,
    "external_runtime_resources": 0,
    "metrics": metrics,
}, indent=2))
