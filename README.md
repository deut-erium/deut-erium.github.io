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

## Article layout checks

Article widths and navigation tracks belong to `assets/css/components/article-layout.css`; footer structure belongs to `assets/css/components/site-footer.css`. Skins supply footer colors, borders, accents and typography through `--footer-*` properties rather than copies of the geometry. Themes with body grids can assign `--article-page-area` and `--footer-page-area` without overriding the shared components. The three mystery buttons keep their order and load toys only after a press. Restore occupies a row only while a toy is active; idle helper text is not displayed. Disabled controls have a screen-reader explanation without JavaScript.

Pages with `page_width: wide` use `assets/css/components/page-layout.css`. The component owns their tracks and width while each skin keeps its visual treatment. The About page opts in because its resume form and preview need more room than ordinary prose.

Both article and writeup layouts build contents links from the final heading IDs. Duplicate targets are omitted. Unsupported HTML produces a build warning and omits contents without changing the article. JavaScript adds heading permalinks and code controls; it is not required for the contents links.

Fonts load through the selected stylesheet, without a separate preload list. Print uses a static print-media stylesheet. Decorative animations observe visibility and reduced motion; game and challenge loops are separate.

```sh
node --test script/test-footer.mjs script/test-decorations.mjs script/test-font-preloads.mjs
node script/test-article-css.mjs
node script/test-page-layout.mjs
ruby script/test-article-contents.rb
python3 script/test-print-fonts.py
```

The optional `script/test-article-layout.mjs` browser check serves only a supplied generated site and blocks external requests. Its `--help` lists the theme matrix, prefix builds, no-JavaScript checks and comparison options. It requires a locally available Chromium and Puppeteer; the native CI checks do not download a browser.

The optional wide-screen page-placement check covers Margin of Error on both sides of its desktop breakpoint. The About check opens the resume section at five widths, in both color modes, across all 48 themes. Both commands need local Chromium and Puppeteer.

```sh
node script/test-theme-page-placement.mjs --site GENERATED_BUILD --out agent_out/theme-redesign/placement
node script/test-about-layout.mjs --site GENERATED_BUILD --out agent_out/about-layout/browser
```

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

## Listing only the first encrypted article in a chain

Keep the first entry in `_posts/`. Write later entries as ordinary Jekyll pages under `locked/` using `--unlisted`:

```sh
read -r -s -p 'Unlock key: ' KEY; printf '\n'
printf '%s\n' "$KEY" | python3 script/encrypt_post.py \
  --plaintext agent_out/private-post/next.html \
  --embed-assets --answer-stdin --unlisted --section tutorials \
  --out locked/2099/01/02/next-article.md --title 'Next article'
unset KEY
```

Replace the example date, title and file paths. Use `--needs` to identify the preceding challenge when appropriate, as for a normal locked post. Link to the new route, `/locked/2099/01/02/next-article.html`, from the preceding article's encrypted HTML before encrypting that article.

These pages keep the article layout and unlock screen but do not enter the posts collection. They stay out of the homepage, archive, tag counts, pagination, related-post lists, feeds, JSON post indexes, section locked-page lists, challenge index and sitemaps. The build also sets `noindex`. A contradictory indexing flag cannot override this; marking a regular post unlisted fails rather than hiding it inconsistently. Only the first entry should be authored as a post.

The route, title, teaser and ciphertext are public. Anyone with the URL can open the page, and the repository and analytics may reveal it. `noindex` is advisory. Unlisted is not access control; encryption protects only the body passed to the encryptor. Keep plaintext and original assets outside the published source tree. Raw files under `locked/` fail the build; assets belong inside the encrypted HTML.

New files under `locked/` require source-commit, byte-count and hash registration in the content manifest, just like posts. They do not increase post-count baselines. The existing `--page` mode still makes ordinary section pages; use `--unlisted` for followups that must stay out of listings.

Run `bundle exec ruby script/test-unlisted-pages.rb` for the offline Jekyll publication checks. The asset-bundler suite also tests an unlisted producer/WebCrypto image roundtrip. No example article is published by either test.

## Authored challenge archive

`/challenges/` groups event challenges by year, newest first. Every entry is an article under `_posts/ctf-tutorials/challenges/`, listed in Tutorials and the normal post indexes. Its existing `/challenges/<event>/<name>/` permalink remains valid. Posts use the verified event start date for ordering; the article labels it "Event began", not the precise release time of that particular challenge. Dates and source links are in `_data/authored_challenges.json`.

Posts have descriptive titles such as "Challenge archive: Google CTF 2024 - IDEA". All 27 challenge downloads are hosted under `assets/challenges/` (about 173 KiB), with three local license texts. The 21 original primary files are byte-identical mirrors; their pinned upstream URLs and hashes remain in the catalog. Five output-only generators have fixed instances produced with the unchanged original code and event flags, then independently solved. They are labeled as new outputs rather than competition recordings. Seven offline assignments use salted SHA-256 checks. Existing practice variants keep their routes, seven checker IDs, flags and progress separate.

Player handouts, archived server source and spoiler-bearing organizer files have separate labels. b00tleg withheld its source during the event; its local organizer practice copy stays in the spoiler disclosure because it contains level answers. Only its final reward was replaced with a public dummy flag, and its original upstream hash and modification are recorded. Law and Order retains the incorrect released handout and corrected source, with distinct download names and an explicit warning. Blokechain uses the author-supplied Cyberkarta mirror. No retired service is contacted or dummy reward accepted by an original event checker.

