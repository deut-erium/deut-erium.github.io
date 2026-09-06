---
title: "new-tetris: a tiny browser tetris"
tags: games javascript tetris
description: "The little tetris clone that lives on this site at /new-tetris/ - where it came from, how it is served, and why it stays untouched."
---
<p>The game runs right here; it is the same build served at <a href="/new-tetris/">/new-tetris/</a>, preserved file-for-file.</p>

<iframe src="/new-tetris/" title="new-tetris: browser tetris" loading="lazy" style="width:100%;min-height:36rem;border:3px solid var(--navy);border-radius:.8rem;background:var(--paper)"></iframe>

Every so often a blog accumulates one thing that exists purely because it is fun.
<code>new-tetris</code> is that thing here: a small tetris clone that shipped with this
site years ago and never left.

## Why it is served untouched

The game is a static app &mdash; plain HTML, CSS, and JavaScript with no build step,
no dependencies, and no network calls. It lives at <a href="/new-tetris/">/new-tetris/</a>
and is deployed exactly as it was written, guarded by a manifest so a site release
cannot silently alter or drop one of its files. When everything else on this site is
generated, versioned, and verified, it is nice to keep one corner byte-frozen.

## How to play

Arrow keys move and rotate, the usual scoring applies, and it works entirely offline.
The frame above runs the real thing &mdash; focus it and play.

## Where it goes next

Nothing, probably. Part of the charm of a preserved artifact is refusing to improve it.
If it ever grows a scoreboard or a sprint mode, that will be a new game, and this one
will stay as it is: a small, complete, working thing from a simpler web.
