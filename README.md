# deuterium's blog

This repository builds the site served from `deut-erium.github.io`.

Sections:

- `/` - personal posts and browser-local challenges
- `/WriteUps/` - CTF writeups and challenge attachments
- `/ctf-tutorials/` - CTF tutorials and assignments
- `/ramblings/` - informal posts
- `/tetrasquares/` - Tetrasquares
- `/tetrasquares/catalog/` and `/tetrasquares/scoring/` - its catalog and scoring guide

The imported source is recorded in `script/imported-content-manifest.json`. It includes the public WriteUps source plus eight newer local files. Historical routes, attachment bytes, feeds, sitemaps, tags, and the recovered game are checked after each build.

## Build

Ruby 3.3.7 and Node 24.19.0 are the supported versions.

```sh
bundle config set --local frozen true
bundle install
npm ci --ignore-scripts --no-audit --no-fund
script/build-release.sh agent_out/release/site
```

The release command performs one Jekyll build for the root blog, WriteUps, tutorials, and ramblings. It renders the three Tetrasquares entry pages with optional analytics, copies the engine assets unchanged, adds `.nojekyll`, runs the content and route checks, and writes `agent_out/release/site.manifest.jsonl`.

Set `BUILD_TIME` to an ISO 8601 timestamp when building outside a Git checkout. The build uses local assets. Mathematics and syntax highlighting are generated before publication.

## API

The build publishes a curl-able index of every post at `/index.json` (a JSON array) and `/index.jsonl` (one object per line). Entries are ordered newest first and are bodyless. Each entry has `title`, `date` (ISO 8601), `route` (absolute URL), `section` (`writeups`, `tutorials`, `ramblings`, or `root`), `tags`, `description`, `has_math` (mirrors the `mathjax` front matter), and `has_code` (fenced code blocks present).

List the routes of every writeup:

```sh
curl -s https://deut-erium.github.io/index.json | jq -r '.[] | select(.section=="writeups") | .route'
```

Stream the JSON Lines variant:

```sh
curl -s https://deut-erium.github.io/index.jsonl | jq -c 'select(.has_math == true) | {title, route}'
```

## Tetrasquares construction practice

Tetrasquares uses `/tetrasquares/`. The old `/new-tetris/` routes have been removed at the author's request; old bookmarks will not redirect. Existing storage keys, daily seeds and replay identifiers are unchanged.
The [accompanying article](_posts/2026-09-07-tetrasquares.md) explains its rules and diagrams.

Open the [square catalog](/tetrasquares/catalog/), select an illustrated
4x4 or 6x6 example, and choose **Practice this construction**. For example,
`/tetrasquares/?practice=4&family=T4` opens the four-T construction.

All three game pages use the shared GoatCounter configuration, without the blog's header or stylesheet. Their analytics labels use canonical paths rather than query strings or per-construction titles. Setting `goatcounter_site` to an empty string disables the script and counting image everywhere.

Practice supplies the illustrated piece order with no gravity or timer. Match
each numbered piece in the outlined target area and hard-drop it to lock. A
wrong drop leaves the board unchanged. The optional placement outline shows the
next target, and Retry resets the same sequence. Hold is disabled so the order
stays consistent with the diagram. Completion means the construction is built;
practice does not submit daily results or collect its pending row-clear value.

The 8x8 catalog has aggregate counts rather than illustrated placement orders,
so it does not offer construction practice. Daily and endless rules are unchanged.
The practice engine and selected catalog dataset load only on practice URLs.

Run the engine and catalog reachability tests with:

```sh
node --test script/test-tetris-practice.mjs
```

The static-app manifest distinguishes newly authored local files from patched
recovered files and retains the original hashes for recovered source.

## Publishing a post

`master` contains the Jekyll source. `gh-pages` contains the generated site. GitHub Actions verifies source pushes but does not deploy them.

Choose the source location for the post:

- `_posts/YYYY-MM-DD-slug.md` for the root blog;
- `_posts/WriteUps/YYYY/event/category/challenge/YYYY-MM-DD-slug.md` for a writeup;
- `_posts/ctf-tutorials/YYYY-MM-DD-slug.md` for a tutorial;
- `_posts/ramblings/YYYY-MM-DD-slug.md` for a rambling.

A minimal post is:

```markdown
---
title: "Example title"
description: "A short description for search results."
author: deuterium
tags:
  - cryptography
  - security
excerpt_separator: <!--more-->
---

Opening summary.

<!--more-->

## First section

Article content.
```

The build assigns the section layout, canonical URL, sitemap entry, feed entry, and GoatCounter markup. Use `mathjax: true` in the front matter when the article contains mathematics. Put writeup attachments beside the Markdown source and link to them with relative paths.

Commit the source before building because the release timestamp is derived from the current commit:

```sh
git add _posts/
git commit -m "Add example article"
npm run sync-katex-assets
script/build-release.sh agent_out/release/site
```

Preview the verified output at `http://127.0.0.1:4180/`:

```sh
python3 -m http.server 4180 --bind 127.0.0.1 \
  --directory agent_out/release/site
```

Push `master`, then wait for the **Site checks** workflow to pass:

```sh
git push origin master
```

Create a deployment worktree once:

```sh
git fetch origin
git worktree add -b gh-pages ../deuterium-deploy origin/gh-pages
```

For each release, replace that worktree with the verified output, commit it, and push:

```sh
rsync -a --delete --exclude='.git' \
  agent_out/release/site/ ../deuterium-deploy/

git -C ../deuterium-deploy add -A
git -C ../deuterium-deploy commit -m "Publish example article"
git -C ../deuterium-deploy push origin gh-pages
```

Do not edit generated HTML on `gh-pages`. The release contains `.nojekyll`, so GitHub Pages serves it without another Jekyll build.

The current integrity gate retains migration-era source and aggregate-count baselines. A newly authored post may require deliberate updates to `script/imported-content-manifest.json` and the expected aggregate counts in `script/verify-site.py`. Review every reported difference rather than bypassing the checks.

The lowercase `/writeups/` deployment workaround is intentionally retired; `/WriteUps/` is the canonical integrated section. CI builds twice and compares JSON Lines manifests that cover every file and directory, file bytes, sizes, and permission modes. Symbolic links and special files fail the artifact gate.

## Locked posts with private images and attachments

Keep the HTML body and its assets outside the checkout, or together under the top-level `agent_out/` directory. Pass `--embed-assets` to the encryptor to bundle local assets in memory before encryption. No bundled plaintext file is written by this mode.

For example, with `body.html`, an `images/` directory and attachments inside `agent_out/private-post/`:

```sh
read -r -s -p 'Unlock key: ' KEY; printf '\n'
printf '%s\n' "$KEY" | python3 script/encrypt_post.py \
  --plaintext agent_out/private-post/body.html \
  --embed-assets --embed-linked-files --answer-stdin \
  --out _posts/2099-01-01-example.md --title 'Example'
unset KEY
```

Use the intended publication date and route; the example is not a registered post. The existing post-inventory checks still apply. `--answer-stdin` avoids putting the key in process arguments; the older `--answer` option remains available. Keys must be nonempty, single-line and without surrounding whitespace, matching the browser's input handling. Titles, teasers and descriptions are public, so keep private details in the encrypted body.

To inspect the bundled HTML separately:

```sh
python3 script/embed_post_assets.py \
  --html agent_out/private-post/body.html \
  --out agent_out/private-post/bundled.html \
  --embed-linked-files
```

That output is **still plaintext**, written with mode 0600. Do not publish it. Neither utility deletes original files or removes copies already exposed by the site, repository, history or another host.

The bundler handles:

- PNG, JPEG, GIF, WebP, SVG and ICO images, picture/source image sets, inline SVG image references, and dependencies inside SVG files or existing SVG data images.
- Stylesheet links, CSS imports and `url()` references, including local fonts. Relative paths use the containing HTML, stylesheet or SVG location. Styles are embedded, not scoped to the article.
- Audio/video sources, posters and caption tracks. Large media increases the encrypted page's initial download and memory use.
- Links marked `download`. With `--embed-linked-files`, ordinary local links to supported file types also become embedded downloads. Other hyperlinks, including external references, remain links. HTML pages are not recursively crawled.

The input must already be a UTF-8 **HTML body**, not Markdown or a full HTML document. The utility does not render Markdown, Liquid, or script-generated assets. Start with trusted author content: it is an asset packer, not an HTML sanitizer or a sandbox. Downloaded attachments are not sanitized.

Remote asset dependencies are rejected without fetching them. Save any permitted external assets locally first. Scripts, frames, active SVG, external SVG symbol references, inline SVG/MathML style elements, and unsupported implicit CSS image functions such as `image-set()` are rejected rather than left unpacked. Ordinary system-font fallbacks and resources supplied by the surrounding page are outside the bundle. A restrictive site Content Security Policy may also need to permit data images/fonts and embedded styles; this utility does not change that policy.

The default asset root is the HTML file's directory. Set `--asset-root` to a larger **private** tree when needed; the HTML must be inside it. A reference such as `/images/plot.png` maps to that tree, never to the filesystem root or a live website. Local query strings are ignored when reading file bytes; fragments are retained. Root escapes, including symlinks outside the tree, are rejected. A physical file cannot re-enter its own dependency chain through another alias; even finite alias re-entry is rejected. The tool assumes no hostile concurrent filesystem changes.

Defaults are 8 MiB per asset and 16 MiB of expanded HTML, with at most 128 file reads and 16 dependency levels. Both commands accept `--max-asset-bytes` and `--max-output-bytes`. Missing files, unsupported syntax, cycles and exceeded limits abort bundling before the encrypted post or chain file is changed. Existing standalone output needs `--force` to replace it.

Run the offline synthetic checks with `python3 script/test-embed-post-assets.py`. The encryption/WebCrypto test needs the existing Python AES backend and Node; it reports a skip if unavailable. Browser rendering checks are separate.
