# PDF review

Source commit: `4f6909cafb76ddac14bb4b6aa441a1a8d619fd0a`

Chrome 152 generated ten A4 PDFs with backgrounds disabled. The set contains 75 pages. `current-browser/pdf-manifest.json` records every route, file size, page count, and SHA-256 value.

## Checked

- All ten routes produced nonempty PDFs without print errors.
- Root home, WriteUps home, and the archive retain their post lists. The earlier print rule that removed those lists is gone.
- Skip links are absent from print and no longer overlap headings, code, images, or archive rows.
- Code frames wrap within the page. Sampled Inputrc and Curvy Decryptor code pages show no collapsed columns or clipped lines.
- N-95 screenshots remain within page bounds. Sampled first, middle, and last pages show no image clipping.
- The 404 artwork wraps within its code frame. Long archival URLs wrap inside the page.
- The New Tetris game prints one explicit noninteractive notice instead of dead controls or a clipped date input.
- The catalog prints the selected arrangement and scoring detail while omitting filters, family-list controls, playback controls, and navigation buttons.
- The scoring guide prints formulas and links in dark text on white. The earlier white-on-white formula text is gone.

Twenty-three rasterized pages were retained under `pdf-samples/`, including every page of both home PDFs, the game PDF, and the catalog PDF. Long documents use first, middle, and last-page samples. `pdf-samples/SHA256SUMS` covers the retained PNG files.

## Limits

This is a browser-PDF and sampled visual review, not an accessible-PDF certification. The PDFs were generated without tagged-PDF output and were not checked for PDF/UA conformance or assistive-technology reading order.

A human still needs to inspect all 75 pages before claiming exhaustive PDF review. The remaining review should focus on page-break preference, whitespace on final pages, grayscale output from a physical printer, and the usefulness of code and mathematics in the chosen PDF reader.
