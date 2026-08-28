# Route and file compatibility review

Reviewed commit: `0a8cd613ef338cb2487d189b60d14745453cd877` on local branch `unified-publishing`.

This was a read-only review of source and the supplied `_site` tree. Nothing was pushed or deployed. The only repository file created by this review is this report.

## Verdict

**Fail for an unconditional cutover.** The supplied tree contains every route and file named by the three manifests, and the post, pagination, feed, sitemap, case, and collision checks below otherwise pass. The release is not yet proved safe because all 24 historical WriteUps aliases send browsers to extensionless paths that do not exist as files in `_site`. `script/verify-site.py` silently treats the corresponding `.html` files as matches. A plain static server returns 404 for an alias target and 200 for the same target with `.html`.

A GitHub Pages deployment may provide the missing extensionless lookup. That remains a deployment-only assumption because nothing was deployed and the repository has no deployment workflow. Even if the lookup works, each alias declares an extensionless canonical while the destination article declares the `.html` canonical. Those two declarations should agree.

There is also a confirmed sitemap defect: the root sitemap lists four pages that emit `noindex`, including all three section 404 pages.

## Commands and direct results

| Command or independent check | Result |
|---|---|
| `git rev-parse HEAD && git branch --show-current && git status --short --branch` | `0a8cd613...`, `unified-publishing`, clean before this report. |
| `python3 script/verify-site.py _site` | Reported pass: 138 HTML files, 101 historical paths, 230 postfiles. This result was treated as a claim to test, not as evidence by itself. |
| `python3 script/verify-imported-content.py` | Reported 319 files. Independent hashing reproduced 319 present and hash-correct rows, with exactly 308 `_posts` files and no extra or missing `_posts` files. |
| `python3 script/verify-code-parity.py` | Reported pass: 61 pages and 311 code blocks. |
| `python3 script/verify-static-app.py _site` | Reported pass: 29 files. |
| Independent manifest-to-output Python checks using `pathlib`, `hashlib`, `HTMLParser`, and `ElementTree` | 78 dated posts present at derived routes with matching self-canonicals; 230 current WriteUps postfiles hash-correct; 76 legacy attachments hash-correct; 24 aliases present; all 101 historical HTML paths present exactly. |
| Independent case-fold and route-normalization scan of all 505 output files | Zero case-folded file collisions, zero NFC/case-fold collisions, and zero normalized HTML route collisions. |
| Independent section pagination scan | WriteUps pages contain `8,8,8,8,8,8,8,5` posts; union is 61 unique URLs and equals the WriteUps sitemap order. Root pages contain nine groups of 8 and one group of 6; union is 78 unique URLs. |
| Independent endpoint and XML scan | All 12 section endpoints (`404.html`, `feed.xml`, `sitemap.xml`, `robots.txt` for three sections) exist with exact case. Feed counts are 20/5/4, feed IDs equal entry links, and each feed is the newest prefix of its section sitemap. Section sitemap counts are 62/6/5 including each section home. |
| Local `python3 -m http.server` plus `curl` | All 24 percent-encoded historical alias files returned 200. An extensionless alias target returned 404; its `.html` form returned 200. `/page2` and `/WriteUps/page2` returned 301 to their slash forms, which returned 200. All 12 section endpoints returned 200. |
| `bundle exec jekyll build --destination /tmp/unified-route-build --cache-dir /tmp/unified-route-cache --disable-disk-cache` | Could not run: `bundle: command not found`; Ruby is also absent. The supplied `_site` was therefore not accepted as independently rebuilt output. |
| `git cat-file -t` for the commits recorded in `historical-html-paths.json` | All four historical source commits are absent from this shallow clone. Completeness of the 101-entry historical manifest could not be checked against its source trees. |

The independent checks were run from the repository root. Temporary command output and the failed build destination were outside the repository.

## Confirmed defect: aliases use a target spelling absent from the artifact

Root cause: `_data/legacy_paths.json` stores extensionless alias targets, for example at `_data/legacy_paths.json:7-9`. `_plugins/legacy_paths.rb:100-110` deliberately strips `.html` from document URLs and rejects targets that include it. `_plugins/legacy_paths.rb:48-63` then uses that extensionless value for both `redirect_to` and `canonical_url`. In contrast, `_plugins/section_metadata.rb:23-25` publishes every current WriteUps post to a `.html` route.

Affected:

