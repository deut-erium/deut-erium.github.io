---
layout: "article"
title: "Some Trick"
description: "SekaiCTF 2024 - Cryptography."
date: "2024-08-23T16:00:00+00:00"
section: "tutorials"
tags: ["challenges", "crypto"]
challenge_id: "sekaictf-2024-some-trick"
challenge_year: 2024
challenge_checker: true
permalink: "/challenges/sekaictf-2024/some-trick/"
---

{% assign event_challenge = site.data.authored_challenges.entries | where: 'id', page.challenge_id | first %}

<div data-challenge-archive="sekaictf-2024-some-trick" markdown="1">

<p>By {{ event_challenge.authors | join: ", " | escape }}.</p>

## Original description

> Bob and Alice found a futuristic version of opunssl and replaced all their needs for doofy wellmen.

## Files

<ul data-archive-files>
  <li><a href="https://raw.githubusercontent.com/project-sekai-ctf/sekaictf-2024/e7c9183860a846dd2c4e0d1fd5d5a1fe468e1244/crypto/some-trick/dist/sometrick.py" data-file-kind="handout">sometrick.py</a></li>
  <li><a href="{{ '/assets/challenges/sekaictf-2024-some-trick/output.txt' | relative_url }}" data-file-kind="fixed-instance">Fixed instance (output.txt)</a></li>
</ul>

Keep the version banner and all three messages in output.txt. The original program only prints these messages; it does not ask for input.

This fixed output was generated for the post with the unchanged original program and event flag. It is not a recording from the competition.

## Download

```sh
mkdir -p sekaictf-2024-some-trick
cd sekaictf-2024-some-trick
curl --fail --location --output sometrick.py \
  "https://raw.githubusercontent.com/project-sekai-ctf/sekaictf-2024/e7c9183860a846dd2c4e0d1fd5d5a1fe468e1244/crypto/some-trick/dist/sometrick.py"
curl --fail --location --output output.txt \
  "{{ '/assets/challenges/sekaictf-2024-some-trick/output.txt' | absolute_url }}"
```

## Check your flag

{% include challenge.html id=event_challenge.checker.id hash=event_challenge.checker.sha256 salt=event_challenge.checker.salt prefix=event_challenge.checker.prefix title=page.title %}

<details data-archive-spoilers>
<summary>Sources and solutions (spoilers)</summary>
{% include challenge-sources.html %}
</details>

[All challenges]({{ '/challenges/' | relative_url }}) · [CTF tutorials]({{ '/ctf-tutorials/' | relative_url }})

</div>
