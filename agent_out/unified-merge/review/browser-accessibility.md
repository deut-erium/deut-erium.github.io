# Browser and accessibility review

Date: 2026-08-28

Target: local unified Jekyll preview at `http://127.0.0.1:4100`

Browser: Chrome for Testing 152.0.7977.54, controlled through CDP

## Result

Seven reproducible defects were found. The shared layouts otherwise held up on desktop, mobile, 200% browser zoom, dark mode, forced colors, and keyboard navigation. No source files were changed and no screenshots were needed.

## Coverage

Representative browser routes included:

- root home and article: `/`, `/2024/01/28/inputrc.html`
- WriteUps home and article: `/WriteUps/`, `/WriteUps/2023/nullcon_hackim/crypto/curvy_decryptor/2023-08-21-Nullcon-HackIM-Curvy-Decryptor.html`
- tutorials home, article, and local challenge form: `/ctf-tutorials/`, `/ctf-tutorials/2020/08/01/Hacking-Sites.html`, `/ctf-tutorials/2021/07/04/what-are-assignments.html`
- Ramblings home and article: `/ramblings/`, `/ramblings/2022/07/01/what-is-ai.html`
- global archive and custom error page: `/archive.html`, `/404.html`
- game and its local subpages: `/new-tetris/`, `/new-tetris/src/catalog/index.html`, `/new-tetris/src/scoring/index.html`

Test modes:

- desktop at 1280 to 1440 CSS pixels
- mobile emulation at 360 by 800 CSS pixels with touch and coarse-pointer media enabled
- actual Chrome browser zoom at 200%; a 1280-pixel host window reflowed to a 632-pixel document viewport
- JavaScript disabled before navigation
- `prefers-color-scheme`, `prefers-reduced-motion`, `forced-colors`, and print media emulation
- sequential Tab navigation with CDP key events and keyboard activation with Space, Escape, and game keys
- Chrome accessibility-tree inspection for canvas and control semantics

## High: the Tetris board has no nonvisual game state

`/new-tetris/`: the Chrome accessibility tree exposes `#board` only as role `Canvas`, name "10 by 20 Tetris board with two visible spawn rows above it", and a static help description. `#hold` is only named "Held piece" and `#next` is only named "Next three pieces". None exposes the current blocks, active piece, held piece type, next piece types, coordinates, or legal placement state.

Affected:

- `#board`: keyboard-focusable and keyboard-operable for a sighted player, but its accessible name and description do not change with the board.
- `#hold` and `#next`: static canvas names do not identify their rendered pieces.

Checked:

- The AX tree contains one `main` landmark, named regions, named statistics, 24 named game buttons, and live regions for status messages.
- Starting endless play changed the canvas bitmap. Pressing P while `#board` was focused announced "Paused" and resume cleared the overlay.
- Key rebinding changed the button name to "Change the key for Move left. Current: Q", announced the result, persisted it locally, and reset correctly.

Impact:

A screen-reader user can reach and invoke the controls but cannot perceive enough board state to play. The static canvas labels do not provide a text alternative for the changing visual information.

Fix:

Expose a concise live description of the active piece, its position, occupied cells, held piece, and queue. A DOM grid or equivalent structured board representation should update with the canvas. Keep frequent movement announcements user-configurable so they do not overwhelm the live region.

## Medium: print enhancement collapses code to a 3.8 rem grid column

`/2024/01/28/inputrc.html` with JavaScript enabled and print media: `article.js` adds `.code-frame__viewport`, a two-column grid. Print CSS hides `.code-frame__gutter`, but the grid template remains. The `.highlight` block is then auto-placed in the first 3.8 rem column.

Affected:

- Representative selector: `.code-frame__viewport > .highlight > pre` measured 61 CSS pixels wide in print.
- The article's print-layout body grew to 61,948 CSS pixels and Chrome produced a 68-page PDF.
- The built site has 69 enhanced routes containing 324 code frames with this structure.

Checked:

- With JavaScript disabled, the same article had no `.code-frame__viewport`; its first `pre` measured 1,257 CSS pixels and Chrome produced 12 pages.
- Root home, archive, and New Tetris print layouts did not have global horizontal overflow. The archive printed in 9 pages and New Tetris in 3 pages.

Impact:

Printed code is squeezed into a few characters per line, greatly inflating page count and making articles impractical to print or save as PDF.

Fix:

In print media, make `.code-frame__viewport` a block or set `grid-template-columns: minmax(0, 1fr)`. Keep the existing `pre-wrap` print rule after the grid is reset.

## Medium: the custom 404 body bypasses prose and code-frame containment

`/404.html` places authored headings and a code frame directly under `.error-shell`, outside `.prose`. Most code-frame overflow, typography, color, and print rules are scoped through `.prose`.

Affected:

- Desktop: a 1,265-pixel document viewport expanded to 3,457 pixels. `.error-shell .code-frame pre` had `overflow-x: visible`, and its `code` ended at x=3,457.
- Mobile: a 360-pixel document viewport had a 3,419-pixel scroll width.
- At 200% browser zoom: a 632-pixel document viewport still had a 3,419-pixel scroll width.
- Print: a 1,265-pixel page viewport had a 2,595-pixel layout width because the 404 `pre` retained `white-space: pre` and visible overflow.
- In the light theme, the regular code text is `#101426` on `#4e5cf0`, a 3.58:1 contrast ratio. `.error-shell h3 a` and `.error-shell h2 a` use `#063f8f` on `#4e5cf0`, a 1.94:1 ratio.
- The focusable `pre` is labelled "horizontally scrollable", but the `pre` itself does not scroll; the whole document does.

