---
layout: "article"
title: "Challenge archive: Google CTF 2024 - McEliece"
description: "Google CTF 2024 - Cryptography."
date: "2024-06-21T18:00:00+00:00"
section: "tutorials"
tags: ["challenges", "crypto"]
challenge_id: "google-ctf-2024-mceliece"
challenge_year: 2024
challenge_checker: true
permalink: "/challenges/google-ctf-2024/mceliece/"
---

{% assign event_challenge = site.data.authored_challenges.entries | where: 'id', page.challenge_id | first %}

<div data-challenge-archive="google-ctf-2024-mceliece" markdown="1">

<p>By {{ event_challenge.authors | join: ", " | escape }}.</p>

## Original description

> Mceliece cryptosystem was developed in 1978 and has resisted cryptanalysis so far.
> Lets make allies with better error correcting codes which may call ease on the sizes of keys.
>
> NOTE: The .sobj files were generated using Sage 10.4. It should be fine to use Sage 9.7 or onwards to parse the files.

Read this challenge as [plain text]({{ '/challenges/google-ctf-2024/mceliece/challenge.txt' | relative_url }}) or [JSON]({{ '/challenges/google-ctf-2024/mceliece/challenge.json' | relative_url }}).

## Files

<ul data-archive-files>
  <li><a href="{{ '/assets/challenges/google-ctf-2024-mceliece/chall.sage' | relative_url }}" data-file-kind="handout">chall.sage</a></li>
  <li><a href="{{ '/assets/challenges/google-ctf-2024-mceliece/flag_enc.sobj' | relative_url }}" data-file-kind="handout">flag_enc.sobj</a></li>
  <li><a href="{{ '/assets/challenges/google-ctf-2024-mceliece/params.sobj' | relative_url }}" data-file-kind="handout">params.sobj</a></li>
  <li><a href="{{ '/assets/challenges/google-ctf-2024-mceliece/pubkey.sobj' | relative_url }}" data-file-kind="handout">pubkey.sobj</a></li>
</ul>

## Download

```sh
mkdir -p google-ctf-2024-mceliece
cd google-ctf-2024-mceliece
curl --fail --location --output challenge.txt \
  "{{ '/challenges/google-ctf-2024/mceliece/challenge.txt' | absolute_url }}"
curl --fail --location --output challenge.json \
  "{{ '/challenges/google-ctf-2024/mceliece/challenge.json' | absolute_url }}"
curl --fail --location --output chall.sage \
  "{{ '/assets/challenges/google-ctf-2024-mceliece/chall.sage' | absolute_url }}"
curl --fail --location --output flag_enc.sobj \
  "{{ '/assets/challenges/google-ctf-2024-mceliece/flag_enc.sobj' | absolute_url }}"
curl --fail --location --output params.sobj \
  "{{ '/assets/challenges/google-ctf-2024-mceliece/params.sobj' | absolute_url }}"
curl --fail --location --output pubkey.sobj \
  "{{ '/assets/challenges/google-ctf-2024-mceliece/pubkey.sobj' | absolute_url }}"
```

## Check your flag

{% include challenge.html id=event_challenge.checker.id hash=event_challenge.checker.sha256 salt=event_challenge.checker.salt prefix=event_challenge.checker.prefix title=page.title %}

<details data-archive-spoilers>
<summary>Sources and solutions (spoilers)</summary>
{% include challenge-sources.html %}
</details>

[All challenges]({{ '/challenges/' | relative_url }}) · [CTF tutorials]({{ '/ctf-tutorials/' | relative_url }})

</div>
