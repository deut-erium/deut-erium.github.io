# Circle Limit IV visual review

Visual source commit: `db0368d182a7a30dde93d3d7fd05162583232f2f`

The older blog used a traced Circle Limit IV mark in its header and a 16rem image beside the About biography. The unified theme had lost both layout rules, leaving the 600px About image as a large standalone block.

## Changes

- [Shared header](https://github.com/deut-erium/deut-erium.github.io/blob/db0368d182a7a30dde93d3d7fd05162583232f2f/_includes/site-header.html#L1-L9): restores a decorative Circle Limit IV brand mark beside the visible site name on every unified page.
- [Header styles](https://github.com/deut-erium/deut-erium.github.io/blob/db0368d182a7a30dde93d3d7fd05162583232f2f/assets/css/main.css#L204-L291): size the mark and keep the wide navigation compact.
- [Responsive header rules](https://github.com/deut-erium/deut-erium.github.io/blob/db0368d182a7a30dde93d3d7fd05162583232f2f/assets/css/main.css#L1563-L1594): switch to an intentional stacked header before controls wrap and retain the existing two-column mobile navigation.
- [About rendering](https://github.com/deut-erium/deut-erium.github.io/blob/db0368d182a7a30dde93d3d7fd05162583232f2f/_plugins/render_compatibility.rb#L99-L107): adds a scoped profile class and a specific alternative without changing the imported About Markdown.
- [About profile styles](https://github.com/deut-erium/deut-erium.github.io/blob/db0368d182a7a30dde93d3d7fd05162583232f2f/assets/css/main.css#L2024-L2101): bounds the image beside the biography on wide screens and centers it above the text on narrow screens.

The 10,340-byte header asset is a 160 by 160 WebP derived locally from the protected `Circle-limit-IV.jpg` source. Source SHA-256: `f2a8d1c2191bf98c1ae3432a95674d61b62541a3f010e68972095c26d6aef785`. Derived SHA-256: `ab1a9318aab05b2e660aa1f90d1292c7e16fb5ed8008346cdf1e9c447d6bc7d8`.

```sh
convert Circle-limit-IV.jpg -strip -resize '160x160^' \
  -gravity center -extent 160x160 -quality 82 \
  assets/images/circle-limit-iv-mark.webp
```

## Verification

- Source, static-app, history, site, code-frame, code-parity, and heading gates passed.
- All 138 HTML routes passed at 320 pixels with and without JavaScript. Fourteen representative routes passed at 1,440 pixels. The 290 checks found no overflow, missing landmark or H1, duplicate ID, unnamed visible link, heading jump, runtime exception, or automatic external request.
- Focused interaction, failure, print, reduced-motion, and text-spacing checks passed. The text-spacing set includes the About route.
- Eleven PDFs covering 77 pages passed generation. Both About pages were rasterized and inspected.
- `home-desktop.png`, `home-mobile.png`, `about-desktop.png`, `about-desktop-dark.png`, and `about-mobile.png` record the retained visual states. `SHA256SUMS` covers all seven screenshots, including the two About print pages.

The final release source `30253b8` adds only excluded browser-evidence tooling and the regression gate after the visual commit. Its generated tree has the same 517 paths; only feed and sitemap timestamps differ.
