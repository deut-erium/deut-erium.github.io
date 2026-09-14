# Authoring the blog

Run commands from the checkout root, using your normal account. Edit on `master` or a contribution branch; publication preparation requires clean `master`. Local Jekyll plugins build the site; GitHub Pages serves the rendered `gh-pages` tree.

Encryption reads the key with a hidden terminal prompt. Never put keys or answers in command arguments, shell variables, public metadata, or recorded sessions.

## TLDR

| Task | Command |
| --- | --- |
| Check installed tools | `python3 script/blog.py doctor` |
| New ordinary post | `python3 script/blog.py new nonce-notes --title "Nonce notes" --section tutorials --date 2026-09-06` |
| New challenge post | `python3 script/blog.py new byte-puzzle --title "Byte puzzle" --section tutorials --date 2026-09-06 --challenge` |
| Encrypt a private body | `python3 script/blog.py encrypt "$HOME/blog-private/article.md" --out _posts/2026-09-06-private-notes.md --title "Private notes"` |
| Encryption options, including chains and attachments | `python3 script/blog.py encrypt --help` |
| Build and preview | `python3 script/blog.py preview --port 8000` |
| Build and verify without serving | `python3 script/blog.py build` |
| Prepare committed source for a human push | `python3 script/blog.py prepare-publish` |

Use `python3 script/blog.py COMMAND --help` for details. The helper uses an installed `.toolchain` cache when present; otherwise it needs Ruby/Bundler matching `.ruby-version` and `Gemfile.lock`, Python 3, Node, and the local KaTeX dependency. Encryption needs Python `cryptography` or `Cryptodome`. It does not install dependencies, fetch refs, or push.

## Canonical public source and private originals

| Material | Where it belongs |
| --- | --- |
| Ordinary articles and public handouts | Source Markdown under `_posts/`; intentionally public files under `assets/downloads/SLUG/` |
| Encrypted articles | Generated ciphertext Markdown under `_posts/` or `locked/`, plus `_data/arg_chain.yml`; these are public source |
| Private bodies, keys, and attachment originals | Outside the checkout; ignored `agent_out/` is also accepted for local scratch, never for staging |
| Rendered site and diagnostics | Fresh `agent_out/blog/run-*` output; use the printed path, never edit it as source |

Keep the editable private original and its backups: ciphertext is not your working document. Do not serve the checkout or a private directory. Future dates, `_drafts`, `hidden`, and `noindex` do not make committed source private; future posts are enabled.

Only actual baseline files are pinned: preserve the bytes and paths recorded in `script/imported-content-manifest.json`, historical route/code/heading baselines, and curated challenge archive inventories. New ordinary posts and valid helper-generated unlisted locked pages do not need manual pin additions. If a gate rejects a path, report it for review; do not rehash old content or bypass the gate. Corrections to pinned material need a separately reviewed change.

## Ordinary post

```sh
python3 script/blog.py new nonce-notes \
  --title "Nonce reuse notes" --section tutorials --date 2026-09-06 \
  --description "A worked example of nonce reuse." --tags crypto --mathjax
```

Edit the generated Markdown. Replace the introduction and body; keep a useful excerpt before `<!--more-->`. The helper supplies front matter, and the layout supplies the title. Body `#` headings become HTML h2 headings through the configured offset:

```markdown
A short public introduction.

<!--more-->

# Details

Inline math uses $$x^2$$. Display math uses its own block:

$$
x^2 + y^2 = z^2
$$
```

Use language-tagged code fences, descriptive image alt text, and established tags. `--mathjax` sets `mathjax: true` for build-time KaTeX styles, not a browser math renderer; omit it when unnecessary. Replace the TODO description if you did not supply one.

| Section | Source for this example | Public route |
| --- | --- | --- |
| root | `_posts/2026-09-06-nonce-notes.md` | `/2026/09/06/nonce-notes.html` |
| tutorials | `_posts/ctf-tutorials/2026-09-06-nonce-notes.md` | `/ctf-tutorials/2026/09/06/nonce-notes.html` |
| ramblings | `_posts/ramblings/2026-09-06-nonce-notes.md` | `/ramblings/2026/09/06/nonce-notes.html` |

For CTF writeups, create Markdown manually, for example `_posts/WriteUps/2026/example-ctf/crypto/nonce/2026-09-06-nonce.md`. The helper has no writeups section. Use the same front matter/excerpt conventions; the plugin assigns the writeup layout and preserves everything below `_posts/` in the URL, changing only the extension to `.html`.

## Challenge or assignment

