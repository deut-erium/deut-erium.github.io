# New Tetris recovery review

Date: 2026-08-28

Candidate: `unified-publishing` at `0a8cd613ef338cb2487d189b60d14745453cd877`

Published source: root `gh-pages` commit `3747c082a1f6ce600da81050223d74b19f1b35ba`

## Verdict

**PASS with deployment notes.** The candidate has exactly the 29 `new-tetris` files in the source commit. Every working-tree file is byte-identical to its Git blob at `3747c082`, and a fresh Jekyll 4.4.1 production build emitted exactly the same 29 blobs. There are no source or build discrepancies inside `/new-tetris/`.

The game, catalog, and scoring guide started and navigated correctly in headless Chrome 152. All 27 runtime files were loaded successfully; the other two files are unreferenced font-license texts. The only baseline browser error was Chrome's implicit request for `/favicon.ico`: the old `gh-pages` tree had that root file, while the unified tree does not. This does not affect the game.

The application passed a synthetic path-prefix test because its links, style URLs, module imports, and generated URLs are relative to the current document. It still assumes a directory URL with a trailing slash (or explicit `index.html`), HTTP(S) delivery with JavaScript MIME types, and no CSP that blocks its dynamic style attributes. A strict self-only CSP leaves the game and catalog scripts running but reports violations and removes catalog piece colors.

## Direct Git-object comparison

I read the commit and blobs from the local acquisition clone's object database. The unified clone itself is shallow and does not contain `3747c082`; no manifest hash was used as source evidence. For each source path, I obtained `3747c082:<path>` from Git and compared its blob ID with `git hash-object <working-tree-path>`. Git blob identity covers the exact byte sequence, including line endings. All source and candidate modes are regular `100644` files.

The same object-to-file check was then run against a fresh production build in `/tmp/new-tetris-jekyll-build`. The build used Jekyll 4.4.1, the locked plugin versions, `JEKYLL_ENV=production`, and `--disable-disk-cache`. It produced 29 files under `/new-tetris/`, with no missing or added path.

