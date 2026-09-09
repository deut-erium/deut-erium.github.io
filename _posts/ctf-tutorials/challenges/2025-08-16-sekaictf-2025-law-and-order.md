---
layout: "article"
title: "Challenge archive: SekaiCTF 2025 - Law and Order"
description: "SekaiCTF 2025 - Cryptography."
date: "2025-08-16T01:00:00+00:00"
section: "tutorials"
tags: ["challenges", "crypto"]
challenge_id: "sekaictf-2025-law-and-order"
challenge_year: 2025
challenge_checker: false
challenge_browser: true
permalink: "/challenges/sekaictf-2025/law-and-order/"
---

{% assign event_challenge = site.data.authored_challenges.entries | where: 'id', page.challenge_id | first %}

<div data-challenge-archive="sekaictf-2025-law-and-order" markdown="1">

<p>By {{ event_challenge.authors | join: ", " | escape }}.</p>

## Description excerpt

> My friends were the FROST to implement sharing signatures for flag and ensured to always include me but somehow it's still not working?

Read this challenge as [plain text]({{ '/challenges/sekaictf-2025/law-and-order/challenge.txt' | relative_url }}) or [JSON]({{ '/challenges/sekaictf-2025/law-and-order/challenge.json' | relative_url }}).

## Browser practice

{% include challenge-browser.html %}

## Files

These files describe the original interactive service. The browser practice above is local; no TCP endpoint or retired remote service is connected.

<ul data-archive-files>
  <li><a href="{{ '/assets/challenges/sekaictf-2025-law-and-order/released-chall.py' | relative_url }}" data-file-kind="handout">chall.py (released handout, incorrect version)</a></li>
  <li><a href="{{ '/assets/challenges/sekaictf-2025-law-and-order/corrected-chall.py' | relative_url }}" data-file-kind="server-source">chall.py (corrected server source)</a></li>
</ul>

The organizers report that the released handout was an incorrect version. The archived server source and solution are for the corrected version; they do not match the released handout.

The original remote service is retired. Browser practice offers corrected (default) and released variants with a public dummy reward.

## Download

```sh
mkdir -p sekaictf-2025-law-and-order
cd sekaictf-2025-law-and-order
curl --fail --location --output challenge.txt \
  "{{ '/challenges/sekaictf-2025/law-and-order/challenge.txt' | absolute_url }}"
curl --fail --location --output challenge.json \
  "{{ '/challenges/sekaictf-2025/law-and-order/challenge.json' | absolute_url }}"
curl --fail --location --output released-chall.py \
  "{{ '/assets/challenges/sekaictf-2025-law-and-order/released-chall.py' | absolute_url }}"
curl --fail --location --output corrected-chall.py \
  "{{ '/assets/challenges/sekaictf-2025-law-and-order/corrected-chall.py' | absolute_url }}"
```

<details data-archive-spoilers>
<summary>Sources and solutions (spoilers)</summary>
{% include challenge-sources.html %}
</details>

[All challenges]({{ '/challenges/' | relative_url }}) · [CTF tutorials]({{ '/ctf-tutorials/' | relative_url }})

</div>