The root Atom feed uses `feed.xml` so challenges sharing an event start keep the archive's order. Existing Atom item IDs are preserved. Section feeds retain their 20-post window.

The challenge itself is also curlable. `/challenges/index.json` contains all 18 records; each article has `challenge.json` and `challenge.txt` alongside its HTML. The text version contains the prompt, notes and file URLs/hashes without the page shell. JSON separates primary files from organizer spoilers. These are generated static files, with no content negotiation or server process required. `/challenges.json` remains the separate progress index.

```sh
curl -fsS https://deut-erium.github.io/challenges/index.json | jq '.[].title'
curl -fsS https://deut-erium.github.io/challenges/google-ctf-2024/idea/challenge.txt
curl -fLo chall.py https://deut-erium.github.io/assets/challenges/google-ctf-2024-idea/chall.py
```

Commands and JSON URL fields use the configured publishing origin and baseurl. For an unpublished local preview, substitute the loopback origin; JSON also supplies prefixed path fields for this purpose. Serve only generated output, never the checkout or all of `agent_out/`.

Eleven interactive archive articles now offer **Browser practice**. Their catalog mode remains `interactive`, describing the original service's I/O. The `browser_practice` object names an allowlisted runtime and its variants; generated JSON also provides `launch_path` and `launch_url`, pointing to the article's Browser practice heading. Offline records have no browser-practice metadata. File URLs still refer to the unchanged local downloads.

### Browser terminal and console API

Choose Start on an interactive article to run its JavaScript port in a same-origin Web Worker. The UI module and scoped stylesheet load only on those eleven articles; the Worker and puzzle modules load only on Start. No retired service is contacted, and there is no TCP endpoint for netcat or an external solver. Each new session uses fresh browser entropy. Law and Order's selector offers `corrected` (default) and `released`; these match the separately labeled sources and are not interchangeable.

On the article, the console exposes these methods on `window.challengePractice`:

- `await window.challengePractice.start()` starts the selected variant.
- `await window.challengePractice.send("1")` sends input. Strings accept LF or CRLF separators; a final newline terminates the last line without adding another blank line. An array such as `["1", "abc"]` sends literal lines without LF. An empty string sends one blank line. Unused lines are discarded on program exit.
- `await window.challengePractice.stop()` terminates the Worker, including during setup or computation, and returns a session snapshot.
- `await window.challengePractice.reset()` terminates the old session and clears the displayed transcript, returning an idle snapshot. Saved completion is kept. Start again for a fresh instance; old Worker replies are ignored.

Await Start before sending input, and await each Send before sending another batch. Concurrent Start/Send operations are rejected rather than interleaved. Start and Send resolve at the next input wait or session end with `{output, state, solved}`; state is `awaiting-input` or `end`. Output contains only that operation's program text, without echoing input; setup status is separate. Stop, Reset, runtime errors and deadlines reject any in-flight operation, with partial output in `error.result`, instead of leaving its promise pending. The API does not accept a runtime URL, reward, RNG seed or injected puzzle state. Use the selector before Start to change Law and Order's variant.

Use ASCII input for numeric parsers; Python Unicode-digit spellings are outside the browser contract. The transport accepts Unicode text, but individual ports may reject it. Limits count UTF-8 bytes: 2 MiB per input line, 4 MiB and 4096 lines per batch (including separators), and 8 MiB output per operation. The displayed transcript retains at most 1 MiB and shows a truncation notice. Setup status is capped at 1024 characters and four updates per second. These bounds are browser limits, not changes to puzzle parameters or query quotas. Original alarms terminate the Worker at the original point in the interaction, after setup where specified; there is no extra setup deadline. Stop also works during expensive setup.

The reward is the public string `practice{local_dummy_reward}`. Completion means the port reached the original success predicate, which may leave the original loop running. It is local feedback, not an original event solve or an authoritative score. Completion timestamps are stored under `deuterium-browser-practice-v1`, keyed by full challenge ID plus `:` plus variant; no original answers are stored. Storage failures do not block practice. This storage is separate from `deuterium-solves`, encrypted unlocks and the unchanged `/challenges.json` progress index. The seven event checkers do not accept the dummy reward.

CI runs every `script/test-practice-*.mjs` suite with retained public vectors and AST reference fixtures from `test/fixtures/challenge-runtime/`. Some suites inject deterministic entropy or known state to compare the port with the original; those are reference controls, not independent puzzle solves. The Bloom reference needs Python 3 and a C compiler, without extra Python packages or a live service. Source-mutation tests and synthetic HTML/Jekyll fixtures check metadata, allowlists and page scope; real builds and browser execution remain separate checks.

When adding entries, preserve creator/coauthor credits, distinguish writeup authors from challenge creators, and record the source revision and file hashes. Register posts, outputs and updated data in the content manifest. Keep flags, generation inputs and solver scratch private. A browser hash check is local feedback, not proof of independent work or a trustworthy competition score. Check source alone, or pass a generated site directory:

```sh
python3 script/verify-challenge-archive.py
python3 script/verify-challenge-archive.py agent_out/release/site
```

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
