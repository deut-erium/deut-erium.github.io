---
title: "Crypto challenge - Injection"
sha256hash: 
  - 23a3a8d369653ce0f4924c3864bdda359fbb3d2b5e21ccb4c9fe9eeabbea2669
tags: challenges injection zh3r0_ctf2 crypto
aside:
  toc: true
sidebar:
  nav: aboutnav
excerpt_separator: <!--more-->
author: deuterium
key: assignment000003
---

Bijections are fun to look at and amusing especially to cryptographers, can
you spot out one here?
<!--more-->



```python
from secret import flag

def nk2n(nk):
    l = len(nk)
    if l==1:
        return nk[0]
    elif l==2:
        i,j = nk
        return ((i+j)*(i+j+1))//2 +j
    return nk2n([nk2n(nk[:l-l//2]), nk2n(nk[l-l//2:])])

print(nk2n(flag))

# output
# 1066464516621568650416778516260128065562999836454777449496486613730252783905\
# 58656231590803591166516524516182041583860744711996793449978222571578932566\ 
# 51539240517205572748689616288529831032342817805470118893063573639935906790\ 
# 19094216260987077393364474718427466510193852
```

{% assign index = 0 %}
{% include checkflag.html %}



