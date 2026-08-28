# Unified site report

Date: 2026-08-28

Branch: `unified-publishing`

Verified source commit: `b93a15dbbca9c72ef13006e8cd14e3a7d1341076`

Target repository: `deut-erium.github.io`

Nothing was pushed or deployed. GitHub Pages settings were not changed.

## Combined site

One Jekyll build now publishes these sections:

```text
/
/WriteUps/
/ctf-tutorials/
/ramblings/
/new-tetris/
```

The repository has one dependency set, build command, shared navigation, archive, tag index, color system, dark-mode preference, and verification workflow. WriteUps retains its event-oriented article layout. The root blog, tutorials, and Ramblings use section-specific metadata without forcing their posts into the WriteUps template.

## Authored source

The source contains 78 posts:

- 8 root posts
- 61 WriteUps posts
- 4 CTF tutorial posts
- 5 Ramblings posts

The integrity manifest covers 331 authored or published files. It rejects byte changes in the imported posts, attachments, assignment files, contribution guide, resumes, historical profile body, and other selected source files.

WriteUps uses a mixed provenance record:

- 285 files match public WriteUps commit `905279fcb7d35e381a5e3c0ddd2a91af0ff6d343` byte-for-byte.
- 8 newer local files come from commit `53c1f40a135f96fcad0dc0c119c77f33639348ef`.

The public WriteUps articles, images, About page, and 404 page were restored after the first combined build was found to contain earlier editorial replacements. Generated descriptions, image dimensions, emoji rendering, math delimiters, and link repairs now happen during the build instead of changing the source Markdown.

The root profile at `/assets/index.html` is generated from the original profile body. Its old tracker markup is not part of the generated page. The original root posts, pages, contribution guide, favicon, assignments, and selected static files match their recorded public source.

The heading gate compares all 420 authored ATX headings with the generated articles. Heading text is unchanged. Root and tutorial heading levels match the source. WriteUps keeps its historical one-level article offset, and Ramblings uses the same offset where needed to retain one page H1.

## Tags and archives

The global archive contains all 78 posts and 130 canonical tags. These exact aliases are merged during generation:

```text
ctf  -> CTF
ctfs -> CTF
rsa  -> RSA
```

Source front matter remains unchanged. Other similar tags remain separate. Archive controls are revealed only after their local script starts; without JavaScript, readers receive the complete archive and a plain explanation.

Root pagination covers all 78 posts once. WriteUps pagination covers all 61 WriteUps once and derives its page-link count from the current post count.

## Routes, attachments, and feeds

The release gate checks:

- all 101 historical HTML paths from the four generated baselines
- all 78 current post routes
- 24 historical WriteUps aliases with exact `.html` destinations and matching canonicals
- 230 current WriteUps postfiles
- 76 historical attachment aliases
- root and section archives, feeds, sitemaps, robots files, and 404 pages
- all WriteUps pages through `/WriteUps/page8/`

Section feeds contain bounded, nonempty summaries and exact newest-first windows. Section sitemaps contain the section home and every post in that section. No noindex page appears in a sitemap. The older unlinked resume remains available at its historical path but is omitted from the sitemap pending owner review.

## Rendering and interaction checks

The generated site contains:

- 138 HTML pages
- 327 code frames with verified source hashes and line counts
- 309 source-verified WriteUps code blocks across 60 code-bearing routes
- 106 build-time KaTeX expressions on 4 articles
- 10 browser-local challenge forms on 6 pages
- 61 images with nonempty alt text and dimensions
- zero automatic third-party resources

Browser checks covered desktop, mobile, dark mode, no JavaScript, forced colors, reduced motion, print media, keyboard use, Clipboard failures, overlapping copy attempts, digest failures, and overlapping challenge submissions.

The follow-up fixes include:

- WriteUps articles now use the intended event/category/topic layout.
- Historical redirects use exact artifact paths.
- Printed code no longer collapses into the line-number column.
- The authored 404 art remains contained on mobile and in print.
- Challenge input cannot enter a native request URL when JavaScript is absent.
- Challenge results reject stale asynchronous completions and report digest failures.
- Invalid stored theme values no longer block system-theme changes.
- Archive filters are not presented as working controls without JavaScript.

