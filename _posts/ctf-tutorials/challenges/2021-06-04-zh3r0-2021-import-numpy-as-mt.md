---
layout: "article"
title: "import numpy as MT"
description: "zh3r0 CTF 2021 - Cryptography."
date: "2021-06-04T10:30:00+00:00"
section: "tutorials"
tags: ["challenges", "crypto"]
challenge_id: "zh3r0-2021-import-numpy-as-mt"
challenge_year: 2021
challenge_checker: true
permalink: "/challenges/zh3r0-2021/import-numpy-as-mt/"
---

{% assign event_challenge = site.data.authored_challenges.entries | where: 'id', page.challenge_id | first %}

<div data-challenge-archive="zh3r0-2021-import-numpy-as-mt" markdown="1">

<p>By {{ event_challenge.authors | join: ", " | escape }}.</p>

## Original description

> Python is so slow! Lets use nUmPy tO MAkE iT FaSTer. Only if there was a module for crypto in it :(

## Files

<ul data-archive-files>
  <li><a href="https://raw.githubusercontent.com/zh3r0/zh3r0-ctf/7fd08591b088215d58aefdc3b0f64c4a9de80f5d/V2/crypto/import_numpy_as_MT/public/challenge.py" data-file-kind="handout">challenge.py</a></li>
  <li><a href="{{ '/assets/challenges/zh3r0-2021-import-numpy-as-mt/output.txt' | relative_url }}" data-file-kind="fixed-instance">Fixed instance (output.txt)</a></li>
</ul>

This is the original two-layer encryption challenge. The Wiki Mersenne practice variant uses one layer and has a different flag.

This fixed output was generated for the post with the unchanged original program and event flag. It is not a recording from the competition.

[Try the local practice variant]({{ '/2021/07/25/wiki-mersenne.html' | relative_url }}). Its flag check is separate from this event challenge.

## Download

```sh
mkdir -p zh3r0-2021-import-numpy-as-mt
cd zh3r0-2021-import-numpy-as-mt
curl --fail --location --output challenge.py \
  "https://raw.githubusercontent.com/zh3r0/zh3r0-ctf/7fd08591b088215d58aefdc3b0f64c4a9de80f5d/V2/crypto/import_numpy_as_MT/public/challenge.py"
curl --fail --location --output output.txt \
  "{{ '/assets/challenges/zh3r0-2021-import-numpy-as-mt/output.txt' | absolute_url }}"
```

## Check your flag

{% include challenge.html id=event_challenge.checker.id hash=event_challenge.checker.sha256 salt=event_challenge.checker.salt prefix=event_challenge.checker.prefix title=page.title %}

<details data-archive-spoilers>
<summary>Sources and solutions (spoilers)</summary>
{% include challenge-sources.html %}
</details>

[All challenges]({{ '/challenges/' | relative_url }}) · [CTF tutorials]({{ '/ctf-tutorials/' | relative_url }})

</div>
