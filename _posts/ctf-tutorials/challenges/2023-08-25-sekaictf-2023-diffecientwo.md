---
layout: "article"
title: "Challenge archive: SekaiCTF 2023 - Diffecientwo"
description: "SekaiCTF 2023 - Cryptography."
date: "2023-08-25T16:00:00+00:00"
section: "tutorials"
tags: ["challenges", "crypto"]
challenge_id: "sekaictf-2023-diffecientwo"
challenge_year: 2023
challenge_checker: false
permalink: "/challenges/sekaictf-2023/diffecientwo/"
---

{% assign event_challenge = site.data.authored_challenges.entries | where: 'id', page.challenge_id | first %}

<div data-challenge-archive="sekaictf-2023-diffecientwo" markdown="1">

<p>By {{ event_challenge.authors | join: ", " | escape }}.</p>

## Original description

> Welcome to the Diffecientwo Caching Database API for tracking and storing content across social media. We have repurposed our [security product]({{ '/challenges/sekaictf-2022/diffecient/' | relative_url }}), as saving the admin key was probably not the best idea.
>
> We have decided to change our policies and to achieve better marketing, we are offering free API KEY to customers sharing `#SEKAICTF #DEUTERIUM #DIFFECIENTWO #CRYPTO` on *LonelyFans* (our premium business partner).

Read this challenge as [plain text]({{ '/challenges/sekaictf-2023/diffecientwo/challenge.txt' | relative_url }}) or [JSON]({{ '/challenges/sekaictf-2023/diffecientwo/challenge.json' | relative_url }}).

## Files

The original challenge used an interactive service. No live server is connected to this post.

<ul data-archive-files>
  <li><a href="{{ '/assets/challenges/sekaictf-2023-diffecientwo/diffecientwo.py' | relative_url }}" data-file-kind="handout">diffecientwo.py</a></li>
</ul>

Originally a service challenge. Recreating the service requires the organizer source; no live instance is provided here.

## Download

```sh
mkdir -p sekaictf-2023-diffecientwo
cd sekaictf-2023-diffecientwo
curl --fail --location --output challenge.txt \
  "{{ '/challenges/sekaictf-2023/diffecientwo/challenge.txt' | absolute_url }}"
curl --fail --location --output challenge.json \
  "{{ '/challenges/sekaictf-2023/diffecientwo/challenge.json' | absolute_url }}"
curl --fail --location --output diffecientwo.py \
  "{{ '/assets/challenges/sekaictf-2023-diffecientwo/diffecientwo.py' | absolute_url }}"
```

<details data-archive-spoilers>
<summary>Sources and solutions (spoilers)</summary>
{% include challenge-sources.html %}
</details>

[All challenges]({{ '/challenges/' | relative_url }}) · [CTF tutorials]({{ '/ctf-tutorials/' | relative_url }})

</div>
