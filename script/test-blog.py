#!/usr/bin/env python3
"""Native tests. Every subprocess is mocked; the printed push is only parsed."""

import contextlib
import importlib.util
import io
import os
from pathlib import Path
import shlex
import stat
import subprocess
import sys
import tempfile
import unittest
import warnings
from unittest.mock import patch

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("blog", Path(__file__).with_name("blog.py"))
blog = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(blog)
SOURCE, BASE, DEPLOY = "a" * 40, "b" * 40, "c" * 40


class BlogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="blog-tests-", dir=blog.directory(blog.ROOT / "agent_out"))
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.patch("ROOT", self.root)
        self.calls, self.worktree = [], None
        self.branch, self.dirty, self.upstream, self.ancestor = "refs/heads/master", "", BASE, 0
        self.build_fails, self.dirty_after_build, self.leftovers = False, False, False
        self.bad_worktree, self.bad_site, self.committed = False, None, False
        self.pages, self.head = BASE, SOURCE
        self.secret, self.body = "private-test-key-123", "private-test-body-456"
        self.rendered = f'<h2>Details</h2><p>{self.body}</p><img src="figure.svg">'
        self.private_calls, self.temporary_html = [], []
        self.ignored, self.convert_fails, self.encrypt_fails = True, False, False
        self.prompt = self.patch("getpass.getpass", return_value=self.secret)
        self.patch("subprocess.run", side_effect=self.process)
        self.stdout, self.stderr = io.StringIO(), io.StringIO()
        capture = contextlib.redirect_stdout(self.stdout)
        capture.__enter__()
        self.addCleanup(capture.__exit__, None, None, None)
        capture = contextlib.redirect_stderr(self.stderr)
        capture.__enter__()
        self.addCleanup(capture.__exit__, None, None, None)

    def patch(self, name, *args, **kwargs):
        target, _, attribute = name.rpartition(".")
        obj = blog if not target else getattr(blog, target)
        patcher = patch.object(obj, attribute or name, *args, **kwargs)
        self.addCleanup(patcher.stop)
        return patcher.start()

    def process(self, argv, **kwargs):
        # Reject network verbs before recording or interpreting any command.
        self.assertFalse(set(argv) & {"push", "fetch", "pull", "clone", "curl", "wget", "scp", "rsync", "install", "publish"})
        self.assertNotIn("shell", kwargs)
        cwd = Path(kwargs["cwd"])
        self.calls.append((argv, cwd, kwargs["env"]))
        out, code = "", 0
        if argv[0] == "git":
            self.assertEqual(argv[1:1 + len(blog.GIT_OPTIONS)], blog.GIT_OPTIONS)
            args = argv[1 + len(blog.GIT_OPTIONS):]
            verb = args[0]
            if verb == "check-ignore":
                self.assertEqual(args[:3], ["check-ignore", "--quiet", "--"])
                self.assertTrue(Path(args[-1]).is_relative_to(self.root / "agent_out"))
                self.assertEqual(kwargs["stdout"], subprocess.DEVNULL)
                self.assertEqual(kwargs["stderr"], subprocess.DEVNULL)
                code = 0 if self.ignored else 1
            elif verb == "symbolic-ref":
                out, code = ("", 1) if cwd == self.worktree else (self.branch, 0)
            elif verb == "status":
                out = self.dirty
            elif verb == "merge-base":
                code = self.ancestor
            elif verb == "rev-parse":
                if args[1] == "--show-toplevel":
                    out = str(self.root if self.bad_worktree else cwd)
                elif "origin/master" in args[-1]:
                    out, code = (self.upstream, 0) if self.upstream else ("", 1)
                elif "origin/gh-pages" in args[-1]:
                    out, code = (self.pages, 0) if self.pages else ("", 1)
                else:
                    out = (DEPLOY if self.committed else BASE) if cwd == self.worktree else self.head
            elif verb == "worktree":
                self.assertEqual(args[:3], ["worktree", "add", "--detach"])
                self.assertEqual(args[-1], BASE)
                self.worktree = Path(args[-2])
                self.assertEqual(self.worktree.parent.parent, self.root / "agent_out/blog")
                self.assertFalse(self.worktree.exists())
                self.worktree.mkdir()
                (self.worktree / ".git").write_text("gitdir: detached-test\n")
                (self.worktree / "old.html").write_text("stale deployment")
            elif verb == "rm":
                self.assertEqual(cwd, self.worktree)
                self.assertEqual(args, ["rm", "-r", "--ignore-unmatch", "."])
                (cwd / "old.html").unlink()
                if self.leftovers:
                    (cwd / "ignored-secret").write_text("must not be staged")
            elif verb == "add":
                self.assertEqual(cwd, self.worktree)
                self.assertEqual(args, ["add", "--force", "--all", "--", "."])
                self.assertEqual({p.name for p in cwd.iterdir()}, {".git", "index.html", ".nojekyll", "assets"})
            elif verb == "commit":
                self.assertEqual(cwd, self.worktree)
                self.assertIn(SOURCE, args[-1])
                self.committed = True
            else:
                self.fail(f"Unexpected git command: {args}")
        elif argv[:3] == ["bundle", "exec", "ruby"]:
            self.assertEqual(argv[3], str(self.root / "script/private-markdown.rb"))
            self.assertEqual(len(argv), 5)  # Source is a path, never an -e program.
            self.assertTrue(Path(argv[4]).is_file())
            self.assertNotIn(self.secret, " ".join(argv))
            self.assertNotIn(self.body, " ".join(argv))
            self.assertIsNone(kwargs["input"])
            self.assertEqual(kwargs["stdin"], subprocess.DEVNULL)
            self.assertEqual(kwargs["stderr"], subprocess.DEVNULL)
            html = Path(kwargs["stdout"].name)
            self.assertEqual(html.parent, Path(argv[4]).parent)
            self.assertEqual(html.suffix, ".html")
            self.assertEqual(stat.S_IMODE(html.stat().st_mode), 0o600)
            self.temporary_html.append(html)
            self.private_calls.append((argv, kwargs))
            os.write(kwargs["stdout"].fileno(), self.rendered.encode("utf-8"))
            code = 1 if self.convert_fails else 0
        elif argv[:2] == [sys.executable, str(self.root / "script/encrypt_post.py")]:
            self.assertNotIn("--answer", argv)
            self.assertEqual(argv.count("--answer-stdin"), 1)
            self.assertNotIn(self.secret, " ".join(argv))
            self.assertNotIn(self.body, " ".join(argv))
            self.assertNotIn(self.secret, repr(kwargs["env"]))
            self.assertEqual(kwargs["input"], self.secret + "\n")
            self.assertTrue(kwargs["text"])
            self.assertEqual(kwargs["stdout"], subprocess.DEVNULL)
            self.assertEqual(kwargs["stderr"], subprocess.DEVNULL)
            html = Path(argv[argv.index("--plaintext") + 1])
            if self.temporary_html:
                self.assertEqual(html, self.temporary_html[-1])
                self.assertEqual(html.read_text(), self.rendered)
                self.assertEqual(stat.S_IMODE(html.stat().st_mode), 0o600)
            self.private_calls.append((argv, kwargs))
            code = 1 if self.encrypt_fails else 0
        elif argv[0] == "sh":
            self.assertEqual(Path(argv[1]), self.root / "script/build-release.sh")
            site = Path(argv[2])
            self.assertEqual(site.parent.parent, self.root / "agent_out/blog")
            self.assertEqual(site.name, "site")
            self.assertFalse(site.exists())
            self.assertEqual(kwargs["env"]["TMPDIR"], str(site.parent))
            self.site(site)
            if self.bad_site == "symlink":
                (site / "leak").symlink_to(self.root)
            if self.bad_site == "missing-marker":
                (site / ".nojekyll").unlink()
            if self.bad_site == "existing-worktree":
                (site.parent / "deploy").mkdir()
            if self.bad_site == "changed-head":
                self.head = "d" * 40
            if self.bad_site == "changed-base":
                self.pages = "d" * 40
            if self.dirty_after_build:
                self.dirty = " M source.md\n"
            code = 1 if self.build_fails else 0
        else:
            self.assertTrue(argv == [sys.executable, str(self.root / "script/verify-local-only-paths.py")]
                            or argv == ["bundle", "check"] or argv == ["node", "-e", "require('katex')"])
        if code and kwargs.get("check"):
            raise subprocess.CalledProcessError(code, argv)
        return subprocess.CompletedProcess(argv, code, out)

    def site(self, path):
        (path / "assets").mkdir(parents=True)
        (path / "index.html").write_text("release only")
        (path / ".nojekyll").touch()
        (path / "assets/app.js").write_text("local asset")
        return path

    def test_new_sections_json_metadata_and_no_git(self):
        for section, folder in blog.SECTIONS.items():
            title = 'Quoted "title": # YAML\nsecond line'
            self.assertEqual(blog.main(["new", "test-post", "--title", title, "--date", "2024-02-29", "--section", section]), 0)
            text = (self.root / folder / "2024-02-29-test-post.md").read_text()
            self.assertIn('title: "Quoted \\"title\\": # YAML\\nsecond line"', text)
            self.assertIn("description: \"TODO:", text)
            self.assertIn("mathjax: false\ntags: []", text)
            self.assertNotIn("challenge_checker", text)
            self.assertIn("\n# Details\n", text)
            self.assertNotIn("\n## Details\n", text)
        self.assertNotIn("gate updates", self.stdout.getvalue())
        self.assertEqual(self.calls, [])

    def test_challenge_and_optional_fields(self):
        self.assertEqual(blog.main(["new", "assignment", "--title", "Assignment", "--section", "tutorials",
                                    "--description", "Practice", "--challenge", "--mathjax", "--tags", "crypto", "z3"]), 0)
        files = list((self.root / "_posts/ctf-tutorials").glob("*.md"))
        self.assertEqual(files[0].name, f"{blog.date.today().isoformat()}-assignment.md")
        text = files[0].read_text()
        self.assertIn('description: "Practice"', text)
        self.assertIn("mathjax: true", text)
        self.assertIn('tags: ["crypto", "z3", "challenges"]', text)
        self.assertIn("challenge_checker: true", text)
        self.assertNotIn("data-answer", text)

    def test_invalid_slugs_dates_and_ports(self):
        for value in ("../escape", "/abs", "a/b", "a\\b", "UPPER", "a--b", ".", "a" * 101):
            with self.subTest(slug=value), self.assertRaises(SystemExit):
                blog.main(["new", value, "--title", "T"])
        for value in ("2024-2-01", "2023-02-29", "0000-01-01", "20240101", "../../x"):
            with self.subTest(date=value), self.assertRaises(SystemExit):
                blog.main(["new", "post", "--title", "T", "--date", value])
        for value in ("0", "65536", "-1", "bad"):
            with self.subTest(port=value), self.assertRaises(SystemExit):
                blog.main(["preview", "--port", value])
        self.assertEqual(self.calls, [])

    def test_blank_fields_and_bad_tags(self):
        for extra in (["--title", " "], ["--title", "T", "--description", " "], ["--title", "T", "--tags", "x:bad"]):
            self.assertEqual(blog.main(["new", "post", *extra]), 1)
        self.assertFalse((self.root / "_posts").exists())

    def test_no_overwrite_or_symlink_escape(self):
        args = ["new", "post", "--title", "T", "--date", "2024-01-01"]
        self.assertEqual(blog.main(args), 0)
        path = self.root / "_posts/2024-01-01-post.md"
        original = path.read_bytes()
        self.assertEqual(blog.main(args), 1)
        self.assertEqual(path.read_bytes(), original)
        path.unlink()
        path.symlink_to(self.root / "missing")
        self.assertEqual(blog.main(args), 1)
        path.unlink()
        path.parent.rmdir()
        path.parent.symlink_to(self.root)
        self.assertEqual(blog.main(args), 1)
        self.assertFalse((self.root / path.name).exists())

    def test_build_unique_destinations_and_pdf_switch(self):
        old = self.root / "agent_out/release/site"
        old.mkdir(parents=True)
        (old / "keep").touch()
        with patch.dict(os.environ, ACADEMIC_PDFS="1"):
            self.assertEqual(blog.main(["build"]), 0)
        self.assertEqual(blog.main(["build", "--pdf"]), 0)
        builds = [(a, env) for a, _, env in self.calls if a[0] == "sh"]
        self.assertNotEqual(builds[0][0][-1], builds[1][0][-1])
        self.assertEqual([env["ACADEMIC_PDFS"] for _, env in builds], ["0", "1"])
        self.assertTrue((old / "keep").exists())

    def test_output_symlink_refused(self):
        (self.root / "agent_out").symlink_to(self.root)
        self.assertEqual(blog.main(["build"]), 1)
        self.assertFalse(any(a[0] == "sh" for a, _, _ in self.calls))

    def test_preview_foreground_loopback_and_no_server_on_build_failure(self):
        server = self.patch("ThreadingHTTPServer")
        server.return_value.__enter__.return_value.serve_forever.side_effect = KeyboardInterrupt
        self.assertEqual(blog.main(["preview", "--pdf", "--port", "8123"]), 0)
        self.assertEqual(server.call_args.args[0], ("127.0.0.1", 8123))
        served = Path(server.call_args.args[1].keywords["directory"])
        self.assertEqual(served.name, "site")
        self.assertEqual(served.parent.parent, self.root / "agent_out/blog")
        server.return_value.__exit__.assert_called_once()
        server.reset_mock()
        self.build_fails = True
        self.assertEqual(blog.main(["preview"]), 1)
        server.assert_not_called()

    def test_prepare_only_copies_release_and_prints_pinned_atomic_command(self):
        (self.root / "private-untracked").write_text("not a site file")
        self.assertEqual(blog.main(["prepare-publish", "--pdf"]), 0)
        self.assertTrue(self.committed)
        self.assertEqual((self.worktree / "index.html").read_text(), "release only")
        self.assertFalse((self.worktree / "private-untracked").exists())
        # Never pass this command to any runner, including the subprocess mock.
        command = shlex.split(self.stdout.getvalue().splitlines()[-1])
        self.assertEqual(command, ["git", "-C", str(self.worktree), "-c", "core.hooksPath=/dev/null",
                                   "push", "--atomic", "origin", f"{SOURCE}:refs/heads/master", f"{DEPLOY}:refs/heads/gh-pages"])
        self.assertIn("Remote refs may be stale", self.stdout.getvalue())
        self.assertIn("git fetch origin on the host first", self.stdout.getvalue())

    def test_prepare_refuses_wrong_branch_dirty_source_or_divergence(self):
        for field, value in (("branch", "refs/heads/topic"), ("branch", ""), ("dirty", "?? draft.md\n"),
                             ("dirty", " M post.md\n"), ("dirty", "M  post.md\n"), ("ancestor", 1), ("ancestor", 128)):
            with self.subTest(field=field, value=value), patch.object(self, field, value):
                self.assertEqual(blog.main(["prepare-publish"]), 1)
                self.assertIsNone(self.worktree)
        self.assertFalse(any(a[0] == "sh" for a, _, _ in self.calls))

    def test_unknown_origin_master_is_allowed(self):
        self.upstream = None
        self.assertEqual(blog.main(["prepare-publish"]), 0)

    def test_prepare_stops_on_build_failure_or_source_change(self):
        for field in ("build_fails", "dirty_after_build"):
            with patch.object(self, field, True):
                self.assertEqual(blog.main(["prepare-publish"]), 1)
                self.assertIsNone(self.worktree)
        self.assertFalse(self.committed)

    def test_prepare_rejects_wrong_git_target_before_removal(self):
        self.bad_worktree = True
        self.assertEqual(blog.main(["prepare-publish"]), 1)
        self.assertTrue((self.worktree / "old.html").exists())
        self.assertFalse(self.committed)

    def test_prepare_rejects_worktree_leftovers_before_staging(self):
        self.leftovers = True
        self.assertEqual(blog.main(["prepare-publish"]), 1)
        self.assertFalse(self.committed)
        self.assertFalse((self.worktree / "index.html").exists())

    def test_prepare_rejects_bad_artifacts_collisions_and_changed_commits(self):
        for case in ("symlink", "missing-marker", "existing-worktree", "changed-head", "changed-base"):
            with self.subTest(case=case):
                self.bad_site, self.head, self.pages = case, SOURCE, BASE
                self.assertEqual(blog.main(["prepare-publish"]), 1)
                self.assertIsNone(self.worktree)
                self.assertNotIn("HUMAN ONLY", self.stdout.getvalue())

    def test_prepare_requires_local_gh_pages(self):
        self.pages = None
        self.assertEqual(blog.main(["prepare-publish"]), 1)
        self.assertFalse(any(a[0] == "sh" for a, _, _ in self.calls))
        self.assertIsNone(self.worktree)

    def test_failed_local_only_gate_blocks_build(self):
        self.patch("local_only", side_effect=subprocess.CalledProcessError(1, ["local-only-check"]))
        self.assertEqual(blog.main(["build"]), 1)
        self.assertEqual(self.calls, [])
        self.assertFalse((self.root / "agent_out").exists())

    def test_copy_does_not_overwrite_existing_files(self):
        site = self.site(self.root / "site")
        target = self.root / "target"
        target.mkdir()
        (target / ".nojekyll").write_text("do not overwrite")
        with self.assertRaises(FileExistsError):
            blog.copy_site(site, target)
        self.assertEqual((target / ".nojekyll").read_text(), "do not overwrite")

    def test_unsafe_generated_entries_rejected(self):
        site = self.site(self.root / "site")
        for name in (".git", ".GIT", ".gitattributes", ".gitmodules"):
            path = site / name
            path.write_text("refused")
            with self.assertRaises(ValueError):
                blog.site_entries(site)
            path.unlink()
        os.link(site / "index.html", site / "alias")
        with self.assertRaises(ValueError):
            blog.site_entries(site)
        (site / "alias").unlink()
        os.mkfifo(site / "pipe")
        with self.assertRaises(ValueError):
            blog.site_entries(site)

    def test_toolchain_cache_and_path_fallback(self):
        with patch.dict(os.environ, {"PATH": "/normal/bin", "GIT_DIR": "/wrong", "GIT_INDEX_FILE": "/wrong/index"}, clear=True):
            self.assertEqual(blog.environment()["PATH"], "/normal/bin")
            ruby = self.root / ".toolchain/ruby-3.3.7/bin/ruby"
            ruby.parent.mkdir(parents=True)
            ruby.touch(mode=0o755)
            (self.root / ".toolchain/vendor-bundle").mkdir()
            env = blog.environment()
            self.assertTrue(env["PATH"].startswith(str(self.root / ".toolchain/bin")))
            self.assertEqual(env["BUNDLE_PATH"], str(self.root / ".toolchain/vendor-bundle"))
            self.assertNotIn("GIT_DIR", env)
            self.assertNotIn("GIT_INDEX_FILE", env)
            self.assertEqual(env["GIT_NO_LAZY_FETCH"], "1")

    def test_doctor_root_warning_and_local_only_gate(self):
        self.patch("shutil.which", return_value="/tool")
        self.patch("os.geteuid", return_value=0)
        self.assertEqual(blog.main(["doctor"]), 0)
        self.assertIn("WARNING: running as root", self.stdout.getvalue())
        self.assertIn("no chown is performed", self.stdout.getvalue())
        self.assertTrue(any("verify-local-only-paths.py" in a[-1] for a, _, _ in self.calls))
        self.assertFalse((self.root / "agent_out").exists())

    def test_doctor_missing_tools_fails(self):
        self.patch("shutil.which", return_value=None)
        self.assertEqual(blog.main(["doctor"]), 1)

    def private_input(self, suffix=".html", *, text=None, outside=False):
        if outside:
            temp = tempfile.TemporaryDirectory(prefix="private-blog-tests-", dir=self.root.parent)
            self.addCleanup(temp.cleanup)
            parent = Path(temp.name)
        else:
            parent = self.root / "agent_out/private"
            parent.mkdir(parents=True, exist_ok=True)
        path = parent / ("body" + suffix)
        path.write_text(self.body if text is None else text, encoding="utf-8")
        return path

    def encrypt_args(self, source, *extra, out="_posts/ramblings/2026-09-05-door.md"):
        return ["encrypt", str(source), "--out", str(out), "--title", "The door", *extra]

    def assert_private_logs(self):
        logs = self.stdout.getvalue() + self.stderr.getvalue()
        self.assertNotIn(self.secret, logs)
        self.assertNotIn(self.body, logs)
        self.assertNotIn(self.rendered, logs)

    def test_encrypt_html_direct_and_key_only_on_stdin(self):
        source = self.private_input(text=f"<p>{self.body}</p>", outside=True)
        self.assertEqual(blog.main(self.encrypt_args(source)), 0)
        self.prompt.assert_called_once_with("Unlock key: ")
        self.assertEqual(len(self.private_calls), 1)
        argv, kwargs = self.private_calls[0]
        self.assertEqual(Path(argv[argv.index("--plaintext") + 1]), source)
        self.assertEqual(Path(argv[argv.index("--out") + 1]), self.root / "_posts/ramblings/2026-09-05-door.md")
        self.assertEqual(kwargs["env"], blog.environment())
        self.assertNotIn("--force", argv)
        self.assertNotIn("--page", argv)
        self.assertNotIn("--unlisted", argv)
        self.assertFalse(self.temporary_html)
        self.assertFalse(any(a[0] == "git" for a, _, _ in self.calls))
        self.assertIn(str(source), self.stdout.getvalue())
        self.assert_private_logs()

    def test_encrypt_forwards_all_options_without_shell_interpretation(self):
        source = self.private_input(outside=True)
        extra = ["--description", "Public description", "--teaser", "$(not-a-command); public teaser",
                 "--tags", "crypto challenges", "--needs", "assignment000003-0", "--section", "tutorials",
                 "--unlisted", "--embed-assets", "--embed-linked-files", "--asset-root", str(source.parent), "--force"]
        self.assertEqual(blog.main(self.encrypt_args(source, *extra, out="locked/2026/09/05/door.md")), 0)
        argv, _ = self.private_calls[-1]
        for option in ("--description=Public description", "--teaser=$(not-a-command); public teaser",
                       "--tags=crypto challenges", "--needs=assignment000003-0", "--section=tutorials",
                       "--unlisted", "--embed-assets", "--embed-linked-files", "--force"):
            self.assertIn(option, argv)
        self.assertNotIn("--page", argv)
        self.assertEqual(argv[argv.index("--asset-root") + 1], str(source.parent))
        self.assert_private_logs()

    def test_encrypt_post_and_page_routing(self):
        source = self.private_input(outside=True)
        for section, folder in blog.SECTIONS.items():
            for page in (False, True):
                route = f"{folder}/2026-09-05-door.md" if not page else f"{section}/2026/09/05/door.md"
                if page and section == "tutorials":
                    route = "ctf-tutorials/2026/09/05/door.md"
                if page and section == "root":
                    route = "2026/09/05/door.md"
                with self.subTest(section=section, page=page):
                    self.assertEqual(blog.main(self.encrypt_args(source, "--section", section, out=self.root / route)), 0)
                    argv, _ = self.private_calls[-1]
                    self.assertEqual("--page" in argv, page)
                    self.assertIn("--section=" + section, argv)
        self.assert_private_logs()

    def test_encrypt_invalid_output_routes_stop_before_prompt(self):
        source = self.private_input(outside=True)
        cases = [("locked/2026/09/05/door.md", []), ("_posts/2026-09-05-door.md", ["--unlisted"]),
                 ("ramblings/door.md", []), ("_posts/undated.md", []),
                 ("_posts/2026-02-30-door.md", []), ("locked/2026/13/05/door.md", ["--unlisted"]),
                 ("../2026-09-05-escape.md", []), (str(source.parent / "2026/09/05/door.md"), [])]
        for out, extra in cases:
            with self.subTest(out=out):
                self.assertEqual(blog.main(self.encrypt_args(source, *extra, out=out)), 1)
        self.prompt.assert_not_called()
        self.assertFalse(self.private_calls)

    def test_encrypt_force_is_explicit_and_preserves_existing_input(self):
        source = self.private_input(outside=True)
        output = self.root / "_posts/ramblings/2026-09-05-door.md"
        output.parent.mkdir(parents=True)
        output.write_text("existing ciphertext")
        self.assertEqual(blog.main(self.encrypt_args(source)), 1)
        self.assertEqual(output.read_text(), "existing ciphertext")
        self.prompt.assert_not_called()
        self.assertFalse(self.private_calls)
        self.assertEqual(blog.main(self.encrypt_args(source, "--force")), 0)
        self.assertIn("--force", self.private_calls[-1][0])
        self.assertEqual(source.read_text(), self.body)

    def test_encrypt_rejects_output_and_chain_symlinks_even_with_force(self):
        source = self.private_input(outside=True)
        output = self.root / "_posts/ramblings/2026-09-05-door.md"
        output.parent.mkdir(parents=True)
        output.symlink_to(source)
        self.assertEqual(blog.main(self.encrypt_args(source, "--force")), 1)
        output.unlink()
        chain = self.root / "_data/arg_chain.yml"
        chain.parent.mkdir()
        chain.symlink_to(source)
        self.assertEqual(blog.main(self.encrypt_args(source, "--force")), 1)
        self.prompt.assert_not_called()
        self.assertFalse(self.private_calls)
        self.assertEqual(source.read_text(), self.body)

    def test_encrypt_private_location_checks_for_html_and_markdown(self):
        for suffix in (".html", ".md", ".markdown"):
            source = self.root / ("public" + suffix)
            source.write_text(self.body)
            self.assertEqual(blog.main(self.encrypt_args(source)), 1)
            scratch = self.private_input(suffix)
            self.ignored = False  # check-ignore also rejects tracked agent_out files.
            self.assertEqual(blog.main(self.encrypt_args(scratch)), 1)
            self.ignored = True
        self.prompt.assert_not_called()
        self.assertFalse(self.private_calls)
        self.assert_private_logs()

    def test_encrypt_private_symlink_aliases_cannot_bypass_location_check(self):
        public = self.root / "public.md"
        public.write_text(self.body)
        private = self.private_input(".md", outside=True)
        scratch = self.private_input(".markdown")
        scratch.unlink()
        scratch.symlink_to(public)
        outside_link = private.parent / "alias.md"
        outside_link.symlink_to(public)
        public_link = self.root / "alias.md"
        public_link.symlink_to(private)
        # An external directory alias still exposes a public repository path.
        alias = private.parent / "repo"
        alias.symlink_to(self.root, target_is_directory=True)
        for source in (scratch, outside_link, public_link, alias / "public.md"):
            self.assertEqual(blog.main(self.encrypt_args(source)), 1)
        self.prompt.assert_not_called()
        self.assertFalse(self.private_calls)

    def test_encrypt_markdown_sibling_mode_cleanup_and_environment(self):
        for suffix in (".md", ".markdown", ".MD", ".MARKDOWN"):
            with self.subTest(suffix=suffix):
                source = self.private_input(suffix, text=f"# Details\n\n{self.body}\n\n![figure](figure.svg)")
                original = source.read_bytes()
                self.assertEqual(blog.main(self.encrypt_args(source, "--embed-assets", "--embed-linked-files")), 0)
                self.assertFalse(self.temporary_html[-1].exists())
                self.assertEqual(source.read_bytes(), original)
                self.assertEqual(self.private_calls[-2][1]["env"], blog.environment())
                argv, _ = self.private_calls[-1]
                self.assertNotIn("--asset-root", argv)  # Default remains the private source directory.
                self.assertIn("--embed-assets", argv)
        self.assert_private_logs()

    def test_encrypt_markdown_rejects_yaml_and_liquid_without_printing_body(self):
        for text in ("---\ntitle: private\n---\n", "\ufeff---\r\ntitle: private\r\n---\r\n",
                     " \n  --- \nsecret: value\n", "---", "%YAML 1.2\n---\n", "%TAG ! tag:example\n",
                     "{{ page.secret }}", "{% include secret.html %}", "```liquid\n{% raw %}\n```",
                     "{{- page.secret -}}", "{%- assign x = 1 -%}"):
            with self.subTest(prefix=text[:20]):
                source = self.private_input(".md", text=text + self.body)
                # The bare opening delimiter needs its own line.
                if text == "---":
                    source.write_text(text)
                self.assertEqual(blog.main(self.encrypt_args(source)), 1)
        self.prompt.assert_not_called()
        self.assertFalse(self.private_calls)
        self.assertFalse(self.temporary_html)
        self.assert_private_logs()

    def test_encrypt_markdown_allows_ordinary_rules_and_trusted_html(self):
        source = self.private_input(".md", text=f"# Details\n\n---\n\n<script>{self.body}</script>", outside=True)
        self.assertEqual(blog.main(self.encrypt_args(source)), 0)
        self.assertEqual(len(self.private_calls), 2)
        self.assert_private_logs()

    def test_encrypt_cleanup_on_conversion_and_encryption_failure(self):
        source = self.private_input(".md", outside=True)
        for field in ("convert_fails", "encrypt_fails"):
            self.private_calls.clear()
            with self.subTest(field=field), patch.object(self, field, True):
                self.assertEqual(blog.main(self.encrypt_args(source)), 1)
                self.assertFalse(self.temporary_html[-1].exists())
                self.assertEqual(len(self.private_calls), 1 if field == "convert_fails" else 2)
                self.assertNotIn("Encrypted ", self.stdout.getvalue())
        self.assert_private_logs()

    def test_encrypt_child_exception_details_are_not_printed_and_temp_is_removed(self):
        source = self.private_input(".md", outside=True)
        for stage in ("ruby", "encrypt_post.py"):
            for error in (subprocess.CalledProcessError(1, [self.secret, self.body], output=self.body, stderr=self.secret),
                          ValueError(self.secret + self.body), OSError(self.secret + self.body), KeyboardInterrupt()):
                def fail(argv, **kwargs):
                    result = self.process(argv, **kwargs)
                    if any(stage in value for value in argv):
                        raise error
                    return result
                with self.subTest(stage=stage, error=type(error).__name__), patch.object(blog.subprocess, "run", side_effect=fail):
                    self.assertEqual(blog.main(self.encrypt_args(source)), 130 if isinstance(error, KeyboardInterrupt) else 1)
                self.assertFalse(self.temporary_html[-1].exists())
        self.assert_private_logs()

    def test_encrypt_returned_diagnostics_are_not_printed(self):
        source = self.private_input(outside=True)
        for code in (0, 1):
            def diagnostics(argv, **kwargs):
                self.process(argv, **kwargs)
                return subprocess.CompletedProcess(argv, code, self.secret, self.body)
            with patch.object(blog.subprocess, "run", side_effect=diagnostics):
                self.assertEqual(blog.main(self.encrypt_args(source)), code)
        self.assert_private_logs()

    def test_encrypt_no_plaintext_written_if_sibling_is_not_ignored(self):
        source = self.private_input(".md")
        def ignored_source_only(argv, **kwargs):
            result = self.process(argv, **kwargs)
            if "check-ignore" in argv and argv[-1] != str(source):
                self.assertEqual(Path(argv[-1]).read_bytes(), b"")
                result.returncode = 1
            return result
        with patch.object(blog.subprocess, "run", side_effect=ignored_source_only):
            self.assertEqual(blog.main(self.encrypt_args(source)), 1)
        self.assertFalse(self.private_calls)
        self.assertEqual(list(source.parent.iterdir()), [source])

    def test_encrypt_key_validation_and_hidden_prompt_failure(self):
        source = self.private_input(outside=True)
        for key in ("", " ", " key", "key ", "a\nb", "a\rb", "\ufeffkey", "key\ufeff", "x" * 4097):
            with self.subTest(length=len(key)):
                self.prompt.return_value = key
                self.assertEqual(blog.main(self.encrypt_args(source)), 1)
        for error in (EOFError(), blog.getpass.GetPassWarning(), KeyboardInterrupt()):
            self.prompt.side_effect = error
            self.assertEqual(blog.main(self.encrypt_args(source)), 130 if isinstance(error, KeyboardInterrupt) else 1)
        self.assertFalse(self.private_calls)
        self.assert_private_logs()

    def test_encrypt_getpass_cannot_fall_back_to_echoed_input(self):
        source = self.private_input(outside=True)
        def fallback(_prompt):
            warnings.warn("Terminal echo cannot be disabled", blog.getpass.GetPassWarning)
            self.fail("getpass fallback would read an echoed key")
        self.prompt.side_effect = fallback
        self.assertEqual(blog.main(self.encrypt_args(source)), 1)
        self.assertFalse(self.private_calls)
        self.assert_private_logs()

    def test_encrypt_max_length_unicode_key_is_preserved(self):
        source = self.private_input(outside=True)
        self.secret = "\u03c0" * 4096
        self.prompt.return_value = self.secret
        self.assertEqual(blog.main(self.encrypt_args(source)), 0)
        self.assert_private_logs()

    def test_encrypt_missing_nonregular_and_non_utf8_input(self):
        source = self.private_input(".md", outside=True)
        source.write_bytes(b"\xff" + self.body.encode())
        self.assertEqual(blog.main(self.encrypt_args(source)), 1)
        for path in (source.parent / "missing", source.parent):
            self.assertEqual(blog.main(self.encrypt_args(path)), 1)
        pipe = source.parent / "pipe.md"
        os.mkfifo(pipe)
        self.assertEqual(blog.main(self.encrypt_args(pipe)), 1)
        self.prompt.assert_not_called()
        self.assertFalse(self.private_calls)
        self.assert_private_logs()

    def test_encrypt_asset_options_require_embedding_and_private_root(self):
        source = self.private_input(outside=True)
        for extra in (["--embed-linked-files"], ["--asset-root", str(source.parent)],
                      ["--embed-assets", "--asset-root", str(self.root)],
                      ["--embed-assets", "--asset-root", str(source)],
                      ["--embed-assets", "--asset-root", str(source.parent / "missing")]):
            self.assertEqual(blog.main(self.encrypt_args(source, *extra)), 1)
        self.prompt.assert_not_called()
        self.assertFalse(self.private_calls)

    def test_encrypt_help_and_no_cli_answer_option(self):
        with self.assertRaises(SystemExit) as help_exit:
            blog.main(["encrypt", "--help"])
        self.assertEqual(help_exit.exception.code, 0)
        help_text = " ".join(self.stdout.getvalue().split())
        for text in ("not a sanitizer", "trusted", "YAML", "Liquid", "--force", "--unlisted", "--embed-assets",
                     "--embed-linked-files", "--asset-root", "--section", "_data/arg_chain.yml", "--page automatically"):
            self.assertIn(text, help_text)
        for option in ("--answer", "--answer-stdin", "--page"):
            with self.assertRaises(SystemExit) as invalid:
                blog.main(self.encrypt_args("/private/body.html", option, "not-an-answer"))
            self.assertEqual(invalid.exception.code, 2)
        self.prompt.assert_not_called()
        self.assertEqual(self.calls, [])

    def test_no_register_command(self):
        with self.assertRaises(SystemExit):
            blog.main(["register", "anything"])
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
