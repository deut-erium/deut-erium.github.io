# Retired generated assets review

## Verdict

The current unified `_site` should not be treated as fully compatible with the generated asset history. Ten proven deployed PNG URLs contain content-specific reverse-engineering screenshots and deserve exact archival responses. They are five unique files published at two URL prefixes. The remaining 139 proven deployed misses are old presentation, browser metadata, source-map, favicon, CSS, or JavaScript files and can remain absent. Another 59 missing asset URLs occur only in local pre-unified build outputs; there is no local evidence that those versions were deployed, so they do not justify public compatibility files.

No source, ref, index, commit, or generated tree was changed. This review used local files and Git objects only.

## Scope and counts

An asset URL is a generated file under an `assets/` directory, plus a site-root `favicon.ico`. This keeps article HTML, feeds, sitemaps, post-relative challenge files, and pagination in the route review rather than mixing them into the asset result.

The parent workspace contains 53 top-level site-output roots after nested page directories are collapsed:

- 38 pre-unified outputs with the public base `/WriteUps`
- one root-site preview with the public base `/`
- ten current or unified gate outputs, checked as current-output duplicates
- four base-path test outputs, excluded because their own canonicals identify synthetic or root-remapping test bases

The historical public-base trees and manifests produce these counts:

| Set | Unique URLs | Asset URLs | Present now | Missing now |
| --- | ---: | ---: | ---: | ---: |
| Deployed-route manifest | 500 | 154 | 5 | 149 |
| 38 local `/WriteUps` output trees | 505 | 94 | 0 | 94 |
| Root-site preview | 24 | 8 | 8 | 0 |
| Combined, after URL deduplication | 697 | 217 | 9 | 208 |

The combined full-URL comparison has 482 retained URLs, 215 missing URLs, and 24 current-only URLs. Of the 215 misses, 208 are assets and seven are excluded non-assets. Provenance splits the 208 missing assets into 149 paths recorded by the deployed-route manifest and 59 paths seen only in local generated outputs.

The deployed manifest itself has 150 missing files: the 149 assets above and `/.gitignore`. The latter is a generated-tree leak, not a public asset contract.

The WriteUps compatibility manifest also passes independently: all 24 HTML aliases and all 76 attachment aliases in `derived-manifest.json` exist in the unified output under `/WriteUps`. The 311-row core and 411-row compatibility SHA-256 manifests each have the same 11 missing presentation assets; the 24-row root-site SHA-256 manifest has no missing path. The two `MANIFEST.sha256` files hash investigation inputs and are not URL inventories.

## Classification

Classification is exclusive. Content-specific files take precedence over their file type. The five root-domain reverse screenshots are classified as duplicates because their bytes exactly equal the five tutorial screenshots. Other files are classified by their browser or build role even when equivalent bytes are currently available at a different URL.

| Class | Missing | Proven deployed | Local-build only | Archival response |
| --- | ---: | ---: | ---: | --- |
| Authored payload | 5 | 5 | 0 | Yes, exact PNG bytes |
| Duplicate | 5 | 5 | 0 | Yes, exact PNG bytes at each old URL |
| Route contract | 8 | 8 | 0 | No |
| Generated theme-only artifact | 58 | 5 | 53 | No |
| Source map | 4 | 4 | 0 | No |
| Favicon | 116 | 115 | 1 | No |
| CSS/JS | 12 | 7 | 5 | No long-term archive |
| Total | 208 | 149 | 59 | 10 yes, 198 no |

### Affected: content payload was retired with the theme

The five files under `/ctf-tutorials/assets/images/reverse/` are screenshots rather than interchangeable shell assets. The same bytes were also published under `/assets/images/reverse/`. No current output path contains them. Local source history and the surviving tutorial source agree on all five byte counts and SHA-256 values.

No local article currently references these URLs, so the immediate site shell does not break. Direct links, bookmarks, and external embeds still return the custom HTML 404 instead of image bytes. Their content-specific names and 1,120,614 unique bytes make conservative archival retention appropriate even though they were unlinked in the available source.

The archival form should be static exact-byte copies at all ten old paths. An HTML compatibility page is not valid for an image request. A redirect would require host-level status control that is not present in this repository; copying from one reviewed source to both prefixes is deterministic and preserves `image/png`.

### Checked: route contracts should remain retired