- All 24 rows in `_data/legacy_paths.json#aliases` produce an old `.html` page whose refresh and two continuation links point to an extensionless URL.
- None of those 24 extensionless targets exists as a file or directory in `_site`; each corresponding `target + ".html"` exists.
- All 24 current destination articles declare `.html` canonicals. All 24 aliases declare the extensionless form. Normalizing `.html` exposed 24 logical canonical pairs with conflicting literal canonicals.
- Example old file: `_site/WriteUps/2020/HSCTF/crypto/Affina and the Quadratics/2020-06-06-HSCTF-2020-Affina-and-the-quadratics.html`. It refreshes to `/WriteUps/2020/HSCTF/crypto/Affina_and_the_Quadratics/2020-06-06-HSCTF-2020-Affina-and-the-quadratics`; only the same path plus `.html` exists.

Fragile:

- The extensionless links work only if the production host maps `/name` to `/name.html`. That behavior is not represented in the artifact and was not tested on GitHub Pages.
- The unusual historical path containing `B007L36 CRYP70/. 4641N/` worked on the local static server, including percent encoding. A dot-leading path segment should still be tested on the actual host.

Checked:

- All 24 historical alias files themselves exist at exact, case-sensitive paths and contain `noindex`.
- All 24 alias targets map unambiguously to one current `.html` article; there are no target collisions.
- The other 77 historical HTML paths are concrete files and do not depend on the `.html` fallback.

Impact:

- On a host without implicit `.html` lookup, every transformed historical WriteUps route loads its retained page and then sends the reader to a 404.
- On a host with the lookup, redirects probably remain usable, but canonical signals disagree between alias and article.

Fix:

- Keep extensionless manifest values as document identifiers if needed, but emit `target_document.url` for the refresh, continuation links, and alias canonical. In this build that value includes `.html`.
- Add a verification rule requiring every alias target to resolve as an exact artifact route and requiring the alias canonical to equal the destination article canonical.

## Confirmed defect: noindex pages are listed in the root sitemap

Root cause: the section 404 hook sets `noindex` but not `sitemap: false` at `_plugins/section_metadata.rb:70-76`. `assets/index.html:1-7` has the same metadata combination. `noindex` creates a robots meta tag through `_includes/head.html:11-13`, but it does not exclude a page from `jekyll-sitemap`.

Affected:

- `_site/sitemap.xml` lists `https://deut-erium.github.io/WriteUps/404.html`.
- It also lists `https://deut-erium.github.io/ramblings/404.html`, `https://deut-erium.github.io/ctf-tutorials/404.html`, and `https://deut-erium.github.io/assets/`.
- All four pages emit `noindex`. This asks crawlers to discover URLs that the pages then tell them not to index.

Fragile:

- The three section 404 pages have no `page.section` because the exact 404 branch at `_plugins/section_metadata.rb:70-76` does not set it. They therefore advertise `/feed.xml` through the fallback at `_includes/head.html:15-21`, rather than their section feeds. This does not break the 404 routes, but it is inconsistent section metadata.

Checked:

- The root `404.html` is `noindex` and is not in the root sitemap.
- The 24 legacy aliases set `sitemap: false` at `_plugins/legacy_paths.rb:59-62` and are not in the sitemap.
- The three section sitemaps contain only the section home and section posts; none contains a 404 route.

Impact:

- This is an indexing and metadata defect, not a missing-file defect. It weakens the claim that generated canonical and sitemap data are internally consistent.

Fix:

- Set `sitemap: false` on every `noindex` compatibility or error page.
- Set the appropriate `section` on each section 404 page if section feed discovery is intended there.

## Confirmed verification gaps in `script/verify-site.py`

Affected:

- `resolves()` adds `candidate.html` for every extensionless reference at `script/verify-site.py:70-80`. This is why the 48 alias continuation links pass despite having no exact target in the artifact.
- Historical coverage at `script/verify-site.py:86-88` checks existence only. It does not verify that an old path contains the intended article or redirect.
- Alias coverage at `script/verify-site.py:179-182` checks only file existence and whether the text contains `noindex`. It does not inspect refresh targets, continuation links, canonical agreement, or a real robots meta tag.
- XML coverage at `script/verify-site.py:147-153` checks well-formedness and feed entry counts. It does not check sitemap membership, feed URLs, entry identity, URL case, or whether XML URLs resolve.
- The required tuple at `script/verify-site.py:90-96` omits every robots endpoint. No later code checks robots files or their sitemap declarations.
- Absolute HTTP(S) links are excluded from local resolution at `script/verify-site.py:62-67`. This skips same-origin links such as `/pyfractal/` written as `https://deut-erium.github.io/pyfractal/`, which is absent from this artifact.

