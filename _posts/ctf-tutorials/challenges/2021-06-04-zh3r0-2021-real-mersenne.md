---
layout: "article"
title: "Challenge archive: zh3r0 CTF V2 2021 - real_mersenne"
description: "zh3r0 CTF 2021 - Cryptography."
date: "2021-06-04T10:30:00+00:00"
section: "tutorials"
tags: ["challenges", "crypto"]
challenge_id: "zh3r0-2021-real-mersenne"
challenge_year: 2021
challenge_checker: false
challenge_browser: true
permalink: "/challenges/zh3r0-2021/real-mersenne/"
---

{% assign event_challenge = site.data.authored_challenges.entries | where: 'id', page.challenge_id | first %}

<div data-challenge-archive="zh3r0-2021-real-mersenne" markdown="1">

<p>By {{ event_challenge.authors | join: ", " | escape }}.</p>

## Original description

> Do you believe in games of luck? I hope you make your guesses real or you'll be floating around,

Read this challenge as [plain text]({{ '/challenges/zh3r0-2021/real-mersenne/challenge.txt' | relative_url }}) or [JSON]({{ '/challenges/zh3r0-2021/real-mersenne/challenge.json' | relative_url }}).

## Browser practice

{% include challenge-browser.html %}

## Files

These files describe the original interactive service. The browser practice above is local; no TCP endpoint or retired remote service is connected.

<ul data-archive-files>
  <li><a href="{{ '/assets/challenges/zh3r0-2021-real-mersenne/challenge.py' | relative_url }}" data-file-kind="handout">challenge.py</a></li>
</ul>

The handout omits the secret module. Browser practice uses a public dummy reward in place of the event flag; the original remote service is retired.

## Download

```sh
mkdir -p zh3r0-2021-real-mersenne
cd zh3r0-2021-real-mersenne
curl --fail --location --output challenge.txt \
  "{{ '/challenges/zh3r0-2021/real-mersenne/challenge.txt' | absolute_url }}"
curl --fail --location --output challenge.json \
  "{{ '/challenges/zh3r0-2021/real-mersenne/challenge.json' | absolute_url }}"
curl --fail --location --output challenge.py \
  "{{ '/assets/challenges/zh3r0-2021-real-mersenne/challenge.py' | absolute_url }}"
```

<details data-archive-spoilers>
<summary>Sources and solutions (spoilers)</summary>
{% include challenge-sources.html %}
</details>

[All challenges]({{ '/challenges/' | relative_url }}) · [CTF tutorials]({{ '/ctf-tutorials/' | relative_url }})

</div>
