# PDF review

Source commit: `db0368d182a7a30dde93d3d7fd05162583232f2f`

Chrome 152 generated eleven A4 PDFs with backgrounds disabled. The set contains 77 pages. `current-browser/pdf-manifest.json` records every route, file size, page count, SHA-256 value, source commit, and generated-tree manifest hash.

## Checked

- All ten routes produced nonempty PDFs without print errors.
- Root home, WriteUps home, and the archive retain their post lists. The earlier print rule that removed those lists is gone.
- The About page prints the restored Circle Limit IV profile mark at a bounded size without clipping or displacing the biography.
- Skip links are absent from print and no longer overlap headings, code, images, or archive rows.
- Code frames wrap within the page. Sampled Inputrc and Curvy Decryptor code pages show no collapsed columns or clipped lines.
- N-95 screenshots remain within page bounds. Sampled first, middle, and last pages show no image clipping.
- The 404 artwork wraps within its code frame. Long archival URLs wrap inside the page.
- The New Tetris game prints one explicit noninteractive notice instead of dead controls or a clipped date input.
- The catalog prints the selected arrangement and scoring detail while omitting filters, family-list controls, playback controls, and navigation buttons.
- The scoring guide prints formulas and links in dark text on white. The earlier white-on-white formula text is gone.

Twenty-five rasterized pages were retained under `pdf-samples/`, including every page of both home PDFs, the About page, the game PDF, and the catalog PDF. Long documents use first, middle, and last-page samples. `pdf-samples/SHA256SUMS` covers the retained PNG files.

## Limits

This is a browser-PDF and sampled visual review, not an accessible-PDF certification. The PDFs were generated without tagged-PDF output and were not checked for PDF/UA conformance or assistive-technology reading order.

A human still needs to inspect all 77 pages before claiming exhaustive PDF review. The remaining review should focus on page-break preference, whitespace on final pages, grayscale output from a physical printer, and the usefulness of code and mathematics in the chosen PDF reader.
