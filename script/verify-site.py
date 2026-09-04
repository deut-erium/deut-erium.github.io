#!/usr/bin/env python3
"""Validate the unified root, section routes, content, privacy, and payloads."""

from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit
import gzip
import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET

from artifact_manifest import ManifestError, manifest_entries

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else "_site").resolve()
SOURCE = Path(__file__).resolve().parents[1]
SITE_URL = "https://deut-erium.github.io"
SITE_HOST = urlsplit(SITE_URL).netloc
HISTORICAL = json.loads(Path(__file__).with_name("historical-html-paths.json").read_text(encoding="utf-8"))
CONTENT = json.loads(Path(__file__).with_name("imported-content-manifest.json").read_text(encoding="utf-8"))
STATIC_APP = json.loads(Path(__file__).with_name("static-app-manifest.json").read_text(encoding="utf-8"))
ARCHIVED = json.loads(Path(__file__).with_name("archived-assets.json").read_text(encoding="utf-8"))
LEGACY = json.loads((SOURCE / "_data/legacy_paths.json").read_text(encoding="utf-8"))
DATE_POST = re.compile(r"^(?P<year>\d{4}|\d{2})-(?P<month>\d{2})-(?P<day>\d{2})-(?P<slug>.+)\.(?:md|markdown)$", re.I)
EXTERNAL_PROJECT_PATHS = ("/pyfractal",)
TRACKERS = (
    "googletagmanager.com", "google-analytics.com", "analytics.google.com",
    "connect.facebook.net", "static.cloudflareinsights.com", "cdn.segment.com",
    "api.mixpanel.com", "plausible.io/js/", "cdn.usefathom.com", "hotjar.com",
    "clarity.ms/tag/", "disqus.com/embed", "giscus.app", "utteranc.es/client",
    "gitalk", "addthis.com", "leancloud.cn",
)
ATOM = "{http://www.w3.org/2005/Atom}"
SITEMAP = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
_gc = re.search(r'(?m)^goatcounter_site:\s*"?([\w-]+)"?\s*(?:#.*)?$', (SOURCE / "_config.yml").read_text(encoding="utf-8"))
GOATCOUNTER = _gc.group(1) if _gc else ""
ANALYTICS_SCRIPT = "https://gc.zgo.at/count.js"


def fail(message: str) -> None:
    raise SystemExit(f"FAIL: {message}")


def exact_file_for_url(url: str) -> Path | None:
    split = urlsplit(url)
    path = unquote(split.path)
    if split.netloc and split.netloc != SITE_HOST:
        return None
    candidate = ROOT / path.lstrip("/")
    if path.endswith("/"):
        candidate = candidate / "index.html"
    return candidate if candidate.is_file() else None


def resolves(page: Path, ref: str) -> bool:
    split = urlsplit(ref)
    path = unquote(split.path)
    if split.netloc and split.netloc != SITE_HOST:
        return True
    if not path:
        return True
    if split.netloc == SITE_HOST and any(path == prefix or path.startswith(f"{prefix}/") for prefix in EXTERNAL_PROJECT_PATHS):
        return True
    candidate = ROOT / path.lstrip("/") if path.startswith("/") else page.parent / path
    candidates = [candidate]
    if path.endswith("/"):
        candidates.append(candidate / "index.html")
    if not Path(path).suffix:
        candidates.extend((Path(f"{candidate}.html"), candidate / "index.html"))
    return any(item.is_file() for item in candidates)


