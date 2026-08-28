# Security and privacy review

Reviewed candidate: `unified-publishing` at `0a8cd613ef338cb2487d189b60d14745453cd877`.

This was a read-only review of the tracked source, every Git object reachable from the local refs, and the supplied `_site` artifact. No network request, deployment, push, index change, source edit, or commit was made. Credential values are not reproduced below.

## Verdict

The current tree and supplied output contain no live OAuth credential, recognized cloud or repository token, analytics identifier, comment runtime, tracker, automatic third-party resource, dangerous URL scheme, inline event handler, insecure `target="_blank"`, or source map. The exact OAuth client ID and secret from the old Ramblings configuration do not occur in any Git blob reachable in this local repository. The old Ramblings commit and configuration blob are not present objects.

Two release claims need qualification. First, the repository's reachable root history still contains an enabled Google Analytics configuration, three analytics identifiers, and tracker-loading code. The current output is clean, but the history is not free of analytics material. Second, four answers for challenges that the current site still presents as interactive exercises are stored as plaintext in the tracked public source. There is also an unlinked resume PDF that the generated sitemap advertises to crawlers.

The local clone is shallow at `b6d7e299`. Its missing parent and earlier root history could not be scanned. The history conclusion therefore covers every object actually present in this repository, not the complete remote ancestry.

## Review scope and evidence

- The HEAD tree has 461 tracked files. The supplied artifact has 505 files, including 138 HTML pages.
- The local refs reach 14 commits and 995 objects: 14 commits, 236 trees, and 745 blobs. `git fsck --full --no-reflogs --unreachable --dangling` reported no unreachable or dangling object, so the scan covered the entire present object store.
- The known Ramblings OAuth values were read in memory from local commit `fd78c8215cb774ab17b4daec4cd342fb858e4e0a` in `../ramblings` and compared byte-for-byte against all 745 blobs reachable here. Neither value matched. The old Ramblings `_config.yml` blob object is also absent.
- Common token formats were checked across the current tree and reachable blobs, including GitHub, AWS, Google API, Slack, Stripe, PEM/OpenSSH, analytics, and concrete `clientSecret` assignments. No live candidate survived context review.
- All 138 generated HTML files and all generated CSS were parsed independently. The result was zero automatic external resources, zero inline event attributes, zero `target="_blank"` links, zero `srcdoc` attributes, and zero non-HTTP dangerous URL schemes. The pages contain 732 explicit outbound anchors to 152 hosts; those links make no request until selected.
- Current and reachable-history path/content scans found no `.map` path, `sourceMappingURL`, `webpack://`, generated directory listing, symlink, or archive member with an absolute or `..` path.
- `python3 script/verify-imported-content.py`, `python3 script/verify-static-app.py _site`, and `python3 script/verify-site.py _site` passed. JavaScript syntax checks passed for the four shared scripts and the catalog script. This validates the supplied artifact; it was not a fresh Jekyll build.

## Affected cluster: analytics survives in reachable root history

Severity: medium for the history/privacy claim; no current runtime tracking

Root cause: the unified branch is a linear descendant of the shallow root commit. It deleted the old analytics runtime at `1a7e16d`, but deletion does not remove the blobs from ancestry.

Affected:

- `b6d7e299:_config.yml:169-179` enables the Google analytics provider, disables IP anonymization, and contains three concrete analytics identifiers. No identifier is printed in this report.
- `b6d7e299:_layouts/base.html:8` includes the analytics dispatcher on every old theme page. `b6d7e299:_includes/analytics.html:1-6` selects the Google provider in production.
- `b6d7e299:_includes/analytics-providers/google.html:1-37` loads Google Tag Manager and configures the old analytics runtimes.
- `b6d7e299:assets/index.html:5-11` independently loads and initializes an automatic Google analytics resource. This standalone page did not depend on the Jekyll dispatcher.
- `b6d7e299:_config.yml:159-166` also enables Google custom search with a concrete engine ID, and `b6d7e299:_includes/search-providers/google-custom-search-engine/search.js:28-31` constructs its automatic external script URL.
- The statement at `agent_out/unified-merge/REPORT.md:120` is accurate for the HEAD tree and current output, but not if "unified repository" includes reachable history: analytics identifiers remain in present Git objects.

