---
layout: "article"
title: "real_mersenne"
description: "zh3r0 CTF 2021 - Cryptography."
date: "2021-06-04T10:30:00+00:00"
section: "tutorials"
tags: ["challenges", "crypto"]
challenge_id: "zh3r0-2021-real-mersenne"
challenge_year: 2021
challenge_checker: false
permalink: "/challenges/zh3r0-2021/real-mersenne/"
---

{% assign event_challenge = site.data.authored_challenges.entries | where: 'id', page.challenge_id | first %}

<div data-challenge-archive="zh3r0-2021-real-mersenne" markdown="1">

<p>By {{ event_challenge.authors | join: ", " | escape }}.</p>

## Original description

> Do you believe in games of luck? I hope you make your guesses real or you'll be floating around,

## Files

The original challenge used an interactive service. No live server is connected to this post.

<ul data-archive-files>
  <li><a href="https://raw.githubusercontent.com/zh3r0/zh3r0-ctf/7fd08591b088215d58aefdc3b0f64c4a9de80f5d/V2/crypto/real_mersenne/public/challenge.py" data-file-kind="handout">challenge.py</a></li>
</ul>

Originally a service challenge. The handout omits the secret module; no live instance is provided here.

## Download

```sh
mkdir -p zh3r0-2021-real-mersenne
cd zh3r0-2021-real-mersenne
curl --fail --location --output challenge.py \
  "https://raw.githubusercontent.com/zh3r0/zh3r0-ctf/7fd08591b088215d58aefdc3b0f64c4a9de80f5d/V2/crypto/real_mersenne/public/challenge.py"
```

<details data-archive-spoilers>
<summary>Sources and solutions (spoilers)</summary>
{% include challenge-sources.html %}
</details>

[All challenges]({{ '/challenges/' | relative_url }}) · [CTF tutorials]({{ '/ctf-tutorials/' | relative_url }})

</div>