Checked:

- The current artifact happens to contain all root and section robots files, and each section robots file points to its existing section sitemap.
- Independent XML membership and exact-path checks passed apart from the noindex entries in the root sitemap.
- The `/pyfractal/` link may be supplied by a separate GitHub project site. It is not classified as broken without deployment evidence.

Impact:

- The current pass report overstates what the script proves. Mutations to alias targets, robots files, sitemap membership, and same-origin absolute links can pass the present checks.

Fix:

- Separate exact artifact resolution from explicitly configured host rewrites. Fail exact checks by default and test rewrites in an integration test against the intended server.
- Parse redirect metadata and canonical URLs, require destination agreement, validate feed and sitemap memberships, and check robots contents.
- Treat absolute URLs on `site.url` as local routes.

## Compatibility checks that passed independently

Checked:

- `script/imported-content-manifest.json`: all 319 rows exist in source and match byte count and SHA-256. Its 308 `_posts` rows equal the actual `_posts` file set. The row counts are 12 root, 293 WriteUps, 7 tutorials, and 7 ramblings. These differ from `sources.*.files` for WriteUps, tutorials, and ramblings (291, 4, and 5); the verifier prints row totals but does not validate or explain the header counts, so the rows were treated as the file inventory.
- Dated content: all 78 post source files map to the expected output path. Every output exists and has exactly one canonical equal to its concrete public route: 61 WriteUps, 8 root, 5 ramblings, and 4 tutorials.
- Postfiles: all 230 non-dated WriteUps files are present beside current articles with manifest byte counts and hashes. The tutorial assignment file at `_site/ctf-tutorials/assigments/what are assignments/task2.txt` is also present and hash-correct.
- `_data/legacy_paths.json`: all 76 attachment aliases are present with exact byte counts and hashes. Its 24 HTML alias paths are unique and present.
- `script/historical-html-paths.json`: all 101 listed files are present at exact case. There are no case-only substitutes.
- Pagination: WriteUps has exactly eight pages and no duplicate or omitted post. Page 8 contains five posts. The root pagination covers all 78 posts once. Directory routes redirect to trailing-slash routes under the local server.
- Feeds and section sitemaps: entries are ordered newest first, feed IDs equal links, all local entry and sitemap URLs resolve exactly, and section membership is correct.
- Canonicals: all 135 Jekyll shell pages use the configured HTTPS origin and each canonical matches `og:url`. Apart from the 24 alias spelling conflicts, canonical paths resolve to concrete `.html` files or directory indexes.
- Route and path case: all 505 output files have unique exact and case-folded paths. HTML route normalization found no `.html` versus `index.html` collision. Local HTML links did not contain a case-only match.
- Section endpoints: all 12 requested section files exist at exact lowercase or `WriteUps` case. All four 404 pages are `noindex` and self-canonical. Section robots files contain `User-agent: *`, `Allow: /`, and the correct absolute sitemap URL.

## Deployment-only assumptions and limits

Needs confirmation:

- GitHub Pages must serve extensionless requests from `.html` files for the 24 alias redirects as currently generated.
- The deployment process must run the custom plugins in `_plugins`. The checked workflow only builds and verifies (`.github/workflows/site-check.yml:44-68`); it does not deploy. `_site` is not tracked. A source-only deployment that omits those plugins would lose legacy aliases and attachment copies, change post routes, and collapse the four source 404 permalinks onto `/404.html`.
- The dot-leading historical path segment `. 4641N` must be accepted by the production CDN. It worked locally.
- The same-origin `/pyfractal/` link must continue to be supplied outside this artifact if that project route is still expected.
- The 101-path historical list may be incomplete. The four source commits recorded at `script/historical-html-paths.json:3-8`, and the WriteUps baseline in `_data/legacy_paths.json:3`, are not available in this clone. No network retrieval was allowed.
- A fresh build could not be reproduced in this environment because Ruby and Bundler are absent. The source-to-route formulas and the supplied output were checked independently, but byte-for-byte source/build agreement remains unconfirmed here.
