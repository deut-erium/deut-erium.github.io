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

## Architecture pass

The first cut of these skins kept theme 31's layout and only restyled components; the owner rejected it as identical. Every skin now re-places the page on the same markup at desktop width:

- b03 moves article facts, actions, and related records into a sticky right marginalia rail and the home list beside a sticky index rail.
- b11 rebuilds the masthead as a clipped diagonal splash panel, lays home rows out as a two-column panel grid with full-width splash rows every fourth card, and runs the article head as a full-bleed splash band.
- b15 lays home rows out three-across as a card hand, centers the masthead as a marquee band between gilt rules, frames the index as a house-rules plaque, turns article facts into a four-column odds board, and grids related records as mini cards.
- b20 turns the header into a sticky left binder rail (brand and nav stacked vertically beside the content sheet).
- b21 narrows everything into a centered exhibit column, shrinks the header to a small centered plaque, and sets indented prose paragraphs.
- b32 welds the header into a folder-tab strip on top of the form sheet, grids home rows into ruled ledger columns, and moves article facts into a sticky left case-file rail beside the proof.

Verified programmatically: on both home and a code-bearing article, each skin differs from classic on at least three of twelve measured structural metrics (body layout mode, header geometry, main columns, list columns, row columns, row width, masthead geometry, facts position and columns, article head geometry), and no two skins share a layout signature. Horizontal overflow is zero for classic and all six skins at 1440, 800, and 375 pixels. The structural rules apply only at 900px and above; below that the skins degrade to the audited mobile layout with their decorative layer, also overflow-free.
