#!/usr/bin/env python3
"""Offline integration tests for blog.py encrypt, using synthetic inputs only.

Run: python3 -B script/test-blog-encryption.py
Requires the cached .toolchain Ruby/bundle environment, local KaTeX/Node, and
an installed AES-GCM Python backend. Nothing is installed or downloaded.

Only getpass is stubbed. A subprocess observer checks the handoff, then runs
real Ruby/Kramdown/KaTeX and encrypt_post.py with their original redirections.
Copied scripts, plugin, Gemfiles and chain data live under agent_out/authoring;
private drafts are siblings of the copied repository. This exercises the
outside-repository input mode without initializing Git or mocking its checks.
No existing posts are copied or decrypted. All temporary fixtures are removed.
"""

import base64
import contextlib
import hashlib
import html
from html.parser import HTMLParser
import importlib.util
import io
import json
import os
import re
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "agent_out/authoring"
REAL_RUN = subprocess.run
COPIED = (
    "script/blog.py", "script/private-markdown.rb", "script/katex-renderer.mjs",
    "script/encrypt_post.py", "script/embed_post_assets.py", "script/new_challenge.rb", "_plugins/katex_math.rb",
    "Gemfile", "Gemfile.lock", "_data/arg_chain.yml", ".gitignore",
)
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCr8AAAAASUVORK5CYII="
)
ENTRY = "_posts/ctf-tutorials/2031-01-02-synthetic-entry.md"
ENTRY_ROUTE = "/ctf-tutorials/2031/01/02/synthetic-entry.html"
FOLLOWUP = "locked/2031/01/03/synthetic-followup.md"
FOLLOWUP_ROUTE = "/locked/2031/01/03/synthetic-followup.html"


def decryption_backend():
    """Decrypt independently of encrypt_post.py and its self-test."""
    if importlib.util.find_spec("cryptography") is not None:
        from cryptography.exceptions import InvalidTag
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        return lambda key, nonce, blob, aad=None: AESGCM(key).decrypt(nonce, blob, aad), InvalidTag
    if importlib.util.find_spec("Cryptodome") is not None:
        from Cryptodome.Cipher import AES

        def decrypt(key, nonce, blob, aad=None):
            cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
            if aad is not None:
                cipher.update(aad)
            return cipher.decrypt_and_verify(blob[:-16], blob[-16:])

        return decrypt, ValueError
    raise unittest.SkipTest("Unavailable Python dependency: cryptography or Cryptodome (AES-GCM)")


class Markup(HTMLParser):
    """Compare the entire HTML event stream, allowing only expected asset edits."""

    def __init__(self, text, replacements=None):
        super().__init__(convert_charrefs=False)
        self.events, self.tags = [], []
        self.replacements = replacements or {}
        self.feed(text)
        self.close()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        field = "src" if tag == "img" else "href" if tag == "a" else None
        if field and attrs.get(field) in self.replacements:
            original = attrs[field]
            attrs[field] = self.replacements[original]
            if tag == "a":
                attrs["download"] = Path(original).name
        self.tags.append((tag, attrs))
        self.events.append(("start", tag, tuple(sorted(attrs.items()))))

    handle_startendtag = handle_starttag

    def handle_endtag(self, tag):
        self.events.append(("end", tag))

    def handle_data(self, data):
        self.events.append(("data", data))

    def handle_entityref(self, name):
        self.events.append(("entity", name))

    def handle_charref(self, name):
        self.events.append(("char", name))

    def handle_comment(self, data):
        self.events.append(("comment", data))


def data_uri(mime, data):
    return "data:" + mime + ";base64," + base64.b64encode(data).decode("ascii")


class BlogEncryptionIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        OUT.mkdir(parents=True, exist_ok=True)
        cls.temp = tempfile.TemporaryDirectory(prefix="blog-encryption-", dir=OUT)
        cls.addClassCleanup(cls.temp.cleanup)
        cls.work = Path(cls.temp.name)
        cls.template = cls.work / "template"
        cls.original = {}
        for name in COPIED:
            source, target = ROOT / name, cls.template / name
            cls.original[name] = source.read_bytes()
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(cls.original[name])

        # These are read-only dependency references, not links to source outputs.
        katex = ROOT / "node_modules/katex/package.json"
        if not katex.is_file():
            raise unittest.SkipTest("Unavailable local dependency: node_modules/katex")
        (cls.template / "node_modules").symlink_to((ROOT / "node_modules").resolve(), target_is_directory=True)
        cache = ROOT / ".toolchain"
        for name in ("ruby-3.3.7/bin/ruby", "ruby-3.3.7/bin/bundle", "bin/ruby"):
            if not os.access(cache / name, os.X_OK):
                raise unittest.SkipTest("Unavailable cached Ruby executable: .toolchain/" + name)
        for name in ("home", "tmp", "bundle-config"):
            (cls.work / name).mkdir()
        # Do not inherit keys, Git redirections, runtime injection options, or
        # package-manager configuration from the author's shell or home directory.
        cls.env = {
            "PATH": os.pathsep.join((str(cache / "bin"), str(cache / "ruby-3.3.7/bin"),
                                     os.environ.get("PATH", os.defpath))),
            "HOME": str(cls.work / "home"), "TMPDIR": str(cls.work / "tmp"),
            "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8",
            "BUNDLE_PATH": str(cache / "vendor-bundle"),
            "BUNDLE_APP_CONFIG": str(cls.work / "bundle-config"),
            "BUNDLE_IGNORE_CONFIG": "true", "BUNDLE_FROZEN": "true",
            "BUNDLE_DISABLE_VERSION_CHECK": "true", "PYTHONDONTWRITEBYTECODE": "1",
        }
        if not shutil.which("node", path=cls.env["PATH"]):
            raise unittest.SkipTest("Unavailable local executable: node")
        decrypt, cls.auth_error = decryption_backend()
        cls.decrypt = staticmethod(decrypt)
        # Only explicit missing-dependency errors skip. Syntax, ABI, configuration
        # and converter failures fail the suite, even when the probe fails first.
        cls.probe("Ruby gems", ["ruby", "-e", '''
begin
  require "bundler/setup"
  require "kramdown"
  require "kramdown-parser-gfm"
  require "rouge"
rescue LoadError => error
  raise unless error.message.start_with?("cannot load such file -- ")
  warn "Unavailable Ruby dependency: #{error.message}"
  exit 77
rescue StandardError => error
  raise unless defined?(Bundler::GemNotFound) && error.is_a?(Bundler::GemNotFound)
  warn "Unavailable cached gems: #{error.message}"
  exit 77
end
'''])
        cls.probe("KaTeX", ["node", "--input-type=module", "-e", '''
try {
  const {default: katex} = await import('katex');
  katex.renderToString('x', {throwOnError: true});
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  console.error('Unavailable local KaTeX dependency: ' + error.message);
  process.exit(77);
}
'''])

    @classmethod
    def probe(cls, label, argv):
        result = REAL_RUN(argv, cwd=cls.template, env=cls.env, text=True,
                          capture_output=True, timeout=45)
        if result.returncode == 77:
            raise unittest.SkipTest(" ".join(result.stderr.split()))
        if result.returncode:
            raise AssertionError(f"{label} dependency probe failed (exit {result.returncode}); not a skip")

    def setUp(self):
        self.case = self.work / self._testMethodName
        self.root, self.private = self.case / "repo", self.case / "private"
        shutil.copytree(self.template, self.root, symlinks=True)
        self.private.mkdir(mode=0o700)
        spec = importlib.util.spec_from_file_location("integration_blog", self.root / "script/blog.py")
        self.blog = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.blog)
        self.assertEqual(self.blog.ROOT, self.root)
        self.chain = self.root / "_data/arg_chain.yml"
        self.baseline_chain = self.chain.read_bytes()
        self.keys = {name: "synthetic-blog-" + name + "-key" for name in ("entry", "followup", "rewrite")}
        self.markers = {name: "SYNTHETIC_PRIVATE_BODY_" + name.upper() for name in self.keys}
        self.attachment = b"SYNTHETIC_PRIVATE_DOWNLOAD_BYTES\n\x00\xff"
        (self.private / "pixel.png").write_bytes(PNG)
        (self.private / "handout.bin").write_bytes(self.attachment)
        self.logs, self.temporary_paths = [], []

    def tearDown(self):
        self.assertEqual(list(self.private.rglob(".blog-private-*.html")), [])
        self.assertTrue((self.private / "pixel.png").read_bytes() == PNG, "Private PNG changed")
        self.assertTrue((self.private / "handout.bin").read_bytes() == self.attachment, "Private download changed")
        for name, original in self.original.items():
            self.assertTrue((ROOT / name).read_bytes() == original, "Parent source changed: " + name)
        self.assert_clean("\n".join(self.logs))

    def assert_clean(self, text):
        # Boolean assertions avoid printing a key or body if a regression leaks it.
        forbidden = [*self.keys.values(), *self.markers.values(), "SYNTHETIC_PRIVATE_DOWNLOAD_BYTES",
                     base64.b64encode(PNG).decode(), base64.b64encode(self.attachment).decode()]
        self.assertFalse(any(value in text for value in forbidden), "Private fixture data leaked into arguments, environment or logs")

    @contextlib.contextmanager
    def capture_logs(self):
        # Capture OS descriptors as well as Python streams: inherited child output
        # must not bypass the log checks if a redirection is accidentally removed.
        sys.stdout.flush()
        sys.stderr.flush()
        saved = os.dup(1), os.dup(2)
        with tempfile.TemporaryFile(mode="w+", encoding="utf-8", dir=self.case) as log:
            try:
                os.dup2(log.fileno(), 1)
                os.dup2(log.fileno(), 2)
                with contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
                    yield
            finally:
                log.flush()
                for fd, original in zip((1, 2), saved):
                    os.dup2(original, fd)
                    os.close(original)
                log.seek(0)
                self.logs.append(log.read())
                self.assert_clean(self.logs[-1])

    def observe_process(self, argv, **kwargs):
        self.assertIsInstance(argv, list)
        self.assert_clean(json.dumps(argv))
        self.assert_clean(json.dumps(kwargs["env"]))
        self.assertFalse(kwargs.get("shell"), "Shell execution is not allowed")
        self.assertEqual(Path(kwargs["cwd"]), self.root)
        self.assertEqual(kwargs["stderr"], subprocess.DEVNULL)
        self.assertTrue(kwargs["text"])
        if argv[:4] == ["bundle", "exec", "ruby", str(self.root / "script/private-markdown.rb")]:
            stage = "convert"
            self.assertEqual(argv[4:], [str(self.active_source)])
            self.assertIsNone(kwargs["input"])
            self.assertEqual(kwargs["stdin"], subprocess.DEVNULL)
            temporary = Path(kwargs["stdout"].name)
            self.assertEqual(stat.S_IMODE(os.fstat(kwargs["stdout"].fileno()).st_mode), 0o600)
            self.temporary_paths.append(temporary)
        elif argv[:2] == [sys.executable, str(self.root / "script/encrypt_post.py")]:
            stage = "encrypt"
            self.assertEqual(argv.count("--answer-stdin"), 1)
            self.assertFalse(any(arg == "--answer" or arg.startswith("--answer=") for arg in argv))
            self.assertTrue(kwargs["input"] == self.active_key + "\n", "Key was not handed off solely on stdin")
            self.assertEqual(kwargs["stdout"], subprocess.DEVNULL)
            temporary = Path(argv[argv.index("--plaintext") + 1])
            self.assertEqual(temporary, self.events[-1]["temporary"])
            output = Path(argv[argv.index("--out") + 1])
            self.assertTrue(output.is_relative_to(self.root), "Encryptor output escaped the copy")
        else:
            self.fail("Unexpected subprocess; only the local converter and encryptor are allowed")
        self.assertEqual(temporary.parent, self.active_source.parent)
        self.assertTrue(temporary.name.startswith(".blog-private-"))
        self.assertEqual(stat.S_IMODE(temporary.stat().st_mode), 0o600)
        result = REAL_RUN(argv, **kwargs, timeout=60)
        self.assertEqual(stat.S_IMODE(temporary.stat().st_mode), 0o600)
        self.events.append({"stage": stage, "temporary": temporary,
                            "html": temporary.read_text(encoding="utf-8"), "exit": result.returncode})
        return result

    def invoke(self, source, output, key_name, *options, expected=0, stages=("convert", "encrypt")):
        self.active_source, self.active_key = source, self.keys[key_name]
        self.events = []
        prompts = []

        def hidden_prompt(prompt):
            prompts.append(prompt)
            return self.active_key

        before = source.read_bytes()
        argv = ["encrypt", str(source), "--out", output, "--title", "Synthetic encrypted article", *options]
        self.assert_clean(json.dumps(argv))
        with self.capture_logs(), patch.dict(os.environ, self.env, clear=True), \
                patch.object(self.blog.getpass, "getpass", new=hidden_prompt), \
                patch.object(self.blog.subprocess, "run", new=self.observe_process):
            status = self.blog.main(argv)
        self.assertEqual(status, expected, "blog.py returned an unexpected exit status")
        self.assertEqual(prompts, ["Unlock key: "] if stages else [])
        self.assertEqual([event["stage"] for event in self.events], list(stages))
        for event in self.events:
            self.assertFalse(event["temporary"].exists(), "Private conversion file was not removed")
        self.assertEqual(len(self.temporary_paths), len(set(self.temporary_paths)))
        self.assertTrue(source.read_bytes() == before, "Private Markdown changed")
        self.assertEqual("Encrypted " in self.logs[-1], expected == 0)
        return self.events

    def markdown(self, name, *, nested=False):
        parent = self.private / "drafts" if nested else self.private
        parent.mkdir(exist_ok=True)
        path = parent / (name + ".md")
        image, download = ("../pixel.png", "/handout.bin") if nested else ("pixel.png", "handout.bin")
        path.write_text(
            "# Private fixture\n\n" + self.markers[name] + "\n\n"
            "Inline: $$x^2+1$$.\n\n$$\n\\frac{1}{2} + y = 7\n$$\n\n"
            f"![Synthetic pixel]({image})\n\n[Private download]({download})\n\n"
            f"[Continue]({FOLLOWUP_ROUTE})\n", encoding="utf-8")
        replacements = {image: data_uri("image/png", PNG), download: data_uri("application/octet-stream", self.attachment)}
        return path, replacements

    def yaml(self, path, *, frontmatter=False):
        # Use the already-required Ruby toolchain, not an extra Python YAML dependency.
        code = 'text = File.read(ARGV.fetch(0)); '
        if frontmatter:
            code += 'text = text.split("---\\n", 3).fetch(1); '
        code += 'puts JSON.generate(YAML.safe_load(text, permitted_classes: [Date]))'
        result = REAL_RUN(["bundle", "exec", "ruby", "-rjson", "-ryaml", "-rdate", "-e", code, str(path)],
                          cwd=self.root, env=self.env, text=True, capture_output=True, timeout=45)
        self.assert_clean(result.stdout + result.stderr)
        self.assertEqual(result.returncode, 0, "Generated metadata is not valid YAML")
        return json.loads(result.stdout)

    def payload(self, output, *, unlisted=False):
        path = self.root / output
        text = path.read_text(encoding="utf-8")
        self.assert_clean(text)
        metadata = self.yaml(path, frontmatter=True)
        self.assertEqual(metadata["layout"], "locked")
        self.assertIs(metadata["mathjax"], True)
        nodes = Markup(text).tags
        locks = [attrs for tag, attrs in nodes if tag == "div" and attrs.get("class") == "argon"]
        self.assertEqual(len(locks), 1)
        lock = locks[0]
        self.assertRegex(lock["data-salt"], r"\A[0-9a-f]{32}\Z")
        start = text.index('aria-live="polite">') + len('aria-live="polite">')
        wire = text[start:text.index("</div>", start)]
        if unlisted:
            self.assertTrue(wire.startswith("<span hidden>") and wire.endswith("</span>"))
            wire = wire[len("<span hidden>"):-len("</span>")]
        else:
            self.assertNotIn("<span", wire)
        blob = base64.b64decode(wire, validate=True)
        self.assertGreater(len(blob), 12 + 16)
        return metadata, lock, blob

    def roundtrip(self, lock, blob, key_name, rendered, replacements):
        self.assertEqual(lock["data-version"], "2")
        self.assertEqual(lock["data-iterations"], "200000")
        salt = bytes.fromhex(lock["data-salt"])
        aad = json.dumps(["deuterium-argon", 2, 200000, lock["data-salt"].lower(), lock["data-needs"]],
                         ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        key = hashlib.pbkdf2_hmac("sha256", self.keys[key_name].encode(), salt, 200_000, dklen=32)
        plaintext = self.decrypt(key, blob[:12], blob[12:], aad).decode("utf-8")
        actual, expected = Markup(plaintext), Markup(rendered, replacements)
        self.assertTrue(actual.events == expected.events, "Decrypted HTML differs from the converted body and expected asset edits")
        self.assertTrue(self.markers[key_name] in plaintext, "Decrypted body marker is missing")
        self.assertTrue(any(tag == "h2" for tag, _ in actual.tags), "Kramdown heading offset was not applied")
        classes = [attrs.get("class", "").split() for _, attrs in actual.tags]
        self.assertEqual(sum("katex" in names for names in classes), 2)
        self.assertEqual(sum("katex-display" in names for names in classes), 1)
        self.assertEqual(sum(tag == "math" for tag, _ in actual.tags), 2)
        images = [attrs for tag, attrs in actual.tags if tag == "img"]
        downloads = [attrs for tag, attrs in actual.tags if tag == "a" and "download" in attrs]
        self.assertEqual(len(images), 1, "Private PNG is missing or duplicated")
        self.assertEqual(len(downloads), 1, "Private download is missing or duplicated")
        self.assertTrue(images[0]["src"] == data_uri("image/png", PNG), "Private PNG did not roundtrip")
        self.assertEqual(downloads[0]["download"], "handout.bin")
        self.assertTrue(downloads[0]["href"] == data_uri("application/octet-stream", self.attachment), "Private download did not roundtrip")
        self.assertTrue(any(tag == "a" and attrs.get("href") == FOLLOWUP_ROUTE for tag, attrs in actual.tags),
                        "Ordinary followup link was not retained")
        wrong_name = "entry" if key_name != "entry" else "followup"
        wrong = hashlib.pbkdf2_hmac("sha256", self.keys[wrong_name].encode(), salt, 200_000, dklen=32)
        with self.assertRaises(self.auth_error):
            self.decrypt(wrong, blob[:12], blob[12:], aad)
        with self.assertRaises(self.auth_error):
            self.decrypt(key, blob[:12], blob[12:-1] + bytes([blob[-1] ^ 1]), aad)

    def check_chain(self, *entries):
        original = self.yaml(self.root / "_data/arg_chain.yml")
        baseline = self.yaml(self.template / "_data/arg_chain.yml")
        self.assertEqual(original, baseline + [
            {"post": row[0], "needs": row[1], "salt": row[2], "key_answer": "flag",
             "version": 2, "iterations": 200000, **({"previous": row[3]} if len(row) == 4 else {})}
            for row in entries
        ])
        self.assertTrue(self.chain.read_bytes().startswith(self.baseline_chain.rstrip(b"\n")), "Existing chain data changed")

    def listed(self):
        source, replacements = self.markdown("entry")
        events = self.invoke(source, ENTRY, "entry", "--embed-assets", "--embed-linked-files",
                             "--description", "Public synthetic description.", "--teaser", "Public synthetic teaser.",
                             "--tags", "challenges crypto", "--needs", "synthetic-entry-check")
        metadata, lock, blob = self.payload(ENTRY)
        for field in ("unlisted", "noindex", "sitemap", "permalink", "section"):
            self.assertNotIn(field, metadata)
        self.assertEqual(metadata["description"], "Public synthetic description.")
        self.assertEqual(metadata["tags"], "challenges crypto")
        self.assertIn("Public synthetic teaser.", (self.root / ENTRY).read_text())
        self.assertEqual(lock["data-needs"], "synthetic-entry-check")
        self.assertEqual([event["exit"] for event in events], [0, 0])
        self.roundtrip(lock, blob, "entry", events[0]["html"], replacements)
        return lock

    def test_listed_markdown_math_assets_and_authenticated_roundtrip(self):
        lock = self.listed()
        self.check_chain((ENTRY_ROUTE, "synthetic-entry-check", lock["data-salt"]))
        self.assertFalse((self.root / "locked").exists())

    def test_writeup_chain_route_preserves_dated_source_path(self):
        source, replacements = self.markdown("entry")
        output = "_posts/WriteUps/2031/example/crypto/notes/2031-01-02-notes.md"
        events = self.invoke(source, output, "entry", "--embed-assets", "--embed-linked-files",
                             "--needs", "synthetic-entry-check")
        _metadata, lock, blob = self.payload(output)
        self.roundtrip(lock, blob, "entry", events[0]["html"], replacements)
        self.check_chain(("/WriteUps/2031/example/crypto/notes/2031-01-02-notes.html",
                          "synthetic-entry-check", lock["data-salt"]))

    def test_unlisted_followup_and_force_rewrite_deduplicate_chain(self):
        entry_lock = self.listed()
        entry_bytes = (self.root / ENTRY).read_bytes()
        source, replacements = self.markdown("followup", nested=True)
        options = ["--unlisted", "--section", "tutorials", "--embed-assets", "--embed-linked-files",
                   "--asset-root", str(self.private), "--previous", ENTRY_ROUTE, "--needs", "synthetic-followup-check"]
        events = self.invoke(source, FOLLOWUP, "followup", *options)
        metadata, lock, blob = self.payload(FOLLOWUP, unlisted=True)
        for field in ("unlisted", "noindex"):
            self.assertIs(metadata[field], True)
        self.assertIs(metadata["sitemap"], False)
        self.assertEqual(metadata["section"], "tutorials")
        self.assertEqual(metadata["date"], "2031-01-03")
        self.assertEqual(metadata["permalink"], FOLLOWUP_ROUTE)
        self.assertEqual(lock["data-needs"], "synthetic-followup-check")
        self.roundtrip(lock, blob, "followup", events[0]["html"], replacements)
        entry = ENTRY_ROUTE, "synthetic-entry-check", entry_lock["data-salt"]
        self.check_chain(entry, (FOLLOWUP_ROUTE, "synthetic-followup-check", lock["data-salt"], ENTRY_ROUTE))

        before_post, before_chain = (self.root / FOLLOWUP).read_bytes(), self.chain.read_bytes()
        self.invoke(source, FOLLOWUP, "followup", *options, expected=1, stages=())
        self.assertTrue((self.root / FOLLOWUP).read_bytes() == before_post, "Overwrite without --force changed the post")
        self.assertTrue(self.chain.read_bytes() == before_chain, "Rejected overwrite changed the chain")

        source, replacements = self.markdown("rewrite", nested=True)
        options[-1] = "synthetic-revised-check"
        # Omitted predecessor must survive a force rewrite, unlike other fields
        # which use the caller's complete metadata/defaults.
        at = options.index("--previous")
        del options[at:at + 2]
        events = self.invoke(source, FOLLOWUP, "rewrite", *options, "--force")
        new_metadata, replacement, new_blob = self.payload(FOLLOWUP, unlisted=True)
        self.assertEqual(new_metadata, metadata, "Force rewrite changed unlisted frontmatter")
        self.assertNotEqual(replacement["data-salt"], lock["data-salt"])
        self.assertNotEqual(new_blob, blob)
        self.assertEqual(replacement["data-needs"], "synthetic-revised-check")
        self.roundtrip(replacement, new_blob, "rewrite", events[0]["html"], replacements)
        old_key = hashlib.pbkdf2_hmac("sha256", self.keys["followup"].encode(),
                                      bytes.fromhex(replacement["data-salt"]), 200_000, dklen=32)
        with self.assertRaises(self.auth_error):
            self.decrypt(old_key, new_blob[:12], new_blob[12:])
        self.check_chain(entry, (FOLLOWUP_ROUTE, "synthetic-revised-check", replacement["data-salt"], ENTRY_ROUTE))
        self.assertTrue((self.root / ENTRY).read_bytes() == entry_bytes, "Followup rewrite changed the listed post")
        self.assertEqual(list((self.root / "_posts").rglob("*.md")), [self.root / ENTRY])
        self.assertEqual(list((self.root / "locked").rglob("*.md")), [self.root / FOLLOWUP])

    def test_literal_brace_hints_through_private_markdown_and_real_kramdown(self):
        hints = ['{{ literal }} and {single}', '{% literal %}', '<img src=x> & "quote" \'apostrophe\' &#123;']
        generated = REAL_RUN(['ruby', str(self.root / 'script/new_challenge.rb'), '--html'],
                             input='synthetic-hint-check\nsynthetic-checker-answer\n' + '|'.join(hints) + '\n',
                             cwd=self.root, env=self.env, text=True, capture_output=True, timeout=45)
        self.assertEqual(generated.returncode, 0, generated.stderr)
        snippet = generated.stdout[generated.stdout.index('<form '):generated.stdout.index('\nsalted digest:')].strip()
        self.assertNotIn('{', snippet)
        self.assertNotIn('}', snippet)
        self.assertIn('&#123;&#123; literal &#125;&#125;', snippet)
        self.assertNotIn('synthetic-checker-answer', generated.stdout + generated.stderr)
        source = self.private / 'checker.md'
        source.write_text('# Private checker\n\n' + snippet + '\n', encoding='utf-8')
        # No bundling: the passive-asset bundler intentionally rejects forms.
        events = self.invoke(source, ENTRY, 'entry')
        self.assertEqual([event['exit'] for event in events], [0, 0])
        _, lock, blob = self.payload(ENTRY)
        aad = json.dumps(['deuterium-argon', 2, 200000, lock['data-salt'], lock['data-needs']],
                         separators=(',', ':')).encode()
        key = hashlib.pbkdf2_hmac('sha256', self.keys['entry'].encode(), bytes.fromhex(lock['data-salt']), 200000, 32)
        plaintext = self.decrypt(key, blob[:12], blob[12:], aad).decode('utf-8')
        self.assertEqual(plaintext, events[0]['html'])
        self.assertIn('<h2', plaintext)  # Confirms real Markdown conversion.
        self.assertEqual(sum(tag == 'form' for tag, _ in Markup(plaintext).tags), 1)
        self.assertFalse(any(tag == 'img' for tag, _ in Markup(plaintext).tags))
        rendered_hints = re.findall(r'<p class="challenge-hint"[^>]*>(.*?)</p>', plaintext)
        self.assertEqual([html.unescape(value) for value in rendered_hints], hints)
        self.check_chain((ENTRY_ROUTE, None, lock['data-salt']))

        # Neither guard was relaxed: raw delimiters still fail, even in code.
        before_post, before_chain = (self.root / ENTRY).read_bytes(), self.chain.read_bytes()
        for body in ('{{ literal }}', '```text\n{{ literal }}\n```', '{% literal %}'):
            source.write_text(body, encoding='utf-8')
            self.invoke(source, ENTRY, 'entry', '--force', expected=1, stages=())
            rejected = REAL_RUN(['ruby', str(self.root / 'script/private-markdown.rb'), str(source)],
                                cwd=self.root, env=self.env, text=True, capture_output=True, timeout=45)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertEqual(rejected.stdout, '')
            self.assertEqual((self.root / ENTRY).read_bytes(), before_post)
            self.assertEqual(self.chain.read_bytes(), before_chain)

    def test_private_temp_cleanup_after_real_child_failures(self):
        source, _ = self.markdown("entry")
        source.write_text(source.read_text() + "\n$$\\notASyntheticKatexCommand$$\n", encoding="utf-8")
        events = self.invoke(source, ENTRY, "entry", expected=1, stages=("convert",))
        self.assertNotEqual(events[0]["exit"], 0)
        self.assertIn("Private Markdown conversion failed:", self.logs[-1])
        self.assertFalse((self.root / ENTRY).exists())
        self.assertTrue(self.chain.read_bytes() == self.baseline_chain, "Conversion failure changed chain metadata")

        source, _ = self.markdown("entry")
        source.write_text(source.read_text() + "\n![Missing](missing-private.png)\n", encoding="utf-8")
        events = self.invoke(source, ENTRY, "entry", "--embed-assets", "--embed-linked-files", expected=1)
        self.assertEqual(events[0]["exit"], 0)
        self.assertNotEqual(events[1]["exit"], 0)
        self.assertIn("Encryption failed:", self.logs[-1])
        self.assertFalse((self.root / ENTRY).exists())
        self.assertTrue(self.chain.read_bytes() == self.baseline_chain, "Embedding failure changed chain metadata")


class ProducerUnitTests(unittest.TestCase):
    def setUp(self):
        OUT.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="producer-unit-", dir=OUT)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        spec = importlib.util.spec_from_file_location("producer_unit", ROOT / "script/encrypt_post.py")
        self.producer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.producer)
        self.producer.REPO = self.root
        self.chain = self.root / "_data/arg_chain.yml"
        self.producer.CHAIN_FILE = self.chain
        self.chain.parent.mkdir()
        self.route = "/2031/01/02/first.html"
        self.next_route = "/locked/2031/01/03/next.html"
        self.salt = "0123456789abcdef" * 2

    def test_backend_three_argument_compatibility_and_optional_aad(self):
        (enc, dec), _backend = self.producer.load_backend()
        key, nonce, body = b"k" * 32, b"n" * 12, b"synthetic body"
        for aad in (None, b"synthetic header"):
            blob = enc(key, nonce, body) if aad is None else enc(key, nonce, body, aad)
            self.assertIsInstance(blob, bytes)
            self.assertEqual(len(blob), len(body) + 16)
            self.assertEqual(dec(key, nonce, blob, aad), body)
            with self.assertRaises(Exception):
                dec(key, nonce, blob, b"wrong header")

    def test_aad_exact_utf8_compact_json_and_salt_normalization(self):
        # Unicode is exercised at the serialization API even though authored
        # needs IDs intentionally use ASCII. Keys and private HTML may be UTF-8.
        self.assertEqual(self.producer.envelope_aad(self.salt.upper(), "check-\u00e9"),
                         ('["deuterium-argon",2,200000,"' + self.salt + '","check-\u00e9"]').encode())
        self.assertEqual(self.producer.derive_key("synthetic-\u00e9", bytes.fromhex(self.salt)),
                         hashlib.pbkdf2_hmac("sha256", "synthetic-\u00e9".encode(), bytes.fromhex(self.salt), 200000, 32))
        self.assertEqual(self.producer.derive_key("synthetic", bytes.fromhex(self.salt), 120000),
                         hashlib.pbkdf2_hmac("sha256", b"synthetic", bytes.fromhex(self.salt), 120000, 32))

    def test_previous_preserved_cleared_and_legacy_replaced_without_duplicates(self):
        self.producer.update_chain(self.route, "", self.salt, "flag", version=1)
        baseline = self.chain.read_bytes()
        self.producer.update_chain(self.next_route, "private-only-check", "0" * 32,
                                   'flag: "quoted" # note', self.route)
        self.assertTrue(self.chain.read_bytes().startswith(baseline))
        self.producer.update_chain(self.next_route, "changed", self.salt, "flag")
        records, _ = self.producer.read_chain(self.chain.read_text())
        self.assertEqual(records[self.next_route]["previous"], self.route)
        self.assertEqual(records[self.next_route]["version"], 2)
        self.assertEqual(records[self.next_route]["iterations"], 200000)
        self.producer.update_chain(self.next_route, "", self.salt, "flag", previous="", version=1)
        records, _ = self.producer.read_chain(self.chain.read_text())
        self.assertNotIn("previous", records[self.next_route])
        self.assertNotIn("version", records[self.next_route])
        self.assertEqual(len(records), 2)
        self.assertTrue(self.chain.read_bytes().startswith(baseline))

    def test_chain_rejects_bad_schema_routes_and_cycles_without_writes(self):
        self.producer.update_chain(self.route, "", self.salt, "flag")
        self.producer.update_chain(self.next_route, "", self.salt, "flag", self.route)
        before = self.chain.read_bytes()
        for previous in (self.next_route, "/2031/01/03/missing.html", "/2031/01/02/first.html#part",
                         "/2031/01/02/../first.html", "https://example.invalid/2031/01/02/first.html"):
            with self.subTest(previous=previous), self.assertRaises(ValueError):
                self.producer.update_chain(self.route, "", self.salt, "flag", previous)
            self.assertEqual(self.chain.read_bytes(), before)
        for suffix in ('  needs: duplicate\n', '  previous: /missing.html\n',
                       '  unexpected: field\n', '  version: 3\n',
                       '- post: /2031/01/02/first.html\n  salt: ' + self.salt + '\n'):
            bad = before + suffix.encode()
            self.chain.write_bytes(bad)
            with self.assertRaises(ValueError):
                self.producer.update_chain(self.route, "", self.salt, "flag")
            self.assertEqual(self.chain.read_bytes(), bad)

    def test_chain_quote_numeric_salt_and_null_like_ids_for_yaml(self):
        for needs in ("null", "true", "123", "a" * 128):
            self.producer.update_chain(self.route, needs, "0" * 32, "flag")
            text = self.chain.read_text()
            self.assertIn('needs: "' + needs + '"', text)
            self.assertIn('salt: "' + "0" * 32 + '"', text)
            records, _ = self.producer.read_chain(text)
            self.assertEqual(records[self.route]["needs"], needs)
        for needs in ("a" * 129, "bad id", "-starts-with-dash", "check-\u00e9"):
            with self.assertRaises(ValueError):
                self.producer.update_chain(self.route, needs, self.salt, "flag")


