---
title: "maSATermind: Mastermind with unreliable answers"
tags: sat z3 mastermind games crypto
author: deuterium
key: masatermind000001
mathjax: true
description: "Play Mastermind with mutating clues, or change a limited number of pegs each turn to mislead the computer."
---

Mastermind usually assumes the person giving feedback can count. Here you can crack a hidden code while its clues mutate, or lock your own secret and alter a temporary scoring row to mislead the computer. The real secret stays fixed. Only a guess matching it wins.

[Skip to the game](#play), or start with the scoring rules. They matter more than the solver's name.

## The game

One player chooses a hidden row of colored pegs. The other guesses the row. After each guess, the code maker reports two counts:

- Exact matches: the right color in the right position.
- Misplaced matches: the right color in the wrong position.

Use four positions and six colors. Colors can repeat. The secret stays fixed throughout the game, and each peg can count only once.

Here R is red, B is blue, G is green, and Y is yellow:

```text
Secret:  R B R G
Guess:   R G Y R
Reply:   1 exact, 2 misplaced
```

The first red is exact. Green and the other red are present but misplaced. Yellow is absent. We can identify those positions because the secret is visible here; the actual reply only gives counts, not which pegs matched.

Duplicates are where innocent arithmetic starts impersonating a liar:

```text
Secret:  R B R G
Guess:   R R R R
Reply:   2 exact, 0 misplaced
```

Both reds in the secret have already been counted as exact matches. The two extra red guesses earn nothing. Checking whether each guessed color appears *somewhere* in the secret would count the same pegs repeatedly.

To score by hand, remove the exact matches, then pair up remaining colors without reusing a peg. In code, count occurrences of each color in both rows. For secret $$s$$ and guess $$g$$ of length $$n$$:

$$E(s,g)=\sum_{i=1}^{n}[s_i=g_i]$$

$$T(s,g)=\sum_{a=1}^{c}\min(\operatorname{count}_a(s),\operatorname{count}_a(g)),\qquad M(s,g)=T(s,g)-E(s,g).$$

The brackets mean 1 when the statement is true and 0 otherwise. $$T$$ is the total color overlap; subtracting the exact matches leaves the misplaced matches.

## One wrong answer can leave plenty of candidates

There are $$6^4=1{,}296$$ possible codes. Suppose the first guess is R R R R and the honest answer is two exact matches. The secret contains exactly two reds. Choose their positions in six ways, then fill the other positions with any of five non-red colors:

$$\binom{4}{2}5^2=150.$$

Now report one exact match instead. The solver keeps codes with exactly one red:

$$\binom{4}{1}5^3=500.$$

The history still has 500 explanations. Every one of them is wrong. A contradiction detector cannot help yet because nothing looks contradictory.

Repeating the guess and getting a different reply would reveal an inconsistency, but not which answer was false. To decide what to keep, we need rules for how feedback can be wrong.

### What about the five-guess strategy?

For honest four-position, six-color Mastermind with repetitions, [Knuth described a strategy that finishes within five guesses](https://web.archive.org/web/20160304020808id_/http://www.cs.uni.edu/~wallingf/teaching/cs3530/resources/knuth-mastermind.pdf). It starts with 1122 and minimizes the largest surviving group after the next answer. Ties prefer a surviving code, then numeric order.

It considers **all legal guesses**, including codes already ruled out as secrets. A guess that cannot win immediately may distinguish the remaining candidates better. The five guesses include the final correct guess, and the bound assumes honest feedback. Knuth also distinguishes this worst-case objective from minimizing the expected number of guesses.

The baseline policies in the experiment section are simpler. They choose a candidate that best explains past replies, breaking ties in numeric lexicographic order: 1111 before 1112, and so on. Their first guess is 1111. They do not implement Knuth's strategy or inherit its bound.

## Two ways to give bad feedback

### Misread the secret

In Breaker, you make the guesses and the real secret never changes. Before each reply, the scorer independently misreads each peg with probability $$p$$, replacing a selected peg with a uniformly chosen **different** color. It scores the guess against that temporary row, then discards the row.

At $$p=0.2$$, each position has a 20% chance of changing. This is not a 20% chance of a wrong whole reply. Several positions may change, and a changed row can still produce the correct counts. If the guess is all blue, misreading a red peg as green need not affect the answer.

A different noise model, redraw, chooses a replacement from *all* colors, including the original. With six colors, a 20% redraw rate changes a peg with probability $$0.2\cdot5/6$$, about 16.7%. The equivalent forced-change rate is:

$$q=p\frac{c-1}{c}.$$

These are the same channel after converting the rate, rather than two independent kinds of difficulty. Breaker uses forced-change noise. Its postgame review shows the temporary rows and the truthful scores alongside the reported clues.

### Change a limited number of positions each turn

In Liar, choose and lock your secret. When the computer guesses, edit a temporary copy of the secret in at most t positions. The game computes the clues from that copy. Your aim is to keep the real code hidden until the round's guesses run out.

The cap applies separately on **every turn**. You can choose different positions next time, and changing fewer than the cap is allowed. Nothing is spent across the game. The computer knows the cap, but receives neither the original secret nor your temporary row.

With four positions and six colors, two changes per turn can already hide every score clue: a legal temporary row can always report two Exact matches and zero Misplaced matches. The [constant-reply construction](https://github.com/deut-erium/deut-erium.github.io/blob/a180e16355802407e907fbdf69ebfd40bf56389e/agent_out/mastermind-analysis/CAP-STRENGTHENING.md) shows why the computer can be forced to search code by code. A round limit is a game goal, not a promise that the computer can always solve within it.

A reported pair must be attainable for the particular guess under ordinary scoring. An all-red guess cannot have misplaced matches. Three exact and one misplaced is impossible for any four-position guess: if three pegs are in place, there is nowhere else for the fourth to belong. Merely checking that the two counts sum to at most four would miss this.

Submitted history cannot be edited. Reset starts a new game; it does not repair an earlier answer in the current one.

## Agreement baselines and a different lie budget

A separate model allows a fixed number of false replies over the **whole game**. Changing either count or both costs one false reply; sending the truthful pair costs nothing. Once this allowance is spent, every later reply must be honest. The bounded-reply experiments below use that rule, not Liar's per-turn position cap.

The earlier maSATermind implementation used Z3 soft constraints. Each old reply supplied two checks: one for the exact count $$E$$, and one for the total overlap $$T=E+M$$. The solver preferred a code satisfying as many checks as possible, with equal weight for each check. [Z3's soft-constraint documentation](https://microsoft.github.io/z3guide/docs/optimization/softconstraints/) describes those weighted preferences.

That objective is different from agreeing with complete replies. Suppose a candidate predicts one exact and one misplaced, so its total overlap is two:

<div class="mst-table" role="region" aria-label="Reply scoring objectives" tabindex="0" markdown="1">

| Reported reply | Failed E/T checks | False whole replies |
| --- | ---: | ---: |
| 0 exact, 2 misplaced | 1 | 1 |
| 0 exact, 0 misplaced | 2 | 1 |

</div>

The first report preserves the total. The second changes both checks. Under the game-wide allowance, either report costs one reply.

The experiment baselines enumerate candidates directly and specify their tie-breaking, rather than relying on which optimum Z3 happens to return. The playable computer opponent uses the per-turn position cap instead: it retains every compatible secret and compares a sample of possible guesses by their largest legal remaining group. It does not load Z3 or claim globally optimal query selection.

The experiments compare these rules:

- Strict consistency keeps only codes agreeing with every complete reply.
- E/T agreement minimizes the number of failed exact-count and total-overlap checks.
- Whole-reply agreement minimizes the number of mismatching reply pairs.
- Known-L keeps codes requiring at most the allowed number of false replies, then uses whole-reply agreement and the same tie-break.
- Random/no-repeat ignores feedback and chooses uniformly among unguessed codes.

For an unsuccessful history of $$t$$ guesses and replies, the whole-reply disagreement count is:

$$d_t(s)=\sum_{j=1}^{t}[F(s,g_j)\ne r_j],$$

where $$F$$ returns the pair of exact and misplaced counts. Known-L retains a candidate when $$d_t(s)\le L$$, except for guesses the referee has already rejected. The actual secret remains in this set if the player respects the allowance.

Candidate-specific lie counts also appear in [Spencer's analysis of searching with a fixed number of lies](https://cims.nyu.edu/~spencer/papers/fixedlies.pdf). His questions can ask membership in arbitrary subsets, however. A Mastermind guess cannot make every partition we might want, so that game's query bounds do not transfer directly.

All five experiment policies choose guesses from their candidate sets. Fitting the history is their scoring objective; it is not a calculation of how much the next answer will teach them.

## A referee changes what counts as success

A separate referee checks each guess against the locked secret. It ends the game only on actual equality. An invented all-exact reply cannot cause a win, and a player cannot conceal a genuine hit by reporting something else.

Continuing play therefore tells the solver that its last guess was wrong. Even if the feedback is useless, it can avoid that code in future. This extra information matters when interpreting the results.

At forced-change probability $$p=5/6$$ with six colors, a temporary peg keeps its original color with probability $$1/6$$ and becomes each other color with probability $$1/6$$. The temporary secret is uniform and independent of the real secret. Its score can depend on the guess, but carries no information about the original code.

The equality check still works. Trying all 1,296 codes without repetition would eventually find the secret. With a uniform secret and a limit of 60 nonrepeating guesses, the success probability at this no-information setting is:

$$\frac{60}{1296}\approx4.63\%.$$

Success here would be enumeration through the referee, not recovery from noisy feedback. A feedback-only experiment would instead need the solver to decide when to declare a secret, then count wrong declarations as failures. That is a different experiment from the one below.

## What happened in 6,200 games

I ran the five policies on four-position, six-color games with a 60-guess limit. The final correct guess counts. Four misreading rates and three allowance settings produce 31 applicable feedback/policy combinations, each with 200 seeded secret draws. Sampling was with replacement: the shared panel contained 186 distinct codes.

The same secret draws and separate random streams were paired across conditions and policies. Different guesses can still produce different replies and realized errors. Seeds were fixed before inspecting results and differed from the earlier three-position pilot.

Here is the moderate-noise case, forced-change $$p=0.2$$. Every percentage includes all 200 games, including failures:

<div class="mst-table" role="region" aria-label="Completion with moderate noise" tabindex="0" markdown="1">

| Policy | Solved by 10 guesses | Solved by 60, with 95% interval |
| --- | ---: | ---: |
| Strict consistency | 10.5% | 10.5% (7.0-15.5%) |
| E/T agreement | 36.5% | 100% (98.1-100%) |
| Whole-reply agreement | 42.0% | 100% (98.1-100%) |
| Random/no-repeat | 0.5% | 5.0% (2.7-9.0%) |

</div>

<img src="{{ '/assets/images/mastermind/completion-p02.svg' | relative_url }}" width="480" height="480" alt="Cumulative completion at forced-change probability 0.2. Strict consistency plateaus at 10.5 percent. Both agreement policies reach 100 percent within 40 guesses." loading="lazy">

Strict consistency exhausted its candidates in 179 games. Both agreement policies finished every sampled game within 40 guesses, but that is not a general completion guarantee. The whole-reply curve is ahead in this panel; the gap alone does not establish that it is the better policy across other seeds or error models.

The intervals are pointwise 95% Wilson binomial intervals under the stated simulation model, not paired significance tests. In particular, 200 successes out of 200 does not establish a true success probability of one. [Complete results]({{ '/assets/data/mastermind/results.csv' | relative_url }}) and [completion curves]({{ '/assets/data/mastermind/curves.csv' | relative_url }}) include all conditions and failures.

### More corruption is not a theorem about difficulty

With truthful feedback, strict consistency and both agreement policies completed all 200 trials within 10 guesses. At $$p=5/6$$, random/no-repeat and each agreement policy completed 10 of 200, or 5.0%, while strict consistency completed none. That is consistent with the roughly 4.63% equality-search baseline. The identical random result across conditions is the same paired control, not several independent observations.

At $$p=1$$, E/T agreement completed only 3 of 200 and whole-reply agreement only 1 of 200. Their objectives reward resemblance to truthful feedback even though every temporary peg is now a different color.

This does not make $$p=1$$ an information-free channel. For a binary alphabet, forced change at probability one is perfectly invertible. With six colors it is still a different channel from the uniform one at $$5/6$$. Poor performance by these agreement heuristics is not a limit on a solver that actually models the channel.

### A random liar is not the hardest liar

For bounded feedback, the simulated opponent chose an attainable false alternative with probability 0.35 while it had allowance remaining. This tests random mistakes, not a player selecting the most damaging reply.

<div class="mst-table" role="region" aria-label="Completion with bounded false replies" tabindex="0" markdown="1">

| Allowance | Strict: solved by 60 | E/T: solved by 60 | Whole-reply / Known-L: solved by 60 |
| --- | ---: | ---: | ---: |
| 0 | 200/200 | 200/200 | 200/200 |
| 1 | 27/200 | 200/200 | 200/200 |
| 2 | 27/200 | 200/200 | 200/200 |

</div>

Whole-reply agreement and Known-L produced identical transcripts in all 600 paired bounded trials. There is a reason beyond chance: while the true secret remains viable, the smallest disagreement count is at most $$L$$. Removing candidates above $$L$$ cannot change that minimum or its lexicographic tie-break. The filter certifies which candidates remain possible; this particular query rule gets no different next guess from it.

Neither those completions nor the invariant that truth survives establishes a 60-guess bound against a strategic opponent. These results concern a whole-game false-reply allowance; they do not establish performance under a per-turn position cap.

## A recorded recovery

In one recorded E/T-agreement game at $$p=0.2$$, the secret was **2261**. The first three rounds were:

<div class="mst-table" role="region" aria-label="Recovery example replies" tabindex="0" markdown="1">

| Guess | Temporary secret | True exact/misplaced | Reported exact/misplaced |
| --- | --- | --- | --- |
| 1111 | 2221 | 1/0 | 1/0 |
| 1222 | 2211 | 1/2 | 1/2 |
| 2123 | 2266 | 1/2 | 1/1 |

</div>

The first two misreads changed a peg but left the reply correct. The third reply understated the overlap. Further guesses were:

```text
1333, 2231, 1443, 2132, 2551, 2661, 2321, 2261
```

The last guess matched the fixed secret on query 11. The referee stopped before sampling another reply. This run was selected for a short example with incorrect feedback, not as a typical game.

The [recorded transcript](https://github.com/deut-erium/deut-erium.github.io/blob/b0162fd002bed5851b43d4f45e29c527c6c62228/agent_out/mastermind-publish/experiments/primary/REPLAY.md) uses seed **3934693235** and the E/T-agreement baseline. Its solver saw only guesses, reported replies and win/non-win outcomes. The temporary rows and truthful counts shown here were withheld during selection. This is a batch replay, not a sequence promised by the playable opponent.

## What a channel-aware solver would need

Agreement counts are not likelihoods. A probabilistic solver would weight each candidate by the probability that the chosen misreading process produced the observed reply for that particular guess.

Even the truthful score is not always enough to index that probability. With three positions and three colors, guess 112 gives both secrets 111 and 113 an honest reply of two exact and zero misplaced. Under forced-change $$p=1/4$$, their probabilities of producing one exact and two misplaced are **9/64** and **3/128**, respectively. A table keyed only by the truthful score would treat them as identical when they are not.

Given those likelihoods, updating beliefs and choosing a query are still separate jobs. Choosing the most likely secret aims for a hit now; another guess may better distinguish the remaining secrets. Research on [noisy Bayesian active learning](https://arxiv.org/abs/1312.2315) studies that distinction, with assumptions about the channel and stopping rule that need checking before borrowing its bounds.

No posterior or information-gain policy was run here. The implemented rules provide baselines for that comparison, with the error model and trusted referee made explicit.

## Play

In **Breaker**, select a peg and choose its color, then check your guess. In **Liar**, set and lock your secret, then edit the temporary row before sending its clues. The computer makes its next guess automatically. Colors may repeat; numbers and color names accompany the pegs.

The default round has 16 guesses. Round settings change the size, mutation probability, per-turn cap and guess limit. An actual match ends the round immediately, even when a false all-exact clue appeared earlier. Review the clues after a win, loss or concession. Reloading or starting a new round clears the board.

{%- include masatermind.html heading="p" panel="p" -%}

## Reproducing the results

The batch experiments use cached scores and incremental costs. Their checks compare every issued guess with independently accumulated costs and sample complete transcripts against the reference referee and ordered candidate lists. All actual wins, non-repeats and spent allowances were checked. A second run reproduced the deterministic result files byte for byte; timing logs are separate. The playable opponent uses a different, position-cap-aware query rule, so these tables are not measurements of its performance.

The [experiment code and retained results](https://github.com/deut-erium/deut-erium.github.io/tree/b0162fd002bed5851b43d4f45e29c527c6c62228/agent_out/mastermind-publish/experiments) document the seeds, opponent, cap, intervals, and verification. To rerun after checking out the repository:

```sh
D=agent_out/mastermind-publish/experiments
node "$D/experiment.mjs" "$D/rerun"
node "$D/validate.mjs" "$D/rerun" "$D/rerun-checks"
```

Those are local policy experiments, not browser-speed measurements. The honest-game bound, random-error results, and behavior against an adversarial player answer different questions. Keeping them separate makes it possible to tell whether a solver learned from a reply, merely survived it, or finally reached the secret by trying codes.
