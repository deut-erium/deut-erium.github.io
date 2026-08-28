# Unified site report

Date: 2026-08-28

Branch: `unified-publishing`

Target repository: `deut-erium.github.io`

Nothing was pushed or deployed. GitHub Pages settings were not changed.

## Result

The root blog, WriteUps, CTF tutorials, Ramblings, and the published `new-tetris` application now build as one Jekyll site from the root repository.

Public sections:

```text
/
/WriteUps/
/ctf-tutorials/
/ramblings/
/new-tetris/
```

The site uses one Gemfile, package lock, layout system, color system, dark-mode control, global archive, merged tag index, sitemap, and deterministic build workflow.

## Authored content

The merge imports 78 posts:

- 8 root posts
- 61 WriteUps posts
- 4 CTF tutorial posts
- 5 Ramblings posts

The original Markdown bodies, titles, headings, front matter, challenge files, and standalone authored pages are copied byte-for-byte. `script/imported-content-manifest.json` records SHA-256 hashes for 319 imported files. `script/verify-imported-content.py` rejects missing, added, or changed imported content.

The original root prose was restored from public commit `b6d7e299`. Earlier local rewrites of the root about page, contribution page, welcome page, challenge introduction, 404 page, and headings are not part of this branch.

Build-time metadata supplies section layouts and historical permalinks without editing the imported Markdown.

## Tags

The root archive contains tags from all 78 posts. It currently exposes 130 canonical tags.

Two exact aliases are merged at build time:

```text
rsa       -> RSA
ctf       -> CTF
ctfs      -> CTF
```

The source front matter is unchanged. The aliases only prevent duplicate entries in the generated global tag index. Other similar-looking tags, such as `crypto` and `cryptography`, remain separate because they are not guaranteed to mean the same thing.

## Routes and files

The release gate confirms:

- 138 HTML pages
- all 101 historical HTML paths from the four generated baselines
- all 61 current WriteUps article routes
- 24 historical WriteUps HTML aliases
- 230 current WriteUps postfiles
- 76 historical attachment aliases
- all historical WriteUps pagination routes through `/WriteUps/page8/`
- section feeds, sitemaps, robots files, archives, and 404 pages
- 29 byte-identical files under `/new-tetris/`

Old theme-specific favicon bundles, source maps, and duplicated CSS files under each section are not copied. They are presentation artifacts rather than authored content or article attachments. The shared root assets replace them.

## Rendering and privacy

The combined site uses the approved calculator visual system in light and dark modes. The root title, publication names, article titles, and authored headings are taken from their original source.

The generated output contains:

- 328 static code frames
- 311 source-verified WriteUps code blocks
- 106 build-time KaTeX expressions
- 10 browser-local challenge forms across 6 pages
- 61 images with dimensions and alt text
- zero automatic third-party resources
- no analytics or comment tracker

The four original YouTube embeds are represented as explicit outbound links. They do not contact YouTube until selected.

## Reproducibility

Two production builds generated 505 files each and produced identical file hashes.

```text
combined bytes: 19,968,657
tree manifest SHA-256: df4a8303ada942e73508fcb9a268220ef2457117bdaab3986a97c9666aa93607
```

The main payloads remain below their gzip limits:

```text
root home:             2,894 bytes gzip
combined archive:      8,915 bytes gzip
WriteUps home:         2,546 bytes gzip
shared CSS:            6,805 bytes gzip
article JavaScript:    1,808 bytes gzip
theme JavaScript:        586 bytes gzip
```

Gate results and review screenshots are stored beside this report.

## Credential requiring owner action

[Ramblings Gitalk configuration](https://github.com/deut-erium/ramblings/blob/fd78c8215cb774ab17b4daec4cd342fb858e4e0a/_config.yml#L121-L132): the old public repository contains an OAuth client secret that was also emitted into its generated branch. Summary: 1 affected configuration; the credential was excluded from the unified repository.

Affected:

- [Public Ramblings configuration](https://github.com/deut-erium/ramblings/blob/fd78c8215cb774ab17b4daec4cd342fb858e4e0a/_config.yml#L121-L132): contains the concrete credential and enables Gitalk.

Checked:

- The unified repository contains no matching credential, active comment provider, analytics identifier, or Gitalk runtime.

Impact:

- The old secret remains public and must be treated as compromised even though it is absent from the merged site.

Fix:

- Revoke or rotate the OAuth application secret before any cutover.
- Keep the old Ramblings repository read-only after migration.
- Do not import its unsanitized Git history into the root repository.

## Remaining owner decisions

- Approve the combined local preview.
- Revoke or rotate the old Ramblings OAuth secret.
- Decide whether retired theme-only asset URLs need archival responses.
- Approve changing the root Pages source to the unified build.
- Confirm the deployment before disabling Pages on WriteUps, Ramblings, and CTF tutorials.
