---
layout: "article"
title: "McEliece"
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

## Files

<ul data-archive-files>
  <li><a href="https://raw.githubusercontent.com/google/google-ctf/067421eb7e918c29e39f187fac5a0f0d72a6ab83/2024/quals/crypto-mceliece/attachments/chall.sage" data-file-kind="handout">chall.sage</a></li>
  <li><a href="https://raw.githubusercontent.com/google/google-ctf/067421eb7e918c29e39f187fac5a0f0d72a6ab83/2024/quals/crypto-mceliece/attachments/flag_enc.sobj" data-file-kind="handout">flag_enc.sobj</a></li>
  <li><a href="https://raw.githubusercontent.com/google/google-ctf/067421eb7e918c29e39f187fac5a0f0d72a6ab83/2024/quals/crypto-mceliece/attachments/params.sobj" data-file-kind="handout">params.sobj</a></li>
  <li><a href="https://raw.githubusercontent.com/google/google-ctf/067421eb7e918c29e39f187fac5a0f0d72a6ab83/2024/quals/crypto-mceliece/attachments/pubkey.sobj" data-file-kind="handout">pubkey.sobj</a></li>
</ul>

## Download

```sh
mkdir -p google-ctf-2024-mceliece
cd google-ctf-2024-mceliece
curl --fail --location --output chall.sage \
  "https://raw.githubusercontent.com/google/google-ctf/067421eb7e918c29e39f187fac5a0f0d72a6ab83/2024/quals/crypto-mceliece/attachments/chall.sage"
curl --fail --location --output flag_enc.sobj \
  "https://raw.githubusercontent.com/google/google-ctf/067421eb7e918c29e39f187fac5a0f0d72a6ab83/2024/quals/crypto-mceliece/attachments/flag_enc.sobj"
curl --fail --location --output params.sobj \
  "https://raw.githubusercontent.com/google/google-ctf/067421eb7e918c29e39f187fac5a0f0d72a6ab83/2024/quals/crypto-mceliece/attachments/params.sobj"
curl --fail --location --output pubkey.sobj \
  "https://raw.githubusercontent.com/google/google-ctf/067421eb7e918c29e39f187fac5a0f0d72a6ab83/2024/quals/crypto-mceliece/attachments/pubkey.sobj"
```

## Check your flag

{% include challenge.html id=event_challenge.checker.id hash=event_challenge.checker.sha256 salt=event_challenge.checker.salt prefix=event_challenge.checker.prefix title=page.title %}

<details data-archive-spoilers>
<summary>Sources and solutions (spoilers)</summary>
{% include challenge-sources.html %}
</details>

[All challenges]({{ '/challenges/' | relative_url }}) · [CTF tutorials]({{ '/ctf-tutorials/' | relative_url }})

</div>
