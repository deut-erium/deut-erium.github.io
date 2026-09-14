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
from html.parser import HTMLParser
import importlib.util
import json
import os
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
    "script/encrypt_post.py", "script/embed_post_assets.py", "_plugins/katex_math.rb",
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
        return lambda key, nonce, blob: AESGCM(key).decrypt(nonce, blob, None), InvalidTag
    if importlib.util.find_spec("Cryptodome") is not None:
        from Cryptodome.Cipher import AES

        def decrypt(key, nonce, blob):
            return AES.new(key, AES.MODE_GCM, nonce=nonce).decrypt_and_verify(blob[:-16], blob[-16:])

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
        salt = bytes.fromhex(lock["data-salt"])
        key = hashlib.pbkdf2_hmac("sha256", self.keys[key_name].encode(), salt, 120_000, dklen=32)
        plaintext = self.decrypt(key, blob[:12], blob[12:]).decode("utf-8")
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
        wrong = hashlib.pbkdf2_hmac("sha256", self.keys[wrong_name].encode(), salt, 120_000, dklen=32)
        with self.assertRaises(self.auth_error):
            self.decrypt(wrong, blob[:12], blob[12:])
        with self.assertRaises(self.auth_error):
            self.decrypt(key, blob[:12], blob[12:-1] + bytes([blob[-1] ^ 1]))

    def check_chain(self, *entries):
        original = self.yaml(self.root / "_data/arg_chain.yml")
        baseline = self.yaml(self.template / "_data/arg_chain.yml")
        self.assertEqual(original, baseline + [
            {"post": route, "needs": needs, "salt": salt, "key_answer": "flag"}
            for route, needs, salt in entries
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

    def test_unlisted_followup_and_force_rewrite_deduplicate_chain(self):
        entry_lock = self.listed()
        entry_bytes = (self.root / ENTRY).read_bytes()
        source, replacements = self.markdown("followup", nested=True)
        options = ["--unlisted", "--section", "tutorials", "--embed-assets", "--embed-linked-files",
                   "--asset-root", str(self.private), "--needs", "synthetic-followup-check"]
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
        self.check_chain(entry, (FOLLOWUP_ROUTE, "synthetic-followup-check", lock["data-salt"]))

        before_post, before_chain = (self.root / FOLLOWUP).read_bytes(), self.chain.read_bytes()
        self.invoke(source, FOLLOWUP, "followup", *options, expected=1, stages=())
        self.assertTrue((self.root / FOLLOWUP).read_bytes() == before_post, "Overwrite without --force changed the post")
        self.assertTrue(self.chain.read_bytes() == before_chain, "Rejected overwrite changed the chain")

        source, replacements = self.markdown("rewrite", nested=True)
        options[-1] = "synthetic-revised-check"
        events = self.invoke(source, FOLLOWUP, "rewrite", *options, "--force")
        new_metadata, replacement, new_blob = self.payload(FOLLOWUP, unlisted=True)
        self.assertEqual(new_metadata, metadata, "Force rewrite changed unlisted frontmatter")
        self.assertNotEqual(replacement["data-salt"], lock["data-salt"])
        self.assertNotEqual(new_blob, blob)
        self.assertEqual(replacement["data-needs"], "synthetic-revised-check")
        self.roundtrip(replacement, new_blob, "rewrite", events[0]["html"], replacements)
        old_key = hashlib.pbkdf2_hmac("sha256", self.keys["followup"].encode(),
                                      bytes.fromhex(replacement["data-salt"]), 120_000, dklen=32)
        with self.assertRaises(self.auth_error):
            self.decrypt(old_key, new_blob[:12], new_blob[12:])
        self.check_chain(entry, (FOLLOWUP_ROUTE, "synthetic-revised-check", replacement["data-salt"]))
        self.assertTrue((self.root / ENTRY).read_bytes() == entry_bytes, "Followup rewrite changed the listed post")
        self.assertEqual(list((self.root / "_posts").rglob("*.md")), [self.root / ENTRY])
        self.assertEqual(list((self.root / "locked").rglob("*.md")), [self.root / FOLLOWUP])

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
