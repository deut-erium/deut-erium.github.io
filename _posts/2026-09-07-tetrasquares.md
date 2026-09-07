---
title: "Tetrasquares: extending The New Tetris on N64"
description: "Building bigger squares from falling tetrominoes: the N64 mechanic I love, a structural scoring rule, and the jump from 4x4 to 6x6 and 8x8."
author: deuterium
tags: games tetris combinatorics programming
key: tetrasquares000001
excerpt_separator: <!--more-->
---

I love *The New Tetris* on the Nintendo 64 because it makes me greedy in a different way. I can see a perfectly reasonable line clear, but I can also see three quarters of a square. Suddenly I want to keep those pieces intact, wait for the missing shape, and finish the construction. Clearing the board can wait. Sometimes that is a terrible decision, but completing the square feels much better than taking the easy line.

<!--more-->

The mechanic is small enough to explain with four pieces. Arrange four T tetrominoes like this, and the game turns them into a gold square:

<figure>
  <img src="{{ '/assets/images/tetrasquares/t4-steps.svg' | relative_url }}" width="720" height="756" alt="Four stages of the T4 construction: numbered T pieces interlock to fill a 4 by 4 square." loading="eager" decoding="async">
  <figcaption>Four pieces, one square. The numbers show placement order; the colors throughout this post belong to my browser experiment, not the N64 game. <a href="{{ '/new-tetris/?practice=4&family=T4' | relative_url }}">Try this construction.</a></figcaption>
</figure>

I wanted a small browser version I could link from a post, with more room to experiment. I wanted the interlocking constructions to earn more than the simple ones, and I wanted to try larger targets: first 6x6, then 8x8.

The result is **Tetrasquares**, an independent falling-block experiment inspired by *The New Tetris*. [Play it here]({{ '/new-tetris/' | relative_url }}), or start with the [construction catalog]({{ '/new-tetris/src/catalog/' | relative_url }}). The game runs on its own page; reading this article does not load it.

## What the N64 game added

