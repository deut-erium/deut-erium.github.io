#!/usr/bin/env python3
"""Local author commands. No installs, fetches, uploads, or source commits."""

import argparse
from contextlib import contextmanager
from datetime import date
from functools import partial
import getpass
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
import warnings

ROOT = Path(__file__).resolve().parents[1]
SECTIONS = {"root": "_posts", "tutorials": "_posts/ctf-tutorials", "ramblings": "_posts/ramblings"}
GIT_OPTIONS = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false",
               "-c", "commit.gpgsign=false", "-c", "protocol.allow=never",
               "-c", "submodule.recurse=false", "-c", "maintenance.auto=false", "-c", "gc.auto=0"]
STALE = "Remote refs may be stale. Run git fetch origin on the host first; this helper never fetches."


def environment():
    # Do not let an inherited alternate index/worktree redirect deployment writes.
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(GIT_OPTIONAL_LOCKS="0", GIT_NO_LAZY_FETCH="1", GIT_TERMINAL_PROMPT="0",
               BUNDLE_FROZEN="true", BUNDLE_DISABLE_VERSION_CHECK="true")
    cache = ROOT / ".toolchain"
    if os.access(cache / "ruby-3.3.7/bin/ruby", os.X_OK):
        env["PATH"] = os.pathsep.join(map(str, [cache / "bin", cache / "ruby-3.3.7/bin",
                                                        env.get("PATH", os.defpath)]))
    if (cache / "vendor-bundle").is_dir():
        env["BUNDLE_PATH"] = str(cache / "vendor-bundle")
    return env


def run(argv, *, cwd=None, env=None, check=True, capture=False):
    return subprocess.run(list(map(str, argv)), cwd=cwd or ROOT, env=env or environment(),
                          check=check, text=True, stdout=subprocess.PIPE if capture else None)


def git(*args, cwd=None, check=True):
    return run(["git", *GIT_OPTIONS, *args], cwd=cwd, check=check, capture=True)


def safe_path(path):
    path = Path(path)
    relative = path.relative_to(ROOT)
    if ".." in relative.parts:
        raise ValueError(f"Unsafe path: {path}")
    current = ROOT
    for part in relative.parts:
        current /= part
        if current.is_symlink():
            raise ValueError(f"Symlink refused: {current}")
    return path


def directory(path):
    path = safe_path(path)
    if not path.exists():
        directory(path.parent)
        path.mkdir()
    if not path.is_dir():
        raise ValueError(f"Not a directory: {path}")
    return path


def local_only():
    run([sys.executable, ROOT / "script/verify-local-only-paths.py"])


def doctor(_args):
    env, failed = environment(), False
    print("Local checks only; no tools will be installed.")
    if os.geteuid() == 0:
        print("WARNING: running as root can leave author outputs unwritable. Use your normal account; no chown is performed.")
    for tool in ("git", "sh", "python3", "ruby", "bundle", "node"):
        found = shutil.which(tool, path=env.get("PATH"))
        print(f"{tool}: {found or 'MISSING'}")
        failed |= not bool(found)
    for relative in (*SECTIONS.values(), "agent_out/blog"):
        path = safe_path(ROOT / relative)
        while not path.exists():
            path = path.parent
        writable = path.is_dir() and os.access(path, os.W_OK | os.X_OK)
        print(f"permissions: {relative}: {'writable' if writable else 'NOT WRITABLE'} (via {path})")
        failed |= not writable
    for relative in ("_site", "agent_out/build", "agent_out/release", "agent_out/blog"):
        path = safe_path(ROOT / relative)
        if path.exists() and path.stat().st_uid == 0:
            print(f"WARNING: root-owned {relative}; left untouched. Builds use fresh agent_out/blog/run-* directories.")
    local_only()
    if shutil.which("bundle", path=env.get("PATH")):
        failed |= run(["bundle", "check"], env=env, check=False).returncode != 0
    if shutil.which("node", path=env.get("PATH")):
        failed |= run(["node", "-e", "require('katex')"], env=env, check=False).returncode != 0
    print("PDFs additionally require cached Puppeteer and Chrome; --pdf never installs them.")
    if failed:
        raise ValueError("Doctor found missing tools, dependencies, or write permissions.")


def slug_value(value):
    if len(value) > 100 or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", value):
        raise argparse.ArgumentTypeError("Use a lowercase alphanumeric slug with single hyphens (max 100 characters).")
    return value


def date_value(value):
    try:
        if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            raise ValueError()
        date.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError("Date must be a real YYYY-MM-DD date.") from None
    return value


