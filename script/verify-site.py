#!/usr/bin/env python3
"""Validate the unified root, section routes, content, privacy, and payloads."""

from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urljoin, urlsplit
import gzip
import hashlib
import html
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
APP_ROUTES = json.loads((SOURCE / "_data/tetrasquares_routes.json").read_text(encoding="utf-8"))
APP_PAGES = set(APP_ROUTES.values())
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
    VOID_ELEMENTS = {
        "area", "base", "br", "col", "embed", "hr", "img", "input",
        "link", "meta", "param", "source", "track", "wbr",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = self.h1 = self.main = self.description = 0
        self.canonicals: list[str] = []
        self.robots: list[str] = []
        self.head_robots: list[str] = []
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
        self.headings: list[tuple[int, str, bool]] = []
        self._heading: dict[str, object] | None = None
        self._element_stack: list[tuple[str, bool]] = []
        self._head_depth = 0
        self.unnamed_links: list[str] = []
        self._anchor: dict[str, str] | None = None
        self.forms = 0
        self.browser_forms = 0
        self.browser_widgets: list[dict] = []
        self.browser_resources: list[tuple[str, dict, bool]] = []
        self.unsafe_browser_markup: list[str] = []
        self._browser_depth = 0
        self._article_depth = 0
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
        classes = set((data.get("class") or "").split())
        style = re.sub(r"\s+", "", (data.get("style") or "").lower())
        ancestor_hidden = self._element_stack[-1][1] if self._element_stack else False
        element_hidden = ancestor_hidden or "hidden" in data or data.get("aria-hidden") == "true" or (
            "visually-hidden" in classes or "display:none" in style or "visibility:hidden" in style
        )
        if tag not in self.VOID_ELEMENTS:
            self._element_stack.append((tag, element_hidden))
        if tag == "head":
            self._head_depth = len(self._element_stack)
        if tag == "article" and data.get("id") == "article-body":
            self._article_depth = len(self._element_stack)
        if "data-challenge-practice" in data:
            self.browser_widgets.append(data)
            self._browser_depth = len(self._element_stack)
            if not self._article_depth or tag not in {"section", "div"}:
                self.unsafe_browser_markup.append("widget outside article")
        for key in ("src", "href"):
            path = urlsplit(data.get(key) or "").path
            if "/assets/js/challenge-practice/" in path or path.endswith("/assets/css/features/challenge-practice.css"):
                self.browser_resources.append((tag, data, bool(self._article_depth)))
        if self._browser_depth:
            if tag == "form":
                self.browser_forms += 1
                if "action" in data or "name" in data or "data-flag-check" in data:
                    self.unsafe_browser_markup.append("practice form attributes")
            if "name" in data or "formaction" in data or tag in {"script", "pre", "iframe", "object", "embed"}:
                self.unsafe_browser_markup.append("active practice markup")
        if tag == "title": self.title += 1
        if tag == "h1": self.h1 += 1
        if re.fullmatch(r"h[1-6]", tag):
            level = int(tag[1])
            self.heading_levels.append(level)
            self._heading = {
                "level": level,
                "tag": tag,
                "text": [],
                "hidden": element_hidden,
            }
        if tag == "main": self.main += 1
        if tag == "body": self.body_classes.update((data.get("class") or "").split())
        if tag == "meta" and data.get("name") == "description": self.description += 1
        if tag == "meta" and data.get("name") == "robots":
            value = data.get("content") or ""
            self.robots.append(value)
            if self._head_depth and len(self._element_stack) == self._head_depth:
                self.head_robots.append(value)
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
                if (split.hostname or "").lower() == SITE_HOST.lower():
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
        if self._heading is not None:
            text = self._heading["text"]
            assert isinstance(text, list)
            text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if self._heading is not None and tag == self._heading["tag"]:
            text = self._heading["text"]
            assert isinstance(text, list)
            self.headings.append((
                int(self._heading["level"]),
                " ".join("".join(text).split()),
                bool(self._heading["hidden"]),
            ))
            self._heading = None
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
        for index in range(len(self._element_stack) - 1, -1, -1):
            if self._element_stack[index][0] == tag:
                del self._element_stack[index:]
                break
        if len(self._element_stack) < self._head_depth:
            self._head_depth = 0
        if len(self._element_stack) < self._browser_depth:
            self._browser_depth = 0
        if len(self._element_stack) < self._article_depth:
            self._article_depth = 0


def check_browser_scope(audit: Audit, entry: dict | None, label: str) -> None:
    intended = entry is not None
    if len(audit.browser_widgets) != int(intended) or audit.browser_forms != int(intended):
        fail(f"browser practice form/widget scope: {label}")
    if audit.unsafe_browser_markup:
        fail(f"unsafe browser practice markup: {label}")
    if intended:
        widget = audit.browser_widgets[0]
        if widget.get("data-id") != entry["id"] or widget.get("data-runtime") != entry["slug"]:
            fail(f"browser practice binding: {label}")
    resources = []
    for tag, attrs, in_article in audit.browser_resources:
        parsed = urlsplit(attrs.get("src") or attrs.get("href") or "")
        if parsed.scheme or parsed.netloc:
            fail(f"nonlocal browser resource: {label}")
        if in_article:
            fail(f"browser resource inside article body: {label}")
        if tag == "script" and attrs.get("type") == "module":
            resources.append(urlsplit(attrs.get("src") or "").path)
        elif tag == "link" and attrs.get("rel") == "stylesheet":
            resources.append(urlsplit(attrs.get("href") or "").path)
        else:
            fail(f"unexpected browser resource type: {label}")
    expected = ["/assets/js/challenge-practice/ui.mjs", "/assets/css/features/challenge-practice.css"] if intended else []
    if sorted(resources) != sorted(expected):
        fail(f"browser resource scope: {label}")


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


def expected_post_routes() -> dict[str, str]:
    """Map canonical URLs to sections; filesystem paths are derived separately."""
    registered = registered_challenge_routes()
    routes: dict[str, str] = {}
    for source in sorted((SOURCE / "_posts").rglob("*.md")):
        match = DATE_POST.match(source.name)
        if not match:
            continue
        rel = source.relative_to(SOURCE / "_posts")
        first = rel.parts[0]
        if source.relative_to(SOURCE).as_posix() in registered:
            route = registered[source.relative_to(SOURCE).as_posix()].lstrip("/")
            section = "tutorials"
        elif first == "WriteUps":
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
        route = "/" + route
        if route in routes: fail(f"duplicate expected post route: {route}")
        routes[route] = section
    return routes


def parse_archive(path: Path) -> list[str]:
    records = re.findall(r'<li\b[^>]*data-record[^>]*>.*?<a\b[^>]*href="([^"]+)"', path.read_text(encoding="utf-8"), re.S)
    return [unquote(urlsplit(html.unescape(url)).path) for url in records]


def has_robots_directive(values: list[str], expected: str) -> bool:
    directives = {
        directive.strip().lower()
        for value in values
        for directive in value.split(",")
        if directive.strip()
    }
    return expected.lower() in directives


def resolved_local_path(ref: str, page_path: str) -> str:
    base = f"{SITE_URL}/{page_path}"
    decoded = unquote(urlsplit(urljoin(base, ref)).path)
    segments: list[str] = []
    for segment in decoded.split("/"):
        if segment in {"", "."}: continue
        if segment == "..":
            if segments: segments.pop()
        else:
            segments.append(segment)
    return "/" + "/".join(segments)


def check_home_pagination(root: Path, archive_order: list[str], page_size: int) -> None:
    if page_size <= 0: fail("invalid pagination size")
    expected_pages = max(1, (len(archive_order) + page_size - 1) // page_size)
    expected_paths = {
        root / ("index.html" if number == 1 else f"page{number}/index.html")
        for number in range(1, expected_pages + 1)
    }
    actual_paths = {root / "index.html", *root.glob("page*/index.html")}
    if actual_paths != expected_paths: fail("home pagination path drift")
    for number in range(1, expected_pages + 1):
        path = root / ("index.html" if number == 1 else f"page{number}/index.html")
        start = (number - 1) * page_size
        if parse_archive(path) != archive_order[start:start + page_size]:
            fail(f"home pagination membership or order drift: page {number}")


def check_archive_membership(actual: list[str], expected: set[str], label: str) -> None:
    if len(actual) != len(expected) or set(actual) != expected:
        fail(f"{label} archive membership drift")


# Canonical tags in the retained 83-post challenge-archive/site/index.json.
# Keep these independent of the build being checked; additions come from the
# registered posts' JSON-compatible tags below.
BASELINE_TAGS = frozenset("""
0CTF 2020 2021 2022 2023 ACSC AES AI BATPWN BlowFish Bsides CBC CRT CTF DES
ECC ECDLP ECM GCD GCM GF2 HSCTF HTB LC4 LCG Nullcon PoW QR RACTF RSA SDCTF SPN
abbreviations affine alpertron artificial_intelligence assignment base12 base64
bash bifid big_e binius64 bit_flipping bonehdurfee bootleg bruteforce cairo-m
ceno challenges choosen_plaintext classical close_primes combinatorics
contribution coppersmith cryptanalysis crypto cryptography cyber_apocalypse
cybersecurity dialogue differential dusk encoding errorcorrection expander
fernet fiat-shamir franklinreiter games gaussian_elimination golang googlectf
gromark guess hacking hashcollision hastad_broadcast hillcipher injection
inputrc introduction invalid_curve invariant javascript jolt known_plaintext
kzg leakage magic mastermind matrixinverse mersenne_twister miscellaneous
morse nahamcon netcat nexus oracle out_of_context padding paillier palindrome
permutation plonk polynomialring ponder poo-i-try prime productivity
programming pun python_bytes python_walrus quipquip railfence randoblurry rc4
redpwn reversing rgbCTF sagemath sat schmidtsamoa short small_e small_factors
small_prime smt soundness substitution testing tetris timeseed transposition
twin_prime vignere vim wargames weak_keys welcome wordgame xor z3 zh3r0
zh3r0_ctf2 zk zkvm
""".split())
# These tags belonged only to the three posts intentionally removed from every
# generated discovery surface. Shared tags remain with their visible posts.
HIDDEN_ONLY_TAGS = frozenset("""
binius64 cairo-m ceno dusk expander fiat-shamir jolt kzg mastermind nexus plonk
sat soundness zk zkvm
""".split())


def expected_archive_tags() -> set[str]:
    tags = set(BASELINE_TAGS - HIDDEN_ONLY_TAGS)
    for path in registered_challenge_routes():
        text = (SOURCE / path).read_text(encoding="utf-8")
        header = re.match(r"\A---\n(.*?)\n---(?:\n|\Z)", text, re.S)
        field = re.search(r"(?m)^tags:\s*(\[[^\n]*\])\s*$", header[1]) if header else None
        try:
            values = json.loads(field[1]) if field else None
        except json.JSONDecodeError:
            values = None
        if not isinstance(values, list) or not values or not all(isinstance(tag, str) and tag.strip() for tag in values):
            fail(f"invalid challenge post tags: {path}")
        # These are the same three canonicalizations as _data/tag_aliases.yml.
        aliases = {"ctf": "CTF", "ctfs": "CTF", "rsa": "RSA"}
        tags.update(aliases.get(tag, tag) for tag in values)
    return tags


def check_archive_tags(archive_text: str) -> int:
    block = re.search(r'<div class="all-tags__grid[^>]*>(.*?)</div>', archive_text, re.S)
    if not block: fail("tag index missing")
    labels = []
    for href in re.findall(r'href="([^"]+)"', block[1]):
        query = parse_qs(urlsplit(html.unescape(href)).query)
        if len(query.get("tag", [])) != 1: fail("invalid archive tag link")
        labels.append(query["tag"][0])
    expected = expected_archive_tags()
    if len(labels) != len(expected) or set(labels) != expected:
        fail(f"merged tag membership drift: missing={sorted(expected - set(labels))} extra={sorted(set(labels) - expected)}")
    if len(re.findall(r"\bdata-filter=", block[1])) != len(labels): fail("archive tag filter count drift")
    return len(labels)


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
}
required.update(APP_PAGES)
required.update(HISTORICAL["html_paths"])
if (ROOT / "new-tetris").exists(): fail("retired new-tetris directory remains in output")
for retired in HISTORICAL.get("retired_html_paths", []):
    if (ROOT / retired).exists(): fail(f"retired route remains: {retired}")
for rel in sorted(required):
    if not (ROOT / rel).is_file(): fail(f"required output missing: {rel}")

post_routes = expected_post_routes()
if len(post_routes) != 101: fail(f"source post count drift: {len(post_routes)}")
for route in post_routes:
    if not (ROOT / post_output_path(route)).is_file(): fail(f"post route missing: {route}")

hidden_config = json.loads((SOURCE / "_data/hidden_posts.json").read_text(encoding="utf-8"))
if hidden_config.get("version") != 1 or not isinstance(hidden_config.get("posts"), list):
    fail("invalid hidden-post configuration")
expected_hidden_posts = {
    ("_posts/2026/osec_mirror/zkvms/2026-03-03-unfaithful-claims-breaking-6-zkvms.md", "/2026/03/03/unfaithful-claims-breaking-6-zkvms.html"),
    ("_posts/2026/osec_mirror/dusk/2026-04-13-dusk-commitment-issues.md", "/2026/04/13/dusk-commitment-issues.html"),
    ("_posts/2026-09-06-masatermind.md", "/2026/09/06/masatermind.html"),
}
hidden_posts = {(entry.get("path"), entry.get("url")) for entry in hidden_config["posts"] if isinstance(entry, dict)}
if hidden_posts != expected_hidden_posts or len(hidden_config["posts"]) != len(expected_hidden_posts):
    fail(f"hidden-post membership drift: {sorted(hidden_posts)}")
for entry in hidden_config["posts"]:
    if not isinstance(entry.get("reason"), str) or not entry["reason"].strip(): fail("hidden-post reason is missing")
    if not (SOURCE / entry["path"]).is_file(): fail(f"hidden-post source missing: {entry['path']}")
hidden_routes = {url for _, url in hidden_posts}
if not hidden_routes.issubset(post_routes): fail("hidden-post route is not a post")
listed_routes = set(post_routes) - hidden_routes

pages = sorted(ROOT.rglob("*.html"))
VERIFICATION_HTML = {"google98b86655786074b6.html", "yandex_0a37c4f8df609655.html"}
shell_pages = [
    page for page in pages
    if page.relative_to(ROOT).as_posix() not in APP_PAGES
    and page.relative_to(ROOT).as_posix() not in VERIFICATION_HTML
]
browser_entries = {post_output_path(e["url"]): e for e in json.loads(
    (SOURCE / "_data/authored_challenges.json").read_text(encoding="utf-8"))["entries"] if e["mode"] == "interactive"}
if len(browser_entries) != 11: fail("browser practice membership drift")
forms = browser_forms = challenge_scripts = article_scripts = theme_scripts = images = brand_marks = code_frames = math_expressions = 0
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
    check_browser_scope(audit, browser_entries.get(rel), rel)
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
    if rel in APP_PAGES:
        expected_path = "/" + rel.removesuffix("index.html")
        if audit.description != 1 or audit.canonicals != [f"{SITE_URL}{expected_path}"]:
            fail(f"static-app metadata drift: {rel}")
        if text.count('property="og:title"') != 1 or f'property="og:url" content="{SITE_URL}{expected_path}"' not in text:
            fail(f"static-app social metadata drift: {rel}")
        if 'class="site-header"' in text or '/assets/css/main.css' in text:
            fail(f"blog layout leaked into game: {rel}")
        continue
    if (audit.title, audit.h1, audit.main, audit.description, len(audit.canonicals)) != (1, 1, 1, 1, 1):
        fail(f"shell invariant failed: {rel}")
    if len(audit.ids) != len(set(audit.ids)): fail(f"duplicate id: {rel}")
    if audit.bad_images: fail(f"image metadata missing in {rel}: {audit.bad_images}")
    if any(level <= 2 and hidden for level, _, hidden in audit.headings):
        fail(f"hidden primary heading: {rel}")
    visible_headings = [(level, label) for level, label, hidden in audit.headings if not hidden]
    repeated_headings = [
        (left, right) for left, right in zip(visible_headings, visible_headings[1:])
        if left[0] <= 2 and right[0] <= 2 and left[1].casefold() == right[1].casefold()
    ]
    if repeated_headings:
        fail(f"adjacent repeated headings in {rel}: {repeated_headings[:5]}")
    if 'aria-label="Social and subscription links"' not in text or "Are you really sure that you want to reach me?" not in text:
        fail(f"social footer missing: {rel}")
    for href in (
        "https://github.com/deut-erium",
        "https://twitter.com/0xdeuterium",
        "https://www.linkedin.com/in/himanshu-sheoran-ab047b152",
        "https://discord.com/users/650776387535503372",
        "mailto:himanshu_sheoran@yahoo.com",
    ):
        if f'href="{href}"' not in text:
            fail(f"social link missing in {rel}: {href}")
    if "Static HTML, local assets, and no tracking." in text or "posts by <a" in text:
        fail(f"retired footer copy remains: {rel}")
    if audit.unsafe_flag_forms: fail(f"unsafe local checker in {rel}: {audit.unsafe_flag_forms}")
    if '<details class="nav-menu"' in text:
        fail(f"primary navigation must remain visible: {rel}")
    primary_nav = re.search(r'<nav\b[^>]*class="site-nav"[^>]*>(.*?)</nav>', text, re.S)
    expected_nav = {"/", "/archive.html", "/WriteUps/", "/ctf-tutorials/", "/ramblings/", "/about.html"}
    if not primary_nav or set(re.findall(r'href="([^"]+)"', primary_nav[1])) != expected_nav:
        fail(f"primary navigation destinations changed: {rel}")
    if any("noindex" in value.lower() for value in audit.robots):
        output_url = "/" + rel
        noindex_paths.add(output_url)
        if rel.endswith("/index.html"): noindex_paths.add("/" + rel.removesuffix("index.html"))
    forms += audit.forms + audit.browser_forms
    browser_forms += audit.browser_forms
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

home_text = (ROOT / "index.html").read_text(encoding="utf-8")
home_headings = page_audits["index.html"].headings
if not home_headings or home_headings[0] != (1, "Your curiosity?", False):
    fail(f"home must begin with the visible masthead heading: {home_headings[:2]}")
if 'class="masthead"' not in home_text:
    fail("home masthead missing")
for phrase in ("what brings you here?", "Your curiosity?", "Please don't press any buttons, I don't know what they do"):
    if phrase not in home_text:
        fail(f"home masthead copy missing: {phrase}")
if home_text.index('id="sections-title"') > home_text.index('id="records"'):
    fail("home publications must precede latest posts")
if 'class="masthead__actions"' not in home_text:
    fail("home masthead actions missing")
SITE_TITLE = "deuterium's blog"
for retired in ("deut-erium.github.io</p>", f"{SITE_TITLE}</h1>"):
    if retired in home_text:
        fail(f"repeated home masthead copy remains: {retired[:40]}")
for rel in ("archive.html", "WriteUps/index.html", "ctf-tutorials/index.html", "ramblings/index.html"):
    text = (ROOT / rel).read_text(encoding="utf-8")
    if 'class="masthead"' in text:
        fail(f"masthead outside the home page: {rel}")
    if re.search(r'<(?:header|section)\b[^>]*>\s*<p class="eyebrow">', text):
        fail(f"repeated landing-page eyebrow remains: {rel}")
if home_text.count("Himanshu Sheoran's blog on tech, security, CTFs and cryptography") != 1:
    fail("site tagline must appear once on the home page")
for rel in ("archive.html", "WriteUps/index.html", "ctf-tutorials/index.html", "ramblings/index.html"):
    text = (ROOT / rel).read_text(encoding="utf-8")
    if re.search(r'<(?:header|section)\b[^>]*>\s*<p class="eyebrow">', text):
        fail(f"repeated landing-page eyebrow remains: {rel}")

# Additive features may add shell pages; the baseline may not shrink.
if len(pages) < 139 or len(shell_pages) < 134: fail(f"HTML count regression: all={len(pages)} shell={len(shell_pages)}")
# Eighteen challenge posts add article scripts and one download code frame each;
# seven also add an event checker, eleven add browser practice forms. Existing
# checker/article scripts, download frames and math counts stay fixed. The About
# page's retired profile card accounts for the one removed content image.
if browser_forms != 11: fail(f"browser practice form count drift: {browser_forms}")
if (forms, challenge_scripts, article_scripts, code_frames, math_expressions, images) != (28, 13, 101, 355, 275, 103):
    fail(f"content scoping drift: forms={forms} challenge_js={challenge_scripts} article_js={article_scripts} code_frames={code_frames} math={math_expressions} images={images}")
if len(challenge_pages) != 13: fail(f"challenge page count drift: {len(challenge_pages)}")
if theme_scripts != len(shell_pages): fail(f"theme script scoping drift: {theme_scripts} != {len(shell_pages)}")
if brand_marks != len(shell_pages): fail(f"brand-mark scoping drift: {brand_marks} != {len(shell_pages)}")
if len(math_pages) != 7: fail(f"math page count drift: {len(math_pages)}")
if GOATCOUNTER:
    wired = [rel for rel, audit in page_audits.items() if rel not in VERIFICATION_HTML and not audit.refresh]
    missing_script = [rel for rel in wired if page_audits[rel].analytics.count(ANALYTICS_SCRIPT) != 1]
    missing_pixel = [rel for rel in wired if len([r for r in page_audits[rel].analytics if r != ANALYTICS_SCRIPT and urlsplit(r).netloc == f"{GOATCOUNTER}.goatcounter.com"]) != 1]
    if missing_script: fail(f"goatcounter script missing in {missing_script[:5]}")
    if missing_pixel: fail(f"goatcounter pixel missing in {missing_pixel[:5]}")

article_routes = {route for route in post_routes if 'itemtype="https://schema.org/Article"' in (ROOT / post_output_path(route)).read_text(encoding="utf-8")}
if article_routes != set(post_routes): fail(f"article schema route drift: {sorted(set(post_routes) - article_routes)[:10]}")
writeup_routes = {route for route, section in post_routes.items() if section == "writeups"}
if len(writeup_routes) != 61: fail(f"WriteUps source count drift: {len(writeup_routes)}")
for route in writeup_routes:
    rel = post_output_path(route)
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
archive_order = parse_archive(ROOT / "archive.html")
check_archive_membership(archive_order, listed_routes, "global")
tag_count = check_archive_tags(archive_text)
if "?tag=RSA" not in archive_text or "?tag=CTF" not in archive_text or "?tag=rsa" in archive_text or "?tag=ctfs" in archive_text:
    fail("tag alias merge drift")

# Feeds must be exact newest-first windows with bounded, nonempty summaries.
global_feed = parse_feed(ROOT / "feed.xml", link_ids=False)
if global_feed != archive_order[:10]: fail("global feed membership or order drift")
section_specs = {
    "WriteUps": ("writeups", 20, "/WriteUps/"),
    "ramblings": ("ramblings", 5, "/ramblings/"),
    "ctf-tutorials": ("tutorials", 20, "/ctf-tutorials/"),
}
for directory, (section, limit, home) in section_specs.items():
    expected = [path for path in archive_order if post_routes[path] == section]
    check_archive_membership(parse_archive(ROOT / directory / "archive.html"), set(expected), directory)
    # WriteUps has a paginated home; the other section homes list every post.
    if section != "writeups":
        check_archive_membership(parse_archive(ROOT / directory / "index.html"), set(expected), f"{directory} home")
    actual = parse_feed(ROOT / directory / "feed.xml")
    if actual != expected[:limit]: fail(f"section feed membership or order drift: {directory}")
    sitemap = parse_sitemap(ROOT / directory / "sitemap.xml")
    if sitemap != {home, *expected}: fail(f"section sitemap membership drift: {directory}")

root_sitemap = parse_sitemap(ROOT / "sitemap.xml")
if not listed_routes.issubset(root_sitemap): fail("root sitemap omits listed posts")
if hidden_routes.intersection(root_sitemap): fail("root sitemap lists hidden posts")
if not {"/" + rel.removesuffix("index.html") for rel in APP_PAGES}.issubset(root_sitemap):
    fail("root sitemap omits Tetrasquares pages")
if any(path.startswith("/new-tetris/") for path in root_sitemap):
    fail("root sitemap retains retired game URLs")
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

pagination_match = re.search(r"(?m)^paginate:\s*(\d+)\s*$", (SOURCE / "_config.yml").read_text(encoding="utf-8"))
if not pagination_match: fail("pagination size is missing")
check_home_pagination(ROOT, archive_order, int(pagination_match.group(1)))
post_index = json.loads((ROOT / "index.json").read_text(encoding="utf-8"))
indexed_routes = {unquote(urlsplit(entry.get("route", "")).path) for entry in post_index if isinstance(entry, dict)}
if len(post_index) != len(listed_routes) or indexed_routes != listed_routes:
    fail("JSON post index lists hidden or missing posts")
hidden_outputs = {post_output_path(route) for route in hidden_routes}
for hidden_route in hidden_routes:
    rel = post_output_path(hidden_route)
    audit = page_audits[rel]
    if len(audit.head_robots) != 1 or not has_robots_directive(audit.head_robots, "noindex"):
        fail(f"hidden post is indexable: {hidden_route}")
for page in pages:
    rel = page.relative_to(ROOT).as_posix()
    if rel in hidden_outputs: continue
    for ref in page_audits[rel].local:
        if resolved_local_path(ref, rel) in hidden_routes:
            fail(f"hidden post linked from generated page: {rel}")

# Sidecar assets for hidden posts must remain available and byte-identical.
hidden_postfiles = 0
content_by_path = {item["path"]: item for item in CONTENT["files"]}
for source_path, hidden_route in hidden_posts:
    source_dir = Path(source_path).parent
    public_dir = ROOT / Path(hidden_route.lstrip("/")).parent
    for asset_path, item in content_by_path.items():
        asset = Path(asset_path)
        if asset.parent != source_dir or DATE_POST.match(asset.name): continue
        public = public_dir / asset.name
        if not public.is_file(): fail(f"hidden postfile missing: {public.relative_to(ROOT)}")
        data = public.read_bytes()
        if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
            fail(f"hidden postfile drift: {public.relative_to(ROOT)}")
        hidden_postfiles += 1
if hidden_postfiles != 19: fail(f"hidden postfile count drift: {hidden_postfiles}")

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
# 2026-09 image work: 230 -> 237 (12-shades: extracted jpeg dropped, 8 webp strips added).
if current_postfiles != 237: fail(f"current postfile count drift: {current_postfiles}")

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
    path = ROOT / APP_ROUTES.get(item["path"], item["path"])
    if not path.is_file(): fail(f"static app file missing: {item['path']}")
    if item["path"] in APP_ROUTES:
        # Source integrity is checked before Jekyll renders entry HTML.
        # Rendered metadata, routes and analytics are checked above.
        if APP_ROUTES[item["path"]] != item["path"] and (ROOT / item["path"]).exists():
            fail(f"noncanonical game entry remains: {item['path']}")
        continue
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

# The inline theme bootstrap builds skin stylesheet URLs from a JS map that
# HTML auditing cannot see, so pin it here: every entry must name a real skin
# file, and the deferred theme-bootstrap.js loader must point at the built asset.
bootstrap_probe = (ROOT / "index.html").read_text(encoding="utf-8")
skin_map = re.search(r"const skinFiles = \{(.*?)\};", bootstrap_probe, re.S)
if not skin_map:
    fail("theme bootstrap skin map missing from rendered HTML")
for skin_id, skin_href in re.findall(r'"([a-z0-9-]+)":\s*"([^"]+)"', skin_map.group(1)):
    clean = skin_href.split("?", 1)[0]
    if not clean.startswith("/assets/css/skins/"):
        fail(f"skin map entry outside skins dir: {skin_id} -> {skin_href}")
    if not (ROOT / clean.lstrip("/")).is_file():
        fail(f"skin map entry missing file: {skin_id} -> {clean}")
if not re.search(r"theme-bootstrap\.js\?v=[0-9a-f]{8}", bootstrap_probe):
    fail("theme bootstrap loader URL missing or unversioned")

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
    "assets/favicon.svg": "aa8d686d23ae6fbc6d08793e2869e9225992372f7ee09c609b5ba35bf756073e",
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
if '<details id="resume-details" class="resume-disclosure">' not in about_text or "<summary>Hire me?</summary>" not in about_text:
    fail("collapsible resume missing from About page")
if '<details id="resume-details" class="resume-disclosure" open' in about_text:
    fail("About resume is open by default")
for stale in ('/assets/resume.pdf', 'id="ottersec-work"', 'id="ottersec-projects"', 'candidate := deuterium', 'ready to overfit'):
    if stale in about_text:
        fail(f"stale resume content on About page: {stale}")
if (ROOT / "assets/resume.pdf").exists():
    fail("stale static resume PDF remains in build")

for path in ROOT.rglob("*"):
    if path.is_file() and (path.suffix == ".map" or "sourceMappingURL=" in path.read_text(encoding="utf-8", errors="ignore")):
        fail(f"source map leak: {path.relative_to(ROOT)}")
for forbidden in ("vendor", "node_modules", "Gemfile", "Gemfile.lock", "package.json", "package-lock.json", "agent_out", "script", ".git", ".github"):
    if (ROOT / forbidden).exists(): fail(f"build leak: {forbidden}")

budgets = {
    "index.html": 10 * 1024,
    "archive.html": 16 * 1024,
    "feed.xml": 12 * 1024,
    "WriteUps/index.html": 10 * 1024,
    "WriteUps/feed.xml": 16 * 1024,
    "assets/css/main.css": 12 * 1024,
    "assets/js/article.js": 2 * 1024,
    "assets/js/archive.js": 2 * 1024,
    "assets/js/challenge.js": 3 * 1024,
    "assets/js/theme.js": 3 * 1024,
    "assets/js/theme-bootstrap.js": 4 * 1024,
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
    "listed_posts": len(listed_routes),
    "hidden_posts": len(hidden_routes),
    "hidden_postfiles": hidden_postfiles,
    "post_sections": {section: list(post_routes.values()).count(section) for section in ("root", "writeups", "tutorials", "ramblings")},
    "merged_tags": tag_count,
    "current_postfiles": current_postfiles,
    "legacy_attachment_aliases": len(LEGACY["attachments"]),
    "legacy_html_aliases": len(LEGACY["aliases"]),
    "archived_asset_paths": archived_asset_paths,
    "code_frames": code_frames,
    "math_expressions": math_expressions,
    "challenge_forms": forms,
    "browser_practice_forms": browser_forms,
    "challenge_pages": len(challenge_pages),
    "external_runtime_resources": 0,
    "analytics": f"goatcounter:{GOATCOUNTER}" if GOATCOUNTER else "none",
    "brand_mark_references": brand_marks,
    "artifact_files": artifact_files,
    "artifact_directories": artifact_directories,
    "metrics": metrics,
}, indent=2))
