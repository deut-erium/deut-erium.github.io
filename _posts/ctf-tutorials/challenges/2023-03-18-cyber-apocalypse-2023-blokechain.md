---
layout: "article"
title: "Challenge archive: HTB Cyber Apocalypse 2023 - Blokechain"
description: "Hack The Box 2023 - Cryptography."
date: "2023-03-18T13:00:00+00:00"
section: "tutorials"
tags: ["challenges", "crypto"]
challenge_id: "cyber-apocalypse-2023-blokechain"
challenge_year: 2023
challenge_checker: false
challenge_browser: true
permalink: "/challenges/cyber-apocalypse-2023/blokechain/"
---

{% assign event_challenge = site.data.authored_challenges.entries | where: 'id', page.challenge_id | first %}

<div data-challenge-archive="cyber-apocalypse-2023-blokechain" markdown="1">

<p>By {{ event_challenge.authors | join: ", " | escape }}.</p>

## Summary

Mine blocks against a private hash function and earn enough to destroy the vessels.

Read this challenge as [plain text]({{ '/challenges/cyber-apocalypse-2023/blokechain/challenge.txt' | relative_url }}) or [JSON]({{ '/challenges/cyber-apocalypse-2023/blokechain/challenge.json' | relative_url }}).

## Browser practice

{% include challenge-browser.html %}

## Files

These files describe the original interactive service. The browser practice above is local; no TCP endpoint or retired remote service is connected.

<ul data-archive-files>
  <li><a href="{{ '/assets/challenges/cyber-apocalypse-2023-blokechain/crypto_blokechain.zip' | relative_url }}" data-file-kind="handout">crypto_blokechain.zip</a></li>
</ul>

The handout contains server.py and prints a placeholder when you win; it does not include the event flag.

This copy comes from Cyberkarta's community archive, not an official HTB repository. The original remote service is retired; browser practice runs locally with a public dummy reward.

## Download

```sh
mkdir -p cyber-apocalypse-2023-blokechain
cd cyber-apocalypse-2023-blokechain
curl --fail --location --output challenge.txt \
  "{{ '/challenges/cyber-apocalypse-2023/blokechain/challenge.txt' | absolute_url }}"
curl --fail --location --output challenge.json \
  "{{ '/challenges/cyber-apocalypse-2023/blokechain/challenge.json' | absolute_url }}"
curl --fail --location --output crypto_blokechain.zip \
  "{{ '/assets/challenges/cyber-apocalypse-2023-blokechain/crypto_blokechain.zip' | absolute_url }}"
```

<details data-archive-spoilers>
<summary>Sources and solutions (spoilers)</summary>
{% include challenge-sources.html %}
</details>

[All challenges]({{ '/challenges/' | relative_url }}) · [CTF tutorials]({{ '/ctf-tutorials/' | relative_url }})

</div>