```sh
python3 script/blog.py new byte-puzzle \
  --title "Byte puzzle" --section tutorials --date 2026-09-06 \
  --challenge --description "An offline byte-level exercise."
ruby script/new_challenge.rb
```

If Ruby is available only in the cache, use `.toolchain/bin/ruby script/new_challenge.rb`. The updated Ruby helper asks for a unique challenge ID, reads the answer with a hidden TTY prompt, and accepts up to three pipe-separated hints. It generates a fresh 32-character hex salt and prints a Liquid include with SHA-256(answer + salt), never the answer. Piped stdin is for synthetic tests only.

Paste the include into the public post body. Keep `challenge_checker: true` in front matter; the include alone does not load the checker. Avoid quotes in IDs and hints, and never use the plaintext `answer` fallback. Hints and salted hashes are public, so use an answer that resists offline guessing. Test a wrong answer and the intended answer locally without recording it.

An assignment is a post with checkers and public handouts, not an archived event or live service. Do not copy archive-only `challenge_id` or permalink metadata. Put new public files under `assets/downloads/byte-puzzle/`, inspect them for unintended answers and backups, and use site-root links:

```markdown
[Download the handout](/assets/downloads/byte-puzzle/handout.zip)
![Byte layout](/assets/downloads/byte-puzzle/layout.png)
```

Leave curated `/assets/challenges/` handouts unchanged. Historical `/ctf-tutorials/assigments/` links retain that spelling; do not use source-root `assigments/` for new downloads. It is excluded from normal copying, and `assigments/flags/` is local-only.

## Listed locked entry

Create a private directory, then use your editor to write `article.md` or `article.html` there. Choose another external path if your home directory is inside the checkout:

```sh
umask 077
mkdir -p "$HOME/blog-private"
chmod 700 "$HOME/blog-private"
```

Private Markdown is a body only: no YAML front matter or Liquid, even inside code examples. The helper automatically converts it with local Kramdown/KaTeX before encryption, using the heading and math conventions above. Its temporary HTML sibling is mode 0600 and removed afterwards. An `.html` input must already be a rendered body fragment. Encrypt only trusted content; decrypted HTML is inserted without sanitization, and widgets or raw TeX are not initialized afterwards.

Choose a nonempty, single-line key without surrounding whitespace (at most 4096 characters). Run the command, then enter the key only at its hidden `Unlock key:` prompt; it refuses to fall back to visible input.

```sh
python3 script/blog.py encrypt "$HOME/blog-private/article.md" \
  --out _posts/2026-09-06-private-notes.md --title "Private notes" \
  --tags "crypto" --teaser "An encrypted article. Enter its key to read it."
```

Use `.html` instead of `.md` for an existing HTML body. Do not scaffold the same output with `new` first: existing files are refused unless you explicitly use `--force`. Dated `_posts/` paths use the section routes above and appear in listings with a public teaser. The output directory selects the post section; `--section` is for standalone page output.

For a first door unlocked by a challenge answer, add `--needs byte-puzzle-0`, using the actual challenge ID. Every successful encryption also updates `_data/arg_chain.yml`; review and commit it with the ciphertext page. Titles, descriptions, teasers, filenames, tags, `needs`, salts, and chain notes are public. A key-source note may describe where to find a key, never contain the key itself.

## Chain followup

Write a separate private body for the next door, then encrypt it with that door's key:

```sh
python3 script/blog.py encrypt "$HOME/blog-private/next-door.md" \
  --out locked/2026/09/07/next-door.md --unlisted --section tutorials \
  --title "Next door" --teaser "Use the answer from the previous door."
```

This creates `/locked/2026/09/07/next-door.html` with `unlisted: true`, `sitemap: false`, and `noindex: true`. Valid new producer-format pages pass the additive source gate without a manifest edit; existing pinned locked files remain protected. Keep the generated envelope intact, and never put plaintext or raw attachments under `locked/`.

Place the next-door link and a discoverable answer inside the preceding private body, then encrypt that body too. Each door requires manual key entry and Unlock. `needs` can show a solved-state hint; it does not enforce prerequisites, redirect, supply a key, or auto-unlock. Challenge includes inside ciphertext are not evaluated or initialized, so use a puzzle with a manually discoverable answer there.

Unlisted pages stay out of normal lists, search/feed listings, and the sitemap. Their routes, ciphertext, and chain metadata remain public; anyone can copy the ciphertext and guess keys offline.

## Embedded private attachments

Keep attachments beside the private body, for example `images/diagram.png` and `handouts/notes.pdf` below `$HOME/blog-private/`. In a new private `bundle.md`, use relative references:

```markdown
![Private derivation](images/diagram.png)
[Download the notes](handouts/notes.pdf)
```

```sh
python3 script/blog.py encrypt "$HOME/blog-private/bundle.md" \
  --out _posts/2026-09-06-private-bundle.md --title "Private bundle" \
  --teaser "Unlock to read the article and download its attachments." \
  --embed-assets --embed-linked-files --asset-root "$HOME/blog-private"
```

`--embed-assets` packages supported local images, stylesheets/resources, media, and explicit download links inside the encrypted body. `--embed-linked-files` also packages ordinary local PDF/ZIP and other supported file links. No remote assets are fetched. The asset root must contain the body and assets; relative references resolve beside the referring file, and `/images/...` resolves inside that private root. Escaping paths or symlinks are rejected.

Defaults allow 8 MiB per asset and 16 MiB bundled HTML, including base64 expansion. See `python3 script/embed_post_assets.py --help` for limits/types; that standalone tool writes plaintext, not ciphertext. Embedding leaves originals unchanged and creates no separate encrypted download file. After unlocking, downloads save plaintext. Without embedding, encrypting a link does not encrypt its target; never copy private originals to public assets or Git.

## Edit an existing encrypted article

Edit its private original, then rerun the same encryption command with `--force`:

```sh
python3 script/blog.py encrypt "$HOME/blog-private/article.md" \
  --out _posts/2026-09-06-private-notes.md --title "Private notes" \
  --tags "crypto" --teaser "An encrypted article. Enter its key to read it." --force
```

Enter the intended key at the hidden prompt again. The command replaces the shell and ciphertext rather than merging metadata: repeat any description, tags, teaser, `--needs`, unlisted/section, and embedding options. Review the refreshed chain entry and any public key-source notes. `--force` does not authorize changing baseline-pinned files; do not hand-edit ciphertext or overwrite an imported article.

## Preview and check

```sh
python3 script/blog.py preview --port 8000
```

Each run builds and verifies a fresh release before serving it on loopback. This is not watch mode: stop with Ctrl-C and rerun after edits. Open the printed address and check the route, title, excerpt, listings, math, code, and downloads. For your new locks, test correct/incorrect keys and embedded downloads, and inspect public output for unintended plaintext. Do not unlock existing historical articles for an authoring test. Use `build` instead when no server is needed.

Use a dedicated browser profile and clear site data afterwards. Locks store only an opened marker in `sessionStorage` and do not restore decrypted content on reload. Challenge checkers persist successful flags in same-origin `localStorage` (`deuterium-solves`); those flags, decrypted DOM, and saved downloads need separate cleanup. Encryption is not account authentication or protection from scripts already running on the page. For strictly offline browser review, block external requests: production analytics remains in the HTML.

## Optional PDFs

Add `--pdf` to `build` or `preview` only when you want PDFs and have cached Puppeteer/Chrome. Ordinary HTML builds do not require them or advertise missing PDFs. Eligible public article/writeup posts get citation metadata and BibTeX; PDF mode renders and verifies sibling PDFs. Locked, hidden, unlisted, noindex, standalone pages, and redirects are excluded. Never feed decrypted content into this pipeline.

Known limitation: emoji can render as missing glyphs without failing the font-load gate. Inspect PDFs visually; a passing font-load check does not prove glyph coverage. A failed or partial PDF run is not a publishable PDF release. Use `--pdf` again for publication preparation if publishing PDFs.

## Common publish path

After preview passes, read new files in your editor (`git diff` omits untracked content) and stage only intended public source. For the ordinary tutorial:

```sh
git status --short
git diff -- _posts/ctf-tutorials/2026-09-06-nonce-notes.md
git add -- _posts/ctf-tutorials/2026-09-06-nonce-notes.md
git diff --cached
git commit -m "Add nonce reuse tutorial"
```

For challenges, also select their public downloads. For locks, select the ciphertext page and `_data/arg_chain.yml`. Check the staged diff for secrets and unrelated edits; avoid blanket staging and never force-add `agent_out/`.

Preparation requires committed source on clean `master` and a local `origin/gh-pages` ref. A human maintainer refreshes refs with `git fetch origin` separately; the helper never fetches. Then run:

```sh
python3 script/blog.py prepare-publish
```

Add `--pdf` when publishing PDFs. Preparation rebuilds and verifies committed source, commits a detached local deployment candidate, and prints the exact HUMAN ONLY atomic, non-force push command. Review the reported revisions and candidate, then have the human run that printed command unchanged. If refs changed or a prerequisite fails, stop rather than force an overwrite. The source commit is the rollback point; nothing is published until the human push.