class Audit(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = self.h1 = self.main = self.description = 0
        self.canonicals: list[str] = []
        self.robots: list[str] = []
        self.refresh: list[str] = []
        self.ids: list[str] = []
        self.local: list[str] = []
        self.external_resources: list[str] = []
        self.analytics: list[str] = []
        self.plain_images = 0
        self.dangerous_refs: list[str] = []
        self.handlers: list[str] = []
        self.bad_images: list[str] = []
        self.body_classes: set[str] = set()
        self.heading_levels: list[int] = []
        self.unnamed_links: list[str] = []
        self._anchor: dict[str, str] | None = None
        self.forms = 0
        self.unsafe_flag_forms: list[str] = []
        self._flag_form = False
        self._flag_input_named = False
        self._flag_submit_disabled = False
        self._flag_form_depth = 0

    def _is_analytics_ref(self, ref: str) -> bool:
        split = urlsplit(ref)
        host = split.netloc.lower()
        if host == "gc.zgo.at" and split.path == "/count.js":
            return True
        return bool(GOATCOUNTER) and host == f"{GOATCOUNTER}.goatcounter.com" and split.path.split("?")[0] == "/count"

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = dict(attrs)
        if tag == "title": self.title += 1
        if tag == "h1": self.h1 += 1
        if re.fullmatch(r"h[1-6]", tag): self.heading_levels.append(int(tag[1]))
        if tag == "main": self.main += 1
        if tag == "body": self.body_classes.update((data.get("class") or "").split())
        if tag == "meta" and data.get("name") == "description": self.description += 1
        if tag == "meta" and data.get("name") == "robots": self.robots.append(data.get("content") or "")
        if tag == "meta" and (data.get("http-equiv") or "").lower() == "refresh": self.refresh.append(data.get("content") or "")
        if tag == "link" and "canonical" in (data.get("rel") or "").split(): self.canonicals.append(data.get("href") or "")
        if data.get("id"): self.ids.append(data.get("id") or "")
        self.handlers.extend(name for name in data if name.lower().startswith("on"))
        if tag == "img":
            if self._is_analytics_ref(data.get("src") or ""):
                pass
            else:
                if not data.get("src") or not data.get("alt") or not data.get("width") or not data.get("height"):
                    self.bad_images.append(data.get("src") or "<missing>")
                self.plain_images += 1
        if tag == "a":
            self._anchor = {
                "href": data.get("href") or "<missing>",
                "name": data.get("aria-label") or data.get("title") or "",
            }
            if data.get("target") == "_blank" and "noopener" not in (data.get("rel") or "").split():
                self.dangerous_refs.append(data.get("href") or "<blank target>")
        elif tag == "img" and self._anchor is not None:
            self._anchor["name"] += data.get("alt") or ""

        if tag == "form" and "data-flag-check" in data:
            self.forms += 1
            self._flag_form = True
            self._flag_form_depth = 1
            self._flag_input_named = False
            self._flag_submit_disabled = False
            action = data.get("action")
            if action and action not in {"#", ""}: self.unsafe_flag_forms.append(f"action={action}")
        elif self._flag_form:
            self._flag_form_depth += 1
            if tag == "input" and "data-flag-input" in data and data.get("name"):
                self._flag_input_named = True
            if tag == "button" and data.get("type") == "submit" and "disabled" in data:
                self._flag_submit_disabled = True

        refs: list[str] = []
        if tag in {"a", "link", "area"} and data.get("href"): refs.append(data["href"] or "")
        if tag in {"script", "img", "iframe", "source", "object", "embed", "video", "audio"}:
            for name in ("src", "data", "poster"):
                if data.get(name): refs.append(data[name] or "")
        if data.get("srcset"):
            refs.extend(item.strip().split()[0] for item in (data.get("srcset") or "").split(",") if item.strip())
        automatic = tag in {"script", "img", "iframe", "source", "object", "embed", "video", "audio"} or (
            tag == "link" and any(value in (data.get("rel") or "").split() for value in ("stylesheet", "preload", "icon", "manifest", "modulepreload"))
        )
        for ref in refs:
            split = urlsplit(ref)
            scheme = split.scheme.lower()
            if scheme in {"javascript", "vbscript"}:
                self.dangerous_refs.append(ref)
            elif scheme == "data":
                if tag not in {"img", "source"}: self.dangerous_refs.append(ref[:80])
            elif scheme in {"http", "https"}:
                if split.netloc == SITE_HOST:
                    self.local.append(ref)
                elif self._is_analytics_ref(ref):
                    self.analytics.append(ref)
                elif automatic:
                    self.external_resources.append(ref)
            elif scheme not in {"mailto", "tel"} and not ref.startswith("#"):
                self.local.append(ref)

    def handle_data(self, data: str) -> None:
        if self._anchor is not None:
            self._anchor["name"] += data

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._anchor is not None:
            if not self._anchor["name"].strip():
                self.unnamed_links.append(self._anchor["href"])
            self._anchor = None
        if self._flag_form:
            self._flag_form_depth -= 1
            if tag == "form" or self._flag_form_depth <= 0:
                if self._flag_input_named: self.unsafe_flag_forms.append("named input")
                if not self._flag_submit_disabled: self.unsafe_flag_forms.append("enabled submit")
                self._flag_form = False
                self._flag_form_depth = 0


class FrameParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.figure_depth = 0
        self.code_depth = 0
        self.attributes: dict[str, str | None] | None = None
        self.text: list[str] | None = None
        self.frames: list[tuple[dict[str, str | None], str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = dict(attrs)
        if tag == "figure" and "data-code-frame" in data:
            if self.figure_depth: fail("nested code frames")
            self.figure_depth = 1
            self.attributes = data
            return
        if self.figure_depth:
            self.figure_depth += 1
            if tag == "code" and self.text is None:
                self.code_depth = self.figure_depth
                self.text = []

    def handle_endtag(self, tag: str) -> None:
        if not self.figure_depth:
            return
        if tag == "code" and self.code_depth == self.figure_depth and self.text is not None:
            self.code_depth = 0
        self.figure_depth -= 1
        if self.figure_depth == 0:
            self.frames.append((self.attributes or {}, "".join(self.text or [])))
            self.attributes = None
            self.text = None

    def handle_data(self, data: str) -> None:
        if self.code_depth and self.text is not None:
            self.text.append(data)


def source_lines(text: str) -> int:
    lines = text.split("\n")
    if text.endswith("\n"): lines.pop()
    return len(lines) or 1


def expected_post_routes() -> dict[str, str]:
    routes: dict[str, str] = {}
    for source in sorted((SOURCE / "_posts").rglob("*.md")):
        match = DATE_POST.match(source.name)
        if not match:
            continue
        rel = source.relative_to(SOURCE / "_posts")
        first = rel.parts[0]
        if first == "WriteUps":
            route = rel.with_suffix(".html").as_posix()
            section = "writeups"
        elif first in {"ramblings", "ctf-tutorials"}:
            year = match["year"] if len(match["year"]) == 4 else f"20{match['year']}"
            slug = re.sub(r"\s+", "-", match["slug"])
            route = f"{first}/{year}/{match['month']}/{match['day']}/{slug}.html"
            section = "ramblings" if first == "ramblings" else "tutorials"
        else:
            slug = re.sub(r"\s+", "-", match["slug"])
            route = f"{match['year']}/{match['month']}/{match['day']}/{slug}.html"
            section = "root"
        if route in routes: fail(f"duplicate expected post route: {route}")
        routes[route] = section
    return routes


def parse_feed(path: Path, *, link_ids: bool = True) -> list[str]:
    tree = ET.parse(path)
    entries = tree.findall(f"{ATOM}entry")
    urls: list[str] = []
    for entry in entries:
        links = [node.get("href") for node in entry.findall(f"{ATOM}link") if node.get("rel") == "alternate"]
        if len(links) != 1: fail(f"feed alternate-link drift: {path}")
        url = links[0] or ""
        identifier = entry.findtext(f"{ATOM}id") or ""
        if not identifier: fail(f"feed id missing: {path}: {url}")
        if link_ids and identifier != url: fail(f"feed id/link mismatch: {path}: {url}")
        summary = entry.find(f"{ATOM}summary")
        if summary is None or not "".join(summary.itertext()).strip(): fail(f"empty feed summary: {path}: {url}")
        if len("".join(summary.itertext())) > 400: fail(f"oversized feed summary: {path}: {url}")
        urls.append(unquote(urlsplit(url).path))
    if len(urls) != len(set(urls)): fail(f"duplicate feed entry: {path}")
    return urls


def parse_sitemap(path: Path) -> set[str]:
    tree = ET.parse(path)
    urls = {unquote(urlsplit(node.text or "").path) for node in tree.findall(f"{SITEMAP}url/{SITEMAP}loc")}
    if len(urls) != len(tree.findall(f"{SITEMAP}url/{SITEMAP}loc")): fail(f"duplicate sitemap URL: {path}")
    return urls


if not ROOT.is_dir(): fail(f"missing build directory: {ROOT}")
try:
    artifact_entries = list(manifest_entries(ROOT))
except (ManifestError, OSError) as error:
    fail(str(error))
artifact_files = sum(entry["type"] == "file" for entry in artifact_entries)
artifact_directories = sum(entry["type"] == "directory" for entry in artifact_entries)

required = {
    "index.html", "archive.html", "about.html", "404.html", "feed.xml", "sitemap.xml", "robots.txt", "favicon.ico",
    "WriteUps/index.html", "WriteUps/archive.html", "WriteUps/about.html", "WriteUps/feed.xml", "WriteUps/sitemap.xml", "WriteUps/robots.txt",
    "ramblings/index.html", "ramblings/archive.html", "ramblings/about.html", "ramblings/feed.xml", "ramblings/sitemap.xml", "ramblings/robots.txt",
    "ctf-tutorials/index.html", "ctf-tutorials/archive.html", "ctf-tutorials/assignments.html", "ctf-tutorials/feed.xml", "ctf-tutorials/sitemap.xml", "ctf-tutorials/robots.txt",
    "new-tetris/index.html", "new-tetris/src/catalog/index.html", "new-tetris/src/scoring/index.html",
}
required.update(HISTORICAL["html_paths"])
for rel in sorted(required):
    if not (ROOT / rel).is_file(): fail(f"required output missing: {rel}")

post_routes = expected_post_routes()
if len(post_routes) != 78: fail(f"source post count drift: {len(post_routes)}")
for rel in post_routes:
    if not (ROOT / rel).is_file(): fail(f"post route missing: {rel}")

pages = sorted(ROOT.rglob("*.html"))
VERIFICATION_HTML = {"google98b86655786074b6.html", "yandex_0a37c4f8df609655.html"}
shell_pages = [
    page for page in pages
    if "new-tetris" not in page.relative_to(ROOT).parts
    and page.relative_to(ROOT).as_posix() not in VERIFICATION_HTML
]
forms = challenge_scripts = article_scripts = theme_scripts = images = brand_marks = code_frames = math_expressions = 0
challenge_pages: set[str] = set()
article_pages: set[str] = set()
math_pages: set[str] = set()
noindex_paths: set[str] = set()
page_audits: dict[str, Audit] = {}
archive_order: list[str] = []

for page in pages:
    rel = page.relative_to(ROOT).as_posix()
    text = page.read_text(encoding="utf-8")
    audit = Audit(); audit.feed(text); audit.close(); page_audits[rel] = audit
    if rel in VERIFICATION_HTML:
        continue
    if not text.lower().lstrip().startswith("<!doctype html>"): fail(f"doctype missing: {rel}")
    if audit.external_resources: fail(f"third-party resource in {rel}: {audit.external_resources}")
    if audit.analytics and (not GOATCOUNTER or audit.refresh): fail(f"third-party resource in {rel}: {audit.analytics}")
    if audit.dangerous_refs: fail(f"dangerous reference in {rel}: {audit.dangerous_refs[:5]}")
    if audit.handlers: fail(f"inline handler in {rel}: {audit.handlers}")
    if audit.unnamed_links: fail(f"unnamed link in {rel}: {audit.unnamed_links[:5]}")
    jumps = [(left, right) for left, right in zip(audit.heading_levels, audit.heading_levels[1:]) if right > left + 1]
    if jumps: fail(f"heading level jump in {rel}: {jumps[:5]}")
    broken = [ref for ref in audit.local if not resolves(page, ref)]
    if broken: fail(f"broken local links in {rel}: {broken[:10]}")
    if any(host in text.lower() for host in TRACKERS): fail(f"retired runtime service remains in {rel}")
    if rel.startswith("new-tetris/"):
        if rel in {"new-tetris/index.html", "new-tetris/src/catalog/index.html", "new-tetris/src/scoring/index.html"}:
            expected_path = "/" + rel.removesuffix("index.html")
            if audit.description != 1 or audit.canonicals != [f"{SITE_URL}{expected_path}"]:
                fail(f"static-app metadata drift: {rel}")
            if text.count('property="og:title"') != 1 or text.count('property="og:url"') != 1:
                fail(f"static-app social metadata drift: {rel}")
        continue
    if (audit.title, audit.h1, audit.main, audit.description, len(audit.canonicals)) != (1, 1, 1, 1, 1):
        fail(f"shell invariant failed: {rel}")
    if len(audit.ids) != len(set(audit.ids)): fail(f"duplicate id: {rel}")
    if audit.bad_images: fail(f"image metadata missing in {rel}: {audit.bad_images}")
    if audit.unsafe_flag_forms: fail(f"unsafe local checker in {rel}: {audit.unsafe_flag_forms}")
    if any("noindex" in value.lower() for value in audit.robots):
        output_url = "/" + rel
        noindex_paths.add(output_url)
        if rel.endswith("/index.html"): noindex_paths.add("/" + rel.removesuffix("index.html"))
    forms += audit.forms
    images += audit.plain_images
    brand_marks += text.count('class="site-brand__mark"')
    challenge_scripts += text.count('/assets/js/challenge.js')
    article_scripts += text.count('/assets/js/article.js')
    theme_scripts += text.count('/assets/js/theme.js')
    code_frames += text.count("data-code-frame")
    math_expressions += text.count('class="katex-mathml"')
    if '/assets/js/challenge.js' in text: challenge_pages.add(rel)
    if '/assets/js/article.js' in text: article_pages.add(rel)
    if 'class="katex-mathml"' in text: math_pages.add(rel)

    parser = FrameParser(); parser.feed(text); parser.close()
    for attributes, source in parser.frames:
        digest = hashlib.sha256(source.encode("utf-8")).hexdigest()
        if attributes.get("data-source-sha256") != digest: fail(f"code hash drift: {rel}")
        if attributes.get("data-lines") != str(source_lines(source)): fail(f"code line-count drift: {rel}")

if len(pages) != 139 or len(shell_pages) != 134: fail(f"HTML count drift: all={len(pages)} shell={len(shell_pages)}")
if (forms, challenge_scripts, article_scripts, code_frames, math_expressions, images) != (10, 6, 79, 327, 106, 61):
    fail(f"content scoping drift: forms={forms} challenge_js={challenge_scripts} article_js={article_scripts} code_frames={code_frames} math={math_expressions} images={images}")
if len(challenge_pages) != 6: fail(f"challenge page count drift: {len(challenge_pages)}")
if theme_scripts != len(shell_pages): fail(f"theme script scoping drift: {theme_scripts} != {len(shell_pages)}")
if brand_marks != len(shell_pages): fail(f"brand-mark scoping drift: {brand_marks} != {len(shell_pages)}")
if len(math_pages) != 4: fail(f"math page count drift: {len(math_pages)}")
if GOATCOUNTER:
    wired = [rel for rel, audit in page_audits.items() if rel not in VERIFICATION_HTML and not rel.startswith("new-tetris/") and not audit.refresh]
    missing_script = [rel for rel in wired if page_audits[rel].analytics.count(ANALYTICS_SCRIPT) != 1]
    missing_pixel = [rel for rel in wired if len([r for r in page_audits[rel].analytics if r != ANALYTICS_SCRIPT and urlsplit(r).netloc == f"{GOATCOUNTER}.goatcounter.com"]) != 1]
    if missing_script: fail(f"goatcounter script missing in {missing_script[:5]}")
    if missing_pixel: fail(f"goatcounter pixel missing in {missing_pixel[:5]}")

article_routes = {rel for rel in post_routes if 'itemtype="https://schema.org/Article"' in (ROOT / rel).read_text(encoding="utf-8")}
if article_routes != set(post_routes): fail(f"article schema route drift: {sorted(set(post_routes) - article_routes)[:10]}")
writeup_routes = {rel for rel, section in post_routes.items() if section == "writeups"}
if len(writeup_routes) != 61: fail(f"WriteUps source count drift: {len(writeup_routes)}")
for rel in writeup_routes:
    text = (ROOT / rel).read_text(encoding="utf-8")
    classes = page_audits[rel].body_classes
    if not {"layout-writeup", "section-writeups"}.issubset(classes) or "<dt>Event</dt>" not in text or "<dt>Category</dt>" not in text:
        fail(f"WriteUps layout drift: {rel}")

for rel, section in (("404.html", "root"), ("WriteUps/404.html", "writeups"), ("ramblings/404.html", "ramblings"), ("ctf-tutorials/404.html", "tutorials")):
    audit = page_audits[rel]
    if not any("noindex" in value.lower() for value in audit.robots): fail(f"404 page is indexable: {rel}")
    if f"section-{section}" not in audit.body_classes: fail(f"404 section identity drift: {rel}")

# Archive order is the source of truth for feed windows.
archive_text = (ROOT / "archive.html").read_text(encoding="utf-8")
record_pattern = re.compile(r'<li\b[^>]*data-record[^>]*>.*?<a\b[^>]*href="([^"]+)"', re.S)
archive_order = [unquote(urlsplit(url).path) for url in record_pattern.findall(archive_text)]
if len(archive_order) != 78 or len(set(archive_order)) != 78 or set(archive_order) != {f"/{rel}" for rel in post_routes}:
    fail("global archive membership drift")
tag_block = re.search(r'<div class="all-tags__grid[^>]*>(.*?)</div>', archive_text, re.S)
if not tag_block: fail("tag index missing")
tag_count = len(re.findall(r"\bdata-filter=", tag_block.group(1)))
if tag_count != 130 or "130 merged tags" not in archive_text: fail(f"merged tag count drift: {tag_count}")
if "?tag=RSA" not in archive_text or "?tag=CTF" not in archive_text or "?tag=rsa" in archive_text or "?tag=ctfs" in archive_text:
    fail("tag alias merge drift")

# Feeds must be exact newest-first windows with bounded, nonempty summaries.
global_feed = parse_feed(ROOT / "feed.xml", link_ids=False)
if global_feed != archive_order[:10]: fail("global feed membership or order drift")
section_specs = {
    "WriteUps": ("writeups", 20, "/WriteUps/"),
    "ramblings": ("ramblings", 5, "/ramblings/"),
    "ctf-tutorials": ("tutorials", 4, "/ctf-tutorials/"),
}
for directory, (section, limit, home) in section_specs.items():
    expected = [path for path in archive_order if post_routes[path.lstrip("/")] == section]
    actual = parse_feed(ROOT / directory / "feed.xml")
    if actual != expected[:limit]: fail(f"section feed membership or order drift: {directory}")
    sitemap = parse_sitemap(ROOT / directory / "sitemap.xml")
    if sitemap != {home, *expected}: fail(f"section sitemap membership drift: {directory}")

root_sitemap = parse_sitemap(ROOT / "sitemap.xml")
if not {f"/{rel}" for rel in post_routes}.issubset(root_sitemap): fail("root sitemap omits posts")
if root_sitemap.intersection(noindex_paths): fail(f"noindex URL in sitemap: {sorted(root_sitemap.intersection(noindex_paths))}")
if "/assets/resume.pdf" in root_sitemap: fail("stale resume is listed in sitemap")
for path in root_sitemap:
    if path.startswith(EXTERNAL_PROJECT_PATHS): continue
    if not resolves(ROOT / "sitemap.xml", path): fail(f"sitemap URL does not resolve: {path}")

robots = {
    "robots.txt": "/sitemap.xml",
    "WriteUps/robots.txt": "/WriteUps/sitemap.xml",
    "ramblings/robots.txt": "/ramblings/sitemap.xml",
    "ctf-tutorials/robots.txt": "/ctf-tutorials/sitemap.xml",
}
for rel, sitemap_path in robots.items():
    text = (ROOT / rel).read_text(encoding="utf-8")
    if f"Sitemap: {SITE_URL}{sitemap_path}" not in text: fail(f"robots sitemap drift: {rel}")

# Every imported WriteUps postfile must remain byte-identical at its current route.
current_postfiles = 0
for item in CONTENT["files"]:
    source_path = item["path"]
    if item["section"] != "WriteUps" or not source_path.startswith("_posts/WriteUps/") or DATE_POST.match(Path(source_path).name):
        continue
    public = ROOT / source_path.removeprefix("_posts/")
    if not public.is_file(): fail(f"current postfile missing: {public.relative_to(ROOT)}")
    data = public.read_bytes()
    if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
        fail(f"current postfile drift: {public.relative_to(ROOT)}")
    current_postfiles += 1
if current_postfiles != 230: fail(f"current postfile count drift: {current_postfiles}")

for item in LEGACY["attachments"]:
    path = ROOT / item["path"]
    if not path.is_file(): fail(f"legacy attachment missing: {item['path']}")
    data = path.read_bytes()
    if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]: fail(f"legacy attachment drift: {item['path']}")
for item in LEGACY["aliases"]:
    path = ROOT / item["path"]
    if not path.is_file(): fail(f"legacy alias missing: {item['path']}")
    audit = page_audits[item["path"]]
    target_path = f"/{item['target']}.html"
    expected_canonical = f"{SITE_URL}{quote(target_path, safe='/')}"
    if audit.canonicals != [expected_canonical]: fail(f"legacy alias canonical drift: {item['path']}")
    if audit.refresh != [f"0; url={quote(target_path, safe='/')}"]: fail(f"legacy alias refresh drift: {item['path']}")
    if exact_file_for_url(target_path) is None: fail(f"legacy alias exact target missing: {item['path']}")
    if not any("noindex" in value.lower() for value in audit.robots): fail(f"legacy alias is indexable: {item['path']}")

for item in STATIC_APP["files"]:
    path = ROOT / item["path"]
    if not path.is_file(): fail(f"static app file missing: {item['path']}")
    data = path.read_bytes()
    if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]: fail(f"static app file drift: {item['path']}")

archived_asset_paths = 0
for item in ARCHIVED["files"]:
    for rel in item["paths"]:
        path = ROOT / rel
        if not path.is_file(): fail(f"archived asset missing: {rel}")
        data = path.read_bytes()
        if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
            fail(f"archived asset drift: {rel}")
        archived_asset_paths += 1

for stylesheet in ROOT.rglob("*.css"):
    text = stylesheet.read_text(encoding="utf-8")
    if re.search(r"@import\s+(?:url\()?['\"]?https?://", text, re.I): fail(f"external CSS import: {stylesheet.relative_to(ROOT)}")
    for ref in re.findall(r"url\(['\"]?([^)'\"]+)", text):
        if urlsplit(ref).scheme in {"data"}: continue
        if urlsplit(ref).scheme in {"http", "https"}: fail(f"external CSS resource: {stylesheet.relative_to(ROOT)}: {ref}")
        if not (stylesheet.parent / unquote(urlsplit(ref).path)).resolve().is_file(): fail(f"missing CSS resource: {stylesheet.relative_to(ROOT)}: {ref}")

favicon_hashes = {
    "favicon.ico": "ca747f44c3e717d9ceaaa91a81e9bcfe5c4929c063630976cb03836392f5846f",
    "assets/favicon.ico": "ca747f44c3e717d9ceaaa91a81e9bcfe5c4929c063630976cb03836392f5846f",
    "assets/favicon-16x16.png": "5b4e6eaef77067e2611d47f36744f809afed41c05e1caa74535e9837e1e0faad",
    "assets/favicon-32x32.png": "dd8d23f732dc10c08fb4d7d9c9760082a9f5c37b14e1aa264b2603a991df40be",
    "assets/favicon-96x96.png": "99368641171b70e08da3bc02176e2f6b7a0e8c03a02447b2001a680831c4d7aa",
}
for rel, expected_hash in favicon_hashes.items():
    path = ROOT / rel
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected_hash:
        fail(f"Escher favicon drift: {rel}")
home_head = (ROOT / "index.html").read_text(encoding="utf-8")
for href in ("/assets/favicon-96x96.png", "/assets/favicon-32x32.png", "/assets/favicon-16x16.png", "/favicon.ico"):
    if f'href="{href}"' not in home_head:
        fail(f"Escher favicon link missing: {href}")
if 'rel="icon" type="image/svg+xml"' in home_head:
    fail("legacy square favicon still selected on regular pages")

brand_asset = ROOT / "assets/images/circle-limit-iv-mark.webp"
brand_data = brand_asset.read_bytes() if brand_asset.is_file() else b""
if len(brand_data) != 5_878 or hashlib.sha256(brand_data).hexdigest() != "c948e796b7e426e092db0fe3644be944dad18837f6d664dc86ddea0901c1a571":
    fail("Circle Limit IV brand asset drift")
main_css = (ROOT / "assets/css/main.css").read_text(encoding="utf-8")
if 'url("../images/circle-limit-iv-mark.webp")' not in main_css:
    fail("Circle Limit IV brand style missing")
about_text = (ROOT / "about.html").read_text(encoding="utf-8")
if 'class="item about-profile"' not in about_text or "M. C. Escher&#39;s Circle Limit IV" not in about_text:
    fail("Circle Limit IV About profile drift")

for path in ROOT.rglob("*"):
    if path.is_file() and (path.suffix == ".map" or "sourceMappingURL=" in path.read_text(encoding="utf-8", errors="ignore")):
        fail(f"source map leak: {path.relative_to(ROOT)}")
for forbidden in ("vendor", "node_modules", "Gemfile", "Gemfile.lock", "package.json", "package-lock.json", "agent_out", "script", ".git", ".github"):
    if (ROOT / forbidden).exists(): fail(f"build leak: {forbidden}")

budgets = {
    "index.html": 10 * 1024,
    "archive.html": 14 * 1024,
    "feed.xml": 12 * 1024,
    "WriteUps/index.html": 10 * 1024,
    "WriteUps/feed.xml": 16 * 1024,
    "assets/css/main.css": 12 * 1024,
    "assets/js/article.js": 2 * 1024,
    "assets/js/archive.js": 2 * 1024,
    "assets/js/challenge.js": 2 * 1024,
    "assets/js/theme.js": 3 * 1024,
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
    "posts": len(post_routes),
    "post_sections": {section: list(post_routes.values()).count(section) for section in ("root", "writeups", "tutorials", "ramblings")},
    "merged_tags": tag_count,
    "current_postfiles": current_postfiles,
    "legacy_attachment_aliases": len(LEGACY["attachments"]),
    "legacy_html_aliases": len(LEGACY["aliases"]),
    "archived_asset_paths": archived_asset_paths,
    "code_frames": code_frames,
    "math_expressions": math_expressions,
    "challenge_forms": forms,
    "challenge_pages": len(challenge_pages),
    "external_runtime_resources": 0,
    "analytics": f"goatcounter:{GOATCOUNTER}" if GOATCOUNTER else "none",
    "brand_mark_references": brand_marks,
    "artifact_files": artifact_files,
    "artifact_directories": artifact_directories,
    "metrics": metrics,
}, indent=2))
