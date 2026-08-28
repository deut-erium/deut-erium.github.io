# Accessibility postfix review

Verified source commit: `db0368d182a7a30dde93d3d7fd05162583232f2f`

## Automated results

- All 138 HTML routes passed at 320 CSS pixels with JavaScript enabled and disabled. Fourteen representative routes also passed at 1,440 pixels. The matrix found no document overflow, missing visible H1, missing visible main landmark, duplicate ID, unnamed visible link, or heading-level jump.
- Generated heading text and order still match all 420 authored ATX headings across 78 posts. The renderer adjusted 29 levels that skipped section depth without changing the source Markdown.
- All 61 generated content images have nonempty alternatives and dimensions. Reviewers inspected all 60 metadata-driven WriteUps images against their pixels and nearby prose. The About image now identifies Circle Limit IV as the profile image; the shared header mark is a decorative CSS image beside the visible site name. Alternative quality remains a human judgment.
- The empty Cryptopals link now has visible descriptive text.
- Root and section record lists remain present in print. Skip links do not appear in print.
- The New Tetris game and catalog each expose one visible H1 and one main landmark without JavaScript. Their inactive machines and controls remain hidden.
- The game board does not widen a 320-pixel document. Chromium exposes its table, 200 cells, 20 row headers, and 11 column headers in the accessibility tree.
- The catalog exposes one pressed size and family, a row-and-column text arrangement for 4x4 and 6x6 examples, a visible plus live failure message, and reduced-motion playback suppression.
- Entry-module failure and initial data failure keep catalog controls hidden. A later size-load failure preserves the complete current state. Retrying uses a new module URL and recovers the requested 1,467-family catalog in the same document.
- The PDF review generated eleven files and retained 25 sampled page rasters, including both About pages. Interactive-only game output now has an explicit print replacement.

## Remaining human work

Chromium accessibility-tree checks are not screen-reader tests. Manual review is still required with NVDA or another Windows reader and with VoiceOver on macOS. The main tasks are heading and landmark navigation, code-frame reading and copy status, KaTeX speech, challenge-result announcements, archive filters, New Tetris play, and catalog arrangement navigation.

No WCAG 2.2 AA, screen-reader usability, PDF/UA, or exhaustive PDF claim should be made from the current automation alone.
