# Final accessibility and print-readiness plan

Audit date: 2026-08-28

Target: current working tree and existing `_site` at `7996024a684838aa4cf154aa3dca2b237e771657`

Review basis: local source inspection, a static pass over all 138 generated HTML files, source-to-output comparisons, the checked-in browser scripts and JSON evidence, and the existing release report. No browser, screen reader, or PDF renderer was launched in this pass. No network was used. No source, Git index, ref, or commit was changed.

## Verdict

The site is not ready for a claim of WCAG 2.2 AA conformance, completed manual screen-reader review, or completed PDF review.

The existing evidence supports narrower statements: the build verifiers pass; a 390 CSS-pixel sweep passed on 110 shell routes; the repaired article code-frame geometry passed one print-media check; and an automated Chromium accessibility-tree check found the New Tetris game board table and 200 data cells. Those checks do not cover the full generated corpus, the complete New Tetris subtree, actual assistive-technology speech, or any retained PDF.

The release report already leaves screen-reader and PDF review as an owner action. Keep that wording until the affected cases below are fixed and the missing automation and manual protocols are complete.

## Evidence reviewed

Checked:

- `script/verify-site.py _site`, `verify-static-app.py`, `verify-heading-parity.py`, and `verify-code-parity.py` pass locally.
- All 138 generated HTML documents have `lang="en"`, one static `main`, and one static H1. All ARIA ID references resolve, no positive `tabindex` occurs, and all 61 images have an `alt` attribute. This static result does not account for CSS or `hidden` state.
- The shared CSS and JavaScript, and representative New Tetris files, are byte-identical between source and `_site`. The static-app verifier covers all 29 New Tetris files.
- The existing viewport result records 110 passing routes at 390 CSS pixels, but its route filter deliberately excludes New Tetris and non-sitemap HTML ([route selection and assertions](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/agent_out/unified-merge/review/check-viewports.mjs#L50-L67)).
- The fixed-interaction result checks one article's print code width after print-media emulation ([print assertion](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/agent_out/unified-merge/review/check-fixed-interactions.mjs#L138-L145)). It does not create or inspect a PDF.
- The New Tetris result checks only the game route, one hard drop, an AX-tree role count, reduced motion for the award flash, and the no-JavaScript control state ([test body](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/agent_out/unified-merge/review/check-tetris-accessibility.mjs#L30-L105)).

Evidence limitations:

- The browser scripts assume a separately launched server and browser at hard-coded CDP ports ([viewport runner](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/agent_out/unified-merge/review/check-viewports.mjs#L3-L6), [Tetris runner](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/agent_out/unified-merge/review/check-tetris-accessibility.mjs#L3-L5)). They do not launch, isolate, version, or stop either process.
- The JSON evidence does not bind results to a commit, `_site` manifest, browser build, OS, command line, or timestamp.
- The checked workflow runs build and static verifiers only ([workflow steps](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/.github/workflows/site-check.yml#L44-L74)). The package has no browser or accessibility test dependency or test command ([package.json](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/package.json#L1-L12)).
- No axe, Accessibility Insights, Lighthouse, Pa11y, HTML conformance, text-spacing, touch-target, or PDF artifact is present under the review directory.
- Chromium's accessibility tree is an implementation data structure. It does not establish what NVDA, JAWS, VoiceOver, TalkBack, or Orca speaks, in what order, or with which keyboard-mode conflicts.

## Generated semantics and content structure

The global heading offset and mixed authored conventions produce invalid heading outlines on a substantial minority of pages. The build applies `header_offset: 1` globally ([configuration](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/_config.yml#L27-L31)), then lowers headings only inside selected root and tutorial article bodies ([post-render repair](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/_plugins/render_compatibility.rb#L104-L116)).

Affected:

- A static generated-tree pass found heading-level jumps on 31 pages: 23 WriteUps articles, three custom 404 pages, two About pages, and three root or Ramblings articles. Representative output starts H1 -> H3 because the source starts at H2 in [Curvy Decryptor](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/_posts/WriteUps/2023/nullcon_hackim/crypto/curvy_decryptor/2023-08-21-Nullcon-HackIM-Curvy-Decryptor.md#L21-L23), or H1 -> H3 because the source itself starts at H3 in [Inputrc](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/_posts/2024-01-28-inputrc.md#L18-L20). Other pages use H4, H5, or H6 for flag text or visual emphasis after an H2.
- One generated article contains a focusable link with no accessible name because its Markdown link text is empty ([Maybe Someday](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/_posts/WriteUps/2022/google_ctf/crypto/maybe_someday/2022-07-04-Google-CTF-22-Maybe-Someday.md#L244-L250)).

Needs confirmation:

- All image alternatives are nonempty, but 39 of 61 are generic candidates such as "Challenge screenshot", "Screenshot", "Step 1", "Final QR", or "Ctftime1". The metadata includes repeated generic values ([representative entries](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/_data/image_metadata.json#L1-L32)). A human must compare each image with nearby text and decide whether it is decorative, redundant, or needs an equivalent description. Presence-only automation cannot make that decision.
- Eight static tables use native table elements and headers, but only the hidden game-board table has a caption. Several tables omit explicit `scope`. Simple header inference may be sufficient; a browser rule and screen-reader pass should confirm header associations rather than treating absence of `scope` as a failure by itself.

Impact:

- Heading navigation can skip expected levels or present emphasis text as document structure. The empty link appears as an unnamed stop in link navigation. Weak image alternatives can omit challenge data or procedural steps that are available visually.

Fix:

- Define one generated heading policy: one page H1, article sections beginning at H2, and no upward jump greater than one. Normalize legacy source conventions during rendering or correct the affected authored headings, then enforce the generated outline.
- Give the Cryptopals link descriptive text or remove it.
- Review image alternatives against the pixels and surrounding prose. Record decorative images with empty `alt` rather than vague filler.
- Add generated-site checks for empty accessible names, heading jumps, ARIA references, label associations, and table header relationships.

## New Tetris accessibility

The game received useful nonvisual state work, but the catalog did not receive an equivalent pass.

Affected:

- With JavaScript disabled, the game notice is visible but the only `main` and H1 remain inside a hidden game container ([fallback and hidden main](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/new-tetris/index.html#L35-L44)). The no-JavaScript document therefore has no exposed main landmark or H1. The existing no-JavaScript test checks control visibility and notice position, not exposed landmark or heading counts.
- The catalog exposes active size buttons, filters, construction controls, and placeholder detail without a no-JavaScript notice or readiness gate ([static controls](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/new-tetris/src/catalog/index.html#L25-L79)). Every control is dead if modules are disabled or initialization fails.
- The catalog's changing construction canvas keeps the static name "Example square" ([canvas and step controls](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/new-tetris/src/catalog/index.html#L64-L74)). Drawing updates block positions and numbered build steps only in pixels ([drawing routine](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/new-tetris/src/catalog/catalog.js#L186-L247)). The recipe and drop-order lists name pieces but do not expose the arrangement's occupied coordinates or piece boundaries.
- Selected catalog size and family are represented only by the `active` class ([size state](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/new-tetris/src/catalog/catalog.js#L317-L335), [family state](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/new-tetris/src/catalog/catalog.js#L302-L305)). The buttons expose no `aria-pressed` or other programmatic selected state. Selecting a family replaces the detail without focus movement or a direct status announcement.
- The catalog's Play control animates construction every 350 ms without consulting reduced-motion preference ([playback loop](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/new-tetris/src/catalog/catalog.js#L367-L375)). The only reduced-motion rule is in the separate game stylesheet and covers the square flash ([game motion rule](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/new-tetris/styles.css#L690-L699)).

Fragile:

- The game creates 20 row headers and 200 data cells and updates them with active or locked piece text ([table construction](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/new-tetris/src/main.js#L158-L175), [state updates](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/new-tetris/src/main.js#L288-L330)). This proves that state reaches the DOM. It does not prove that a screen-reader user can efficiently inspect 200 cells, identify columns, hear focused-canvas name changes, or play while the reader's browse and quick-navigation keys are active.
- Game events can update several live regions for one event: board overlays, square flash, square result, and the dedicated announcement node ([live-region markup](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/new-tetris/index.html#L103-L120), [event messages](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/new-tetris/src/main.js#L233-L280)). Only real screen readers can establish whether speech is duplicated, dropped, late, or overwhelming.
- The hidden board has row headers but no column-header row. Whether announced column numbers are sufficient is an assistive-technology usability question.

Checked:

- Existing evidence confirms the game route exposes the named board table in Chromium's AX tree, changes the board summary after one hard drop, changes hold and queue labels, suppresses the award flash under reduced motion, and hides dead game controls without JavaScript.
- The scoring guide uses ordinary headings, lists, definition lists, text labels for every colored piece type, and native tables ([representative structure](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/new-tetris/src/scoring/index.html#L26-L77)).

Impact:

- The catalog's main visual information is not available nonvisually. Its selected state and detail updates are ambiguous, and its no-JavaScript mode advertises controls that cannot work. The game may still be impractical with a screen reader even though its state exists in the accessibility tree.

Fix:

- Keep a visible fallback main landmark and H1 when the game cannot initialize.
- Gate catalog controls behind successful module initialization and provide a prominent fallback that keeps the scoring guide and game links usable.
- Add a text or table representation of each catalog arrangement and construction step. Include coordinates or an equivalent row-by-row model, current family, current step, and piece ownership.
- Expose selected size and family state programmatically. Announce a concise detail change without moving focus unexpectedly.
- Disable or replace catalog playback under reduced motion.
- Do not close the game finding until a human screen-reader user completes the play tasks below.

## Print readiness

The shared article print repair is valid but the print surface is not ready as a whole.

Affected:

- Print CSS hides every `.record-index` ([print selector](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/assets/css/main.css#L1814-L1828)). That class is also the primary post list on the root home and pagination layout ([home list](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/_layouts/home.html#L35-L40)) and all section home, pagination, and section archive pages ([section list](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/_layouts/section_home.html#L17-L30)). The generated tree has 23 such index or archive pages. Their main record lists disappear in print.

Needs confirmation:

- New Tetris game, catalog, and scoring styles have no print-specific rules. The game and catalog can print interactive controls, clipped screen-reader-only state, canvases, scroll regions, and long generated lists without an explicit print contract.
- Shared prose tables remain scroll containers under print, and there are no page-break rules for table rows, figures, images, headings with following content, or ordinary callouts. Media emulation cannot show whether a PDF clips them or creates poor page breaks.
- The checked-in browser report mentions earlier PDF page counts, but no corresponding PDF, page raster, hash, or current fixed-state PDF was retained. The current fixed-interaction script checks CSS geometry only.

Checked:

- The shared print rule now turns the enhanced code viewport into a block and wraps code ([code print rules](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/assets/css/main.css#L1864-L1887)). Existing evidence measured a 1,257 CSS-pixel code block in a 1,265 CSS-pixel print viewport.
- Shared print CSS removes color backgrounds and hides shell navigation, article actions, code controls, gutters, and live statuses. This is a useful baseline, not visual PDF evidence.

Impact:

- Printed index pages omit their primary content. Other pages may clip tables or canvas content, split related material badly, or waste pages on controls. None of those outcomes is detectable from the retained geometry JSON.

Fix:

- Narrow the `.record-index` print exclusion to the article-navigation aside. Keep post lists visible on index and archive routes.
- Define intended print output for each New Tetris page. If the game is intentionally non-printable, print a short explanation, current state summary, and links while hiding controls. Print the scoring guide and selected catalog detail as ordinary text and tables.
- Add break, overflow, and sizing rules only after PDF page renders show where they are needed.

## Browser-automatable checks versus human checks

| Area | Browser or static automation can establish | Human screen reader or PDF review must establish |
|---|---|---|
| Names and structure | Landmarks, heading levels, ARIA references, computed names, roles, states, table associations, empty links, and hidden focusable controls | Whether landmark and heading navigation is understandable and whether names make sense in context |
| Keyboard | Tab order, focus visibility, activation, focus return, keyboard traps, and state changes after key events | Conflicts with screen-reader browse mode, ease of operation, and whether focus changes are expected |
| Dynamic status | DOM and AX-tree changes, live-region attributes, mutation order, and stale-result suppression | Spoken wording, timing, interruption, duplication, verbosity, and discoverability |
| Canvas | Parity between visual state and a DOM model, changing labels, cell counts, and selected-state attributes | Whether the model is efficient enough to understand and use, especially during play |
| CSS and viewport | Contrast for DOM text, reflow, text-spacing overrides, zoom, forced colors, reduced motion, orientation, and target geometry | Readability, cognitive load, magnifier use, and whether visual grouping survives user settings |
| Print | Print computed styles, PDF creation, page count, extracted text, element presence, and raster bounds | Clipping, overlap, page-break quality, grayscale legibility, useful content selection, and visual reading order |
| Accessible PDF | Tag presence, metadata, document language, links, and some structural rules | Tag-tree reading order, alternative text quality, math/code experience, and operation in a PDF reader with assistive technology |

An AX-tree assertion must be reported as an AX-tree assertion, not as a screen-reader test. Print-media emulation must be reported as CSS geometry testing, not as PDF review.

## Required automation before manual sign-off

### Reproducible local test runner

1. Add pinned browser-test and accessibility-rule dependencies to the lockfile. Use one command that starts a loopback-only static server, launches the browser with background networking disabled, runs tests, and tears both down.
2. Enumerate all generated HTML paths from `_site`, not only sitemap URLs. Test all 138 documents statically and group equivalent templates for expensive browser scenarios.
3. Record commit, complete `_site` SHA-256 manifest, browser and rule-engine versions, OS, viewport, media settings, command, start time, and result in every evidence file.
4. Run the test runner in CI after `verify-site.py`. Fail if tests produce unexpected external requests, console exceptions, unhandled rejections, or changed accessibility baselines.

### Static and browser accessibility gate

1. Run an HTML/ARIA conformance pass on every generated document, including New Tetris before and after initialization and with scripts disabled.
2. Run axe-core or an equivalent local rule engine on every template class in light, dark, forced-colors, and no-JavaScript modes. Do not treat a zero-rule result as conformance.
3. Add custom assertions for the 31 heading jumps, empty accessible names, image metadata, live-region uniqueness, table header associations, visible H1/main counts, and controls exposed before initialization.
4. Exercise 320 CSS-pixel reflow, actual 200% and 400% zoom, WCAG text-spacing overrides, portrait and landscape orientation, 24-by-24 CSS-pixel target minimums and their allowed exceptions, focus not obscured, and document-level overflow.
5. Run full keyboard paths for skip links, primary and footer navigation, archives, theme switching, code wrapping and copy fallback, challenge checking, disclosures, and every New Tetris control. Assert the active element and visible focus after each step.
6. Test Chromium plus Firefox for layout and interaction differences. Use WebKit where a supported local runner is available. Accessibility snapshots remain supplemental because engine trees are not assistive-technology output.

### New Tetris gate

1. Cover game, catalog, and scoring routes with JavaScript enabled, disabled, and initialization forced to fail.
2. For the game, script start, left/right/down, both rotations, hold, hard drop, pause/resume, reset, rebind, line clear, square award, game over, and daily completion. Assert visible state, DOM alternative, AX state, live-region mutation count, and focus.
3. For the catalog, cover 4x4, 6x6, and paged 8x8 modes; every filter; zero results; family navigation; range input; step buttons; playback; reduced motion; and selected state. Compare a deterministic canvas state with its text or grid equivalent.
4. Assert that the catalog and game expose one visible H1 and one main landmark in every supported readiness state.

### PDF gate

1. Generate actual PDFs from a clean `_site` with JavaScript enabled and disabled where behavior differs. Test A4 and Letter, default background settings, and both light and dark pre-print state.
2. At minimum include root home, one section archive, Inputrc, Curvy Decryptor, the image-heavy N-95 article, a table-heavy article, the custom 404, and all three New Tetris pages.
3. Save each PDF under the future review artifact directory with a SHA-256 manifest, browser version, page size, page count, source route, and generation options.
4. Use `pdfinfo` for metadata and page dimensions, `pdftotext` for expected headings and code, and `pdftoppm` or an equivalent local renderer for page images. Fail on missing primary content, blank pages, unexpected page-count jumps, raster content outside page bounds, or omitted article text.
5. If "accessible PDF" is part of the claim, add a PDF tag and PDF/UA checker. A visually acceptable browser PDF is not automatically an accessible PDF.

## Manual screen-reader protocol

Run this only after known automated failures are fixed. Record OS, screen reader and version, browser and version, route, task, expected speech, actual speech, and result.

Minimum combinations:

- NVDA with Firefox and Chromium on Windows.
- VoiceOver with Safari on macOS. Add iOS Safari for touch exploration if mobile accessibility is in scope.
- TalkBack with Chrome on Android if the game is intended to be playable on mobile with a screen reader.

Representative tasks:

1. Navigate by landmarks, H1-H6, links, forms, tables, and regions on home, archive, 404, short article, long article, and About.
2. On a code-heavy article, identify each code frame, read code, use horizontal navigation, toggle wrapping, copy, trigger clipboard fallback, and hear each status once.
3. On Curvy Decryptor, read inline and display MathML and confirm that expressions are intelligible, not merely present in the accessibility tree.
4. On the archive, enter a query, select and clear tag filters, reach zero results, use Escape, and verify concise result announcements.
5. On a challenge page, submit empty, wrong, correct, and forced-error values and confirm label, focus, and status behavior.
6. In New Tetris, start a game; identify active, held, and next pieces; inspect occupied cells; move, rotate, hold, drop, pause, resume, rebind, reset, clear a line, and reach game over. Note browse-mode conflicts and every duplicated or missing announcement.
7. In the catalog, identify selected size and family, filter results, inspect a complete arrangement and each construction step, use playback under reduced motion, and move between family detail and the family list without losing context.

The game passes manual review only if a screen-reader user can complete these tasks without visual assistance. Finding a table in the AX tree is not enough.

## Manual PDF protocol

Inspect every generated representative PDF page, not only the browser preview.

- Confirm that home and section record lists are present.
- Check code, tables, MathML, blockquotes, images, captions, long URLs, and headings for clipping or overlap.
- Check page breaks around headings, figures, table rows, code labels, and callouts.
- Check page headers and footers, page count, blank pages, grayscale output, and background-disabled output.
- Confirm that interactive-only controls are omitted or replaced with useful static text.
- For New Tetris, confirm the agreed print contract rather than accepting whatever the canvas and controls happen to produce.
- If accessible PDF is claimed, inspect the tag tree and reading order in a PDF reader with a screen reader, including links, image alternatives, code, and math.

## Exit criteria and permitted claims

Release accessibility sign-off requires all of the following:

- The affected semantic, New Tetris, and record-list print cases are fixed or covered by an explicit, owner-approved non-print policy.
- The full static gate passes all 138 HTML documents, and the browser gate passes every template class and New Tetris state without serious or critical rule violations.
- Reflow, zoom, text spacing, forced colors, reduced motion, keyboard, focus, and contrast checks have commit-bound evidence.
- Actual PDFs pass automated content checks and page-by-page human inspection.
- The screen-reader protocol has completed logs for the required combinations and tasks.
- Remaining exceptions identify the exact WCAG criterion, affected routes, user impact, rationale, and owner acceptance.

Until then, the defensible wording is: "Local browser automation checked selected accessibility and print-media behaviors; manual screen-reader and PDF review remain incomplete." The existing owner-action statement ([release report](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/agent_out/unified-merge/REPORT.md#L203-L210)) is accurate and should remain.