Checked:

- Current `_config.yml:1-65` has no analytics, search-provider, comment-provider, or sharing-provider configuration.
- Current `_includes/head.html:15-25` emits only local feed, favicon, JavaScript, CSS, and optional local KaTeX resources.
- The current source and supplied `_site` have no analytics identifier or tracker runtime. Independent scanning covered HTML, CSS, and JavaScript rather than only the six names in the release gate.
- The historical root Gitalk, Disqus, Valine, AddThis, AddToAny, and LeanCloud templates are dormant historical theme code. At `b6d7e299:_config.yml:110-155`, sharing, comments, and page views are disabled and their credential fields are empty. They are not evidence of another live credential.

Impact:

- Checking out or inspecting history reveals old tracking configuration and identifiers. This does not make the current pages contact those services.
- A statement that the current artifact has no tracking is supported. A statement that the local Git history is sanitized of analytics is not.

Fix:

- State the narrower artifact/HEAD claim, or rewrite the root history too if removal from Git objects is a release requirement. Identifier removal is a privacy and provenance cleanup, not secret rotation.

## Checked cluster: the Ramblings OAuth credential was not imported

The specific credential claim in `agent_out/unified-merge/REPORT.md:110-130` is supported within the available object boundary.

Checked:

- `script/imported-content-manifest.json` names the old Ramblings source commit, but `fd78c8215cb774ab17b4daec4cd342fb858e4e0a` is not an object in this repository.
- The exact old OAuth client ID and secret have zero byte matches across all 745 reachable blobs. The old configuration blob itself is absent.
- The unified ancestry at `5cd34da8349031e7f3d70339440e1f830286a074` imports files as one ordinary commit whose sole parent is the root branch. It does not merge or parent any WriteUps, tutorial, Ramblings, or `new-tetris` source commit.
- The four imported Ramblings posts retain `comments.provider: "gitalk"` metadata at `_posts/ramblings/2022-02-01-welcome.md:14-16`, `_posts/ramblings/2022-02-02-randoblurry0001.md:14-16`, `_posts/ramblings/2022-02-03-randoblurry-test.md:14-16`, and `_posts/ramblings/22-02-04-randoblurry-update.md:14-16`. No current layout reads that field, and no generated Ramblings page contains Gitalk code.

Needs confirmation:

- `.git/shallow:1` stops ancestry at `b6d7e299c8a98dee349f8d1c4d2dd38a06bcc8d0`. That commit records an earlier parent, but the parent object is absent. No claim about all older root commits or the complete remote repository history can be proved from this clone.
- GitHub Pages settings, Actions secrets, environments, and server-side deployment history are not Git objects and were not available in this offline review.

## Affected cluster: current challenge answers are tracked in plaintext

Severity: low to medium, limited to challenge integrity

Root cause: the browser checker publishes only a SHA-256 digest, but the corresponding answer files remain in the public repository. Obscure filenames do not protect a Git tree from enumeration.

Affected:

- `assigments/flags/injection-59e9dc917a1db56feeb5a5f8d95d5d45.md:1` matches the digest used by `_posts/2021-07-25-injection.md:3-4`.
- `assigments/flags/mersenne-seed-recovery-164e17c71dcb320e29b3244894541b6b.md:1` matches `_posts/2021-07-25-mersenne-seed-recovery.md:3-4`.
- `assigments/flags/untwist-me-e885303b929d978d8a4a9310604b342e.md:1` matches `_posts/2021-07-25-untwist-me.md:3-4`.
- `assigments/flags/wiki-mersenne-a33e0d1d86680748453be85f9758766c.md:1` matches `_posts/2021-07-25-wiki-mersenne.md:3-4`.
- `_config.yml:35-51` excludes `assigments` from `_site`, so the answers are absent from the generated artifact. Exclusion does not hide them from a public Git repository or its history.

