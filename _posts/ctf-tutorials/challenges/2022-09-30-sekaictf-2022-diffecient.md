---
layout: "article"
title: "Challenge archive: SekaiCTF 2022 - Diffecient"
description: "SekaiCTF 2022 - Cryptography."
date: "2022-09-30T16:00:00+00:00"
section: "tutorials"
tags: ["challenges", "crypto"]
challenge_id: "sekaictf-2022-diffecient"
challenge_year: 2022
challenge_checker: false
permalink: "/challenges/sekaictf-2022/diffecient/"
---

{% assign event_challenge = site.data.authored_challenges.entries | where: 'id', page.challenge_id | first %}

<div data-challenge-archive="sekaictf-2022-diffecient" markdown="1">

<p>By {{ event_challenge.authors | join: ", " | escape }}.</p>

## Original description

> Welcome to the Diffecient Security Key Database API, for securely and efficiently saving tons of long security keys! Feel *free* to query your security keys, and pay a little to add your own to our state-of-the-art database.
>
> We trust our product so much that we even save our own keys here!

Read this challenge as [plain text]({{ '/challenges/sekaictf-2022/diffecient/challenge.txt' | relative_url }}) or [JSON]({{ '/challenges/sekaictf-2022/diffecient/challenge.json' | relative_url }}).

## Files

The original challenge used an interactive service. No live server is connected to this post.

<ul data-archive-files>
  <li><a href="{{ '/assets/challenges/sekaictf-2022-diffecient/diffecient.py' | relative_url }}" data-file-kind="server-source">diffecient.py (archived server source)</a></li>
</ul>

The archive has server source but no separate player handout. The linked file imports a secret module; organizer files are under the spoiler section.

## Download

```sh
mkdir -p sekaictf-2022-diffecient
cd sekaictf-2022-diffecient
curl --fail --location --output challenge.txt \
  "{{ '/challenges/sekaictf-2022/diffecient/challenge.txt' | absolute_url }}"
curl --fail --location --output challenge.json \
  "{{ '/challenges/sekaictf-2022/diffecient/challenge.json' | absolute_url }}"
curl --fail --location --output diffecient.py \
  "{{ '/assets/challenges/sekaictf-2022-diffecient/diffecient.py' | absolute_url }}"
```

<details data-archive-spoilers>
<summary>Sources and solutions (spoilers)</summary>
{% include challenge-sources.html %}
</details>

[All challenges]({{ '/challenges/' | relative_url }}) · [CTF tutorials]({{ '/ctf-tutorials/' | relative_url }})

</div>