The eight `browserconfig.xml` and `site.webmanifest` paths describe the old TeXt theme, stale colors, old icon bundles, or a malformed relative tile path. Restoring those files would revive obsolete install and tile metadata. They should remain absent rather than redirecting to an unrelated current resource.

An installed browser entry may continue to cache old manifest metadata after the URL starts returning 404. That is preferable to serving a new manifest under a section-scoped old URL without an explicit PWA migration plan.

### Checked: theme files, source maps, and favicons should remain retired

The theme-only set contains generic logos, local preview fonts, KaTeX support files, font licenses, avatar/logo variants, and the two-byte `/assets/temp` test file. The 53 local-only paths were generated by design experiments or rebuild stages and are not in the deployed-route manifest.

Fifteen of those 59 local-only paths have one observed byte version and that version is already served elsewhere in the current tree. This includes selected fonts, licenses, three KaTeX fonts, `favicon.svg`, and the KaTeX license. Byte duplication does not prove that the retired `/WriteUps/assets/...` URL was public.

Source maps are development artifacts. Old CSS that contains a `sourceMappingURL` comment causes only a developer-tools request when its map is absent. Publishing a historical map adds source disclosure without restoring reader functionality.

The 115 proven deployed favicon misses and one local-only SVG favicon miss do not affect document content. Redirecting PNG or ICO names to the current SVG can violate size and MIME expectations in pinned-tile and browser-icon consumers. Exact copies would be required for favicon compatibility, but their archival value does not justify retaining the old four-site bundles.

### Checked: CSS and JavaScript do not have a safe generic alias

Cached historical HTML can request an old section stylesheet or script after the asset cache entry expires. A 404 then leaves that cached page unstyled or without search behavior. Serving current unified CSS or JavaScript at the old path is worse: the old DOM and current script/style contract are not equivalent.

The local trees show that stable names were repeatedly reused. Across the 38 WriteUps outputs, `/WriteUps/assets/css/main.css` has 22 byte variants, its source map has nine, `article.js` has seven, `site.js` has four, and ten asset URLs have more than one observed version. These local variants are not proof of a deployment sequence, but they show why an arbitrary compatibility copy is unsafe.

A short transition window could serve the exact bytes from the last proven deployed commit if those bytes and host cache controls were available. Three of the four generated commits named by the deployed manifest are no longer present as Git objects in their local acquisition clones, and the manifest records paths rather than hashes. This review therefore does not recommend guessing historical CSS or JavaScript bytes. Long-term omission is appropriate.

## Cache and MIME requirements

The current shell references `/assets/css/main.css` and `/assets/js/*.js` without content hashes or version queries. The root stylesheet URL was also present in the old deployed root tree and now has different bytes. The repository has no `_headers` file or other cache policy. Effective CDN and browser cache headers cannot be established from the artifact, so the first unified deployment needs a cache purge or forced revalidation outside this repository. Otherwise a current page can receive stale root CSS even though the file exists.

Missing responses can also be negatively cached. If the ten PNG archives are accepted, they should be present in the first cutover artifact rather than added after clients have cached 404 responses.

For the ten retained payload URLs:

- return status 200 with the exact reviewed bytes and `Content-Type: image/png`;
- do not return the custom HTML 404 with status 200;
- do not place SVG or HTML bytes behind a `.png` path;
- frozen archival bytes may use a long public cache lifetime and an immutable validator because their hashes are fixed.

For intentionally omitted files, a real 404 or 410 is acceptable. It must not be a soft-404 status 200. If strict MIME sniffing is enabled, historical CSS, JavaScript, JSON manifests, XML browser metadata, WOFF2 fonts, SVG, PNG, WebP, and ICO files would respectively require `text/css`, a JavaScript MIME type, `application/manifest+json`, an XML MIME type, `font/woff2`, `image/svg+xml`, `image/png`, `image/webp`, and an icon MIME type. This is another reason not to place one HTML retirement document at all old asset paths.

## Reproduction

Run from the unified repository root. The script uses each generated root's canonical path to distinguish `/WriteUps` output from root and synthetic base-path tests.

