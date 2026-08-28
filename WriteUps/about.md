---
title: About the register
description: How the CTF writeups, challenge files, and solve scripts are organized.
tags: writeups usage
key: writeups-about
layout: page
mathjax: false
show_edit_on_github: true
comment: false
---

This site is a public notebook for CTF challenges, with an emphasis on cryptography. A writeup should preserve enough evidence for another person to repeat the solve: the challenge statement, the failed assumptions that mattered, the derivation, and the final script.

# Repository

The complete source is in the [WriteUps repository](https://github.com/deut-erium/WriteUps). Corrections are welcome as issues or pull requests.

Articles and their supporting files live together under [`_posts`](https://github.com/deut-erium/WriteUps/tree/master/_posts). The directory structure is part of the public URL:

```text
year/
  ctf_name/
    category/
      challenge_name/
        description.md
        DATE-challenge_name.md
        solve.py
        challenge files
```

A corresponding article is published at:

```text
https://deut-erium.github.io/WriteUps/year/ctf_name/category/challenge_name/DATE-challenge_name
```

# Reproducing a solve

Linked scripts, source files, ciphertexts, and other challenge material are served beside each article. File names and letter case are preserved because many old writeups refer to those exact paths.

Treat every script as CTF research code rather than a maintained package. Read it before running it, use an isolated environment, and expect challenge-specific dependencies.

# Rendering policy

The site ships static HTML and local assets. It uses no analytics or comment tracker. Syntax highlighting and mathematics are generated during the build; math styles are sent only on the five records that contain formulas.
