---
title: "new-tetris: a tiny browser tetris"
tags: games javascript tetris
description: "The little tetris clone that lives on this site at /new-tetris/ - where it came from, how it is served, and why it stays untouched."
---
<p>The game runs right here, in full, inline. Prefer a dedicated page? It is
also served untouched at <a href="/new-tetris/">/new-tetris/</a>.</p>

{% tetris_embed %}

Every so often a blog accumulates one thing that exists purely because it is fun.
<code>new-tetris</code> is that thing here: a small tetris clone that shipped with this
site years ago and never left.

## Why it is served untouched

The game is a static app &mdash; plain HTML, CSS, and JavaScript with no build step,
no dependencies, and no network calls. Its canonical home stays at
<a href="/new-tetris/">/new-tetris/</a>, deployed exactly as written and guarded by a
manifest so a site release cannot silently alter or drop one of its files. This post
renders the very same files inline: the build extracts the game markup, scopes its
styles under the embed container so nothing leaks into the page, and loads the
untouched <code>main.js</code> as a module from its real location.

## How to play

Arrow keys move and rotate, the usual scoring applies, and it works entirely offline.
The frame above runs the real thing &mdash; focus it and play.

## Where it goes next

Nothing, probably. Part of the charm of a preserved artifact is refusing to improve it.
If it ever grows a scoreboard or a sprint mode, that will be a new game, and this one
will stay as it is: a small, complete, working thing from a simpler web.