```python
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlsplit
import json
import os
import re

agent = Path("../../..").resolve()
workspace = Path("../../../..").resolve()
current_root = Path("_site").resolve()
skip = {
    "node_modules", "vendor", "toolchain", "browser", ".git", ".bundle",
    ".jekyll-cache", ".sass-cache", "text-theme-upstream",
}

def is_asset(url):
    return "/assets/" in url or url.endswith("/favicon.ico") or url == "/favicon.ico"

current = {
    "/" + p.relative_to(current_root).as_posix()
    for p in current_root.rglob("*") if p.is_file()
}

candidates = []
for dirpath, dirnames, files in os.walk(agent):
    dirnames[:] = [name for name in dirnames if name not in skip]
    root = Path(dirpath)
    signals = sum((root / name).exists() for name in (
        "assets", "404.html", "feed.xml", "sitemap.xml", "robots.txt", "archive.html"
    ))
    if "index.html" in files and signals >= 3:
        candidates.append(root)

candidate_set = set(candidates)
roots = [
    root for root in candidates
    if not any(parent in candidate_set for parent in root.parents)
]
roots.append(workspace / "_site")

writeups = set()
writeups_roots = 0
for root in sorted(set(roots)):
    html = (root / "index.html").read_text(errors="ignore")
    match = re.search(r'<link rel="canonical" href="([^"]+)"', html)
    base = urlsplit(match.group(1)).path.rstrip("/") if match else "/WriteUps"
    if base != "/WriteUps":
        continue
    writeups_roots += 1
    for path in root.rglob("*"):
        if path.is_file():
            writeups.add("/WriteUps/" + path.relative_to(root).as_posix())

manifest = json.loads((agent / "merge-inventory/deployed-route-manifest.json").read_text())
deployed = {
    url
    for site in manifest["sites"].values()
    for url in site["all_file_paths"]
}

root_preview_dir = agent / "site-rebuild-audit/preview/root"
root_preview = {
    "/" + path.relative_to(root_preview_dir).as_posix()
    for path in root_preview_dir.rglob("*") if path.is_file()
}

historical = deployed | writeups | root_preview
assets = {url for url in historical if is_asset(url)}
missing = assets - current

classes = defaultdict(set)
for url in missing:
    name = Path(url).name.lower()
    if "/images/reverse/" in url:
        key = "authored payload" if url.startswith("/ctf-tutorials/") else "duplicate"
    elif name in {"browserconfig.xml", "site.webmanifest"}:
        key = "route contract"
    elif url.endswith(".map"):
        key = "source map"
    elif (
        url.endswith("/favicon.ico")
        or name.startswith(("android-", "apple-", "favicon-", "mstile-", "safari-pinned-tab"))
        or name == "favicon.svg"
    ):
        key = "favicon"
    elif url.endswith((".css", ".js")):
        key = "CSS/JS"
    else:
        key = "generated theme-only artifact"
    classes[key].add(url)

print("WriteUps roots:", writeups_roots)
print("current files:", len(current))
print("historical URLs:", len(historical))
print("retained historical URLs:", len(historical & current))
print("missing historical URLs:", len(historical - current))
print("asset URLs:", len(assets))
print("retained assets:", len(assets & current))
print("missing assets:", len(missing))
print("proven deployed missing assets:", len(missing & deployed))
print("local-only missing assets:", len(missing - deployed))
for key in sorted(classes):
    print(key, len(classes[key]))
```

Expected count output is 38 WriteUps roots, 506 current files, 697 historical URLs, 482 retained historical URLs, 215 missing historical URLs, 217 asset URLs, nine retained assets, 208 missing assets, 149 proven deployed missing assets, and 59 local-only missing assets.

## Appendix A: archival paths and hashes

Each row has two archival URLs with identical bytes.

| File | Bytes | SHA-256 | Paths |
| --- | ---: | --- | --- |
| `cek.png` | 293691 | `543d4ba8e7b1ace6170ef7aee9166707c8b5322def0b5a2d4e3fb54ef92c4330` | `/assets/images/reverse/cek.png`; `/ctf-tutorials/assets/images/reverse/cek.png` |
| `final.png` | 57468 | `560ef26e2c14d249726c9bf26e1eea685e96d0d7b72c556c09d0274792568e0c` | `/assets/images/reverse/final.png`; `/ctf-tutorials/assets/images/reverse/final.png` |
| `ida.png` | 328215 | `6211f8792e48ec70c090c81a04ce07afd8c18997e1cd95b21a0f9b9b56f37a39` | `/assets/images/reverse/ida.png`; `/ctf-tutorials/assets/images/reverse/ida.png` |
| `valid.png` | 433738 | `4ba98aaa1391968ab28dd3f41f12fe281e41b10c0e2d784485c49aa45761fb18` | `/assets/images/reverse/valid.png`; `/ctf-tutorials/assets/images/reverse/valid.png` |
| `x86-registers.png` | 7502 | `a7c2f4f572f6f115df5a1996c1244d92238abed8494d8ce493cf2bbbe299d45c` | `/assets/images/reverse/x86-registers.png`; `/ctf-tutorials/assets/images/reverse/x86-registers.png` |