*The New Tetris* came out in 1999, developed by H2O Entertainment and Blue Planet Software and published by Nintendo. Alongside the familiar falling pieces, it had Hold, a three-piece preview, and Spin Moves that could break parts of the stack into individual cells. The feature I care about here is its [square-building rule](https://tetris.wiki/The_New_Tetris#Squares).

A square must contain four complete tetrominoes filling a 4x4 region. No holes, no pieces sticking out, and no fragments left over from earlier line clears. Four pieces of the same type form a gold **Mono-Square**. A mixture forms a silver **Multi-Square**; it does not have to use four different types.

The [original manual, page 11](https://archive.org/download/new-tetris-the-usa/New%20Tetris%2C%20The%20%28USA%29_text.pdf#page=13), describes five collected lines for each row cleared through a silver square, and ten for gold. That is the reward I remember chasing, compared with one collected line for an ordinary row.[^original-score]

Making the square itself pays nothing. You still have to clear rows through it to collect the reward. That delay is a large part of the appeal: first I build something worth preserving, then I have to get it off the board. A badly timed line clear can ruin a construction before it becomes a square.

Hold gives me some control over that plan, but the incoming pieces still matter. The [square-building guides](https://tetris.wiki/Square_Tetris) spend a lot of time on broad platforms and placement order, because a pretty final arrangement is only useful if I can actually assemble it from above.

## Small squares, different constructions

The easy gold squares are four O pieces or four I pieces. One is a larger square made from smaller squares; the other is four strips stacked together.

<figure>
  <img src="{{ '/assets/images/tetrasquares/easy-squares.svg' | relative_url }}" width="720" height="456" alt="O4 consists of four 2 by 2 O pieces. I4 consists of four horizontal I strips. Each has an uncomplicated rectangular decomposition." loading="lazy" decoding="async">
  <figcaption>Two straightforward gold constructions. Practice <a href="{{ '/new-tetris/?practice=4&family=O4' | relative_url }}">O4</a> or <a href="{{ '/new-tetris/?practice=4&family=I4' | relative_url }}">I4</a>.</figcaption>
</figure>

Silver squares give me more freedom. I can join two 2x4 rectangles, each made from two pieces. Or I can make a 3x4 rectangle from three pieces and complete it with an I strip. The second construction below uses two T pieces and an L for that three-piece region.

<figure>
  <img src="{{ '/assets/images/tetrasquares/rectangles.svg' | relative_url }}" width="720" height="456" alt="Two L pieces and two O pieces split into two 2 by 4 rectangles. An L and two T pieces make a 3 by 4 rectangle, completed by an I strip. Cyan lines mark the splits." loading="lazy" decoding="async">
  <figcaption>Small rectangles are useful building blocks. Try <a href="{{ '/new-tetris/?practice=4&family=L2-O2' | relative_url }}">the two pairs</a> or <a href="{{ '/new-tetris/?practice=4&family=I1-L1-T2' | relative_url }}">the rectangle with an I cap</a>.</figcaption>
</figure>

The T square at the start feels different. Its pieces interlock: I cannot draw a straight cut all the way across the square without cutting a piece. J and L pieces have some lovely arrangements too, including spirals and pairs that form rectangles. These two examples show why the arrangement matters even when every piece has the same type.

<figure>
  <img src="{{ '/assets/images/tetrasquares/gold-patterns.svg' | relative_url }}" width="720" height="456" alt="A spiral of four J pieces has no clean straight split. The pictured four-L arrangement consists of two separable pairs, with a horizontal clean split." loading="lazy" decoding="async">
  <figcaption>A <a href="{{ '/new-tetris/?practice=4&family=J4' | relative_url }}">J spiral</a> and <a href="{{ '/new-tetris/?practice=4&family=L4' | relative_url }}">paired L pieces</a>. These are different arrangements, not a reflected pair. L pieces can form a spiral too.</figcaption>
</figure>

Another favorite is the silver square made from two Z pieces and two L pieces. Its reflected composition uses two S pieces and two J pieces. The two slanted pieces fit between the hooks, and the whole thing has half-turn symmetry.

<figure>
  <img src="{{ '/assets/images/tetrasquares/mixed-interlocks.svg' | relative_url }}" width="720" height="456" alt="Two L and two Z pieces interlock into one silver square. The reflected piece mix uses two J and two S pieces. Both pictured constructions have half-turn symmetry." loading="lazy" decoding="async">
  <figcaption>The <a href="{{ '/new-tetris/?practice=4&family=L2-Z2' | relative_url }}">Z/L interlock</a> and the <a href="{{ '/new-tetris/?practice=4&family=J2-S2' | relative_url }}">S/J interlock</a>. Their displayed values are Tetrasquares points, explained below.</figcaption>
</figure>

Once I started looking at these as constructions, gold versus silver felt too coarse. Keeping four identical pieces available is a useful challenge, but it does not distinguish four O pieces from an interlocking T square. I wanted the latter to earn something extra.

## Rewarding the interlock

Tetrasquares uses points rather than the original game's collected-line score. I kept the delayed reward: a completed square gets a pending value, and clearing its rows pays that value out.

For a 4x4 square, the rule is:

| Part of the award | Points |
| --- | ---: |
| Base value | 1,000 |
| Gold: all pieces have the same type | +1,500 |
| Each distinct piece type after the first | +250 |
| No clean horizontal or vertical split | +1,000 |

A **clean split** runs between rows or columns, all the way across the region, without passing through a tetromino. Four O pieces have clean splits. Four interlocking T pieces do not.

<figure>
  <img src="{{ '/assets/images/tetrasquares/clean-splits.svg' | relative_url }}" width="720" height="456" alt="Cyan cuts separate O4 without crossing a piece. A red sample cut through T4 crosses pieces, and no clean full cut exists. O4 carries 2500 pending points; T4 carries 3500." loading="lazy" decoding="async">
  <figcaption>Both are gold and use one type, so the 1,000-point difference comes entirely from the structural bonus.</figcaption>
</figure>

The same comparison works for silver. Two L pieces and two O pieces are worth 1,250. Two L pieces and two Z pieces are worth 2,250. Both use two types; the interlock earns the extra 1,000.

This is a deliberately simple preference, not a measurement of how difficult a player will find a construction. It does not count required rotations, estimate the probability of getting the right queue, or award points for rarity in the catalog. An awkwardly placed simple square can still be much harder to finish than an interlock on a good platform.

Gold also retains a substantial bonus. The ordinary O4 square at 2,500 still beats the mixed Z/L interlock at 2,250. I have added another consideration to the original material distinction, rather than making structure override everything else.

The pending value is split across the square's rows. O4 carries 2,500 points, so each of its four rows carries 625. Clear one of those rows and collect that share, alongside the ordinary line award. Clear all four eventually and collect the full square value. The [scoring guide]({{ '/new-tetris/src/scoring/' | relative_url }}) covers the other awards and how larger squares preserve uncollected shares from smaller ones inside them.

## Nine pieces instead of four

A 6x6 square takes nine tetrominoes. There is enough room to combine familiar subassemblies, or make an interlock that involves the entire region. I extended the same scoring idea, but a single yes-or-no split test felt too crude at this size.

For 6x6, the base value is 2,500, gold adds 3,500, and each distinct type after the first adds 500. The structural bonus depends on what remains after recursively making clean cuts.

I try the legal cuts, repeat inside the smaller rectangles, and choose the decomposition with the smallest possible largest unsplittable group. If the whole square stays together, I look for the full cut that crosses the fewest pieces.

| Structure left after the best decomposition | Shape bonus |
| --- | ---: |
| Largest group contains 1 or 2 pieces | 0 |
| Largest group contains 3 or 4 pieces | 500 |
| Largest group contains 5 or 6 pieces | 1,000 |
| All 9 stay together; some full cut crosses just 1 piece | 1,500 |
| All 9 stay together; every full cut crosses at least 2 pieces | 2,500 |

<figure>
  <img src="{{ '/assets/images/tetrasquares/six-cuts.svg' | relative_url }}" width="720" height="456" alt="The left 6 by 6 square separates into five O pieces and a four-T interlock, giving a 500-point shape bonus. The right uses five L and four T pieces; even its best full cut crosses two pieces, giving a 2500-point bonus." loading="lazy" decoding="async">
  <figcaption>Compare <a href="{{ '/new-tetris/?practice=6&family=O5-T4' | relative_url }}">a T4 core surrounded by O pieces</a> with <a href="{{ '/new-tetris/?practice=6&family=L5-T4' | relative_url }}">the nine-piece L/T interlock</a>. Cyan cuts separate pieces; the red cut crosses them.</figcaption>
</figure>

There are no groups of seven or eight in this table. Each piece has area four, so such a rectangular group would need area 28 or 32. Neither area has an integer-sided rectangle that fits inside 6x6.

Type variety and interlocking are separate rewards. This seven-type example earns 7,000, while the six-type example beside it earns 7,500 because it gets the larger shape bonus. Both beat nine O pieces, whose gold square is worth 6,000.

<figure>
  <img src="{{ '/assets/images/tetrasquares/six-mixes.svg' | relative_url }}" width="720" height="456" alt="A 6 by 6 construction using all seven types is worth 7000 pending points. A different construction using six types has a stronger interlock and is worth 7500." loading="lazy" decoding="async">
  <figcaption>Try <a href="{{ '/new-tetris/?practice=6&family=I1-J1-L1-O1-S1-T2-Z2' | relative_url }}">all seven types</a> or <a href="{{ '/new-tetris/?practice=6&family=J1-L1-O1-S1-T2-Z3' | relative_url }}">the six-type interlock</a>. Each picture shows one specific arrangement, not a fixed price for every arrangement of that piece mix.</figcaption>
</figure>

Scaling up also changes what is possible. Nine T pieces cannot tile a 6x6 square at all. Color the board like a checkerboard: it has 18 cells of each color. Every T covers three cells of one color and one of the other, an imbalance of plus or minus two. An odd number of those imbalances cannot cancel. The T4 pattern does not have a T9 counterpart.

## A catalog of possibilities

The number of geometric tilings grows quickly. These totals appear in a [tiling poster by Steve Butler, Jason Ekstrand, and Steven Osborne](https://oeis.org/A230031/a230031.pdf), and match the sums in the catalog:

| Square | Pieces | Geometric tilings | Piece mixes in the catalog |
| --- | ---: | ---: | ---: |
| 4x4 | 4 | 117 | 24 |
| 6x6 | 9 | 178,939 | 1,467 |
| 8x8 | 16 | 19,077,209,438 | 30,434 |

A piece mix records how many of each type I use. For example, L2-Z2 means two L pieces and two Z pieces. The same mix can have several arrangements, and those arrangements can have different structural scores. The totals count placements on a fixed board, including rotated or reflected arrangements when those produce different tilings; they are not counts with every symmetry identified.

The [catalog]({{ '/new-tetris/src/catalog/' | relative_url }}) groups the results by piece mix. For every 4x4 and 6x6 mix it shows one illustrated construction, its piece order, and the value of that particular arrangement. Those 1,491 example orders are checked against the browser game's movement model. That is a much smaller claim than proving every geometric tiling can be built with falling pieces, let alone with a particular random queue.

Each illustrated entry has a **Practice this construction** link. Practice supplies the pictured sequence without gravity or a timer. A wrong drop leaves the board unchanged; an optional outline shows the next placement. It ends when the construction is complete, before the row-clearing part of the game, and does not contribute to daily results.

I like this as the link between looking at a diagram and understanding it. A square can look obvious once every piece is already in place. Trying to put the next one there makes the order much more concrete.

## Sixteen pieces is probably enough

An 8x8 square needs sixteen tetrominoes. The playing well is still ten columns wide, so a centered construction leaves just one column on either side. This is where my desire to keep a square intact starts competing with almost everything else I might want to do on the board.

<figure>
  <img src="{{ '/assets/images/tetrasquares/eight-square.svg' | relative_url }}" width="480" height="546" alt="Sixteen numbered T pieces form an 8 by 8 gold square from four T4 quadrants. The new square carries 20000 pending points." loading="lazy" decoding="async">
  <figcaption>Four T4 constructions form one T16 square. This illustration's order was checked with the game's movement and locking methods using a supplied T-only sequence. It is not an 8x8 practice entry.</figcaption>
</figure>

At this size I use a fixed value: 10,000 for silver and 20,000 for gold, collected across eight rows. There is no extra diversity or interlock bonus for 8x8. The picture above shows the new square's award; earlier uncollected awards from its smaller squares remain separate.

The [8x8 catalog]({{ '/new-tetris/src/catalog/?size=8&family=T16' | relative_url }}) lists piece mixes and their geometric arrangement counts. It does not contain nineteen billion diagrams, or illustrated placement orders, and it does not offer practice mode. That is where I have stopped the catalog for now.

[Tetrasquares is playable here]({{ '/new-tetris/' | relative_url }}). If the full game feels like a lot to start with, [build the four-T square first]({{ '/new-tetris/?practice=4&family=T4' | relative_url }}). That is still the little construction that makes me want to ignore an easy line clear.

[^original-score]: The manual describes five and ten *collected* lines per square row. [TetrisWiki](https://tetris.wiki/The_New_Tetris#Scoring) and [Hard Drop](https://harddrop.com/wiki/The_New_Tetris#Scoring) instead describe additive square bonuses, giving 25 and 45 for four-row clears through silver and gold squares. I have used the manual's wording here, not tried to reconcile those accounts into an exact runtime formula. Tetrasquares has its own point system, described above.
