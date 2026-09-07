---
title: "Tetrasquares: extending The New Tetris on N64"
description: "I like building squares more than clearing lines. A browser experiment with the N64 game's square mechanic, interlock bonuses, and 6x6 and 8x8 targets."
author: deuterium
tags: games tetris combinatorics programming
key: tetrasquares000001
stylesheets:
  - /assets/css/tetrasquares-article.css
excerpt_separator: <!--more-->
---

I keep passing up perfectly good line clears in *The New Tetris* because I want to finish a square. The [N64 game](#ref-game) rewards you for packing four whole tetrominoes into a 4x4 region. With three pieces already lined up, I'm much more interested in finding the fourth than clearing the board.

<!--more-->

Four pieces of the same shape turn gold; a mixture turns silver. Four T pieces can make this:

<figure class="tetrasquares-figure">
  <div class="tetrasquares-gallery tetrasquares-steps">
    <div class="tetrasquares-card square-4">
      <span class="tetrasquares-label">1 of 4</span>
      <img src="{{ '/assets/images/tetrasquares/t4-step-1.svg' | relative_url }}" width="128" height="128" alt="T4 after placement 1: 1 whole T pieces in the target square." loading="eager" decoding="async">

    </div>
    <div class="tetrasquares-card square-4">
      <span class="tetrasquares-label">2 of 4</span>
      <img src="{{ '/assets/images/tetrasquares/t4-step-2.svg' | relative_url }}" width="128" height="128" alt="T4 after placement 2: 2 whole T pieces in the target square." loading="eager" decoding="async">

    </div>
    <div class="tetrasquares-card square-4">
      <span class="tetrasquares-label">3 of 4</span>
      <img src="{{ '/assets/images/tetrasquares/t4-step-3.svg' | relative_url }}" width="128" height="128" alt="T4 after placement 3: 3 whole T pieces in the target square." loading="eager" decoding="async">

    </div>
    <div class="tetrasquares-card square-4">
      <span class="tetrasquares-label">4 of 4</span>
      <img src="{{ '/assets/images/tetrasquares/t4.svg' | relative_url }}" width="128" height="128" alt="T4 after placement 4: 4 whole T pieces in the target square." loading="eager" decoding="async">

    </div>
  </div>
  <figcaption>T4 in the browser game's colors. Each number identifies one piece and its placement order. <a href="{{ '/new-tetris/?practice=4&family=T4' | relative_url }}">Build this one.</a></figcaption>
</figure>

I wanted more of that, so I made [Tetrasquares]({{ '/new-tetris/' | relative_url }}), a browser game with 6x6 and 8x8 squares as well. I also changed the scoring to give interlocking arrangements some extra points. Four O pieces and four interlocking Ts both make gold, but I like the T square enough to pay it more.

## The bit I borrowed from the N64 game

*The New Tetris* came out in 1999. Its [manual](#ref-manual) calls the gold and silver constructions Mono-Squares and Multi-Squares. Silver can contain repeated shapes: two Ls and two Os work, for example. All four pieces must be intact, with no holes or bits sticking outside the square. You can't build one out of leftovers from earlier line clears.

You collect the reward by clearing rows through the finished square. The manual gives five collected lines per silver-square row and ten per gold-square row, compared with one for an ordinary row. The wiki's arithmetic differs; I've left a note with the [references](#references) rather than mixing those numbers into my scoring rules.

That delay is part of what I enjoy. Before the square forms, a line clear can ruin it. After it forms, I want to clear through it. Hold helps with keeping a useful piece around, but I still have to leave somewhere for the rest of the queue to go. The [square-building guides](#ref-squares) have a lot to say about platforms for exactly this reason.

## Four pieces fit together in quite a few ways

O4 and I4 are the easy gold squares: four little squares, or four strips.

<figure class="tetrasquares-figure">
  <div class="tetrasquares-gallery">
    <div class="tetrasquares-card square-4">
      <span class="tetrasquares-label">O4</span>
      <img src="{{ '/assets/images/tetrasquares/o4.svg' | relative_url }}" width="128" height="128" alt="Four numbered O pieces fill a 4x4 square." loading="lazy" decoding="async">

    </div>
    <div class="tetrasquares-card square-4">
      <span class="tetrasquares-label">I4</span>
      <img src="{{ '/assets/images/tetrasquares/i4.svg' | relative_url }}" width="128" height="128" alt="Four numbered horizontal I pieces fill a 4x4 square." loading="lazy" decoding="async">

    </div>
  </div>
  <figcaption>Practice <a href="{{ '/new-tetris/?practice=4&family=O4' | relative_url }}">four Os</a> or <a href="{{ '/new-tetris/?practice=4&family=I4' | relative_url }}">four Is</a>.</figcaption>
</figure>

For silver, I can join two 2x4 rectangles made from two pieces each. Another option is a three-piece 3x4 assembly with an I across the top. These are handy recipes because I can work on a smaller rectangle while waiting for the piece that finishes it.

<figure class="tetrasquares-figure">
  <div class="tetrasquares-gallery">
    <div class="tetrasquares-card square-4">
      <span class="tetrasquares-label">L2-O2</span>
      <img src="{{ '/assets/images/tetrasquares/l2-o2-cut.svg' | relative_url }}" width="128" height="128" alt="A cyan horizontal seam divides two 2x4 rectangles, one made from two Ls and the other from two Os." loading="lazy" decoding="async">

    </div>
    <div class="tetrasquares-card square-4">
      <span class="tetrasquares-label">I1-L1-T2</span>
      <img src="{{ '/assets/images/tetrasquares/i1-l1-t2-cut.svg' | relative_url }}" width="128" height="128" alt="Two Ts and one L form a 3x4 assembly below an I strip. A cyan seam runs under the I." loading="lazy" decoding="async">

    </div>
  </div>
  <figcaption><a href="{{ '/new-tetris/?practice=4&family=L2-O2' | relative_url }}">Two pairs</a>, or <a href="{{ '/new-tetris/?practice=4&family=I1-L1-T2' | relative_url }}">three pieces with an I cap</a>. Cyan marks the seams.</figcaption>
</figure>

The T square has no such seam. Any straight cut across the whole square goes through at least one piece. J pieces can make a spiral too; the L arrangement below uses two separable pairs instead. Ls can also spiral, but this particular catalog example doesn't.

<figure class="tetrasquares-figure">
  <div class="tetrasquares-gallery">
    <div class="tetrasquares-card square-4">
      <span class="tetrasquares-label">J4 spiral</span>
      <img src="{{ '/assets/images/tetrasquares/j4.svg' | relative_url }}" width="128" height="128" alt="Four J pieces interlock into a 4x4 square." loading="lazy" decoding="async">

    </div>
    <div class="tetrasquares-card square-4">
      <span class="tetrasquares-label">L4 pairs</span>
      <img src="{{ '/assets/images/tetrasquares/l4-cut.svg' | relative_url }}" width="128" height="128" alt="Four L pieces form two rectangles separated by a cyan horizontal seam." loading="lazy" decoding="async">

    </div>
  </div>
  <figcaption><a href="{{ '/new-tetris/?practice=4&family=J4' | relative_url }}">Spiral Js</a> and <a href="{{ '/new-tetris/?practice=4&family=L4' | relative_url }}">paired Ls</a>. These are different arrangements, not mirror images.</figcaption>
</figure>

I also like the two-L, two-Z square. Reflecting its piece mix gives two Js and two Ss. The slanted pieces fit between the hooks, and both of these arrangements have half-turn symmetry.

<figure class="tetrasquares-figure">
  <div class="tetrasquares-gallery">
    <div class="tetrasquares-card square-4">
      <span class="tetrasquares-label">L2-Z2</span>
      <img src="{{ '/assets/images/tetrasquares/l2-z2.svg' | relative_url }}" width="128" height="128" alt="Two L pieces and two Z pieces interlock in a half-turn-symmetric square." loading="lazy" decoding="async">

    </div>
    <div class="tetrasquares-card square-4">
      <span class="tetrasquares-label">J2-S2</span>
      <img src="{{ '/assets/images/tetrasquares/j2-s2.svg' | relative_url }}" width="128" height="128" alt="Two J pieces and two S pieces interlock in a half-turn-symmetric square." loading="lazy" decoding="async">

    </div>
  </div>
  <figcaption>Practice the <a href="{{ '/new-tetris/?practice=4&family=L2-Z2' | relative_url }}">L/Z</a> or <a href="{{ '/new-tetris/?practice=4&family=J2-S2' | relative_url }}">J/S</a> interlock.</figcaption>
</figure>

## Paying extra for an interlock

I kept the gold bonus and added a test for a *clean cut*: a horizontal or vertical line that crosses the whole region without cutting a piece. O4 has clean cuts in both directions. T4 has none.

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
  <figcaption>Both use one shape and form gold. T4 gets another 1,000 points for the interlock.</figcaption>
</figure>

For a 4x4 square, I add up:

| Award | Points |
| --- | ---: |
| Base | 1,000 |
| Gold | +1,500 |
| Each distinct shape after the first | +250 |
| No clean cut | +1,000 |
{: tabindex="0" aria-label="4x4 square awards"}

That makes O4 worth 2,500 and T4 worth 3,500. The silver comparison works the same way: L2-O2 gets 1,250, while L2-Z2 gets 2,250. The extra thousand buys the interlock in each case. O4 still beats L2-Z2 overall; I wanted gold to remain worth chasing.

This bonus only looks at geometry. It doesn't know whether the queue is being helpful or whether I've built the whole thing on top of a mess.

These are pending points. Making O4 attaches 2,500 points to it, split into four shares of 625. Clear one of its rows and collect that row's share, plus the ordinary line-clear points. The [scoring page]({{ '/new-tetris/src/scoring/' | relative_url }}) has the full rules, including what happens when a larger square contains smaller ones.

## Six by six takes nine pieces

There is room for a T4 interlock inside a 6x6 square, with five Os filling the rest. Giving that the same structural bonus as a nine-piece interlock would be a bit generous. So I try the clean cuts recursively and choose the decomposition whose largest unsplittable group is smallest.

The first construction below comes apart into five individual Os and the four-T group. The second won't come apart at all. Even its least damaging full cut goes through two pieces.

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
  <figcaption><a href="{{ '/new-tetris/?practice=6&family=O5-T4' | relative_url }}">A T4 core with five Os</a>, and <a href="{{ '/new-tetris/?practice=6&family=L5-T4' | relative_url }}">a nine-piece interlock</a>.</figcaption>
</figure>

The 6x6 base is 2,500 points, gold adds 3,500, and each distinct shape after the first adds 500. Then I add the shape bonus:

| What remains after the best decomposition | Bonus |
| --- | ---: |
| Largest group has 1 or 2 pieces | 0 |
| Largest group has 3 or 4 pieces | 500 |
| Largest group has 5 or 6 pieces | 1,000 |
| All 9 stay together; some full cut crosses just 1 piece | 1,500 |
| All 9 stay together; every full cut crosses at least 2 pieces | 2,500 |
{: tabindex="0" aria-label="6x6 structure bonuses"}

There are no seven- or eight-piece groups in that table. They would need rectangular regions of area 28 or 32, neither of which fits inside a 6x6 square.

Using all seven shapes is worth a decent bonus, though it doesn't guarantee the highest score. The seven-type construction below gets 7,000. The six-type one gets 7,500 because its interlock earns another thousand, more than making up for the missing shape. Nine Os get 6,000.

<figure class="tetrasquares-figure">
  <div class="tetrasquares-gallery">
    <div class="tetrasquares-card square-6">
      <span class="tetrasquares-label">Seven types</span>
      <img src="{{ '/assets/images/tetrasquares/seven-types.svg' | relative_url }}" width="192" height="192" alt="A 6x6 square using all seven types has a 1,500-point shape bonus." loading="lazy" decoding="async">
      <span class="tetrasquares-value">7,000 pending</span>
    </div>
    <div class="tetrasquares-card square-6">
      <span class="tetrasquares-label">Six types</span>
      <img src="{{ '/assets/images/tetrasquares/six-types.svg' | relative_url }}" width="192" height="192" alt="A 6x6 square using six types has a 2,500-point shape bonus." loading="lazy" decoding="async">
      <span class="tetrasquares-value">7,500 pending</span>
    </div>
  </div>
  <figcaption>Try <a href="{{ '/new-tetris/?practice=6&family=I1-J1-L1-O1-S1-T2-Z2' | relative_url }}">all seven shapes</a> or <a href="{{ '/new-tetris/?practice=6&family=J1-L1-O1-S1-T2-Z3' | relative_url }}">the stronger six-type interlock</a>.</figcaption>
</figure>

Nine Ts won't work at all. Checkerboard-color a 6x6 board and there are 18 cells of each color. A T always covers three of one color and one of the other, giving an imbalance of +2 or -2. Nine such imbalances can't sum to zero. The little T4 spiral has no T9 equivalent.

## The catalog

Butler, Ekstrand and Osborne [count these tilings](#ref-tiling):

| Square | Pieces | Geometric tilings | Piece mixes |
| --- | ---: | ---: | ---: |
| 4x4 | 4 | 117 | 24 |
| 6x6 | 9 | 178,939 | 1,467 |
| 8x8 | 16 | 19,077,209,438 | 30,434 |
{: tabindex="0" aria-label="Geometric tilings and catalog piece mixes"}

A mix such as L2-Z2 says which pieces are used, not where they go. It can have several arrangements with different scores. These counts keep rotations and reflections when they give different tilings on the fixed board. They also include geometric tilings without promising that a falling-piece sequence can reach each one.

The [catalog]({{ '/new-tetris/src/catalog/' | relative_url }}) has one illustrated, checked construction for every 4x4 and 6x6 mix: 1,491 examples altogether. Its step slider shows how they go together. The [platforming guide](#ref-platforms) is useful background here; a finished tiling hides all the trouble you can have getting a piece into place.

Each example links to practice mode, which supplies its pieces in order without gravity. A wrong drop leaves the board alone, and there's an optional placement outline. You can learn the construction without waiting for a friendly queue or trying to keep the rest of the board alive. Practice stops when the square is built; collecting its points is left to normal play.

## Eight by eight takes most of the well

An 8x8 square needs sixteen pieces. In a ten-column well, centering it leaves one column on either side. Four copies of the T4 pattern fit together like this:

<figure class="tetrasquares-figure">
  <div class="tetrasquares-gallery">
    <div class="tetrasquares-card square-8">
      <span class="tetrasquares-label">T16 / 8x8</span>
      <img src="{{ '/assets/images/tetrasquares/t16.svg' | relative_url }}" width="256" height="256" alt="Sixteen numbered T pieces form an 8x8 gold square from four T4 quadrants." loading="lazy" decoding="async">
      <span class="tetrasquares-value">20,000 pending</span>
    </div>
  </div>
  <figcaption>T16, assembled from four T4 quadrants.</figcaption>
</figure>

I checked this order with a supplied T-only sequence under the browser game's movement rules. For 8x8 I went with a flat 10,000 for silver and 20,000 for gold, collected across eight rows. There is no additional interlock or diversity bonus. Those smaller T4 squares can still have their own uncollected points attached when the big square forms.

The [8x8 catalog]({{ '/new-tetris/src/catalog/?size=8&family=T16' | relative_url }}) has counts by piece mix, but no construction orders or practice mode yet. You can build 8x8 squares in the [full game]({{ '/new-tetris/' | relative_url }}). The [four-T practice]({{ '/new-tetris/?practice=4&family=T4' | relative_url }}) supplies the right queue if you want to try the spiral.

## References

1. <span id="ref-manual"></span>[The New Tetris instruction booklet](https://archive.org/download/new-tetris-the-usa/New%20Tetris%2C%20The%20%28USA%29_text.pdf), Nintendo, 1999. Printed page 9 describes Mono-Squares and Multi-Squares; page 11 describes collected-line rewards. These are PDF pages 11 and 13.
2. <span id="ref-game"></span>[The New Tetris](https://tetris.wiki/The_New_Tetris), TetrisWiki. Release information, square rules, Hold, Spin Moves and scoring.
3. <span id="ref-squares"></span>[Square Tetris](https://tetris.wiki/Square_Tetris), TetrisWiki. Square constructions and building methods.
4. <span id="ref-platforms"></span>[Square Platforming](https://harddrop.com/wiki/Square_Platforming), Hard Drop. Supporting surfaces and placement order.
5. <span id="ref-harddrop"></span>[The New Tetris](https://harddrop.com/wiki/The_New_Tetris), Hard Drop. Another account of the original rules and scoring; some material overlaps with TetrisWiki.
6. <span id="ref-tiling"></span>[TETRIS Tiling](https://oeis.org/A230031/a230031.pdf), Steve Butler, Jason Ekstrand and Steven Osborne. Geometric counts for tetromino tilings of squares.

A scoring wrinkle: the manual says five or ten collected lines per square row. TetrisWiki and Hard Drop describe additive bonuses and give 25 or 45 for a four-row clear through a silver or gold square. I haven't resolved that disagreement by testing the N64 game. The point values in this post belong to Tetrasquares.