## Appendix B: intentionally omitted paths

### Route contract (8)

- `/WriteUps/assets/browserconfig.xml`
- `/WriteUps/assets/site.webmanifest`
- `/assets/browserconfig.xml`
- `/assets/site.webmanifest`
- `/ctf-tutorials/assets/browserconfig.xml`
- `/ctf-tutorials/assets/site.webmanifest`
- `/ramblings/assets/browserconfig.xml`
- `/ramblings/assets/site.webmanifest`

### Generated theme-only artifact (58)

- `/WriteUps/assets/fonts/README.md`
- `/WriteUps/assets/fonts/atkinson-hyperlegible-400.woff2`
- `/WriteUps/assets/fonts/atkinson-hyperlegible-700.woff2`
- `/WriteUps/assets/fonts/atkinsonhyperlegible-OFL.txt`
- `/WriteUps/assets/fonts/bungee-shade-400.woff2`
- `/WriteUps/assets/fonts/chango-400.woff2`
- `/WriteUps/assets/fonts/climate-crisis-400.woff2`
- `/WriteUps/assets/fonts/doto-700-900.woff2`
- `/WriteUps/assets/fonts/fascinate-inline-400.woff2`
- `/WriteUps/assets/fonts/licenses/atkinsonhyperlegible-OFL.txt`
- `/WriteUps/assets/fonts/licenses/bungeeshade-OFL.txt`
- `/WriteUps/assets/fonts/licenses/chango-OFL.txt`
- `/WriteUps/assets/fonts/licenses/climatecrisis-OFL.txt`
- `/WriteUps/assets/fonts/licenses/doto-OFL.txt`
- `/WriteUps/assets/fonts/licenses/fascinateinline-OFL.txt`
- `/WriteUps/assets/fonts/licenses/monoton-OFL.txt`
- `/WriteUps/assets/fonts/licenses/pixelifysans-OFL.txt`
- `/WriteUps/assets/fonts/licenses/rubikglitch-OFL.txt`
- `/WriteUps/assets/fonts/licenses/silkscreen-OFL.txt`
- `/WriteUps/assets/fonts/licenses/unbounded-OFL.txt`
- `/WriteUps/assets/fonts/monoton-400.woff2`
- `/WriteUps/assets/fonts/pixelify-sans.woff2`
- `/WriteUps/assets/fonts/rubik-glitch-400.woff2`
- `/WriteUps/assets/fonts/silkscreen-400.woff2`
- `/WriteUps/assets/fonts/silkscreen-700.woff2`
- `/WriteUps/assets/fonts/silkscreen-OFL.txt`
- `/WriteUps/assets/fonts/unbounded-600-900.woff2`
- `/WriteUps/assets/images/avatar.jpg`
- `/WriteUps/assets/images/avatar.webp`
- `/WriteUps/assets/images/logo.png`
- `/WriteUps/assets/images/logo.webp`
- `/WriteUps/assets/images/logo/logo.svg`
- `/WriteUps/assets/katex/LICENSE`
- `/WriteUps/assets/katex/README.txt`
- `/WriteUps/assets/katex/fonts/KaTeX_AMS-Regular.woff2`
- `/WriteUps/assets/katex/fonts/KaTeX_Caligraphic-Bold.woff2`
- `/WriteUps/assets/katex/fonts/KaTeX_Caligraphic-Regular.woff2`
- `/WriteUps/assets/katex/fonts/KaTeX_Fraktur-Bold.woff2`
- `/WriteUps/assets/katex/fonts/KaTeX_Fraktur-Regular.woff2`
- `/WriteUps/assets/katex/fonts/KaTeX_Main-Bold.woff2`
- `/WriteUps/assets/katex/fonts/KaTeX_Main-BoldItalic.woff2`
- `/WriteUps/assets/katex/fonts/KaTeX_Main-Italic.woff2`
- `/WriteUps/assets/katex/fonts/KaTeX_Main-Regular.woff2`
- `/WriteUps/assets/katex/fonts/KaTeX_Math-BoldItalic.woff2`
- `/WriteUps/assets/katex/fonts/KaTeX_Math-Italic.woff2`
- `/WriteUps/assets/katex/fonts/KaTeX_SansSerif-Bold.woff2`
- `/WriteUps/assets/katex/fonts/KaTeX_SansSerif-Italic.woff2`
- `/WriteUps/assets/katex/fonts/KaTeX_SansSerif-Regular.woff2`
- `/WriteUps/assets/katex/fonts/KaTeX_Script-Regular.woff2`
- `/WriteUps/assets/katex/fonts/KaTeX_Size1-Regular.woff2`
- `/WriteUps/assets/katex/fonts/KaTeX_Size2-Regular.woff2`
- `/WriteUps/assets/katex/fonts/KaTeX_Size3-Regular.woff2`
- `/WriteUps/assets/katex/fonts/KaTeX_Size4-Regular.woff2`
- `/WriteUps/assets/katex/fonts/KaTeX_Typewriter-Regular.woff2`
- `/assets/images/logo/logo.svg`
- `/assets/temp`
- `/ctf-tutorials/assets/images/logo/logo.svg`
- `/ramblings/assets/images/logo/logo.svg`

