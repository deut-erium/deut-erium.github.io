# Browser evidence

The browser scripts are local review tools, not CI steps. They require:

- a generated site at `_site-next`
- the loopback preview at `http://127.0.0.1:4100`
- a Chromium CDP endpoint at `http://127.0.0.1:9241`

Run the complete route matrix with low concurrency to limit Chromium process growth:

```sh
CONCURRENCY=2 node agent_out/unified-merge/review/run-route-matrix-parallel.mjs
```

The browser used for the retained evidence exits after roughly 275 navigations in this container. If that happens after a partial file is written, restart Chromium and finish the missing tasks with:

```sh
RESUME=1 node agent_out/unified-merge/review/run-route-matrix-parallel.mjs
```

Run focused state, failure, accessibility-tree, reduced-motion, text-spacing, and print-media checks with:

```sh
FOCUSED_ONLY=1 SKIP_PDFS=1 node agent_out/unified-merge/review/run-browser-matrix.mjs
```

Generate the ten retained PDFs with a fresh browser process:

```sh
node agent_out/unified-merge/review/generate-pdfs.mjs
```

`current-browser/route-matrix.json` and `current-browser/pdf-manifest.json` bind their results to source commit `4f6909c`. The focused matrix is bound to `87f3de8`; the only later source change is the scoring-guide print-color rule covered by the final PDF and clean build.
