---
title: "maSATermind: a Mastermind solver that forgives your lies"
tags: sat z3 mastermind games crypto
author: deuterium
key: masatermind000001
---

<p>The game runs right here; it is the same engine this post describes. Press
&ldquo;Watch it beat a liar&rdquo; for the two-minute demo, or play a round yourself.</p>

<div data-coi-sw="/2026/coi-serviceworker.js">
{%- include masatermind.html heading="p" panel="p" -%}
</div>

Mastermind is the classic code-guessing game: one player hides a row of colored pegs,
the other guesses, and each guess is scored with <strong>bulls</strong> (right color, right slot)
and <strong>cows</strong> (right color, wrong slot). The game is old, the questions are not:
how do you guess efficiently, and &mdash; more interesting &mdash; what happens when the
scorer <em>lies</em>?

## The solver

Each round, the solver holds a symbolic board: one integer variable per slot, bounded
to the color range. Every guess you answered becomes <em>two constraints</em>:

- **bulls:** the number of slots where the symbolic board equals your guess must match
  the bulls you reported &mdash; a sum of `ite (= board[i] guess[i])` terms;
- **cows:** the classic color-count bound, that for every color the sum of
  `min(count_board(color), count_guess(color))` equals your reported bulls+cows.

Ask a solver for any model of those constraints and you get a code consistent with
everything you have admitted so far. Guess it, repeat, and the candidate space collapses
quickly &mdash; typically a handful of rounds even for eight colors.

## The lies

Here is the part that makes it worth writing up: a liar breaks normal solvers. One
false answer and the constraint set becomes unsatisfiable &mdash; logically, no code
exists at all, and a plain SAT loop is stuck.

The fix is to make every answer a <strong>soft constraint</strong> and hand the whole
thing to an optimizing solver. Soft constraints may be violated at a cost, and the
solver maximizes how many of your answers it can satisfy simultaneously. A lie is no
longer a contradiction; it is just the answer the optimizer quietly decides to
disagree with. The Lies counter you see in the game is exactly that: soft constraints
the optimum refused to honor. The solver forgives you, mathematically.

The reference implementation ([maSATermind](https://github.com/deut-erium/maSATermind))
simulates an unreliable scorer by mutating the hidden secret before each answer
&mdash; each slot of the true secret is replaced with a random color with probability
0.2. The browser port above ships the same idea in its &ldquo;watch it beat a liar&rdquo;
mode: watch the Lies column climb while the solver still closes in.

## In your browser

The whole thing runs client-side. Z3 is compiled to WebAssembly and served from this
site (about 35&nbsp;MB, fetched once per visit, and never until you press a button).
The SMT-LIB encoding is generated fresh each round &mdash; open
&ldquo;see what the solver knows&rdquo; in the game and read the exact script your
answers produced, `assert-soft` lines and all. Nothing about your game leaves the page.

One browser wrinkle: the WASM build runs its long solves on worker threads, which
browsers only permit on cross-origin-isolated pages, so the first solve registers a
small service worker scoped to the game and reloads once to unlock it. Your round
history survives the reload.

## Play it

Think of a code, answer honestly or maliciously, and see how long you last. And if
you have never watched a MaxSAT objective shrug off a lie in real time &mdash;
that is the show.