### Source map (4)

- `/WriteUps/assets/css/main.css.map`
- `/assets/css/main.css.map`
- `/ctf-tutorials/assets/css/main.css.map`
- `/ramblings/assets/css/main.css.map`

### Favicon (116)

- `/WriteUps/assets/android-chrome-144x144.png`
- `/WriteUps/assets/android-chrome-192x192.png`
- `/WriteUps/assets/android-chrome-512x512.png`
- `/WriteUps/assets/android-icon-36x36.png`
- `/WriteUps/assets/android-icon-48x48.png`
- `/WriteUps/assets/android-icon-72x72.png`
- `/WriteUps/assets/android-icon-96x96.png`
- `/WriteUps/assets/apple-icon-114x114.png`
- `/WriteUps/assets/apple-icon-120x120.png`
- `/WriteUps/assets/apple-icon-144x144.png`
- `/WriteUps/assets/apple-icon-152x152.png`
- `/WriteUps/assets/apple-icon-57x57.png`
- `/WriteUps/assets/apple-icon-60x60.png`
- `/WriteUps/assets/apple-icon-72x72.png`
- `/WriteUps/assets/apple-icon-76x76.png`
- `/WriteUps/assets/apple-icon-precomposed.png`
- `/WriteUps/assets/apple-icon.png`
- `/WriteUps/assets/apple-touch-icon.png`
- `/WriteUps/assets/favicon-16x16.png`
- `/WriteUps/assets/favicon-32x32.png`
- `/WriteUps/assets/favicon-96x96.png`
- `/WriteUps/assets/favicon.ico`
- `/WriteUps/assets/favicon.svg`
- `/WriteUps/assets/mstile-144x144.png`
- `/WriteUps/assets/mstile-150x150.png`
- `/WriteUps/assets/mstile-310x150.png`
- `/WriteUps/assets/mstile-310x310.png`
- `/WriteUps/assets/mstile-70x70.png`
- `/WriteUps/assets/safari-pinned-tab.svg`
- `/WriteUps/favicon.ico`
- `/assets/android-chrome-144x144.png`
- `/assets/android-chrome-192x192.png`
- `/assets/android-chrome-512x512.png`
- `/assets/android-icon-36x36.png`
- `/assets/android-icon-48x48.png`
- `/assets/android-icon-72x72.png`
- `/assets/android-icon-96x96.png`
- `/assets/apple-icon-114x114.png`
- `/assets/apple-icon-120x120.png`
- `/assets/apple-icon-144x144.png`
- `/assets/apple-icon-152x152.png`
- `/assets/apple-icon-57x57.png`
- `/assets/apple-icon-60x60.png`
- `/assets/apple-icon-72x72.png`
- `/assets/apple-icon-76x76.png`
- `/assets/apple-icon-precomposed.png`
- `/assets/apple-icon.png`
- `/assets/apple-touch-icon.png`
- `/assets/favicon-16x16.png`
- `/assets/favicon-32x32.png`
- `/assets/favicon-96x96.png`
- `/assets/favicon.ico`
- `/assets/mstile-144x144.png`
- `/assets/mstile-150x150.png`
- `/assets/mstile-310x150.png`
- `/assets/mstile-310x310.png`
- `/assets/mstile-70x70.png`
- `/assets/safari-pinned-tab.svg`
- `/ctf-tutorials/assets/android-chrome-144x144.png`
- `/ctf-tutorials/assets/android-chrome-192x192.png`
- `/ctf-tutorials/assets/android-chrome-512x512.png`
- `/ctf-tutorials/assets/android-icon-36x36.png`
- `/ctf-tutorials/assets/android-icon-48x48.png`
- `/ctf-tutorials/assets/android-icon-72x72.png`
- `/ctf-tutorials/assets/android-icon-96x96.png`
- `/ctf-tutorials/assets/apple-icon-114x114.png`
- `/ctf-tutorials/assets/apple-icon-120x120.png`
- `/ctf-tutorials/assets/apple-icon-144x144.png`
- `/ctf-tutorials/assets/apple-icon-152x152.png`
- `/ctf-tutorials/assets/apple-icon-57x57.png`
- `/ctf-tutorials/assets/apple-icon-60x60.png`
- `/ctf-tutorials/assets/apple-icon-72x72.png`
- `/ctf-tutorials/assets/apple-icon-76x76.png`
- `/ctf-tutorials/assets/apple-icon-precomposed.png`
- `/ctf-tutorials/assets/apple-icon.png`
- `/ctf-tutorials/assets/apple-touch-icon.png`
- `/ctf-tutorials/assets/favicon-16x16.png`
- `/ctf-tutorials/assets/favicon-32x32.png`
- `/ctf-tutorials/assets/favicon-96x96.png`
- `/ctf-tutorials/assets/favicon.ico`
- `/ctf-tutorials/assets/mstile-144x144.png`
- `/ctf-tutorials/assets/mstile-150x150.png`
- `/ctf-tutorials/assets/mstile-310x150.png`
- `/ctf-tutorials/assets/mstile-310x310.png`
- `/ctf-tutorials/assets/mstile-70x70.png`
- `/ctf-tutorials/assets/safari-pinned-tab.svg`
- `/ctf-tutorials/favicon.ico`
- `/ramblings/assets/android-chrome-144x144.png`
- `/ramblings/assets/android-chrome-192x192.png`
- `/ramblings/assets/android-chrome-512x512.png`
- `/ramblings/assets/android-icon-36x36.png`
- `/ramblings/assets/android-icon-48x48.png`
- `/ramblings/assets/android-icon-72x72.png`
- `/ramblings/assets/android-icon-96x96.png`
- `/ramblings/assets/apple-icon-114x114.png`
- `/ramblings/assets/apple-icon-120x120.png`
- `/ramblings/assets/apple-icon-144x144.png`
- `/ramblings/assets/apple-icon-152x152.png`
- `/ramblings/assets/apple-icon-57x57.png`
- `/ramblings/assets/apple-icon-60x60.png`
- `/ramblings/assets/apple-icon-72x72.png`
- `/ramblings/assets/apple-icon-76x76.png`
- `/ramblings/assets/apple-icon-precomposed.png`
- `/ramblings/assets/apple-icon.png`
- `/ramblings/assets/apple-touch-icon.png`
- `/ramblings/assets/favicon-16x16.png`
- `/ramblings/assets/favicon-32x32.png`
- `/ramblings/assets/favicon-96x96.png`
- `/ramblings/assets/favicon.ico`
- `/ramblings/assets/mstile-144x144.png`
- `/ramblings/assets/mstile-150x150.png`
- `/ramblings/assets/mstile-310x150.png`
- `/ramblings/assets/mstile-310x310.png`
- `/ramblings/assets/mstile-70x70.png`
- `/ramblings/assets/safari-pinned-tab.svg`
- `/ramblings/favicon.ico`

