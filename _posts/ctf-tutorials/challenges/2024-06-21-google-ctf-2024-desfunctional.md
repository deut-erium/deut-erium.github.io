---
layout: "article"
title: "Challenge archive: Google CTF 2024 - desfunctional"
description: "Google CTF 2024 - Cryptography."
date: "2024-06-21T18:00:00+00:00"
section: "tutorials"
tags: ["challenges", "crypto"]
challenge_id: "google-ctf-2024-desfunctional"
challenge_year: 2024
challenge_checker: false
challenge_browser: true
permalink: "/challenges/google-ctf-2024/desfunctional/"
---

{% assign event_challenge = site.data.authored_challenges.entries | where: 'id', page.challenge_id | first %}

<div data-challenge-archive="google-ctf-2024-desfunctional" markdown="1">

<p>By {{ event_challenge.authors | join: ", " | escape }}.</p>

## Original description

> A newbie friend of mine was trying to implement a secure server
> for DES encryption and decryption but there seem to be some errors
> unexpectedly creeping in the key. It is getting frustrating, please help

Read this challenge as [plain text]({{ '/challenges/google-ctf-2024/desfunctional/challenge.txt' | relative_url }}) or [JSON]({{ '/challenges/google-ctf-2024/desfunctional/challenge.json' | relative_url }}).

## Browser practice

{% include challenge-browser.html %}

## Files

These files describe the original interactive service. The browser practice above is local; no TCP endpoint or retired remote service is connected.

<ul data-archive-files>
  <li><a href="{{ '/assets/challenges/google-ctf-2024-desfunctional/chall.py' | relative_url }}" data-file-kind="handout">chall.py</a></li>
</ul>

The original remote service is retired. Browser practice runs locally with the public dummy reward practice{local_dummy_reward}; it does not award an event solve.

## Download

```sh
mkdir -p google-ctf-2024-desfunctional
cd google-ctf-2024-desfunctional
curl --fail --location --output challenge.txt \
  "{{ '/challenges/google-ctf-2024/desfunctional/challenge.txt' | absolute_url }}"
curl --fail --location --output challenge.json \
  "{{ '/challenges/google-ctf-2024/desfunctional/challenge.json' | absolute_url }}"
curl --fail --location --output chall.py \
  "{{ '/assets/challenges/google-ctf-2024-desfunctional/chall.py' | absolute_url }}"
```

<details data-archive-spoilers>
<summary>Sources and solutions (spoilers)</summary>
{% include challenge-sources.html %}
</details>

[All challenges]({{ '/challenges/' | relative_url }}) · [CTF tutorials]({{ '/ctf-tutorials/' | relative_url }})

</div>