def new(args):
    if not args.title.strip() or (args.description is not None and not args.description.strip()):
        raise ValueError("Title and description must not be blank.")
    tags = list(args.tags)
    if any(not re.fullmatch(r"[a-z0-9]+(?:[-_][a-z0-9]+)*", tag) for tag in tags):
        raise ValueError("Tags must be simple lowercase words, optionally joined by hyphens or underscores.")
    if args.challenge and "challenges" not in tags:
        tags.append("challenges")
    path = safe_path(ROOT / SECTIONS[args.section] / f"{date_value(args.date)}-{slug_value(args.slug)}.md")
    description = args.description or "TODO: Write a one-sentence summary for readers and search results."
    metadata = {"layout": "article", "title": args.title, "date": args.date,
                "section": args.section, "description": description,
                "mathjax": args.mathjax, "tags": tags}
    if args.challenge:
        metadata["challenge_checker"] = True
    text = "---\n" + "".join(f"{key}: {json.dumps(value, ensure_ascii=True)}\n" for key, value in metadata.items())
    text += "---\n\nWrite the introduction here.\n\n<!--more-->\n\n# Details\n\nWrite the post here.\n"
    if args.challenge:
        text += "\n<!-- Add a challenge.html include with a salted digest, never a plaintext answer. -->\n"
    directory(path.parent)
    with path.open("x", encoding="utf-8") as handle:
        handle.write(text)
    print(f"Created {path.relative_to(ROOT)}; review the title, description, tags, and body before publishing.")
    if args.description is None:
        print("Replace the TODO description, or supply --description when creating a post.")
    print("No source was staged or committed.")