Checked:

- The direct 404 document has one `main`, one H1, a working skip link, named recovery links, and visible keyboard focus.
- Dark-theme text contrast on the tested 404 elements passed, but the overflow remained.

Impact:

The error page fails mobile and 200% reflow, clips content when printed, and has low-contrast authored content in the default light theme.

Fix:

Wrap the authored fallback body in `.prose` or apply equivalent containment and color rules under `.error-shell`. Give the code viewport its own `overflow-x: auto`, wrap it for print, and choose light-theme link and code colors that meet contrast requirements on the shell background.

## Medium: archive filters remain advertised but do nothing without JavaScript

`/archive.html` renders `#archive-query` and `.quick-filters [data-filter]` before the archive script runs. There is no no-JavaScript notice or alternate filtering path.

Affected:

- With JavaScript disabled, entering `ramblings` in `#archive-query` left `.js-result-count` at 78 and all 78 `[data-record]` rows visible.
- Following `.quick-filters a[data-filter="cryptography"]` changed the URL to `?tag=cryptography`, but still showed all 78 records and marked no filter current.

Checked:

- With JavaScript enabled, the same text query showed 5 Ramblings records; Escape restored 78 and moved focus out of the field.
- The Cryptography filter showed 57 records, updated the URL, and set `aria-current="true"`.

Impact:

No-JavaScript users encounter a labelled filter field and filter links that appear functional but cannot change the results.

Fix:

Hide the filtering UI until the archive script marks it enhanced, and provide a short no-JavaScript explanation. If filters must work without scripts, generate real tag routes or server-rendered anchor targets rather than query strings that require client code.

## Medium: New Tetris leaves enabled dead controls ahead of its no-JavaScript notice

`/new-tetris/` keeps the full game UI interactive when module scripts are disabled. Its `noscript` text follows `main` in document order.

Affected:

- At 360 pixels, the notice "This game needs JavaScript enabled" began at document y=1,812, immediately after the full game.
- Twenty-two buttons remained enabled, `#board` remained focusable, and the date, disclosures, and links preceded the notice.
- Activating `#start-casual` did not change the piece count or any status.

Impact:

Keyboard and touch users can spend time traversing and invoking controls that cannot respond before reaching the explanation.

Fix:

Place a prominent no-JavaScript notice before the game. Hide or inert the game controls until the module sets a ready class or attribute; keep the catalog and scoring links available.

## Low: all WriteUps articles identify the wrong publication

The tested WriteUps article shows "deuterium's blog" in `.record-head__key`, the first `.record-facts dd`, and `.related-records h2`, while its active primary navigation item and index identify the section as Writeups or CTF Writeups.

Affected:

- Representative route: `/WriteUps/2023/nullcon_hackim/crypto/curvy_decryptor/2023-08-21-Nullcon-HackIM-Curvy-Decryptor.html`.
- Supplemental built-tree inspection found the same publication label on all 61 `.section-writeups.layout-article` pages.

Checked:

- All 4 tutorial articles show "Blog on CTFs".
- All 5 Ramblings articles show "Ramblings".
- All 8 root articles show "deuterium's blog".

Impact:

The page header and related-post heading give WriteUps readers the wrong section context, despite the primary navigation correctly marking Writeups current.

Fix:

Set the WriteUps publication default to "CTF Writeups" in the generated article metadata used by the header, facts, and related-record heading.

## Low: reduced-motion preference does not suppress the square flash

Affected:

- `/new-tetris/` under `prefers-reduced-motion: reduce`: applying the same `.fire` class used after a square award left `#square-flash` with `animation-name: pop-square-flash`, duration 1.8 seconds, step timing, and a scale/rotation transform.

Checked:

- The shared site changed `html` smooth scrolling to `auto` under reduced motion.
- The Tetris flash is event-driven rather than continuous, but it is still a large overlay animation.

Impact:

Users who request less motion still receive the full award flash.

Fix:

Add a reduced-motion rule that disables the flash animation or replaces it with a static, short-lived message without scale or rotation.

## Checks that passed

- Every representative rendered page except the preview server's generic missing-path response had one visible `main` and one H1. A supplemental scan of all generated HTML found no duplicate IDs and no pages with a different H1 or `main` count.
- Root, WriteUps, tutorials, Ramblings, and archive pages had no global horizontal overflow at desktop, 360-pixel mobile, or 200% browser zoom. Article code and wide mathematics remained in local scroll containers.
- All sampled images loaded with natural dimensions. Sampled links, buttons, inputs, summaries, and focusable code regions had accessible names or associated labels.
- The first shared-site Tab stop was the visible skip link. Primary navigation, theme control, article actions, archive controls, code controls, and game controls followed DOM order and showed visible focus.
- Light and dark selection persisted through reloads and navigation across root, WriteUps, tutorials, and Ramblings. The button label and `aria-pressed` state changed in both directions. With no saved choice, system dark preference selected dark mode.
- Forced-colors emulation replaced decorative backgrounds and shadows while preserving text, borders, links, controls, and focus outlines on the shared site and New Tetris.
- Article wrapping toggled `aria-pressed`, removed unnecessary code focus when wrapped, and generated working table-of-contents links. The local challenge checker announced an incorrect answer through its polite live output without navigating.
- Primary section routes, pagination, section archives, About, the direct 404 document, the game, catalog, and scoring guide all returned HTTP 200 from the preview.

## Preview limitation

A request for `/missing-browser-a11y-check` returned the Python preview server's generic 404 "Error response" document instead of the site's custom 404 body. The custom page was audited directly at `/404.html`, but automatic unknown-route mapping could not be verified with this server.
