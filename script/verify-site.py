#!/usr/bin/env python3
"""Validate the generated root site without third-party Python packages."""

from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
import gzip
import json
import re
import sys
import xml.etree.ElementTree as ET

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else "_site").resolve()
EXPECTED = {
    "index.html", "archive.html", "about.html", "404.html", "assets/index.html",
    "2021/04/08/challenges.html", "2021/04/08/contributions.html", "2021/04/08/welcome.html",
    "2021/07/25/injection.html", "2021/07/25/mersenne-seed-recovery.html",
    "2021/07/25/untwist-me.html", "2021/07/25/wiki-mersenne.html", "2024/01/28/inputrc.html",
}
EXTERNAL_LOCAL_PREFIXES = ("/WriteUps/", "/ctf-tutorials/", "/ramblings/", "/pyfractal/", "/Mal-det-cal/", "/hacking_tools/")


def fail(message: str) -> None:
    raise SystemExit(f"FAIL: {message}")


class Audit(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = self.h1 = self.main = self.description = 0
        self.canonical: list[str] = []
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
        if tag == "link" and data.get("rel") == "canonical": self.canonical.append(data.get("href") or "")
        if data.get("id"): self.ids.append(data.get("id") or "")
        self.handlers.extend(name for name in data if name.lower().startswith("on"))
        if tag == "form" and "data-flag-check" in data: self.forms += 1
        if tag == "img" and (not data.get("src") or not data.get("width") or not data.get("height") or not data.get("alt")):
            self.bad_images.append(data.get("src") or "<missing>")

        refs = []
        if tag in {"a", "link"} and data.get("href"): refs.append(data["href"] or "")
        if tag in {"script", "img", "iframe", "source"} and data.get("src"): refs.append(data["src"] or "")
        automatic = tag in {"script", "img", "iframe", "source"} or (
            tag == "link" and any(x in (data.get("rel") or "").split() for x in ("stylesheet", "preload", "icon", "manifest"))
        )
        for ref in refs:
            scheme = urlsplit(ref).scheme.lower()
            if scheme in {"http", "https"}:
                if automatic: self.external_resources.append(ref)
            elif scheme not in {"mailto", "tel", "data", "javascript"} and not ref.startswith("#"):
                self.local.append(ref)


def resolves(page: Path, ref: str) -> bool:
    path = unquote(urlsplit(ref).path)
    if not path: return True
    if path.startswith(EXTERNAL_LOCAL_PREFIXES): return True
    if path.startswith("/"):
        path = path[1:]
    else:
        path = (page.relative_to(ROOT).parent / path).as_posix()
    candidates = [ROOT / path]
    if not Path(path).suffix:
        candidates.extend((ROOT / f"{path}.html", ROOT / path / "index.html"))
    if path.endswith("/"): candidates.append(ROOT / path / "index.html")
    return any(candidate.is_file() for candidate in candidates)


if not ROOT.is_dir(): fail(f"missing build directory: {ROOT}")
pages = sorted(ROOT.rglob("*.html"))
routes = {page.relative_to(ROOT).as_posix() for page in pages}
if routes != EXPECTED: fail(f"route drift: removed={sorted(EXPECTED-routes)}, added={sorted(routes-EXPECTED)}")

forms = article_scripts = challenge_scripts = archive_scripts = images = 0
for page in pages:
    rel = page.relative_to(ROOT).as_posix()
    text = page.read_text(encoding="utf-8")
    audit = Audit(); audit.feed(text)
    if not text.lower().startswith("<!doctype html>"): fail(f"doctype missing: {rel}")
    if (audit.title, audit.h1, audit.main, audit.description, len(audit.canonical)) != (1, 1, 1, 1, 1):
        fail(f"shell invariant failed: {rel}")
    if len(audit.ids) != len(set(audit.ids)): fail(f"duplicate id: {rel}")
    if audit.external_resources: fail(f"third-party resource in {rel}: {audit.external_resources}")
    if audit.handlers: fail(f"inline handler in {rel}: {audit.handlers}")
    if audit.bad_images: fail(f"image metadata missing in {rel}: {audit.bad_images}")
    broken = [ref for ref in audit.local if not resolves(page, ref)]
    if broken: fail(f"broken links in {rel}: {broken[:10]}")
    forms += audit.forms
    images += text.count("<img ")
    article_scripts += text.count("/assets/js/article.js")
    challenge_scripts += text.count("/assets/js/challenge.js")
    archive_scripts += text.count("/assets/js/archive.js")
    if any(host in text for host in ("googletagmanager.com", "google-analytics.com", "ajax.googleapis.com", "cdnjs.cloudflare.com", "cdn.jsdelivr.net")):
        fail(f"retired service remains in {rel}")

if (forms, article_scripts, challenge_scripts, archive_scripts, images) != (7, 8, 5, 1, 1):
    fail(f"scoping drift: forms={forms}, article_js={article_scripts}, challenge_js={challenge_scripts}, archive_js={archive_scripts}, images={images}")
if "noindex" not in (ROOT / "404.html").read_text() or "noindex" not in (ROOT / "assets/index.html").read_text():
    fail("error or legacy route is indexable")
for xml in ("feed.xml", "sitemap.xml"): ET.parse(ROOT / xml)

for name in ("assets/css/main.css", "assets/js/article.js", "assets/js/archive.js", "assets/js/challenge.js"):
    if not (ROOT / name).is_file(): fail(f"missing asset: {name}")
for forbidden in ("vendor", "Gemfile", "Gemfile.lock", "jekyll-text-theme.gemspec", "assets/search.js", "assets/js/site.js"):
    if (ROOT / forbidden).exists(): fail(f"build leak: {forbidden}")

budgets = {"index.html": 6*1024, "archive.html": 6*1024, "assets/css/main.css": 10*1024,
           "assets/js/article.js": 2*1024, "assets/js/archive.js": 2*1024, "assets/js/challenge.js": 2*1024}
metrics = {}
for name, budget in budgets.items():
    data = (ROOT / name).read_bytes(); compressed = len(gzip.compress(data, 9))
    if compressed > budget: fail(f"budget exceeded: {name} {compressed}>{budget}")
    metrics[name] = {"raw": len(data), "gzip": compressed, "budget": budget}

print(json.dumps({"status": "pass", "html_pages": len(pages), "challenge_forms": forms,
                  "external_runtime_resources": 0, "metrics": metrics}, indent=2))
