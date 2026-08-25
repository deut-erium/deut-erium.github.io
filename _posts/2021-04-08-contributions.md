---
title: Contributing
description: How to correct an article or propose a new field note for this Jekyll site.
tags: introduction contribution
excerpt_separator: "<!--more-->"
author: deuterium
key: contribution00001
---

The source for this site is public. Corrections, technical disagreements, and focused new articles are welcome through the [repository](https://github.com/deut-erium/deut-erium.github.io).
<!--more-->

# Correcting an article

Open an issue for a small factual problem. For a direct patch, fork the repository, edit the corresponding Markdown file, run the site checks, and submit a pull request. Preserve existing public URLs unless the change also includes a redirect plan.

# Adding a field note

Posts live in `_posts` and use the file form `YYYY-MM-DD-name.md`. A minimal post looks like this:

```yaml
---
title: A specific title
description: A one-sentence account of what the article establishes.
tags: security cryptography
---
```

Use fenced code with a language identifier. Keep diagrams and downloads local when their license permits it. Images need useful alt text plus intrinsic `width` and `height` attributes.

# Adding a challenge

A local challenge stores one or more SHA-256 flag hashes in front matter:

```yaml
sha256hash:
  - 0123456789abcdef...
```

Insert a checker where needed:

```liquid
{% raw %}{% assign index = 0 %}
{% include checkflag.html %}{% endraw %}
```

The browser computes SHA-256 through Web Crypto and compares it with the public hash. This is a convenience for static puzzles, not authentication.

# Build checks

The repository workflow builds Jekyll from a clean checkout and rejects broken internal links, third-party runtime assets, duplicate metadata, missing image dimensions, or performance-budget regressions. Run the equivalent local build before opening a large pull request.
