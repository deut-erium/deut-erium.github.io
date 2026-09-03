# deuterium's blog

This repository builds the site served from `deut-erium.github.io`.

Sections:

- `/` - personal posts and browser-local challenges
- `/WriteUps/` - CTF writeups and challenge attachments
- `/ctf-tutorials/` - CTF tutorials and assignments
- `/ramblings/` - informal posts
- `/new-tetris/` - the published game, catalog, and scoring guide

The imported source is recorded in `script/imported-content-manifest.json`. It includes the public WriteUps source plus eight newer local files. Historical routes, attachment bytes, feeds, sitemaps, tags, and the recovered game are checked after each build.

## Build

Ruby 3.3.7 and Node 24.19.0 are the supported versions.

```sh
bundle config set --local frozen true
bundle install
npm ci --ignore-scripts --no-audit --no-fund
script/build-release.sh agent_out/release/site
```

The release command performs one Jekyll build for the root blog, WriteUps, tutorials, and ramblings. It also copies `/new-tetris/` unchanged, adds `.nojekyll`, runs the content and route checks, and writes `agent_out/release/site.manifest.jsonl`.

Set `BUILD_TIME` to an ISO 8601 timestamp when building outside a Git checkout. The build uses local assets. Mathematics and syntax highlighting are generated before publication.

## Publishing a post

`master` contains the Jekyll source. `gh-pages` contains the generated site. GitHub Actions verifies source pushes but does not deploy them.

Choose the source location for the post:

- `_posts/YYYY-MM-DD-slug.md` for the root blog;
- `_posts/WriteUps/YYYY/event/category/challenge/YYYY-MM-DD-slug.md` for a writeup;
- `_posts/ctf-tutorials/YYYY-MM-DD-slug.md` for a tutorial;
- `_posts/ramblings/YYYY-MM-DD-slug.md` for a rambling.

A minimal post is:

```markdown
---
title: "Example title"
description: "A short description for search results."
author: deuterium
tags:
  - cryptography
  - security
excerpt_separator: <!--more-->
---

Opening summary.

<!--more-->

## First section

Article content.
```

The build assigns the section layout, canonical URL, sitemap entry, feed entry, and GoatCounter markup. Use `mathjax: true` in the front matter when the article contains mathematics. Put writeup attachments beside the Markdown source and link to them with relative paths.

Commit the source before building because the release timestamp is derived from the current commit:

```sh
git add _posts/
git commit -m "Add example article"
npm run sync-katex-assets
script/build-release.sh agent_out/release/site
```

Preview the verified output at `http://127.0.0.1:4180/`:

```sh
python3 -m http.server 4180 --bind 127.0.0.1 \
  --directory agent_out/release/site
```

Push `master`, then wait for the **Site checks** workflow to pass:

```sh
git push origin master
```

Create a deployment worktree once:

```sh
git fetch origin
git worktree add -b gh-pages ../deuterium-deploy origin/gh-pages
```

For each release, replace that worktree with the verified output, commit it, and push:

```sh
rsync -a --delete --exclude='.git' \
  agent_out/release/site/ ../deuterium-deploy/

git -C ../deuterium-deploy add -A
git -C ../deuterium-deploy commit -m "Publish example article"
git -C ../deuterium-deploy push origin gh-pages
```

Do not edit generated HTML on `gh-pages`. The release contains `.nojekyll`, so GitHub Pages serves it without another Jekyll build.

The current integrity gate retains migration-era source and aggregate-count baselines. A newly authored post may require deliberate updates to `script/imported-content-manifest.json` and the expected aggregate counts in `script/verify-site.py`. Review every reported difference rather than bypassing the checks.

The lowercase `/writeups/` deployment workaround is intentionally retired; `/WriteUps/` is the canonical integrated section. CI builds twice and compares JSON Lines manifests that cover every file and directory, file bytes, sizes, and permission modes. Symbolic links and special files fail the artifact gate.
