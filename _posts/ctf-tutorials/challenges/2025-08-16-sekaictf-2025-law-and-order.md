---
layout: "article"
title: "Law and Order"
description: "SekaiCTF 2025 - Cryptography."
date: "2025-08-16T01:00:00+00:00"
section: "tutorials"
tags: ["challenges", "crypto"]
challenge_id: "sekaictf-2025-law-and-order"
challenge_year: 2025
challenge_checker: false
permalink: "/challenges/sekaictf-2025/law-and-order/"
---

{% assign event_challenge = site.data.authored_challenges.entries | where: 'id', page.challenge_id | first %}

<div data-challenge-archive="sekaictf-2025-law-and-order" markdown="1">

<p>By {{ event_challenge.authors | join: ", " | escape }}.</p>

## Description excerpt

> My friends were the FROST to implement sharing signatures for flag and ensured to always include me but somehow it's still not working?

## Files

The original challenge used an interactive service. No live server is connected to this post.

<ul data-archive-files>
  <li><a href="https://raw.githubusercontent.com/project-sekai-ctf/sekaictf-2025/683dd81ae520581add40ec21c4819866e28cbde4/crypto/law-and-order/dist/chall.py" data-file-kind="handout">chall.py (released handout, incorrect version)</a></li>
  <li><a href="https://raw.githubusercontent.com/project-sekai-ctf/sekaictf-2025/683dd81ae520581add40ec21c4819866e28cbde4/crypto/law-and-order/challenge/app/chall.py" data-file-kind="server-source">chall.py (corrected server source)</a></li>
</ul>

The organizers report that the released handout was an incorrect version. The archived server source and solution are for the corrected version; they do not match the released handout.

Originally a service challenge. No live instance is provided here.

## Download

```sh
mkdir -p sekaictf-2025-law-and-order
cd sekaictf-2025-law-and-order
curl --fail --location --output released-chall.py \
  "https://raw.githubusercontent.com/project-sekai-ctf/sekaictf-2025/683dd81ae520581add40ec21c4819866e28cbde4/crypto/law-and-order/dist/chall.py"
curl --fail --location --output corrected-chall.py \
  "https://raw.githubusercontent.com/project-sekai-ctf/sekaictf-2025/683dd81ae520581add40ec21c4819866e28cbde4/crypto/law-and-order/challenge/app/chall.py"
```

<details data-archive-spoilers>
<summary>Sources and solutions (spoilers)</summary>
{% include challenge-sources.html %}
</details>

[All challenges]({{ '/challenges/' | relative_url }}) · [CTF tutorials]({{ '/ctf-tutorials/' | relative_url }})

</div>