Checked:

- `_includes/checkflag.html:1-12` emits a local form with no action, and `assets/js/challenge.js:1-29` computes SHA-256 in the browser. All ten generated forms have no submission URL or method. No answer or visitor input is sent anywhere.
- The ten forms carry seven unique, well-formed digests. Repeated digests come from the duplicated introductory exercise, not a leaked runtime credential.
- `ctf-tutorials/assigments/what are assignments/task2.txt:1` is an intentionally downloadable task artifact. The article explicitly instructs the reader to retrieve it at `_posts/ctf-tutorials/2021-07-04-what are assignments.md:44-49`; it is not a hidden server secret.

Impact:

- Anyone who browses or clones the repository can obtain the four answers without solving the current exercises. There is no account, server, prize, or authentication boundary in the local checker, so the impact is game integrity rather than system compromise.

Fix:

- If the exercises remain competitive, rotate the four answers and keep their plaintext outside the public repository. Retain only high-entropy digests in front matter. If they are archival exercises, label them as such and accept that source readers can inspect the answers.

## Checked cluster: educational keys, flags, exploit code, and raw attachments

The WriteUps section deliberately publishes challenge inputs, solvers, recovered flags, archives, and code. These artifacts look dangerous to generic secret scanners but are not live site credentials.

Not applicable:

- `_posts/WriteUps/2020/ractf/crypto/Mysterious_Masquerading_Message/id_rsa.txt:3-26`, the copy in `solve.py:6-29`, and the copy in the article at lines 30-53 use an OpenSSH private-key wrapper as challenge data. Base64 decoding succeeds, but the payload does not have the required `openssh-key-v1` magic and is not an OpenSSH private key. The article introduces it as a malformed challenge file at lines 23-30.
- Four one-line `flag.txt` files are published byte-for-byte at `_site/WriteUps/2020/redpwn/crypto/pseudo-key/flag.txt:1`, `_site/WriteUps/2020/zh3r0/crypto/Mix/Mix/flag.txt:1`, `_site/WriteUps/2021/google_ctf/crypto/pythia/flag.txt:1`, and `_site/WriteUps/2022/google_ctf/crypto/maybe_someday/flag.txt:1`. They are solved, dated CTF challenge artifacts colocated with public writeups, not credentials used by this site.
- `_posts/WriteUps/2020/zh3r0/crypto/Analyze_me/solve.py:60` uses Python `eval` while parsing challenge output. It is a downloadable solver and is never loaded or executed by the browser, Jekyll build, or CI workflow.
- Variables named `FLAG`, `secret`, `password`, and `token` in the challenge sources are placeholders, generated per challenge run, ciphertext inputs, or solver state. CI runs only the scripts named at `.github/workflows/site-check.yml:38-42,58-68`; it does not execute post attachments.

Checked:

- The supplied output has 238 raw code/data/archive files after excluding site/app JavaScript and asset notices. They are public WriteUps attachments plus the tutorial task attachment. Their presence is required by `script/verify-site.py:190-201` and the imported-content manifest.
- No output file exposes `_config.yml`, `.git`, `.github`, `agent_out`, `script`, `Gemfile`, package manifests, environment files, logs, backups, or source maps.
- No output or history blob contains a generated directory-index signature. There are no source/output symlinks, and all six compressed challenge attachments have clean member paths.

## Needs confirmation: an unlinked resume is indexed

Severity: privacy review required

Affected:

- `assets/resume_himanshu_sheoran.pdf` is deliberately linked as "Hire Me" at `about.md:57` and copied byte-for-byte to `_site/assets/resume_himanshu_sheoran.pdf`. This appears intentional.
- `assets/resume.pdf` has no reference in current tracked text but is also copied byte-for-byte to `_site/assets/resume.pdf`.
- `_site/sitemap.xml:411-418` advertises both PDFs to crawlers. The unlinked file is therefore discoverable without a directory listing.