### CSS/JS (12)

- `/WriteUps/assets/css/main.css`
- `/WriteUps/assets/js/archive.js`
- `/WriteUps/assets/js/article.js`
- `/WriteUps/assets/js/site.js`
- `/WriteUps/assets/js/theme.js`
- `/WriteUps/assets/katex/katex.min.css`
- `/WriteUps/assets/search.js`
- `/assets/search.js`
- `/ctf-tutorials/assets/css/main.css`
- `/ctf-tutorials/assets/search.js`
- `/ramblings/assets/css/main.css`
- `/ramblings/assets/search.js`

## Appendix C: excluded non-assets

These seven missing generated files are outside the asset definition and should remain omitted:

- `/.gitignore`: generated-tree source leak
- `/WriteUps/README.md`: repository documentation copied by local builds, absent from the deployed manifest
- `/WriteUps/i`: two-byte test file copied by local builds, absent from the deployed manifest
- `/WriteUps/2022/cyber_apocalypse/crypto/memory_acceleration/__pycache__/pofwork.cpython-310.pyc`: ignored Python bytecode contamination
- `/WriteUps/2022/google_ctf/crypto/maybe_someday/__pycache__/chall.cpython-310.pyc`: ignored Python bytecode contamination
- `/WriteUps/2023/nullcon_hackim/crypto/curvy_decryptor/__pycache__/ec.cpython-311.pyc`: ignored Python bytecode contamination
- `/WriteUps/2023/nullcon_hackim/crypto/curvy_decryptor/__pycache__/utils.cpython-311.pyc`: ignored Python bytecode contamination

