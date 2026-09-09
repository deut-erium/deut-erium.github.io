---
layout: "article"
title: "RandSubWare"
description: "SekaiCTF 2023 - Cryptography."
date: "2023-08-25T16:00:00+00:00"
section: "tutorials"
tags: ["challenges", "crypto"]
challenge_id: "sekaictf-2023-randsubware"
challenge_year: 2023
challenge_checker: false
permalink: "/challenges/sekaictf-2023/randsubware/"
---

{% assign event_challenge = site.data.authored_challenges.entries | where: 'id', page.challenge_id | first %}

<div data-challenge-archive="sekaictf-2023-randsubware" markdown="1">

<p>By {{ event_challenge.authors | join: ", " | escape }}.</p>

## Description excerpt

> "RandSubWare" - standing for 'Random Substitution Warefare Challenge'. This term encompasses the idea of breaking a substitution permutation network through the use of randomized and strategic attacks on the substituted boxes, engaging in a battle against the complexity and obscurity of the encryption.

## Files

The original challenge used an interactive service. No live server is connected to this post.

<ul data-archive-files>
  <li><a href="https://raw.githubusercontent.com/project-sekai-ctf/sekaictf-2023/4dc0f1fb2836c64b3a502e2538ba32530996b8c9/crypto/randsubware/dist/chall.py" data-file-kind="handout">chall.py</a></li>
</ul>

Originally a service challenge. Recreating the service requires the organizer source; no live instance is provided here.

## Download

```sh
mkdir -p sekaictf-2023-randsubware
cd sekaictf-2023-randsubware
curl --fail --location --output chall.py \
  "https://raw.githubusercontent.com/project-sekai-ctf/sekaictf-2023/4dc0f1fb2836c64b3a502e2538ba32530996b8c9/crypto/randsubware/dist/chall.py"
```

<details data-archive-spoilers>
<summary>Sources and solutions (spoilers)</summary>
{% include challenge-sources.html %}
</details>

[All challenges]({{ '/challenges/' | relative_url }}) · [CTF tutorials]({{ '/ctf-tutorials/' | relative_url }})

</div>
