---
layout: "article"
title: "Challenge archive: SekaiCTF 2022 - FaILProof Revenge"
description: "SekaiCTF 2022 - Cryptography."
date: "2022-09-30T16:00:00+00:00"
section: "tutorials"
tags: ["challenges", "crypto"]
challenge_id: "sekaictf-2022-failproof-revenge"
challenge_year: 2022
challenge_checker: true
permalink: "/challenges/sekaictf-2022/failproof-revenge/"
---

{% assign event_challenge = site.data.authored_challenges.entries | where: 'id', page.challenge_id | first %}

<div data-challenge-archive="sekaictf-2022-failproof-revenge" markdown="1">

<p>By {{ event_challenge.authors | join: ", " | escape }}.</p>

## Original description

> I am sure it's failproof now, I have increased the security levels too!

Read this challenge as [plain text]({{ '/challenges/sekaictf-2022/failproof-revenge/challenge.txt' | relative_url }}) or [JSON]({{ '/challenges/sekaictf-2022/failproof-revenge/challenge.json' | relative_url }}).

## Files

<ul data-archive-files>
  <li><a href="{{ '/assets/challenges/sekaictf-2022-failproof-revenge/source.py' | relative_url }}" data-file-kind="server-source">source.py (archived server source)</a></li>
  <li><a href="{{ '/assets/challenges/sekaictf-2022-failproof-revenge/output.txt' | relative_url }}" data-file-kind="fixed-instance">Fixed instance (output.txt)</a></li>
</ul>

The flag module is needed only to generate a new instance. Solve from the source and the two lines in output.txt; no server is needed.

This fixed output was generated for the post with the unchanged original program and event flag. It is not a recording from the competition.

## Download

```sh
mkdir -p sekaictf-2022-failproof-revenge
cd sekaictf-2022-failproof-revenge
curl --fail --location --output challenge.txt \
  "{{ '/challenges/sekaictf-2022/failproof-revenge/challenge.txt' | absolute_url }}"
curl --fail --location --output challenge.json \
  "{{ '/challenges/sekaictf-2022/failproof-revenge/challenge.json' | absolute_url }}"
curl --fail --location --output source.py \
  "{{ '/assets/challenges/sekaictf-2022-failproof-revenge/source.py' | absolute_url }}"
curl --fail --location --output output.txt \
  "{{ '/assets/challenges/sekaictf-2022-failproof-revenge/output.txt' | absolute_url }}"
```

## Check your flag

{% include challenge.html id=event_challenge.checker.id hash=event_challenge.checker.sha256 salt=event_challenge.checker.salt prefix=event_challenge.checker.prefix title=page.title %}

<details data-archive-spoilers>
<summary>Sources and solutions (spoilers)</summary>
{% include challenge-sources.html %}
</details>

[All challenges]({{ '/challenges/' | relative_url }}) · [CTF tutorials]({{ '/ctf-tutorials/' | relative_url }})

</div>
