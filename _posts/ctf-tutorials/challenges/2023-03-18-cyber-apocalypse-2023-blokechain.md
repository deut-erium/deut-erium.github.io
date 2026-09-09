---
layout: "article"
title: "Blokechain"
description: "Hack The Box 2023 - Cryptography."
date: "2023-03-18T13:00:00+00:00"
section: "tutorials"
tags: ["challenges", "crypto"]
challenge_id: "cyber-apocalypse-2023-blokechain"
challenge_year: 2023
challenge_checker: false
permalink: "/challenges/cyber-apocalypse-2023/blokechain/"
---

{% assign event_challenge = site.data.authored_challenges.entries | where: 'id', page.challenge_id | first %}

<div data-challenge-archive="cyber-apocalypse-2023-blokechain" markdown="1">

<p>By {{ event_challenge.authors | join: ", " | escape }}.</p>

## Summary

Mine blocks against a private hash function and earn enough to destroy the vessels.

## Files

The original challenge used an interactive service. No live server is connected to this post.

<ul data-archive-files>
  <li><a href="https://raw.githubusercontent.com/cyberkarta/HTBCyberApocalypse2023/d3fc66c54303eb6f2a6cd831c786f054bb8214c6/crypto_blokechain.zip" data-file-kind="handout">crypto_blokechain.zip</a></li>
</ul>

The handout contains server.py and prints a placeholder when you win; it does not include the event flag.

This copy comes from Cyberkarta's community archive, not an official HTB repository. No live instance is provided here.

## Download

```sh
mkdir -p cyber-apocalypse-2023-blokechain
cd cyber-apocalypse-2023-blokechain
curl --fail --location --output crypto_blokechain.zip \
  "https://raw.githubusercontent.com/cyberkarta/HTBCyberApocalypse2023/d3fc66c54303eb6f2a6cd831c786f054bb8214c6/crypto_blokechain.zip"
```

<details data-archive-spoilers>
<summary>Sources and solutions (spoilers)</summary>
{% include challenge-sources.html %}
</details>

[All challenges]({{ '/challenges/' | relative_url }}) · [CTF tutorials]({{ '/ctf-tutorials/' | relative_url }})

</div>
