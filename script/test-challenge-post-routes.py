#!/usr/bin/env python3
"""Offline fixtures for the two post-route gates; no Jekyll build required."""

from __future__ import annotations

import ast
import copy
import html
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import quote, unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "agent_out/challenge-runtime/integration/post-route-gates"
RETAINED = ROOT / "agent_out/challenge-posts/legacy-baseline.json"


def load_gate(name: str) -> dict:
    """Execute the actual helpers without invoking the full-build gate.

    The CLI scripts intentionally validate at top level. Only imports, helper
    definitions and the named constants below are needed for these fixtures.
    A separate test executes the archive/feed/sitemap block unchanged.
    """
    path = ROOT / "script" / name
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    constants = {"DATE_POST", "EMOJI", "ATOM", "SITEMAP", "BASELINE_TAGS", "HIDDEN_ONLY_TAGS"}
    nodes = []
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            if isinstance(node, ast.ImportFrom) and node.module == "artifact_manifest":
                continue
            nodes.append(node)
        elif isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            nodes.append(node)
        elif isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id in constants for target in node.targets):
            nodes.append(node)
    env = {
        "__name__": "route_fixture", "SOURCE": ROOT, "SITE": OUT, "ROOT": OUT,
        "SITE_URL": "https://deut-erium.github.io", "SITE_HOST": "deut-erium.github.io",
        "EXTERNAL_PROJECT_PATHS": ("/pyfractal",), "GOATCOUNTER": "",
    }
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), "exec"), env)
    return env


def archive_gate_code():
    path = ROOT / "script/verify-site.py"
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))

    def assignment(node, name):
        return isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == name for target in node.targets)

    start = next(i for i, node in enumerate(tree.body) if assignment(node, "archive_text"))
    end = next(i for i, node in enumerate(tree.body) if assignment(node, "robots"))
    return compile(ast.Module(body=tree.body[start:end], type_ignores=[]), str(path), "exec")


def write(root: Path, name: str, text: str) -> Path:
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def sample_entry() -> dict:
    return {
        "id": "fixture-2031-example", "event_id": "fixture-2031", "slug": "example",
        "url": "/challenges/fixture-2031/example/",
        "post_path": "_posts/ctf-tutorials/challenges/2031-01-02-example.md",
    }


def catalog_fixture(root: Path) -> dict:
    entry = sample_entry()
    write(root, "_data/authored_challenges.json", json.dumps({"entries": [entry]}))
    write(root, entry["post_path"], '---\ntags: ["challenges", "crypto"]\n---\n## Files\n```sh\n# Not a heading\n```\n## Check your flag\n')
    return entry