## Appendix D: historical generated trees and manifests

The 38 `/WriteUps` trees included in the URL union are:

- `_site`
- `agent_out/article-layout-revert/final`
- `agent_out/article-reading-frame/final`
- `agent_out/article-reading-frame/preview`
- `agent_out/article-reading-frame/review`
- `agent_out/article-width-fix/final`
- `agent_out/article-width-fix/preview`
- `agent_out/hn-upgrade/build-1`
- `agent_out/hn-upgrade/build-2`
- `agent_out/hn-upgrade/build-3`
- `agent_out/hn-upgrade/build-4`
- `agent_out/hn-upgrade/final`
- `agent_out/hn-upgrade/serve`
- `agent_out/home-refresh/final`
- `agent_out/home-refresh/preview`
- `agent_out/home-refresh-cleanup/final`
- `agent_out/home-refresh-cleanup/preview`
- `agent_out/home-width-fix/final`
- `agent_out/home-width-fix/preview`
- `agent_out/redesign/build-markup`
- `agent_out/redesign/final`
- `agent_out/redesign/preview`
- `agent_out/redesign-pop/final`
- `agent_out/redesign-pop/preview`
- `agent_out/serve-site`
- `agent_out/site-build`
- `agent_out/site-rebuild-audit/.code-frame-final-review-tmp/baseline-site`
- `agent_out/site-rebuild-audit/.code-frame-final-review-tmp/integrated-site`
- `agent_out/site-rebuild-audit/adversarial/baseline-build`
- `agent_out/site-rebuild-audit/adversarial/production-build`
- `agent_out/site-rebuild-audit/candidate-build`
- `agent_out/site-rebuild-audit/code-frame-build`
- `agent_out/site-rebuild-audit/code-frame-matrix/production-a`
- `agent_out/site-rebuild-audit/code-frame-matrix/production-b`
- `agent_out/site-rebuild-audit/current-build`
- `agent_out/site-rebuild-audit/math-build`
- `agent_out/site-rebuild-audit/preview/writeups`
- `agent_out/site-rebuild-audit/rpn31-build`

The root-site tree is `agent_out/site-rebuild-audit/preview/root`. The path manifests checked are:

- `agent_out/merge-inventory/deployed-route-manifest.json`
- `agent_out/site-rebuild-audit/legacy/derived-manifest.json`
- `agent_out/site-rebuild-audit/final-site.sha256`
- `agent_out/site-rebuild-audit/legacy/site.sha256`
- `agent_out/site-rebuild-audit/root-site/site.sha256`

Mirrored copies under `.code-frame-reverify-tmp` have the same row counts and path sets, so they do not add URLs. The excluded test trees are `adversarial/root-build`, `adversarial/sentinel-build`, `code-frame-matrix/root`, and `code-frame-matrix/sentinel`; their canonicals use `/`, `/__adversarial_gate__/`, or `/__gate__/` to test base-path behavior, not to assert historical public URLs.