Needs confirmation:

- The environment had no PDF text parser, so stale contact details or other personal data inside the older, unlinked PDF could not be compared with the intended resume. Both files are binary and have no source line numbers.

Impact:

- If `assets/resume.pdf` is an obsolete copy, search engines can retain and surface personal details that the current About page no longer links.

Fix:

- Confirm that both versions are intentionally public. Remove the stale copy and its sitemap entry if only the named current resume should remain available.

## Checked and fragile cluster: current browser runtime

Checked:

- The only automatic page resources are local. `_includes/head.html:15-25`, `new-tetris/index.html:8-16,153`, `new-tetris/src/catalog/index.html:8,99`, and `new-tetris/src/scoring/index.html:8-9` resolve to files inside `_site`.
- `_includes/extensions/youtube.html:1-3` renders an ordinary outbound link rather than an iframe. YouTube receives no request until the reader follows it.
- No generated link uses `target="_blank"`, so there is no reverse-tabnabbing case requiring `rel="noopener"`.
- No generated HTML has an inline event attribute. The New Tetris page has one inline script at `new-tetris/index.html:8-13`, but it only maps a query value through a two-value allowlist before assigning a data attribute.
- No browser script uses `fetch`, XHR, WebSocket, `postMessage`, cookies, IndexedDB, or remote dynamic import. `assets/js/theme.js:4-46` and `new-tetris/src/main.js:72-85,181-185` store only theme, key-binding, and replay state in local storage.
- Archive query values are used for comparisons and same-origin history updates at `assets/js/archive.js:12-49`; they do not enter an HTML sink. Tetris date/layout parameters are validated or allowlisted at `new-tetris/src/main.js:294-310,406-419` and `new-tetris/src/ui-layout.js:44-65`.
- Redirect paths are required to be clean relative paths at `_plugins/legacy_paths.rb:11-25`; generated refresh and link destinations begin at the local base URL at lines 34-46. The supplied output contains no `javascript:`, `data:`, `vbscript:`, or `srcdoc` sink.

Fragile:

- `new-tetris/src/catalog/catalog.js:129-156,271-321` constructs HTML with `innerHTML`. The values currently come only from bundled, hash-pinned catalog modules. A recursive scan of all three modules found no `<`, `>`, `&`, quote, or backtick in any data string, and query parameters select existing objects rather than becoming HTML. This is safe for the current immutable data but would become stored DOM XSS if a future catalog source admitted markup-bearing strings.
- Jekyll layouts interpolate titles, descriptions, tags, and repository metadata as trusted markup, for example `_layouts/article.html:12-22` and `_layouts/writeup.html:15-41`. The current corpus has no active HTML in those metadata fields, and authored Markdown is already a trusted-code boundary because raw HTML is allowed. Future automation must not import untrusted Markdown and treat escaping a few fields as a complete sandbox.
- The four stale Ramblings `comments.provider` fields are harmless now, but a future theme that restores provider dispatch could reactivate Gitalk behavior. Remove or override the stale metadata if comment support is not meant to return.

## Fragile cluster: the release gate does not prove every security claim

The current output passed independent checks, but `script/verify-site.py` has blind spots that could allow later regressions.

Fragile:

- `script/verify-site.py:22-25` recognizes a short tracker list. It omits common comment, analytics, session-replay, ad, and social runtimes.
- `script/verify-site.py:43-67` collects common HTML resources, but it does not reject dangerous `data:` or `javascript:` references, inspect `target="_blank"`, parse `srcset`, `object`, `embed`, `video`, `audio`, `srcdoc`, forms with network actions, or inspect JavaScript-created resources.
- `script/verify-site.py:232-234` checks URL references only in the shared main CSS. It does not inspect KaTeX CSS or either New Tetris stylesheet for external imports.
- The gate has no check for source maps, private-key markers, credential formats, challenge-answer files, stale personal artifacts, or reachable Git history.

