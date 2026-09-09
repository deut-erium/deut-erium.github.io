---
layout: "article"
title: "Challenge archive: zh3r0 CTF V2 2021 - twist_and_shout"
description: "zh3r0 CTF 2021 - Cryptography."
date: "2021-06-04T10:30:00+00:00"
section: "tutorials"
tags: ["challenges", "crypto"]
challenge_id: "zh3r0-2021-twist-and-shout"
challenge_year: 2021
challenge_checker: true
permalink: "/challenges/zh3r0-2021/twist-and-shout/"
---

{% assign event_challenge = site.data.authored_challenges.entries | where: 'id', page.challenge_id | first %}

<div data-challenge-archive="zh3r0-2021-twist-and-shout" markdown="1">

<p>By {{ event_challenge.authors | join: ", " | escape }}.</p>

## Original description

> Wise men once said, "Well, shake it up, baby, now Twist and shout come on and work it on out" I obliged, now the flag is as twisted as my sense of humour

Read this challenge as [plain text]({{ '/challenges/zh3r0-2021/twist-and-shout/challenge.txt' | relative_url }}) or [JSON]({{ '/challenges/zh3r0-2021/twist-and-shout/challenge.json' | relative_url }}).

## Files

<ul data-archive-files>
  <li><a href="{{ '/assets/challenges/zh3r0-2021-twist-and-shout/challenge.py' | relative_url }}" data-file-kind="handout">challenge.py</a></li>
  <li><a href="{{ '/assets/challenges/zh3r0-2021-twist-and-shout/output.txt' | relative_url }}" data-file-kind="fixed-instance">Fixed instance (output.txt)</a></li>
</ul>

Use all 624 lines in output.txt with the original source. The Untwist Me practice variant has its own output and flag.

This fixed output was generated for the post with the unchanged original program and event flag. It is not a recording from the competition.

[Try the local practice variant]({{ '/2021/07/25/untwist-me.html' | relative_url }}). Its flag check is separate from this event challenge.

## Download

```sh
mkdir -p zh3r0-2021-twist-and-shout
cd zh3r0-2021-twist-and-shout
curl --fail --location --output challenge.txt \
  "{{ '/challenges/zh3r0-2021/twist-and-shout/challenge.txt' | absolute_url }}"
curl --fail --location --output challenge.json \
  "{{ '/challenges/zh3r0-2021/twist-and-shout/challenge.json' | absolute_url }}"
curl --fail --location --output challenge.py \
  "{{ '/assets/challenges/zh3r0-2021-twist-and-shout/challenge.py' | absolute_url }}"
curl --fail --location --output output.txt \
  "{{ '/assets/challenges/zh3r0-2021-twist-and-shout/output.txt' | absolute_url }}"
```

## Check your flag

{% include challenge.html id=event_challenge.checker.id hash=event_challenge.checker.sha256 salt=event_challenge.checker.salt prefix=event_challenge.checker.prefix title=page.title %}

<details data-archive-spoilers>
<summary>Sources and solutions (spoilers)</summary>
{% include challenge-sources.html %}
</details>

[All challenges]({{ '/challenges/' | relative_url }}) · [CTF tutorials]({{ '/ctf-tutorials/' | relative_url }})

</div>
