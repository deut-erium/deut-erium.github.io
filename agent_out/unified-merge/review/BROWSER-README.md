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

`current-browser/route-matrix.json`, `current-browser/matrix.json`, and `current-browser/pdf-manifest.json` bind their results to source commit `db0368d` and generated-tree manifest `03ecda95604043f1c8f4ac5fc6c39d79db3046735625c84a8e650e3fe663756a`. The browser tools now derive both values instead of embedding a historical commit. The later commits through `30253b8` change only excluded review and verification scripts. Their clean output has the same 517 paths, with changes only to the commit-derived timestamps in `feed.xml` and `sitemap.xml`.

When `_config.yml` sets `goatcounter_site`, the route matrix tolerates requests to `gc.zgo.at` and the configured `*.goatcounter.com` host. The sandbox resolver still blocks those hosts, so the count script and pixel fail to load locally; the matrix treats only non-analytics external traffic as a failure.
