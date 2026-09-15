#!/usr/bin/env python3
"""Offline source checks for the reader manual, not a Jekyll release check."""

import json
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
MAN = ROOT / "man/deuterium.html"
LOCAL_LINK = re.compile(r"\{\{\s*'(/[^']*)'\s*\|\s*relative_url\s*\}\}(.*)")
ROUTE_SOURCES = {
    "/": "index.html",
    "/about.html": "about.md",
    "/archive.html": "archive.html",
    "/WriteUps/": "WriteUps/index.md",
    "/ctf-tutorials/": "ctf-tutorials/index.md",
    "/ramblings/": "ramblings/index.md",
    "/feed.xml": "feed.xml",
    "/scoreboard/": "scoreboard/index.html",
    "/playground/": "playground.html",
    "/tetrasquares/": "tetrasquares/index.html",
    "/tetrasquares/catalog/": "tetrasquares/src/catalog/index.html",
    "/tetrasquares/scoring/": "tetrasquares/src/scoring/index.html",
    "/404.html": "404.md",
    "/teapot/": "teapot.html",
    "/man/deuterium/": "man/deuterium.html",
}


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def source_route(path):
    """Only the explicit/simple Jekyll page routes used by this manual."""
    source = read(path)
    match = re.match(r"\A---\n(.*?)\n---\n", source, re.S)
    if not match:
        raise AssertionError(f"Missing front matter: {path}")
    permalink = re.search(r"^permalink:\s*([^\n]+)$", match[1], re.M)
    if permalink:
        return permalink[1].strip().strip("\"'")
    result = "/" + str(Path(path).with_suffix(".html"))
    return result.removesuffix("index.html") if result.endswith("/index.html") else result


class Manual(HTMLParser):
    """Record links and examples; require balanced markup in this small fragment."""

    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.ids = []
        self.links = []
        self.examples = []
        self.headings = []
        self.text = []
        self.tags = []
        self.in_example = False
        self.in_heading = False
        self.feed(source.split("---", 2)[2])
        self.close()
        if self.stack:
            raise AssertionError(f"Unclosed tags: {self.stack}")

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.tags.append(tag)
        if tag not in {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}:
            self.stack.append(tag)
        if "id" in attrs:
            self.ids.append(attrs["id"])
        if tag == "a":
            self.links.append(attrs.get("href", ""))
        if tag == "pre":
            self.examples.append("")
            self.in_example = True
        if tag == "h2":
            self.headings.append("")
            self.in_heading = True

    def handle_endtag(self, tag):
        if not self.stack or self.stack.pop() != tag:
            raise AssertionError(f"Mismatched closing tag: {tag}")
        if tag == "pre":
            self.in_example = False
        if tag == "h2":
            self.in_heading = False

    def handle_data(self, data):
        if "style" not in self.stack:
            self.text.append(data)
        if self.in_example:
            self.examples[-1] += data
        if self.in_heading:
            self.headings[-1] += data


class ManPageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = MAN.read_text(encoding="utf-8")
        cls.page = Manual(cls.source)
        cls.text = " ".join(" ".join(cls.page.text).split())

    def test_sections_and_fragment_targets(self):
        self.assertEqual(len(self.page.ids), len(set(self.page.ids)))
        for heading in ("NAME", "SYNOPSIS", "DESCRIPTION", "OPTIONS", "GAME CENTER", "SCOREBOARD",
                        "ENCRYPTED PAGES", "BROWSER PRACTICE", "PLAYGROUND", "TETRASQUARES",
                        "CITATIONS AND PRINT", "SHARING", "MISSING PAGES", "EXIT STATUS",
                        "ENVIRONMENT", "FILES", "BUGS", "STANDARDS", "AUTHOR", "SEE ALSO"):
            self.assertIn(heading, self.page.headings)
            self.assertIn(heading.replace(" ", "-"), self.page.ids)
        for href in self.page.links:
            if href.startswith("#"):
                self.assertIn(href[1:], self.page.ids)

    def test_local_links_are_baseurl_safe_public_routes(self):
        themes = set(re.findall(r"^- id: (\S+)$", read("_data/themes.yml"), re.M))
        checked = set()
        for href in self.page.links:
            if href.startswith("#"):
                continue
            with self.subTest(href=href):
                match = LOCAL_LINK.fullmatch(href)
                self.assertIsNotNone(match, "Use a local relative_url link, not a source/docs URL")
                route, suffix = match.groups()
                self.assertTrue(not suffix or suffix.startswith(("?", "#")))
                if route == "/.well-known/security.txt":
                    self.assertIn('RELATIVE_DESTINATION = ".well-known/security.txt"', read("_plugins/security_txt.rb"))
                else:
                    self.assertIn(route, ROUTE_SOURCES)
                    self.assertEqual(source_route(ROUTE_SOURCES[route]), route)
                query = parse_qs(urlsplit(route + suffix).query)
                self.assertTrue(set(query) <= {"skin"})
                for skin in query.get("skin", []):
                    self.assertIn(skin, themes)
                checked.add(route)
        self.assertTrue(set(ROUTE_SOURCES) <= checked)
        # These source directories are remapped, not public /src/ routes.
        routes = json.loads(read("_data/tetrasquares_routes.json"))
        for route in ("/tetrasquares/", "/tetrasquares/catalog/", "/tetrasquares/scoring/"):
            self.assertEqual(routes[ROUTE_SOURCES[route]], route.lstrip("/") + "index.html")

    def test_progress_example_is_empty_v3_without_answers_or_private_ids(self):
        self.assertEqual(len(self.page.examples), 1)
        self.assertEqual(json.loads(self.page.examples[0]), {
            "version": 3, "solves": {}, "attempts": {}, "hints": {},
        })
        self.assertNotIn("script", self.page.tags)
        self.assertNotIn("form", self.page.tags)
        self.assertNotRegex(self.source, r"data-(?:answer|sha256|salt|needs|flag-check)\s*=")

    def test_documented_controls_exist(self):
        # Literal UI labels only: these catch drift such as documenting "Lock again"
        # when the deployed reader control is "Relock".
        for path, labels in {
            "assets/js/features/argon.js": ["Remember answers in this tab", "Relock", "Cancel unlock", "Clear saved answers and lock"],
            "assets/js/challenge.js": ["Keep correct answers in this tab for chained pages", "Clear tab answers", "Enter answer again"],
            "scoreboard/index.html": ["Copy public progress as JSON", "Import pasted progress"],
            "_includes/challenge-browser.html": ["Start", "Stop", "Reset", "Send", "Shift+Enter"],
            "_includes/publication-actions.html": ["Cite", "Download .bib"],
            "_includes/qr-share.html": ["Share this article", "Open QR SVG"],
        }.items():
            implementation = read(path)
            for label in labels:
                with self.subTest(path=path, label=label):
                    self.assertIn(label, implementation)
                    self.assertIn(label, self.text)
        playground = read("playground.html")
        select = re.search(r'<select[^>]+id="pg-preset"[^>]*>(.*?)</select>', playground, re.S)[1]
        presets = re.findall(r'<option value="[^"]+">([^<]+)</option>', select)
        self.assertEqual(presets, ["Trivial assert", "n-Queens (6)", "Sudoku, as SMT-LIB"])
        for preset in presets:
            self.assertIn(preset, self.text)

    def test_build_clock_not_an_arbitrary_revision_date(self):
        self.assertIn("Build {{ site.time | date: '%Y-%m-%d' }}", self.source)
        footer = re.search(r'<div class="man-foot".*?</div>', self.source, re.S)[0]
        self.assertNotRegex(footer, r"\b20\d\d-\d\d")
        build = read("script/build-site.sh")
        self.assertIn("BUILD_TIME", build)
        self.assertIn("git show -s --format=%cI HEAD", build)
        self.assertIn('time: "%s"', build)

    def test_no_pending_services_or_deployed_author_guide_claims(self):
        self.assertNotRegex(self.text.lower(), r"guestbook|webring")
        self.assertIn("not deployed as a site page", self.text)
        self.assertIn("not recovered posts or promises of future articles", self.text)
        self.assertIn("not watch mode", self.text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
