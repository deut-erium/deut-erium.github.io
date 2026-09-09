---
layout: "article"
title: "IDEA"
description: "Google CTF 2024 - Cryptography."
date: "2024-06-21T18:00:00+00:00"
section: "tutorials"
tags: ["challenges", "crypto"]
challenge_id: "google-ctf-2024-idea"
challenge_year: 2024
challenge_checker: false
permalink: "/challenges/google-ctf-2024/idea/"
---

{% assign event_challenge = site.data.authored_challenges.entries | where: 'id', page.challenge_id | first %}

<div data-challenge-archive="google-ctf-2024-idea" markdown="1">

<p>By {{ event_challenge.authors | join: ", " | escape }}.</p>

## Original description

> We have a new idea about a cipher which we think may provide pretty good privacy
> So bruce for impact as we may patent our new proposed encryption standard

## Files

The original challenge used an interactive service. No live server is connected to this post.

<ul data-archive-files>
  <li><a href="https://raw.githubusercontent.com/google/google-ctf/067421eb7e918c29e39f187fac5a0f0d72a6ab83/2024/quals/crypto-idea/attachments/chall.py" data-file-kind="handout">chall.py</a></li>
</ul>

Originally a service challenge. Recreating the service requires the organizer source; no live instance is provided here.

## Download

```sh
mkdir -p google-ctf-2024-idea
cd google-ctf-2024-idea
curl --fail --location --output chall.py \
  "https://raw.githubusercontent.com/google/google-ctf/067421eb7e918c29e39f187fac5a0f0d72a6ab83/2024/quals/crypto-idea/attachments/chall.py"
```

<details data-archive-spoilers>
<summary>Sources and solutions (spoilers)</summary>
{% include challenge-sources.html %}
</details>

[All challenges]({{ '/challenges/' | relative_url }}) · [CTF tutorials]({{ '/ctf-tutorials/' | relative_url }})

</div>