Checked:

- Independent scans filled those gaps for this candidate and found no current exploit or automatic tracker. The gap is in future regression coverage, not evidence that the supplied artifact contains a missed runtime.

Fix:

- Parse all load-bearing HTML attributes and all CSS files, reject dangerous schemes, inspect JavaScript network/resource APIs, check `target="_blank"` relations, forbid source maps and build/config files, and run a value-redacting secret scan over `git rev-list --objects --all`.

## Checked and fragile cluster: CI permissions and publishing

Checked:

- `.github/workflows/site-check.yml:3-10` is the only workflow at HEAD. It grants only `contents: read`; there is no `pages`, `id-token`, package, issue, or write permission.
- The three third-party actions at `.github/workflows/site-check.yml:20-33` are pinned to full 40-character commit IDs.
- `npm ci` uses `--ignore-scripts` at `.github/workflows/site-check.yml:35-36`. `package.json:1-11` is private and contains no publish or install lifecycle script.
- No workflow or reachable historical workflow contains a deploy action, Pages upload, release, package publication, `git push`, or cloud upload command. `_site` is ignored at `.gitignore:1` and has no tracked file.

Fragile:

- `pull_request` runs repository-controlled Python, Ruby, custom Jekyll plugins, and Node code at `.github/workflows/site-check.yml:6,38-68`. This is arbitrary code from a pull request. The token is read-only and the repository is public, but `actions/checkout` leaves credentials persisted by default because lines 20-21 do not set `persist-credentials: false`. This matters if the workflow later gains secrets or wider permissions.
- The workflow has no job timeout. A malicious or broken pull request can consume runner time through a verifier or Jekyll plugin.
- Push checks run only on `master` at `.github/workflows/site-check.yml:4-7`. A direct push to `unified-publishing` does not trigger this workflow unless it is also covered by a pull request or manual dispatch.

Needs confirmation:

- The repository contains no publishing mechanism. Actual GitHub Pages branch/build settings and any automatically generated Pages workflow live outside Git. A future cutover must not assume that this read-only workflow deploys or that custom plugins run in the host's selected publishing mode.

Fix:

- Keep permissions read-only, set checkout `persist-credentials: false`, add a timeout, and ensure the eventual publishing path is separately reviewed with the minimum `pages` and `id-token` permissions. Do not combine untrusted pull-request execution with deployment credentials.

## GoatCounter analytics support (added, not enabled)

The unified site supports optional visitor counting through GoatCounter. The owner approved trying it after the cleanup removed every runtime tracker.

- `_includes/goatcounter.html` renders one async script (`https://gc.zgo.at/count.js`) plus a no-JS counting pixel, only when `_config.yml` sets `goatcounter_site`. The value is empty at HEAD, so generated output contains no third-party request and the verifier reports `analytics: none`.
- Redirect pages (the 24 historical aliases) never load analytics; New Tetris pages are standalone and have none. Every other Jekyll page gets exactly one script and one pixel when enabled.
- `script/verify-site.py` enforces both states: disabled means zero occurrences of `gc.zgo.at` or `*.goatcounter.com` anywhere; enabled means exactly one script and one pixel on every regular page, no analytics on redirect pages, and any other external resource still fails the build. The image metadata gate exempts only the counting pixel.
- The browser matrix tolerates `gc.zgo.at` and the configured `*.goatcounter.com` host only when the config enables them. The sandbox resolver maps external hosts to 0.0.0.0, so those requests fail harmlessly during local runs.
- Enabling requires the owner to register the site at goatcounter.com and commit the site code. GoatCounter sets no cookies and does not fingerprint; the free tier requires non-commercial use, which fits this blog. The snippet adds roughly 400 raw bytes per page, well inside every payload budget.
- Old dashboards (Google Analytics for the root blog, LeanCloud counters) remain the only source of historical visitor numbers. Revoking the leaked credentials does not delete that history.