def private_path(value):
    """Apply the encryptor's lexical and resolved-path checks before reading."""
    path = Path(os.path.abspath(value))
    resolved = path.resolve()
    for candidate in {path, resolved, path.parent.resolve() / path.name}:
        if not candidate.is_relative_to(ROOT):
            continue
        if not candidate.is_relative_to(ROOT / "agent_out"):
            raise ValueError("Private input must be outside the repository or in ignored agent_out/.")
        # Without --no-index, tracked files fail this check even under agent_out/.
        result = subprocess.run(["git", *GIT_OPTIONS, "check-ignore", "--quiet", "--", str(candidate)],
                                cwd=ROOT, env=environment(), check=False,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if result.returncode != 0:
            raise ValueError(f"Private path is not gitignored: {candidate}")
    return path


def encrypted_output(args):
    path = Path(args.out)
    path = safe_path(path if path.is_absolute() else ROOT / path)
    relative = path.relative_to(ROOT)
    if not relative.parts:
        raise ValueError("Output must be a Markdown file inside the repository.")
    first = relative.parts[0]
    if args.unlisted != (first == "locked"):
        raise ValueError("Output under locked/ requires --unlisted; --unlisted requires locked/YYYY/MM/DD/slug.md.")
    page = first != "_posts"
    # Match encrypt_post.py: posts use a dated filename, pages use date folders.
    pattern = r"(?:.+/)?(\d{4}|\d{2})/(\d{2})/(\d{2})/[^/]+\.md" if page else r"(\d{4}|\d{2})-(\d{2})-(\d{2})-.+\.md"
    match = re.fullmatch(pattern, relative.as_posix() if page else path.name, re.I)
    if not match:
        raise ValueError("Output needs YYYY-MM-DD-slug.md under _posts/, or YYYY/MM/DD/slug.md for a page.")
    year = match[1] if len(match[1]) == 4 else "20" + match[1]
    try:
        date.fromisoformat(f"{year}-{match[2]}-{match[3]}")
    except ValueError:
        raise ValueError("Output date is not a real calendar date.") from None
    if path.exists():
        if not path.is_file() or path.stat().st_nlink != 1:
            raise ValueError(f"Output must be a regular, non-hard-linked file: {path}")
        if not args.force:
            raise ValueError(f"Output already exists (use --force to rewrite): {path}")
    return path, page


def check_private_markdown(path):
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        raise ValueError(f"Cannot read private Markdown as UTF-8: {path}") from None
    # Conservative rejection, including delimiters in code examples. No Jekyll
    # frontmatter parsing or Liquid expansion happens in the private converter.
    if re.match(r"\A\ufeff?\s*(?:---[ \t]*(?:\r?\n|$)|%YAML\b|%TAG\b)", text):
        raise ValueError(f"YAML frontmatter is unsupported in private Markdown: {path}")
    if "{{" in text or "{%" in text:
        raise ValueError(f"Liquid constructs are unsupported in private Markdown: {path}")


def private_process(argv, *, message, input=None, stdout=subprocess.DEVNULL):
    """Never echo child diagnostics or exceptions: they can contain plaintext."""
    try:
        result = subprocess.run(list(map(str, argv)), cwd=ROOT, env=environment(), check=False,
                                text=True, input=input, stdout=stdout, stderr=subprocess.DEVNULL,
                                **({"stdin": subprocess.DEVNULL} if input is None else {}))
    except (OSError, ValueError, subprocess.SubprocessError):
        raise ValueError(message) from None
    if result.returncode:
        raise ValueError(message)


@contextmanager
def private_html(path):
    if path.suffix.lower() not in {".md", ".markdown"}:
        yield path
        return
    # A sibling keeps relative resources and the default asset root unchanged.
    # NamedTemporaryFile creates mode 0600 and unlinks on errors and interrupts.
    with tempfile.NamedTemporaryFile(prefix=".blog-private-", suffix=".html", dir=path.parent) as html:
        temporary = private_path(html.name)
        private_process(["bundle", "exec", "ruby", ROOT / "script/private-markdown.rb", path],
                        stdout=html, message=f"Private Markdown conversion failed: {path}")
        yield temporary


def encrypt(args):
    source = private_path(args.private_input)
    if not source.is_file():
        raise ValueError(f"Private input must be a regular file: {source}")
    if source.suffix.lower() in {".md", ".markdown"}:
        check_private_markdown(source)
    output, page = encrypted_output(args)
    if not args.title.strip():
        raise ValueError("Title must not be blank.")
    if (args.embed_linked_files or args.asset_root is not None) and not args.embed_assets:
        raise ValueError("--embed-linked-files and --asset-root require --embed-assets.")
    asset_root = private_path(args.asset_root) if args.asset_root is not None else None
    if asset_root is not None and not asset_root.is_dir():
        raise ValueError(f"Asset root must be a directory: {asset_root}")
    # encrypt_post.py also writes this file; do not let a symlink redirect it.
    chain = safe_path(ROOT / "_data/arg_chain.yml")
    if chain.exists() and (not chain.is_file() or chain.stat().st_nlink != 1):
        raise ValueError(f"Chain must be a regular, non-hard-linked file: {chain}")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            answer = getpass.getpass("Unlock key: ")
    except (getpass.GetPassWarning, EOFError):
        raise ValueError("Cannot read a hidden unlock key from the terminal.") from None
    if (not answer or len(answer) > 4096 or answer != answer.strip()
            or "\r" in answer or "\n" in answer or answer.startswith("\ufeff") or answer.endswith("\ufeff")):
        raise ValueError("Unlock key must be 1-4096 characters, one line, without surrounding whitespace or BOM.")
    with private_html(source) as html:
        command = [sys.executable, ROOT / "script/encrypt_post.py", "--plaintext", html,
                   "--answer-stdin", "--out", output, "--title=" + args.title]
        for name in ("description", "teaser", "tags", "needs", "section", "previous"):
            value = getattr(args, name)
            if value is not None:
                command.append(f"--{name}={value}")
        if args.unlisted:
            command.append("--unlisted")
        elif page:
            command.append("--page")
        for name in ("embed_assets", "embed_linked_files", "force", "legacy"):
            if getattr(args, name):
                command.append("--" + name.replace("_", "-"))
        if asset_root is not None:
            command.extend(["--asset-root", asset_root])
        private_process(command, input=answer + "\n", message=f"Encryption failed: {source} -> {output}")
    print(f"Encrypted {source} -> {output}")
    print(f"Updated {chain}")


def site_entries(site):
    site = safe_path(site)
    if not site.is_dir():
        raise ValueError(f"Missing generated site: {site}")
    entries = []
    for path in sorted(site.rglob("*")):
        safe_path(path)
        mode = path.lstat()
        if path.name.casefold() in {".git", ".gitattributes", ".gitmodules"}:
            raise ValueError(f"Git metadata refused in generated site: {path}")
        if not (stat.S_ISDIR(mode.st_mode) or stat.S_ISREG(mode.st_mode)):
            raise ValueError(f"Special file refused: {path}")
        if stat.S_ISREG(mode.st_mode) and mode.st_nlink != 1:
            raise ValueError(f"Hard-linked file refused: {path}")
        entries.append(path)
    if not all((site / name).is_file() for name in ("index.html", ".nojekyll")):
        raise ValueError("Release must contain index.html and .nojekyll.")
    return entries


def build(args):
    local_only()
    parent = directory(ROOT / "agent_out/blog")
    output = Path(tempfile.mkdtemp(prefix="run-", dir=parent))
    site = output / "site"
    env = environment()
    env.update(ACADEMIC_PDFS="1" if args.pdf else "0", TMPDIR=str(output))
    print(f"Building full release into {site}", flush=True)
    run(["sh", ROOT / "script/build-release.sh", site], env=env)
    site_entries(site)
    return site


def preview(args):
    site = build(args)

    class Handler(SimpleHTTPRequestHandler):
        def send_head(self):
            try:
                safe_path(Path(self.translate_path(self.path)))
            except ValueError:
                self.send_error(403, "Symlink refused")
                return None
            return super().send_head()

    with ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, directory=str(site))) as server:
        print(f"Preview: http://127.0.0.1:{args.port}/ (foreground; Ctrl-C stops it)", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


def oid(ref, *, cwd=None, required=True):
    result = git("rev-parse", "--verify", "--quiet", ref + "^{commit}", cwd=cwd, check=False)
    if result.returncode == 1 and not required:
        return None
    value = result.stdout.strip()
    if result.returncode or not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", value):
        raise ValueError(f"Missing or invalid local commit: {ref}. {STALE}")
    return value


def clean_source():
    branch = git("symbolic-ref", "--quiet", "HEAD", check=False)
    if branch.returncode or branch.stdout.strip() != "refs/heads/master":
        raise ValueError("prepare-publish requires checked-out master, not a detached HEAD.")
    if git("status", "--porcelain", "--untracked-files=all", "--ignore-submodules=none").stdout:
        raise ValueError("Commit source changes yourself first: master must be clean, including untracked files.")
    source = oid("HEAD")
    upstream = oid("refs/remotes/origin/master", required=False)
    if upstream:
        result = git("merge-base", "--is-ancestor", upstream, source, check=False)
        if result.returncode:
            raise ValueError("Cannot establish origin/master as an ancestor of master; refusing deployment.")
    return source


def copy_site(site, worktree):
    entries = site_entries(site)
    for source in entries:
        target = safe_path(worktree / source.relative_to(site))
        safe_path(source)
        if source.is_dir():
            target.mkdir()
        else:
            fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, "rb") as incoming:
                info = os.fstat(incoming.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    raise ValueError(f"Generated file changed: {source}")
                with target.open("xb") as outgoing:
                    shutil.copyfileobj(incoming, outgoing)


def prepare_publish(args):
    print(STALE)
    source = clean_source()
    base = oid("refs/remotes/origin/gh-pages")
    site = build(args)
    if clean_source() != source or oid("refs/remotes/origin/gh-pages") != base:
        raise ValueError("Source or deployment base changed during build; refusing deployment.")
    worktree = safe_path(site.parent / "deploy")
    if worktree.exists():
        raise ValueError(f"Deployment target already exists: {worktree}")
    git("worktree", "add", "--detach", str(worktree), base)
    # Check the actual Git target before any removal or staging.
    if (git("rev-parse", "--show-toplevel", cwd=worktree).stdout.strip() != str(worktree)
            or git("symbolic-ref", "--quiet", "HEAD", cwd=worktree, check=False).returncode != 1
            or oid("HEAD", cwd=worktree) != base):
        raise ValueError("Deployment worktree identity check failed; nothing removed.")
    git("rm", "-r", "--ignore-unmatch", ".", cwd=worktree)
    if {p.name for p in worktree.iterdir()} != {".git"} or not (worktree / ".git").is_file():
        raise ValueError("Unexpected worktree leftovers; refusing to copy or stage them.")
    copy_site(site, worktree)
    git("add", "--force", "--all", "--", ".", cwd=worktree)
    git("commit", "--allow-empty", "-m", f"Deploy blog from {source}", cwd=worktree)
    deployment = oid("HEAD", cwd=worktree)
    print(f"Detached deployment retained at {worktree}. Parent branches and remote refs were not moved.")
    print("HUMAN ONLY: review the release before running this atomic, non-force push; the helper never runs it.")
    print(shlex.join(["git", "-C", str(worktree), "-c", "core.hooksPath=/dev/null", "push", "--atomic",
                      "origin", f"{source}:refs/heads/master", f"{deployment}:refs/heads/gh-pages"]))


def port_value(value):
    try:
        port = int(value)
        if 1 <= port <= 65535:
            return port
    except ValueError:
        pass
    raise argparse.ArgumentTypeError("Port must be between 1 and 65535.")


def parser():
    cli = argparse.ArgumentParser(description=__doc__, epilog="Use python3 script/blog.py COMMAND --help.")
    commands = cli.add_subparsers(dest="command", required=True)
    commands.add_parser("doctor", help="Check local tools, permissions, and tracked local-only paths.").set_defaults(func=doctor)
    create = commands.add_parser("new", help="Create a public Markdown post; never stage or commit source.")
    create.add_argument("slug", type=slug_value)
    create.add_argument("--title", required=True)
    create.add_argument("--section", choices=SECTIONS, default="root", help="Post section (default: root).")
    create.add_argument("--date", type=date_value, default=date.today().isoformat(), help="YYYY-MM-DD (default: today).")
    create.add_argument("--description", help="One-sentence summary; otherwise write a TODO for the author to replace.")
    create.add_argument("--mathjax", action="store_true", help="Enable math rendering (default: false).")
    create.add_argument("--tags", nargs="*", default=[], help="Simple lowercase tags, separated by spaces.")
    create.add_argument("--challenge", action="store_true", help="Enable challenge_checker JavaScript; use tutorials for assignments. No answers are requested.")
    create.set_defaults(func=new)
    lock = commands.add_parser("encrypt", help="Encrypt a private HTML or Markdown body; prompt for the key.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description="Encrypt trusted HTML, or convert .md/.markdown with local Kramdown/KaTeX first.\n"
                    "This is not a sanitizer: HTML, including raw HTML in Markdown, must be trusted.\n"
                    "Private input must be outside the repository or in ignored agent_out/.\n"
                    "Markdown cannot contain YAML frontmatter or Liquid constructs, even in code.\n"
                    "Conversion uses a mode-0600 sibling HTML file, removed on success or failure.\n"
                    "Child diagnostics are suppressed; logs contain paths, not body or key.",
        epilog="Example (the key is prompted for, never passed as an argument):\n"
               "  python3 script/blog.py encrypt /private/draft.md \\\n"
               "    --out _posts/ctf-tutorials/2026-09-05-door.md --title 'The door' --embed-assets\n"
               "Unlisted output: --out locked/2026/09/05/door.md --unlisted --section tutorials\n"
               "Title, description, teaser, tags, and needs are public metadata.\n"
               "The encryptor also updates _data/arg_chain.yml; no source is staged or committed.")
    lock.add_argument("private_input", metavar="PRIVATE_INPUT", help="Private HTML body or .md/.markdown file.")
    lock.add_argument("--out", required=True, metavar="PATH", help="Repository-relative or absolute output. Dated _posts/ paths stay posts; other dated paths use --page automatically.")
    lock.add_argument("--title", required=True, metavar="TITLE")
    lock.add_argument("--description", metavar="TEXT", help="Public description (default: teaser text).")
    lock.add_argument("--teaser", metavar="TEXT", help="Public teaser above the encrypted body.")
    lock.add_argument("--tags", metavar="TEXT", help="Space-separated tags as one quoted value (default: challenges crypto).")
    lock.add_argument("--needs", metavar="ID", help="Challenge whose flag unlocks this body (default: standalone lock).")
    lock.add_argument("--previous", metavar="ROUTE", help="Public dated predecessor route; omitted preserves existing value; empty clears it.")
    lock.add_argument("--legacy", action="store_true", help="Emit versionless v1 without AAD (default: authenticated v2 metadata).")
    lock.add_argument("--unlisted", action="store_true", help="Require locked/YYYY/MM/DD/slug.md; omit from post lists and sitemap.")
    lock.add_argument("--section", choices=("tutorials", "root", "ramblings"), help="Page section (default: encryptor's ramblings). Post sections follow --out, not this flag.")
    lock.add_argument("--embed-assets", action="store_true", help="Embed local assets before encryption; no network requests.")
    lock.add_argument("--embed-linked-files", action="store_true", help="With --embed-assets, also package local file hyperlinks.")
    lock.add_argument("--asset-root", metavar="PATH", help="Private asset root for --embed-assets (default: input directory).")
    lock.add_argument("--force", action="store_true", help="Explicitly allow overwriting an existing output.")
    lock.set_defaults(func=encrypt)
    for name, function, help_text in (("build", build, "Build and verify a full release in a fresh output directory."),
                                       ("preview", preview, "Build, then serve only 127.0.0.1 in the foreground."),
                                       ("prepare-publish", prepare_publish, "Require clean master, build, commit a detached deployment; print a HUMAN-only atomic push.")):
        command = commands.add_parser(name, help=help_text, description=help_text)
        command.add_argument("--pdf", action="store_true", help="Render publication PDFs using installed tools only.")
        command.set_defaults(func=function)
        if name == "preview":
            command.add_argument("--port", type=port_value, default=8000, help="Local port (default: 8000).")
        if name == "prepare-publish":
            command.epilog = STALE + " No source is staged or committed; no parent refs are updated."
    return cli


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        args.func(args)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"blog: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
