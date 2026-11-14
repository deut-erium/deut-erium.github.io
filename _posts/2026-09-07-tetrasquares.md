---
title: "Tetrasquares: Extending N64's Tetris"
description: "A hopefully snappy, in-browser extension of the square mechanic in N64's The New Tetris to 6x6 and 8x8 blocks, with extended scoring rules."
author: deuterium
tags: games tetris combinatorics programming
key: tetrasquares000001
stylesheets:
  - /assets/css/tetrasquares-article.css
excerpt_separator: <!--more-->
widgets:
  - tetrasquares-o4
---




> PS: If you don't care, you can directly [jump to the game](https://deut-erium.github.io/tetrasquares/) and figure out the differences yourself, but it will take some time

Do you love Tetris? Or are you one of those who never got the hype about the [#1 best selling game EVER](https://en.wikipedia.org/wiki/List_of_best-selling_video_games). Yes, more than Minecraft, and more than twice as many copies as GTA 5, and I am pretty sure it will beat GTA 6 as well or any other game.

How could anyone enjoy this boring sequence of blocks? It's just meh. That's what I used to think but believe me, you just need to play it enough to experience what exactly the fuss is. It [alters your brain](https://en.wikipedia.org/wiki/List_of_best-selling_video_games) and I guess this is the ONLY game where I felt that ever, and I have done my fair share of wasting time playing games.

You dream about playing the game, and yes I have dreamt about many other games where I keep on thinking about some strategy or just living that game again as an extended part of my dreams but with Tetris Effect, you get the superpower to experience playing the game as soon as you close your eyes. There is no better way to describe this than to actually experience it. Just bear with it and play it enough and you will understand I swear.

# The New Tetris

I think the part of the dislike is due to the fact that there are soooo many versions, each shitty in its own way. For example the official [tetris.com](https://play.tetris.com) takes an awful lot of time just to load for such a simple game to implement (honestly any dumb clanker can do it in one shot, even the small 4B param ones on your laptop), and if you don't have an adblocker for some reason you will be bombarded with ads like there's no tomorrow.

And even if someone tries to create their own Tetris, these guys are daddy of Disney in this regard and sue them to oblivion. Come on guys, grow up you have had enough of your share of the pie please let everyone breathe and enjoy now.

Nevertheless I love [The New Tetris](https://en.wikipedia.org/wiki/The_New_Tetris) from the N64 the most as it forces you to think in new ways to satisfy your urge to fit the blocks together and gets you to actually feel the frustration of the pace because [you know the pieces fit](https://genius.com/Tool-schism-lyrics) but can't move there just in time. PS you will understand more as you read this blog 

But the very first frustration you hit is that there are no good emulators for N64 games somehow to play your legally owned ROMs of the game *sigh*. Try any of them, and you will know right away that they don't feel performant at all and lag. No matter what hardware you throw at them they will refuse to show you a constant framerate, I think it was something to do with weirdness of its architecture and graphics not mapping neatly into modern GPUs, but again I never really looked into it. 

# Gold and silver squares

Anyways let me just describe what I really love about this game. So for the usual versions of Tetris, you get points by breaking more and more lines at once, breaking 3 lines at once is better than breaking 2 lines which is in turn better than breaking a single line and if you manage to break 4 lines at once, which you can only do by inserting an "I" or straight 4x1 block into an appropriately shaped crevice.

But the N64 version doesn't care, you get one point for each line clear (okay breaking 4 lines together gives you 5 instead of 1, but whatever I don't think it's really worth all that extra effort for a 25% gain).

So instead of incentivizing breaking multiple lines, it incentivizes you to form 4x4 squares. One very simple way to do that is to stack 4 "O" pieces i.e 2x2 blocks one over another to form a 4x4 piece really. 

<figure id="o4-animation" class="tetrasquares-figure tetrasquares-o4" data-o4-animation>
  <div class="tetrasquares-gallery">
    <div class="tetrasquares-card square-6">
      <span class="tetrasquares-label">O4</span>
      <svg class="tetrasquares-o4-board" xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192" role="img" aria-labelledby="o4-title o4-desc">
        <title id="o4-title">Four O pieces form a gold square</title>
        <desc id="o4-desc">Four 2x2 O pieces fall one at a time, filling a 4x4 square that turns into one solid golden block.</desc>
        <defs>
          <clipPath id="o4-well"><rect width="192" height="192" /></clipPath>
          <symbol id="o4-piece" viewBox="0 0 64 64">
            <rect x="2" y="2" width="60" height="60" fill="#b9c0ca" stroke="#111" stroke-width="4" />
            <path d="M32 4V60M4 32H60" fill="none" stroke="#757d8b" stroke-width="2" />
            <path d="M5 59V5H59" fill="none" stroke="#e7ecf3" stroke-width="2" />
          </symbol>
          <linearGradient id="o4-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#fff0a1" />
            <stop offset="0.5" stop-color="#ffd447" />
            <stop offset="1" stop-color="#d59416" />
          </linearGradient>
        </defs>
        <g clip-path="url(#o4-well)">
          <rect width="192" height="192" fill="#123d73" />
          <path d="M32 0V192M64 0V192M96 0V192M128 0V192M160 0V192M0 32H192M0 64H192M0 96H192M0 128H192M0 160H192" fill="none" stroke="#5d8ec2" stroke-width="1" />
          <rect x="34" y="66" width="124" height="124" fill="none" stroke="#9dc5ec" stroke-dasharray="4 4" />
          <g transform="translate(32 128)"><g data-o4-piece data-drop="192"><use href="#o4-piece" width="64" height="64" /></g></g>
          <g transform="translate(96 128)"><g data-o4-piece data-drop="192"><use href="#o4-piece" width="64" height="64" /></g></g>
          <g transform="translate(32 64)"><g data-o4-piece data-drop="128"><use href="#o4-piece" width="64" height="64" /></g></g>
          <g transform="translate(96 64)"><g data-o4-piece data-drop="128"><use href="#o4-piece" width="64" height="64" /></g></g>
          <g data-o4-gold>
            <rect x="34" y="66" width="124" height="124" fill="url(#o4-gold)" stroke="#111" stroke-width="4" />
            <path d="M39 184V71H152" fill="none" stroke="#fff3b5" stroke-width="4" />
            <path d="M153 72V185H40" fill="none" stroke="#b67d13" stroke-width="4" />
          </g>
        </g>
      </svg>
    </div>
  </div>
  <button type="button" class="tetrasquares-o4-replay" data-o4-replay hidden>Play animation</button>
</figure>

And as soon as you do that a short animation plays transforming this block into a solid block. And since this particular arrangement was homogenous, i.e all the individual blocks were of the same type, the game rewards you and calls it a "golden" block. So as soon as you have a golden block and you break a line containing a part of the golden cube, it is now worth 10 lines!

And if it were a heterogeneous 4x4 block i.e using more than one type of block, it transforms into a silver block which rewards 5 lines per line. 

<figure class="tetrasquares-figure">
  <div class="tetrasquares-gallery">
    <div class="tetrasquares-card square-4">
      <span class="tetrasquares-label">L2-O2</span>
      <img src="{{ '/assets/images/tetrasquares/l2-o2-cut.svg' | relative_url }}" width="128" height="128" alt="A cyan horizontal seam divides two 2x4 rectangles, one made from two Ls and the other from two Os." loading="lazy" decoding="async">

    </div>
  </div>
</figure> 

Trust me [The instruction booklet](https://dn710401.ca.archive.org/0/items/new-tetris-the-usa/New%20Tetris%2C%20The%20%28USA%29_text.pdf) describes it better than I can.

# Building 4x4 squares

There are a number of interesting ways these 4x4 squares can be built btw. I hand-drew all of them concisely here. Hehe this looks like a cool robot

<figure class="tetrasquares-figure">
  <img src="{{ '/assets/images/tetrasquares/hand-drawn-arrangements.png' | relative_url }}" width="622" height="1214" alt="Hand-drawn tetrominoes and 4x4 square arrangements, laid out like a robot." loading="lazy" decoding="async">
</figure>

But you can otherwise explore all of the ways this can be done in [the 4x4 catalog](https://deut-erium.github.io/tetrasquares/catalog/?size=4&family=T4)

Oh no I think I bored the kids with all this text, they might be feeling an urge to watch a YouTube video. So I think they can watch this 

<div class="tetrasquares-video">
  <iframe src="https://www.youtube-nocookie.com/embed/VkrBrwnEEPA" title="Tetris video 1" width="560" height="315" referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe>
</div>

And now you would be wondering, will we call it "Tetris" anymore if the incentive structure itself forces and pushes towards kinds of tactics and gameplay which don't feel like Tetris anymore? It's amazing that the rules are essentially the same but the reward function is totally altered. Look at this and you will see it right away and it will break your brain in good ways.

<div class="tetrasquares-video">
  <iframe src="https://www.youtube-nocookie.com/embed/lKYD9H0IwB0" title="Tetris video 2" width="560" height="315" referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe>
</div>

# Beyond 4x4

And now if we can hold two blocks of 4x4 per row, what's actually stopping us from forming 6x6 squares or even 8x8 squares. 10x10 is not possible for obvious reasons (Would you like a formally verified TM lean proof for this?).

I believe nerds like me would have wanted to create that extended version back when they were making the original game but the hardware limitations more than 25 years ago were strikingly different to allow those and they might have just settled with the 4x4 versions. 

# Interlocking pieces

Even in the 4x4, I feel there is an asymmetry even if we account for the rarity of getting 4 of the same pieces. For example fitting 4 Os is much easier than fitting 4 Ts, so here is what I propose: if we can find a clean cut in our arrangement separating it into rectangles, it should be relatively easier to visualize hence fit. 

<figure class="tetrasquares-figure">
  <div class="tetrasquares-gallery">
    <div class="tetrasquares-card square-4">
      <span class="tetrasquares-label">Clean cuts</span>
      <img src="{{ '/assets/images/tetrasquares/o4-cuts.svg' | relative_url }}" width="128" height="128" alt="Cyan vertical and horizontal cuts run between the four O pieces." loading="lazy" decoding="async">
      <span class="tetrasquares-value">2,500 pending</span>
    </div>
    <div class="tetrasquares-card square-4">
      <span class="tetrasquares-label">No clean cut</span>
      <img src="{{ '/assets/images/tetrasquares/t4-cut.svg' | relative_url }}" width="128" height="128" alt="A red vertical cut crosses the T pieces; every full straight cut crosses at least one piece." loading="lazy" decoding="async">
      <span class="tetrasquares-value">3,500 pending</span>
    </div>
  </div>
</figure>


## 6x6 and 8x8 squares

We can easily extend this idea to 6x6 and 8x8 classes. 

<figure class="tetrasquares-figure">
  <div class="tetrasquares-gallery">
    <div class="tetrasquares-card square-6">
      <span class="tetrasquares-label">O5-T4</span>
      <img src="{{ '/assets/images/tetrasquares/o5-t4-cuts.svg' | relative_url }}" width="192" height="192" alt="Recursive cyan cuts separate five O pieces from a four-T interlock." loading="lazy" decoding="async">
      <span class="tetrasquares-value">Shape bonus: 500</span>
    </div>
    <div class="tetrasquares-card square-6">
      <span class="tetrasquares-label">L5-T4</span>
      <img src="{{ '/assets/images/tetrasquares/l5-t4-cut.svg' | relative_url }}" width="192" height="192" alt="Nine interlocked L and T pieces. The red cut crosses two pieces, the minimum for any full cut." loading="lazy" decoding="async">
      <span class="tetrasquares-value">Shape bonus: 2,500</span>
    </div>
  </div>
</figure>

<figure class="tetrasquares-figure">
  <div class="tetrasquares-gallery">
    <div class="tetrasquares-card square-8">
      <span class="tetrasquares-label">T16 / 8x8</span>
      <img src="{{ '/assets/images/tetrasquares/t16.svg' | relative_url }}" width="256" height="256" alt="Sixteen numbered T pieces form an 8x8 gold square from four T4 quadrants." loading="lazy" decoding="async">
      <span class="tetrasquares-value">20,000 pending</span>
    </div>
  </div>
</figure>

I tried so hard to draw the 6x6 and 8x8 arrangements concisely but I think I won't be able to manage it here in a way which won't bore you so if you have some fraction of curiosity left, you can explore the [6x6 catalog](https://deut-erium.github.io/tetrasquares/catalog/?size=6&family=O9) or the really insane [8x8 catalog](https://deut-erium.github.io/tetrasquares/catalog/?size=8&family=T8-Z8)

I hope this [scoring guide](https://deut-erium.github.io/tetrasquares/scoring/) describes everything well and hope someone grinding new ways or algorithms to fit the falling blocks and urges you to.


# [Play the game](https://deut-erium.github.io/tetrasquares/)

Here are some [strats for 4x4](https://harddrop.com/wiki/Square_Platforming) which you should be able to extend beyond or just write another [beautiful paper](https://oeis.org/A230031/a230031.pdf) for what it is worth.