A 390-pixel viewport sweep covered 110 sitemap and error routes with no document-level horizontal overflow, missing H1, or missing main landmark.

## New Tetris

All 29 recovered files retain provenance to root `gh-pages` commit `3747c082a1f6ce600da81050223d74b19f1b35ba`. Twenty-four files remain byte-identical. Five files have recorded local patches for accessibility or page metadata.

The game now:

- hides inactive controls until its module starts
- puts the no-JavaScript notice before the hidden game
- exposes a 20 by 10 board table with active and locked cell states
- updates board, held-piece, and queue descriptions
- announces game events without making every movement a live update
- suppresses the square flash under reduced motion
- declares canonical, Open Graph, and favicon metadata for the game, catalog, and scoring guide

A browser test confirmed 200 accessible board cells, changing board state after a hard drop, no-JavaScript control hiding, reduced-motion behavior, and successful game startup.

## Privacy and history

The production artifact contains no analytics, comment runtime, tracker, external automatic resource, source map, inline event handler, or unsafe blank-target link. The known Ramblings OAuth values do not occur in any Git blob reachable from this unified repository.

Historical root commits still contain old analytics identifiers and templates. They do not execute in the current site. Four archival challenge answers also remain in the public source; this affects exercise secrecy, not site or account security.

[Ramblings Gitalk configuration](https://github.com/deut-erium/ramblings/blob/fd78c8215cb774ab17b4daec4cd342fb858e4e0a/_config.yml#L121-L132): the old repository contains a concrete OAuth secret. Summary: 1 affected configuration, 1 unified history checked.

Affected:

- [Public Ramblings configuration](https://github.com/deut-erium/ramblings/blob/fd78c8215cb774ab17b4daec4cd342fb858e4e0a/_config.yml#L121-L132): enables Gitalk with the exposed credential.

Checked:

- The unified working tree, generated artifact, and reachable Git blobs contain no matching OAuth value or active Gitalk runtime.

Impact:

- The old credential must be treated as compromised even though the combined site does not use it.

Fix:

- Revoke or rotate the OAuth secret before cutover.
- Do not import the unsanitized Ramblings history.
- Keep comments disabled unless they receive a separate privacy review.

## Reproducible release gate

A clean `git archive` build installed JavaScript dependencies from the lockfile, used the locked Ruby bundle, and generated two independent artifacts. Both artifacts contained 506 files and had identical per-file SHA-256 manifests.

```text
verified source commit: b93a15dbbca9c72ef13006e8cd14e3a7d1341076
regular-file bytes:     22,052,920
manifest SHA-256:       ee1d6755e85b4974118dd9a2f1b77ecdf3840b9f89a98a685120e4b1e66ae2c8
```

Payload measurements:

```text
root home:             2,890 bytes gzip
combined archive:      8,979 bytes gzip
root feed:             1,639 bytes gzip
WriteUps home:         2,554 bytes gzip
WriteUps feed:         1,709 bytes gzip
shared CSS:            7,021 bytes gzip
article JavaScript:    1,808 bytes gzip
challenge JavaScript:    827 bytes gzip
theme JavaScript:        622 bytes gzip
```

The checked workflow runs on every push, uses frozen dependencies, disables persisted checkout credentials, has a job timeout, performs two builds, compares every output hash, and runs the source, route, code, heading, application, feed, sitemap, privacy, and payload gates. It does not deploy.

## Owner actions before cutover

- Review the local combined preview.
- Revoke or rotate the old Ramblings OAuth secret.
- Decide whether the older `/assets/resume.pdf` should remain public.
- Approve a separate GitHub Pages artifact-deployment workflow and Pages source change.
- After a verified production cutover, disable Pages on WriteUps, Ramblings, and CTF tutorials.
- Complete manual screen-reader and PDF review on representative long articles and the game.
