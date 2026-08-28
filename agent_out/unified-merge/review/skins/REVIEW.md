# Dice skins, first batch of six

Six complete themes, drawn by hand from their moodboard boards. The generator-built set of 36 combinatorial skins was rejected and removed; nothing here is template recombination. The calculator theme remains the default and board 31 stays out of the roll.

## The six

- `b03` The Exploit Grimoire (board 03): parchment and poisoned jewel tones, small-caps serif, rubricated drop caps, roman-numeral chapter ledger, gilded code as dark scripture, marginalia quotations.
- `b11` The Hash Crash! (board 11): halftone newsprint, Comic Sans body with Impact headlines, ink-bordered panels with hard offset shadows, speech-bubble quotations with tails, hazard-striped code headers.
- `b15` The House Always Seeds (board 15): dark-first velvet and gold, card-grid home rows with suit pips and chip badges, placard article head, dealer terminal code on felt, gilt pill navigation.
- `b20` Mutant Mathematics (board 20): khaki graph-grid stock, mono stencil type, hazard-striped header, numbered ITEM ledger, CAUTION quotations, phosphor-green terminal code.
- `b21` The Impossible Proof (board 21): Escher engraving, hatched monochrome with one cobalt accent, engraved figure numbers, stair-stepped rows, recursive nested article frames, centered epigraph quotes.
- `b32` The Undecidable Register (board 32): bureaucratic typewriter forms, manila folder header with a DEPARTMENT tab, numbered docket index, rotated red THEOREM stamps, CERTIFIED COPY quotations, green-bar line-printer code listings.

## Verification

- Each skin restyles the unified markup only: header, nav, buttons, masthead, home rows, article chrome, prose, quotations, code frames, tables, pagination, footer, plus its own dark variant and print reset. No images, no web fonts, no external resources.
- `script/verify-site.py` requires exactly these six files, each scoped to its `html[data-skin]`, each containing header, nav, row, code-frame, quotation, and print rules, and each listed in `theme.js`.
- Browser sweep on a code-bearing article at 375 and 1440 pixels: zero horizontal overflow under every skin and classic, and every skin has a distinct identity tuple (header background, page background, body and heading fonts) from classic and from each other at both widths.
- Screenshots of all six in light mode, plus grimoire, casino, and cryptoon in dark, are retained here.
- Skins stay lazy: a rolled skin loads one stylesheet of roughly 2-3.5 KB gzip; the default page loads none.

The full route matrix was not rerun for this change at the owner's direction; retained browser evidence binds to earlier trees.