class RouteTests(unittest.TestCase):
    def setUp(self):
        OUT.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="native-", dir=OUT)
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        self.site = load_gate("verify-site.py")
        self.heading = load_gate("verify-heading-parity.py")

    def retained_rows(self):
        return json.loads(RETAINED.read_text(encoding="utf-8"))["posts"]

    def test_catalog_maps_all_eighteen_posts_to_tutorials(self):
        expected = {entry["post_path"]: entry["url"] for entry in json.loads((ROOT / "_data/authored_challenges.json").read_text())["entries"]}
        self.assertEqual(len(expected), 18)
        self.assertEqual(self.site["registered_challenge_routes"](), expected)
        self.assertEqual(self.heading["registered_challenge_routes"](), expected)
        routes = self.site["expected_post_routes"]()
        self.assertEqual(len(routes), 101)
        for path, route in expected.items():
            with self.subTest(path=path):
                self.assertEqual(routes[route], "tutorials")
                output = route.lstrip("/") + "index.html"
                self.assertEqual(self.site["post_output_path"](route), output)
                match = self.heading["DATE_POST"].fullmatch(Path(path).name)
                self.assertEqual(self.heading["output_path"](ROOT / path, match, "tutorials", expected), OUT / output)
                header = (ROOT / path).read_text().split("---", 2)[1]
                fields = {key: json.loads(value) for key, value in (line.split(":", 1) for line in header.splitlines() if ":" in line)}
                self.assertEqual(fields["permalink"], route)
                self.assertEqual(fields["section"], "tutorials")

    def test_original_eighty_three_routes_match_retained_index(self):
        rows = self.retained_rows()
        baseline = {unquote(urlsplit(row["route"]).path): row["section"] for row in rows}
        registered = self.site["registered_challenge_routes"]()
        actual = self.site["expected_post_routes"]()
        old = {route: section for route, section in actual.items() if route not in registered.values()}
        self.assertEqual(len(baseline), 83)
        self.assertEqual(old, baseline)
        for source in (ROOT / "_posts").rglob("*.md"):
            match = self.heading["DATE_POST"].fullmatch(source.name)
            if not match or source.relative_to(ROOT).as_posix() in registered:
                continue
            first = source.relative_to(ROOT / "_posts").parts[0]
            section = {"WriteUps": "writeups", "ctf-tutorials": "tutorials", "ramblings": "ramblings"}.get(first, "root")
            destination = self.heading["output_path"](source, match, section, registered)
            self.assertEqual(baseline["/" + destination.relative_to(OUT).as_posix()], section)

    def test_retained_section_archives_match_original_membership(self):
        rows = self.retained_rows()
        for directory, section in (("WriteUps", "writeups"), ("ramblings", "ramblings"), ("ctf-tutorials", "tutorials")):
            expected = {unquote(urlsplit(row["route"]).path) for row in rows if row["section"] == section}
            for name in (["archive.html"] if section == "writeups" else ["archive.html", "index.html"]):
                with self.subTest(directory=directory, name=name):
                    actual = json.loads(RETAINED.read_text(encoding="utf-8"))["section_archives"][f"{directory}/{name}"]
                    self.site["check_archive_membership"](actual, expected, directory)

    def test_original_tags_and_single_new_tag_match_retained_index(self):
        tags = {tag for row in self.retained_rows() for tag in row["tags"]}
        self.assertEqual(len(tags), 149)
        self.assertEqual(self.site["BASELINE_TAGS"], tags)
        current = self.site["expected_archive_tags"]()
        visible = tags - self.site["HIDDEN_ONLY_TAGS"]
        self.assertEqual(len(current), 135)
        self.assertEqual(current, visible | {"misc"})
        aliases = dict(line.split(": ") for line in (ROOT / "_data/tag_aliases.yml").read_text().splitlines() if line)
        self.assertEqual(aliases, {"ctf": "CTF", "ctfs": "CTF", "rsa": "RSA"})

    def test_original_route_inference_ignores_unregistered_permalinks(self):
        catalog_fixture(self.work)
        self.site["SOURCE"] = self.heading["SOURCE"] = self.work
        cases = [
            ("_posts/2020-02-03-root post.md", "/2020/02/03/root-post.html", "root"),
            ("_posts/21-02-03-short.md", "/21/02/03/short.html", "root"),
            ("_posts/WriteUps/event/2020-02-03-Write Up.md", "/WriteUps/event/2020-02-03-Write Up.html", "writeups"),
            ("_posts/ramblings/nested/21-02-03-short name.md", "/ramblings/2021/02/03/short-name.html", "ramblings"),
            ("_posts/ctf-tutorials/21-02-03-tutorial.md", "/ctf-tutorials/2021/02/03/tutorial.html", "tutorials"),
            ("_posts/ctf-tutorials/2020-02-03-index.md", "/ctf-tutorials/2020/02/03/index.html", "tutorials"),
        ]
        for path, _, _ in cases:
            write(self.work, path, "---\npermalink: /ignored/\n---\n")
        registered = self.site["registered_challenge_routes"]()
        actual = self.site["expected_post_routes"]()
        for path, url, section in cases:
            with self.subTest(path=path):
                self.assertEqual(actual[url], section)
                match = self.heading["DATE_POST"].fullmatch(Path(path).name)
                destination = self.heading["output_path"](self.work / path, match, section, registered)
                self.assertEqual(destination, OUT / url.lstrip("/"))
                self.assertEqual(self.site["post_output_path"](url), url.lstrip("/"))

    def rejected_catalog(self, mutate, message):
        entry = catalog_fixture(self.work)
        data = {"entries": [entry]}
        mutate(data)
        write(self.work, "_data/authored_challenges.json", json.dumps(data))
        for gate in (self.site, self.heading):
            gate["SOURCE"] = self.work
            with self.assertRaisesRegex(SystemExit, message):
                gate["registered_challenge_routes"]()

    def test_duplicate_registered_path_rejected(self):
        self.rejected_catalog(lambda data: data["entries"].append(copy.deepcopy(data["entries"][0])), "duplicate")

    def test_duplicate_registered_url_rejected(self):
        def mutate(data):
            other = copy.deepcopy(data["entries"][0])
            other["post_path"] = other["post_path"].replace("example.md", "other.md")
            write(self.work, other["post_path"], "---\n---\n")
            data["entries"].append(other)
        self.rejected_catalog(mutate, "duplicate")

    def test_mismatched_event_route_rejected(self):
        self.rejected_catalog(lambda data: data["entries"][0].update(event_id="different"), "event/slug")

    def test_missing_registered_post_rejected(self):
        self.rejected_catalog(lambda data: (self.work / data["entries"][0]["post_path"]).unlink(), "post missing")

    def test_unregistered_challenge_post_rejected(self):
        self.rejected_catalog(lambda data: write(self.work, "_posts/ctf-tutorials/challenges/2031-01-02-stray.md", "## Stray\n"), "membership")

    def test_absolute_archive_links_decode_to_canonical_routes(self):
        path = write(self.work, "archive.html", '<li data-record><a href="https://deut-erium.github.io/challenges/fixture-2031/example/">Example</a></li><li data-record><a href="/WriteUps/A%20B.html">Legacy</a></li>')
        expected = {"/challenges/fixture-2031/example/", "/WriteUps/A B.html"}
        actual = self.site["parse_archive"](path)
        self.site["check_archive_membership"](actual, expected, "fixture")
        self.assertEqual(set(actual), expected)

    def test_archive_duplicate_and_file_routes_rejected(self):
        route = sample_entry()["url"]
        for actual in ([route, route], [route + "index.html"], [route.rstrip("/")], []):
            with self.subTest(actual=actual), self.assertRaisesRegex(SystemExit, "membership"):
                self.site["check_archive_membership"](actual, {route}, "fixture")

    def tags_html(self, tags):
        return '<div class="all-tags__grid js-archive-filters">' + "".join(f'<a href="/archive.html?tag={quote(tag)}" data-filter="{html.escape(tag.lower())}">{html.escape(tag)}</a>' for tag in sorted(tags)) + '</div>'

    def test_hidden_post_robots_directive_is_exact(self):
        check = self.site["has_robots_directive"]
        self.assertTrue(check(["NOINDEX, follow"], "noindex"))
        self.assertFalse(check(["index, follow, x-noindex-disabled"], "noindex"))
        self.assertFalse(check([], "noindex"))

    def test_hidden_post_links_resolve_absolute_and_relative_forms(self):
        resolve = self.site["resolved_local_path"]
        route = "/2026/09/06/masatermind.html"
        self.assertEqual(resolve(route, "about.html"), route)
        self.assertEqual(resolve("https://deut-erium.github.io" + route + "?from=about", "about.html"), route)
        self.assertEqual(resolve("../../09/06/masatermind%2Ehtml", "2026/10/01/example.html"), route)

    def test_home_pagination_enforces_page_boundaries(self):
        routes = [f"/2026/01/{day:02d}/fixture-{day}.html" for day in range(1, 11)]

        def records(items):
            return "<ol>" + "".join(f'<li data-record><a href="{route}">Post</a></li>' for route in items) + "</ol>"

        write(self.work, "index.html", records(routes[:8]))
        write(self.work, "page2/index.html", records(routes[8:]))
        self.site["check_home_pagination"](self.work, routes, 8)
        write(self.work, "index.html", records(routes))
        write(self.work, "page2/index.html", records([]))
        with self.assertRaisesRegex(SystemExit, "page 1"):
            self.site["check_home_pagination"](self.work, routes, 8)

    def test_exact_tag_membership_and_duplicates(self):
        tags = self.site["expected_archive_tags"]()
        self.assertEqual(self.site["check_archive_tags"](self.tags_html(tags)), 135)
        for bad in (tags - {"misc"}, tags - {"RSA"} | {"rsa"}, list(tags) + ["misc"], tags - {"CRT"} | {"unexpected"}):
            with self.subTest(size=len(bad)), self.assertRaisesRegex(SystemExit, "tag membership"):
                self.site["check_archive_tags"](self.tags_html(bad))

    def test_new_tag_is_derived_from_registered_source(self):
        entry = catalog_fixture(self.work)
        self.site["SOURCE"] = self.work
        path = self.work / entry["post_path"]
        path.write_text(path.read_text().replace('["challenges", "crypto"]', '["ctfs", "rsa", "fixture-new"]'))
        visible = set(self.site["BASELINE_TAGS"]) - self.site["HIDDEN_ONLY_TAGS"]
        self.assertEqual(self.site["expected_archive_tags"](), visible | {"fixture-new"})

    def test_malformed_new_tag_array_rejected(self):
        entry = catalog_fixture(self.work)
        self.site["SOURCE"] = self.work
        for value in ('"misc"', '[null]', '[]', '["misc",]'):
            write(self.work, entry["post_path"], f"---\ntags: {value}\n---\n")
            with self.subTest(value=value), self.assertRaisesRegex(SystemExit, "invalid challenge post tags"):
                self.site["expected_archive_tags"]()

    def archive_fixture(self):
        env = self.site
        env.update(ROOT=self.work, APP_PAGES=set(), noindex_paths=set())
        routes = env["expected_post_routes"]()
        hidden = {entry["url"] for entry in json.loads((ROOT / "_data/hidden_posts.json").read_text())["posts"]}
        env.update(post_routes=routes, hidden_routes=hidden, listed_routes=set(routes) - hidden)
        # Put challenge routes in both feed windows so the mutations exercise
        # the new route type, rather than only the unchanged dated posts.
        order = sorted(env["listed_routes"], key=lambda route: (not route.startswith("/challenges/"), route))
        tags = self.tags_html(env["expected_archive_tags"]())

        def records(urls):
            return "".join(f'<li data-record><a href="{html.escape(quote(url, safe="/"))}">Post</a></li>' for url in urls)

        def feed(urls):
            entries = "".join(f'<entry><id>https://deut-erium.github.io{quote(url, safe="/")}</id><link rel="alternate" href="https://deut-erium.github.io{quote(url, safe="/")}"/><summary>Fixture summary.</summary></entry>' for url in urls)
            return '<feed xmlns="http://www.w3.org/2005/Atom">' + entries + '</feed>'

        def sitemap(urls):
            return '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + "".join(f'<url><loc>https://deut-erium.github.io{quote(url, safe="/")}</loc></url>' for url in urls) + '</urlset>'

        write(self.work, "archive.html", tags + records(order))
        write(self.work, "feed.xml", feed(order[:10]))
        write(self.work, "sitemap.xml", sitemap(order))
        for directory, section, limit in (("WriteUps", "writeups", 20), ("ramblings", "ramblings", 5), ("ctf-tutorials", "tutorials", 20)):
            expected = [route for route in order if routes[route] == section]
            write(self.work, f"{directory}/archive.html", records(expected))
            write(self.work, f"{directory}/index.html", records(expected))
            write(self.work, f"{directory}/feed.xml", feed(expected[:limit]))
            write(self.work, f"{directory}/sitemap.xml", sitemap([f"/{directory}/", *expected]))
        for route in order:
            write(self.work, env["post_output_path"](route), "<!doctype html><title>Fixture</title>")
        return env

    def test_archive_feed_sitemap_block_with_98_listed_routes(self):
        env = self.archive_fixture()
        exec(archive_gate_code(), env)
        self.assertEqual(len(env["archive_order"]), 98)
        self.assertEqual(env["tag_count"], 135)

    def test_deliberate_payload_baseline(self):
        tree = ast.parse((ROOT / "script/verify-site.py").read_text())
        comparisons = [node for node in ast.walk(tree) if isinstance(node, ast.Compare)]
        payload = next(node for node in comparisons if isinstance(node.left, ast.Tuple) and [item.id for item in node.left.elts] == ["forms", "challenge_scripts", "article_scripts", "code_frames", "math_expressions", "images"])
        self.assertEqual(ast.literal_eval(payload.comparators[0]), (28, 13, 101, 356, 275, 103))
        for name, expected in (("post_routes", 101), ("challenge_pages", 13), ("math_pages", 7)):
            count = next(node for node in comparisons if isinstance(node.left, ast.Call) and isinstance(node.left.func, ast.Name) and node.left.func.id == "len" and len(node.left.args) == 1 and isinstance(node.left.args[0], ast.Name) and node.left.args[0].id == name)
            self.assertEqual(ast.literal_eval(count.comparators[0]), expected)

    def browser_scope_fixture(self):
        return ('<article id="article-body"><section data-challenge-practice data-id="fixture-2031-example" data-runtime="example">'
                '<form><textarea data-practice-input disabled></textarea><button type="submit" disabled>Send</button></form>'
                '</section></article><script type="module" src="/assets/js/challenge-practice/ui.mjs?v=fixture"></script>'
                '<link rel="stylesheet" href="/assets/css/features/challenge-practice.css?v=fixture">')

    def check_browser_scope(self, text, entry):
        audit = self.site["Audit"]()
        audit.feed(text)
        audit.close()
        self.site["check_browser_scope"](audit, entry, "synthetic page")
        return audit

    def test_global_browser_scope_counts_forms_without_event_progress(self):
        audit = self.check_browser_scope(self.browser_scope_fixture(), sample_entry())
        self.assertEqual(audit.browser_forms, 1)
        self.assertEqual(audit.forms, 0)
        self.check_browser_scope('<article id="article-body"><p>No browser practice.</p></article>', None)

    def test_global_browser_scope_rejects_off_target_forms_and_resources(self):
        for text in (self.browser_scope_fixture(),
                     '<script type="module" src="/assets/js/challenge-practice/ui.mjs"></script>',
                     '<link rel="stylesheet" href="/assets/css/features/challenge-practice.css">'):
            with self.subTest(text=text), self.assertRaisesRegex(SystemExit, "browser.*scope"):
                self.check_browser_scope(text, None)

    def test_global_browser_scope_rejects_resource_and_form_mutations(self):
        mutations = [
            ('type="module"', 'type="text/javascript"'),
            ('/ui.mjs', '/worker.mjs'),
            ('rel="stylesheet"', 'rel="modulepreload"'),
            ('<form>', '<form action="/submit">'),
            ('<form>', '<form name="practice">'),
            ('data-practice-input', 'data-practice-input name="input"'),
            ('<section data-challenge-practice', '<section data-wrong-practice'),
            ('data-runtime="example"', 'data-runtime="other"'),
            ('data-id="fixture-2031-example"', 'data-id="other"'),
            ('</section>', '<pre>Extra frame</pre></section>'),
            ('</article><script', '<script'),
        ]
        for old, new in mutations:
            with self.subTest(old=old, new=new), self.assertRaisesRegex(SystemExit, "browser"):
                self.check_browser_scope(self.browser_scope_fixture().replace(old, new), sample_entry())

    def heading_cli(self, *, stale=False, wrong_heading=False):
        entry = catalog_fixture(self.work)
        shutil.copyfile(ROOT / "script/verify-heading-parity.py", write(self.work, "script/verify-heading-parity.py", ""))
        output = self.work / "site"
        route = "ctf-tutorials/2031/01/02/example.html" if stale else entry["url"].lstrip("/") + "index.html"
        body = '<article id="article-body"><h2>Files</h2><h2>' + ("Wrong" if wrong_heading else "Check your flag") + '</h2></article>'
        write(output, route, body)
        return subprocess.run([sys.executable, str(self.work / "script/verify-heading-parity.py"), str(output)], text=True, capture_output=True, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}, timeout=10)

    def test_heading_cli_reads_preserved_route(self):
        result = self.heading_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Validated 2 authored headings across 1 posts.", result.stdout)

    def test_heading_cli_rejects_date_inferred_output(self):
        result = self.heading_cli(stale=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing output", result.stderr)

    def test_heading_cli_still_rejects_changed_heading(self):
        result = self.heading_cli(wrong_heading=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("heading parity failed", result.stderr)


# Keep each mutation visible as its own unittest result.
BAD_URLS = {
    "absolute": "https://deut-erium.github.io/challenges/fixture-2031/example/",
    "protocol_relative": "//deut-erium.github.io/challenges/fixture-2031/example/",
    "no_leading_slash": "challenges/fixture-2031/example/",
    "no_trailing_slash": "/challenges/fixture-2031/example",
    "index_file": "/challenges/fixture-2031/example/index.html",
    "query": "/challenges/fixture-2031/example/?x=1",
    "fragment": "/challenges/fixture-2031/example/#files",
    "encoded_traversal": "/challenges/fixture-2031/%2e%2e/",
    "traversal": "/challenges/fixture-2031/../",
    "uppercase": "/challenges/fixture-2031/Example/",
    "wrong_section": "/ctf-tutorials/fixture-2031/example/",
    "not_string": None,
}
BAD_PATHS = {
    "absolute": "/_posts/ctf-tutorials/challenges/2031-01-02-example.md",
    "traversal": "_posts/ctf-tutorials/challenges/../2031-01-02-example.md",
    "backslash": "_posts/ctf-tutorials/challenges/x\\2031-01-02-example.md",
    "wrong_root": "_posts/ramblings/2031-01-02-example.md",
    "undated": "_posts/ctf-tutorials/challenges/example.md",
    "not_string": None,
}
for field, variants in (("url", BAD_URLS), ("post_path", BAD_PATHS)):
    for label, value in variants.items():
        def check(self, field=field, value=value):
            self.rejected_catalog(lambda data: data["entries"][0].update({field: value}), "invalid registered challenge")
        setattr(RouteTests, f"test_bad_{field}_{label}", check)

GATE_MUTATIONS = {
    "global_file_route": ("archive.html", "index.html", "global archive"),
    "tutorial_archive_file_route": ("ctf-tutorials/archive.html", "index.html", "ctf-tutorials archive"),
    "tutorial_home_file_route": ("ctf-tutorials/index.html", "index.html", "ctf-tutorials home archive"),
    "global_feed_file_route": ("feed.xml", "index.html", "global feed"),
    "tutorial_feed_file_route": ("ctf-tutorials/feed.xml", "index.html", "section feed"),
    "tutorial_sitemap_file_route": ("ctf-tutorials/sitemap.xml", "index.html", "section sitemap"),
    "root_sitemap_file_route": ("sitemap.xml", "index.html", "root sitemap omits listed posts"),
}
for label, (path, suffix, message) in GATE_MUTATIONS.items():
    def check(self, path=path, suffix=suffix, message=message):
        env = self.archive_fixture()
        target = self.work / path
        text = target.read_text()
        # The synthetic order puts challenge tutorials inside both feed windows.
        route = next(route for route in env["post_routes"] if route.startswith("/challenges/") and route in text)
        target.write_text(text.replace(route, route + suffix))
        with self.assertRaisesRegex(SystemExit, message):
            exec(archive_gate_code(), env)
    setattr(RouteTests, f"test_gate_rejects_{label}", check)


if __name__ == "__main__":
    unittest.main(verbosity=2)