| Source path | Git blob at `3747c082` | Working tree | Fresh Jekyll output |
|---|---|---:|---:|
| [new-tetris/index.html](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/index.html) | `8b511a2d9349f7180d7017559e2d732b3f908a48` | exact | exact |
| [new-tetris/src/board.js](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/board.js) | `6367174bec798f3736dff8e9ada6d2f09a88b4b0` | exact | exact |
| [new-tetris/src/catalog/catalog-model.js](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/catalog/catalog-model.js) | `258f3d2c5be88cec661bd696c9ca7a29b909b8f9` | exact | exact |
| [new-tetris/src/catalog/catalog.css](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/catalog/catalog.css) | `9440dbfb690b4c403d09a6cb75cfa274f6b2bf6a` | exact | exact |
| [new-tetris/src/catalog/catalog.js](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/catalog/catalog.js) | `cc3949d9f55ab70c2b5a71d627c57447d7e6b424` | exact | exact |
| [new-tetris/src/catalog/data-4.js](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/catalog/data-4.js) | `76a6ca88e24b197cf702fd0729277db6e8c4ed67` | exact | exact |
| [new-tetris/src/catalog/data-6.js](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/catalog/data-6.js) | `ba92aa05696c17ca0e323c0aba4b186b53252120` | exact | exact |
| [new-tetris/src/catalog/data-8.js](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/catalog/data-8.js) | `2687bc9cd5054eef1a98b01249c2e73443fbfa8f` | exact | exact |
| [new-tetris/src/catalog/index.html](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/catalog/index.html) | `1810f7247d06f3f11840fcd268394a0068a6ffcd` | exact | exact |
| [new-tetris/src/challenge.js](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/challenge.js) | `44bb6f4957b2ee8506fc937f32aa6775b4fcfcca` | exact | exact |
| [new-tetris/src/fonts/Atkinson-Hyperlegible-OFL.txt](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/fonts/Atkinson-Hyperlegible-OFL.txt) | `2befc89b0ee81d5a37e6ca6503bb0db099feb70f` | exact | exact |
| [new-tetris/src/fonts/Pixelify-Sans-OFL.txt](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/fonts/Pixelify-Sans-OFL.txt) | `6aa5bfbae9e8654b83e5fff942b9540830403022` | exact | exact |
| [new-tetris/src/fonts/atkinson-hyperlegible-400.woff2](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/fonts/atkinson-hyperlegible-400.woff2) | `2e43c90d5456bbf449b5c4f8e119ae83d129abae` | exact | exact |
| [new-tetris/src/fonts/atkinson-hyperlegible-700.woff2](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/fonts/atkinson-hyperlegible-700.woff2) | `bc31903acd1b6772780b04b4f6f7e0e9f36021bb` | exact | exact |
| [new-tetris/src/fonts/pixelify-sans.woff2](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/fonts/pixelify-sans.woff2) | `fe867e95ffd9845016373064c630e8ece25c5948` | exact | exact |
| [new-tetris/src/game.js](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/game.js) | `b8505a9352f3389712c4057316f09005108f9736` | exact | exact |
| [new-tetris/src/input.js](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/input.js) | `601e9c25cd519e5042f010b366584094cb7bb633` | exact | exact |
| [new-tetris/src/layouts/pop-schematic.css](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/layouts/pop-schematic.css) | `5af3879a47b9b036f81dbe4b49e614ebe5075810` | exact | exact |
| [new-tetris/src/main.js](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/main.js) | `baa62093e6860eba424ec717dcf6e32e183b6db7` | exact | exact |
| [new-tetris/src/pieces.js](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/pieces.js) | `ae5d0176d9012861972b333a37d6687a6ea3deab` | exact | exact |
| [new-tetris/src/placement-search.js](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/placement-search.js) | `42d58ff14aa571926b23f318440a584f3f647059` | exact | exact |
| [new-tetris/src/randomizer.js](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/randomizer.js) | `c3051c5e886811457227485469ca14d2645c0a89` | exact | exact |
| [new-tetris/src/renderer.js](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/renderer.js) | `130295ec599199e80b0c7783a7370bd713471ab4` | exact | exact |
| [new-tetris/src/replay.js](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/replay.js) | `1caed87b8fa2481387a07fac8c5d5168fcf0ae66` | exact | exact |
| [new-tetris/src/scoring/index.html](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/scoring/index.html) | `ffdb82eab032d56b4f2e479bb7c935d662ad222c` | exact | exact |
| [new-tetris/src/scoring/scoring.css](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/scoring/scoring.css) | `cf09703309de1dcd2afa997255b63d562df45012` | exact | exact |
| [new-tetris/src/square-scoring.js](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/square-scoring.js) | `6d7e1c75ffa3405f5ff47b2c435ea16f1774117a` | exact | exact |
| [new-tetris/src/ui-layout.js](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/src/ui-layout.js) | `6d21610157d4c9db22aca93b114070437b74023a` | exact | exact |
| [new-tetris/styles.css](https://github.com/deut-erium/deut-erium.github.io/blob/3747c082a1f6ce600da81050223d74b19f1b35ba/new-tetris/styles.css) | `407e3b928f9fb95cf7624594d6b9eda221647cda` | exact | exact |

## Browser exercise

Chrome for Testing 152.0.7977.54 loaded the unified `_site` through a loopback HTTP server. Browser background networking was disabled and hostname resolution was restricted to loopback. CDP captured responses, load failures, console logs, and uncaught exceptions.

| Exercise | Observed result |
|---|---|
| Game startup at `/new-tetris/` | Module startup completed; run mode was `free`, status was `ENDLESS`, score was `0`, the daily-date field was populated, both local font families were available, and all 198,000 board-canvas pixels were painted. Starting endless play and activating hard drop increased the piece count to 1. |
| Catalog 4x4 | 24 mixes, 117 ways to build, 24 visible entries, 24 rendered buttons. The initial `T4` example drew to canvas and showed 3,500 points. |
| Catalog 6x6 | 1,467 mixes and 178,939 ways to build. Filtering for `L5 T4` produced one result, selected `L5-T4`, updated the URL to `?size=6&family=L5-T4`, and showed 5,500 points. |
| Scoring guide | Both local stylesheets loaded; the page had 11 content sections and five catalog-example links. Selecting the `L5-T4` example returned to the catalog with the expected size, family, URL, and 5,500-point value. |
| Catalog 8x8 | 30,434 mixes and 19,077,209,438 board arrangements loaded from the dynamic data module. The first page contained 250 entries, displayed `1-250 of 30,434`, used aggregate mode, and showed a 10,000-point silver family. |
| Runtime resources | Every referenced HTML, CSS, JavaScript module, dynamic data module, and WOFF2 font returned 200 with a suitable MIME type. This covers 27 distinct app files; only the two OFL text files are not runtime resources. No app request left the loopback origin. |
| JavaScript diagnostics | No uncaught exception and no non-cancelled network failure occurred. The only console error was the unrelated root favicon 404 described below. |

The browser results also confirm that query strings on module and font URLs do not interfere with MIME handling, and that all three catalog data modules can start through dynamic `import()` at [catalog.js lines 1-7](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/new-tetris/src/catalog/catalog.js#L1-L7).

## Deployment-path assumptions

The standalone pages use document-relative references: the game styles, catalog link, and main module at [index.html lines 15-25](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/new-tetris/index.html#L15-L25) and [line 153](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/new-tetris/index.html#L153); the catalog's stylesheet, sibling-page links, and module at [catalog/index.html lines 8-15](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/new-tetris/src/catalog/index.html#L8-L15) and [line 99](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/new-tetris/src/catalog/index.html#L99); and the scoring guide's styles and navigation at [scoring/index.html lines 8-16](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/new-tetris/src/scoring/index.html#L8-L16). The fonts are also relative to their stylesheets at [styles.css lines 1-22](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/new-tetris/styles.css#L1-L22).

I served the same artifact below a synthetic `/preview` prefix and opened the game with `?layout=warm-cartridge`, then navigated game -> catalog -> scoring. The pages started correctly, and every app request remained under `/preview/new-tetris/`. The prefix test produced no JavaScript exception. The app therefore does not assume an origin-root `/new-tetris/` path or Jekyll's empty `baseurl`.

The remaining path requirements are:

- The entry point must be `/new-tetris/` or `/new-tetris/index.html`. A host that serves `/new-tetris` without redirecting to the slash form would resolve `styles.css` and `src/main.js` against the wrong parent directory.
- The subtree must retain its internal directory structure. There is no `<base>` element and no Jekyll URL filter to repair moved individual files.
- ES modules must be served over HTTP(S), with `.js` returned as JavaScript. Opening the files directly through `file://` is not a supported deployment.
- Clipboard writes prefer `navigator.clipboard` at [main.js lines 313-320](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/new-tetris/src/main.js#L313-L320), which normally requires HTTPS. The local `execCommand` fallback handles hosts where that API is unavailable. Storage denial is also handled by the `try`/`catch` blocks at [main.js lines 72-87](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/new-tetris/src/main.js#L72-L87).

## CSP assumptions

The app and unified repository declare no CSP meta element or response-header configuration. Git does not record the headers a future Pages deployment may add, so I tested this explicit policy locally:

```text
default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'
```

Checked:

- The external main module, its imports, the catalog module, the 4x4 dynamic data module, and both scoring stylesheets still loaded under that policy. Game and catalog startup completed with no uncaught exception.
- The scoring guide needs no inline script or inline style and rendered with both stylesheets.
- No code uses `eval`, `new Function`, workers, remote scripts, remote styles, or remote fonts.

Fragile:

- The pre-paint layout selector at [index.html lines 8-14](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/new-tetris/index.html#L8-L14) is inline. Chrome blocked it under `script-src 'self'` and reported the exact allowed hash `sha256-q0vaqbrxSpx1NGjR8P68y7n15UGJT5NrbRG/5bNQG7g=`. The main module later selected `warm-cartridge` successfully through [main.js lines 23-26](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/new-tetris/src/main.js#L23-L26), so this causes a CSP error and possible pre-paint layout flash rather than startup failure. A nonce or the exact hash is needed if the inline bootstrap is retained.
- Catalog piece icons create a dynamic `style="--piece-color:..."` attribute at [catalog.js lines 111-113](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/new-tetris/src/catalog/catalog.js#L111-L113). `style-src 'self'` blocked that declaration. The requested color `#e8a3f3` remained in the DOM attribute, but the computed custom property stayed at the stylesheet fallback `#d7dce2`. A deployment needs to permit these style attributes with `style-src-attr`, or the color selection must move to allowed classes or stylesheet rules.
- The clipboard fallback sets two style properties on a temporary textarea at [main.js lines 322-328](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/new-tetris/src/main.js#L322-L328). A policy that blocks style attributes can leave that temporary control visible while fallback copying runs.

## Exact discrepancies

Checked:

- No discrepancy exists among the 29 app files in the source Git object, candidate working tree, supplied `_site`, or fresh Jekyll output.

Fragile:

- A strict self-only CSP changes presentation as described above. This is conditional on deployment headers; no such policy is present in the candidate.

Not applicable:

- Chrome requested origin-root `/favicon.ico` because the standalone app has no favicon declaration. It returned 404 and produced the sole baseline console error. The old source commit contains root `favicon.ico` as blob `7ad332b2cb6f8572f7dbac6904f04a7adb2e9c49`; the unified source and output omit it. This file is outside the 29-file `/new-tetris/` unit and has no effect on game, catalog, or scoring behavior.

No source file, Git index entry, branch, or deployment state was changed during this review.
