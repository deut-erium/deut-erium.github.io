---
layout: "article"
title: "Challenge archive: SekaiCTF 2023 - RandSubWare"
description: "SekaiCTF 2023 - Cryptography."
date: "2023-08-25T16:00:00+00:00"
section: "tutorials"
tags: ["challenges", "crypto"]
challenge_id: "sekaictf-2023-randsubware"
challenge_year: 2023
challenge_checker: false
challenge_browser: true
permalink: "/challenges/sekaictf-2023/randsubware/"
---

{% assign event_challenge = site.data.authored_challenges.entries | where: 'id', page.challenge_id | first %}

<div data-challenge-archive="sekaictf-2023-randsubware" markdown="1">

<p>By {{ event_challenge.authors | join: ", " | escape }}.</p>

## Description excerpt

> "RandSubWare" - standing for 'Random Substitution Warefare Challenge'. This term encompasses the idea of breaking a substitution permutation network through the use of randomized and strategic attacks on the substituted boxes, engaging in a battle against the complexity and obscurity of the encryption.

Read this challenge as [plain text]({{ '/challenges/sekaictf-2023/randsubware/challenge.txt' | relative_url }}) or [JSON]({{ '/challenges/sekaictf-2023/randsubware/challenge.json' | relative_url }}).

## Browser practice

{% include challenge-browser.html %}

## Files

These files describe the original interactive service. The browser practice above is local; no TCP endpoint or retired remote service is connected.

<ul data-archive-files>
  <li><a href="{{ '/assets/challenges/sekaictf-2023-randsubware/chall.py' | relative_url }}" data-file-kind="handout">chall.py</a></li>
</ul>

The original remote service is retired. Browser practice runs locally with the public dummy reward practice{local_dummy_reward}; it does not award an event solve.

## Download

```sh
mkdir -p sekaictf-2023-randsubware
cd sekaictf-2023-randsubware
curl --fail --location --output challenge.txt \
  "{{ '/challenges/sekaictf-2023/randsubware/challenge.txt' | absolute_url }}"
curl --fail --location --output challenge.json \
  "{{ '/challenges/sekaictf-2023/randsubware/challenge.json' | absolute_url }}"
curl --fail --location --output chall.py \
  "{{ '/assets/challenges/sekaictf-2023-randsubware/chall.py' | absolute_url }}"
```

<details data-archive-spoilers>
<summary>Sources and solutions (spoilers)</summary>
{% include challenge-sources.html %}
</details>

[All challenges]({{ '/challenges/' | relative_url }}) · [CTF tutorials]({{ '/ctf-tutorials/' | relative_url }})

</div>