class ProducerPlaintextTests(unittest.TestCase):
    """Real input/bundling and filesystem checks; rejection must precede crypto."""

    LIMIT = 24 * 1024 * 1024 - 28

    def setUp(self):
        OUT.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='producer-plaintext-', dir=OUT)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        spec = importlib.util.spec_from_file_location('plaintext_producer', ROOT / 'script/encrypt_post.py')
        self.producer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.producer)
        self.producer.REPO = self.root
        self.chain = self.root / '_data/arg_chain.yml'
        self.producer.CHAIN_FILE = self.chain
        self.source = self.root / 'agent_out/body.html'
        self.source.parent.mkdir()
        (self.source.parent / 'pixel.png').write_bytes(PNG)
        self.output = self.root / '_posts/2031-01-02-synthetic.md'
        self.salt = '0123456789abcdef' * 2

    def invoke(self, *, embed=False, legacy=False, force=False):
        argv = ['encrypt_post.py', '--plaintext', str(self.source), '--out', str(self.output),
                '--answer', 'synthetic-plaintext-key', '--salt', self.salt]
        if embed:
            # Deliberately allow more than the receiver limit in the bundler.
            argv += ['--embed-assets', '--max-output-bytes', str(self.LIMIT + 1024)]
        if legacy:
            argv += ['--legacy']
        if force:
            argv += ['--force']
        with patch.object(sys, 'argv', argv), contextlib.redirect_stdout(io.StringIO()):
            self.producer.main()

    def sized_body(self, final_size, embed):
        suffix = b'</p>'
        if embed:
            suffix += ('<img src="' + data_uri('image/png', PNG) + '">').encode()
        size = final_size - len(b'<p>') - len(suffix)
        # Count UTF-8 bytes, not characters, and do not trim before measuring.
        expected = b'<p>' + '\u00e9'.encode() * (size // 2) + b' ' * (size % 2) + suffix
        source = expected.replace(data_uri('image/png', PNG).encode(), b'pixel.png') if embed else expected
        self.assertEqual(len(expected), final_size)
        if embed:
            self.assertLess(len(source), self.LIMIT)
        return source, expected

    def assert_rejected_without_mutation(self, body, pattern, *, embed, legacy):
        self.source.write_bytes(body)
        # Test absent outputs, an existing chain, and forced replacement of both.
        for state in ('new', 'existing-chain', 'force'):
            with self.subTest(state=state):
                if state == 'existing-chain':
                    self.producer.update_chain('/2030/01/01/predecessor.html', '', self.salt, 'flag')
                if state == 'force':
                    self.output.parent.mkdir(parents=True, exist_ok=True)
                    self.output.write_bytes(b'previous synthetic locked post\n')
                    self.producer.update_chain('/2031/01/02/synthetic.html', '', self.salt, 'flag')
                before = {path: path.read_bytes() if path.exists() else None for path in (self.output, self.chain)}
                paths = sorted(self.root.rglob('*'))
                with patch.object(self.producer, 'load_backend') as backend, \
                        patch.object(self.producer, 'derive_key') as derive:
                    with self.assertRaisesRegex(SystemExit, pattern):
                        self.invoke(embed=embed, legacy=legacy, force=state == 'force')
                    backend.assert_not_called()
                    derive.assert_not_called()
                self.assertEqual(sorted(self.root.rglob('*')), paths, 'Rejected input created output paths')
                for path, original in before.items():
                    if original is None:
                        self.assertFalse(path.exists())
                    else:
                        self.assertEqual(path.read_bytes(), original)
                self.assertEqual(self.source.read_bytes(), body)
        self.output.unlink()
        self.output.parent.rmdir()
        self.chain.unlink()
        self.chain.parent.rmdir()

    def test_non_utf8_rejected_in_direct_and_embedded_legacy_and_v2(self):
        for embed in (False, True):
            for legacy in (False, True):
                for invalid in (b'\xff', b'\x80', b'\xc0\xaf', b'\xed\xa0\x80', b'\xe2\x82'):
                    with self.subTest(embed=embed, legacy=legacy, invalid=invalid.hex()):
                        self.assert_rejected_without_mutation(b'<p>synthetic</p>' + invalid, 'UTF-8',
                                                              embed=embed, legacy=legacy)

    def test_one_byte_over_limit_rejected_after_embedding_without_writes(self):
        for embed in (False, True):
            body, _ = self.sized_body(self.LIMIT + 1, embed)
            for legacy in (False, True):
                with self.subTest(embed=embed, legacy=legacy):
                    self.assert_rejected_without_mutation(body, f'{self.LIMIT}-byte limit',
                                                          embed=embed, legacy=legacy)

    def test_exact_wire_limit_accepted_and_decrypts_in_all_modes(self):
        decrypt, _ = decryption_backend()
        self.assertEqual(self.producer.MAX_PLAINTEXT_BYTES, self.LIMIT)
        for embed in (False, True):
            source, expected = self.sized_body(self.LIMIT, embed)
            self.source.write_bytes(source)
            for legacy in (False, True):
                with self.subTest(embed=embed, legacy=legacy):
                    self.invoke(embed=embed, legacy=legacy, force=self.output.exists())
                    text = self.output.read_text(encoding='utf-8')
                    wire = base64.b64decode(re.search(r'aria-live="polite">([^<]+)', text)[1], validate=True)
                    self.assertEqual(len(wire), 24 * 1024 * 1024)
                    iterations = 120000 if legacy else 200000
                    aad = None if legacy else ('["deuterium-argon",2,200000,"' + self.salt + '",""]').encode()
                    key = hashlib.pbkdf2_hmac('sha256', b'synthetic-plaintext-key', bytes.fromhex(self.salt), iterations, 32)
                    self.assertTrue(decrypt(key, wire[:12], wire[12:], aad) == expected,
                                    'Boundary plaintext did not roundtrip')
                    records, _ = self.producer.read_chain(self.chain.read_text())
                    self.assertEqual(len(records), 1)
                    self.assertEqual(records['/2031/01/02/synthetic.html'].get('version', 1), 1 if legacy else 2)
                    self.assertEqual(self.source.read_bytes(), source)


class ChainPluginTests(unittest.TestCase):
    """Run the new plugin in real, isolated Jekyll builds, not source stubs."""
    @classmethod
    def setUpClass(cls):
        OUT.mkdir(parents=True, exist_ok=True)
        cls.temp = tempfile.TemporaryDirectory(prefix="chain-plugin-", dir=OUT)
        cls.addClassCleanup(cls.temp.cleanup)
        cls.work = Path(cls.temp.name)
        cache = ROOT / ".toolchain"
        ruby = cache / "ruby-3.3.7/bin/ruby"
        if not os.access(ruby, os.X_OK):
            raise unittest.SkipTest("Unavailable cached Ruby for Jekyll plugin tests")
        cls.env = {"PATH": os.pathsep.join((str(cache / "bin"), str(ruby.parent), os.defpath)),
                   "HOME": str(cls.work), "TMPDIR": str(cls.work), "LANG": "C.UTF-8",
                   "BUNDLE_GEMFILE": str(ROOT / "Gemfile"), "BUNDLE_PATH": str(cache / "vendor-bundle"),
                   "BUNDLE_APP_CONFIG": str(cls.work / "bundle-config"), "BUNDLE_IGNORE_CONFIG": "true",
                   "BUNDLE_FROZEN": "true", "BUNDLE_DISABLE_VERSION_CHECK": "true"}
        result = REAL_RUN(["ruby", "-e", 'require "bundler/setup"; require "jekyll"'],
                          env=cls.env, cwd=cls.work, capture_output=True, text=True, timeout=45)
        if result.returncode:
            raise AssertionError("Cached Jekyll dependency probe failed: " + result.stderr)

    def baseline(self):
        salt = "0123456789abcdef" * 2
        wire = base64.b64encode(bytes(range(64))).decode()
        a, b = "/2031/01/02/first.html", "/locked/2031/01/03/followup.html"
        def doc(route, version):
            attrs = 'data-version="2" data-iterations="200000" ' if version == 2 else ""
            body = (f'<div class="argon" {attrs}data-salt="{salt}" data-needs="private-check" '
                    f'aria-live="polite">{wire}</div>')
            return {"path": "first.md" if version == 1 else "locked/2031/01/03/followup.md",
                    "data": {"layout": "locked", "permalink": route, "unlisted": version == 2}, "body": body}
        return {"records": [{"post": a, "needs": "private-check", "salt": salt, "key_answer": "flag"},
                            {"post": b, "needs": "private-check", "salt": salt, "key_answer": "flag",
                             "previous": a, "version": 2, "iterations": 200000}],
                "docs": [doc(a, 1), doc(b, 2)]}

    def run_cases(self, cases):
        paths = []
        batch = Path(tempfile.mkdtemp(prefix=self._testMethodName + "-", dir=self.work))
        for index, (_label, case, _error) in enumerate(cases):
            root = batch / str(index)
            paths.append(str(root))
            for name, text in {
                "_config.yml": json.dumps({"collections": {"private": {"output": False}}}),
                "_data/arg_chain.yml": json.dumps(case["records"]),
                "_layouts/locked.html": '<main><b>{{ page.chain_position }}/{{ page.chain_length }}</b>{{ content }}</main>',
                "_plugins/encryption_chains.rb": (ROOT / "_plugins/encryption_chains.rb").read_text(),
                **case.get("static", {}),
            }.items():
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(text)
            for doc in case["docs"]:
                target = root / doc["path"]
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("---\n" + json.dumps(doc["data"]) + "\n---\n" + doc["body"])
        code = r'''require "bundler/setup"
require "jekyll"
require "json"
results = JSON.parse(STDIN.read).map do |root|
  begin
    site = Jekyll::Site.new(Jekyll.configuration({"source" => root, "destination" => root + "/out",
      "quiet" => true, "future" => true, "incremental" => false, "disable_disk_cache" => true,
      "exclude" => ["out"], "cache_dir" => root + "/cache"}))
    site.process
    docs = (site.pages + site.collections.values.flat_map(&:docs)).select { |d| d.data["layout"] == "locked" && d.write? }
    {"metadata" => docs.to_h { |d| [d.url, d.data.select { |k, _| k.start_with?("chain_") }] },
     "output" => docs.to_h { |d| [d.url, d.output] }}
  rescue StandardError => e
    {"error" => e.message, "written" => Dir.glob(root + "/out/**/*.html")}
  end
end
puts JSON.generate(results)
'''
        result = REAL_RUN(["ruby", "-e", code], input=json.dumps(paths), cwd=self.work,
                          env=self.env, capture_output=True, text=True, timeout=90)
        self.assertEqual(result.returncode, 0, result.stderr)
        results = json.loads(result.stdout)
        for (label, _case, error), actual in zip(cases, results):
            with self.subTest(label=label):
                if error:
                    self.assertRegex(actual.get("error", ""), error)
                    self.assertEqual(actual["written"], [])
                else:
                    self.assertNotIn("error", actual, actual.get("error"))
        return results

    def test_real_rendering_legacy_wrapping_chain_positions_and_no_next_urls(self):
        case = self.baseline()
        wire = base64.b64encode(bytes(range(64))).decode()
        # The existing format wraps base64; do not apply v2's no-whitespace rule.
        case["docs"][0]["body"] = case["docs"][0]["body"].replace(wire, "\n" + wire[:40] + "\n" + wire[40:] + "\n")
        # Validate evaluated Liquid rather than a misleading source-only match.
        case["docs"][1]["body"] = case["docs"][1]["body"].replace('data-needs="private-check"', 'data-needs="{{ page.unlock_id }}"')
        case["docs"][1]["data"]["unlock_id"] = "private-check"
        case["docs"][1]["body"] = case["docs"][1]["body"].replace(wire, "<span hidden>" + wire + "</span>")
        result = self.run_cases([("honest", case, None)])[0]
        for index, row in enumerate(case["records"], 1):
            self.assertEqual(result["metadata"][row["post"]], {"chain_position": index, "chain_length": 2})
            self.assertIn(f"<b>{index}/2</b>", result["output"][row["post"]])
            self.assertNotIn(case["records"][1]["post"], result["output"][row["post"]])
        single = self.baseline()
        single["docs"].pop(); single["records"].pop()
        self.run_cases([("single legacy", single, None)])

    def test_empty_chains_explicit_v1_and_branch_length(self):
        empty = {"records": [], "docs": [{"path": "index.html", "data": {}, "body": "Public page"}]}
        single = self.baseline(); single["records"].pop(); single["docs"].pop()
        single["records"][0].update(version=1, iterations=120000)
        single["docs"][0]["body"] = single["docs"][0]["body"].replace('class="argon"',
                         'class="argon" data-version="1" data-iterations="120000"')
        branch = self.baseline()
        route = "/locked/2031/01/04/branch.html"
        branch["records"].append({**branch["records"][1], "post": route})
        branch["docs"].append({**branch["docs"][1], "path": "branch.md",
                               "data": {**branch["docs"][1]["data"], "permalink": route}})
        results = self.run_cases([("empty", empty, None), ("explicit v1", single, "version/iterations"), ("branch", branch, None)])
        self.assertEqual(results[0]["metadata"], {})
        self.assertEqual(results[2]["metadata"][route], {"chain_position": 2, "chain_length": 2})

    def test_record_schema_routes_predecessors_and_real_output_membership(self):
        cases = []
        def add(label, mutate, error):
            case = self.baseline(); mutate(case); cases.append((label, case, error))
        add("missing record", lambda c: c["records"].pop(), "no chain record")
        add("extra record", lambda c: c["docs"].pop(), "rendered locked output")
        add("ordinary predecessor", lambda c: c["docs"][0]["data"].update(layout="page"), "rendered locked output")
        add("unpublished predecessor", lambda c: c["docs"][0].update(path="_posts/2031-01-02-first.md", data={**c["docs"][0]["data"], "published": False}), "rendered locked output")
        add("non-output collection", lambda c: c["docs"][0].update(path="_private/first.md"), "rendered locked output")
        add("duplicate record", lambda c: c["records"].append(c["records"][0].copy()), "duplicate route")
        add("duplicate output", lambda c: c["docs"].append({**c["docs"][0], "path": "alias.md"}), "rendered locked output")
        add("static collision", lambda c: c.update(static={"2031/01/02/first.html": "static"}), "output collision")
        add("missing predecessor", lambda c: c["records"][1].update(previous="/2031/01/02/missing.html"), "missing predecessor")
        add("self cycle", lambda c: c["records"][0].update(previous=c["records"][0]["post"]), "cycle")
        add("two cycle", lambda c: c["records"][0].update(previous=c["records"][1]["post"]), "cycle")
        for value in ("//example.invalid/2031/01/02/a.html", "/2031/01/02/../a.html", "/2031/01/02/a.html?x=1",
                      "/2031/01/02/a.html#x", "/2031/01/02/%2e%2e.html", "/2031/02/30/a.html", "/0000/01/02/a.html", "/no-date.html"):
            add("unsafe " + value, lambda c, v=value: c["records"][1].update(previous=v), "route")
        for fields in ({"version": 3}, {"version": True}, {"version": "2"}, {"iterations": 120000},
                       {"iterations": "200000"}, {"iterations": 200001}, {"salt": 123},
                       {"needs": True}, {"needs": "x" * 129}, {"needs": "bad id"}, {"key_answer": 123}, {"unknown": "x"}):
            add("bad fields " + repr(fields), lambda c, f=fields: c["records"][1].update(f), "encryption chain")
        add("missing v2 iterations", lambda c: c["records"][1].pop("iterations"), "version/iterations")
        add("non-array data", lambda c: c.update(records={}), "must be an array")
        add("non-map record", lambda c: c["records"].append("bad"), "record")
        self.run_cases(cases)

    def test_rendered_envelope_mutations_fail_before_any_public_write(self):
        cases = []
        wire = base64.b64encode(bytes(range(64))).decode()
        salt = "0123456789abcdef" * 2
        for old, new in [
            ('data-needs="private-check"', 'data-needs="other-check"'),
            ('data-needs="private-check"', 'data-needs="bad id"'),
            (salt, "0" * 32), (salt, "0" * 31), (salt, "g" * 32),
            ('data-version="2"', 'data-version="1"'), ('data-version="2"', 'data-version="3"'),
            ('data-version="2"', 'data-version="02"'), ('data-version="2" ', ''),
            ('data-version="2"', 'data-version="2" data-version="2"'),
            ('data-iterations="200000"', 'data-iterations="0200000"'),
            ('data-iterations="200000"', 'data-iterations="120000"'),
            ('data-iterations="200000" ', ''),
            (wire, "A" * 37 + "B=="), (wire, wire + "="), (wire, "!" * 64),
            (wire, base64.b64encode(b"x" * 27).decode()), (wire, wire[:10] + "\n" + wire[10:]),
            (wire, "<p>" + wire + "</p>"), ("</div>", ""), ('class="argon"', 'class="not-argon"'),
        ]:
            case = self.baseline()
            case["docs"][1]["body"] = case["docs"][1]["body"].replace(old, new)
            # HTML pages preserve duplicate attributes and unclosed tags;
            # Kramdown repairs these before the rendered-output validator runs.
            case["docs"][1]["path"] = "locked/followup.html"
            cases.append((old + " -> " + new, case, "encryption chain"))
        for wrap in (lambda b: b + b, lambda b: "<!--" + b + "-->", lambda b: "<script>" + b + "</script>",
                     lambda b: "<template>" + b + "</template>"):
            case = self.baseline(); case["docs"][1]["body"] = wrap(case["docs"][1]["body"])
            cases.append(("one actual payload", case, "exactly one"))
        self.run_cases(cases)



if __name__ == "__main__":
    unittest.main(verbosity=2)
