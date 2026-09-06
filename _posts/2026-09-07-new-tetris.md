---
title: "new-tetris: a tiny browser tetris"
tags: games javascript tetris
description: "The little tetris clone that lives on this site at /new-tetris/ - where it came from, how it is served, and why it stays untouched."
---
<p>The game runs right here, in full, below this paragraph. Prefer a dedicated
page? It is also served untouched at <a href="/new-tetris/">/new-tetris/</a>.</p>

<div class="tetris-embed">
<iframe id="tetris-frame" src="/new-tetris/" title="new-tetris: browser tetris" style="width:100%;height:40rem;border:0;background:transparent;display:block"></iframe>
<p class="tetris-fallback" hidden>The embedded game could not load in this frame.
<a href="/new-tetris/">Play it on its own page instead</a> &mdash; same build, same saves.</p>
</div>

<script>
(function () {
  var f = document.getElementById('tetris-frame');
  var fb = document.querySelector('.tetris-fallback');
  var fail = function () { f.hidden = true; fb.hidden = false; };
  var fit = function () {
    try {
      var d = f.contentDocument; if (!d || !d.documentElement) return;
      var h = Math.max(d.documentElement.scrollHeight, d.body ? d.body.scrollHeight : 0);
      if (h > 300) f.style.height = (h + 24) + 'px';
    } catch (e) {}
  };
  f.addEventListener('load', function () {
    fit();
    try {
      var d = f.contentDocument;
      if (window.ResizeObserver && d && d.documentElement) {
        new ResizeObserver(fit).observe(d.documentElement);
      }
    } catch (e) {}
  });
  f.addEventListener('error', fail);
  setTimeout(function () {
    try { if (!f.contentDocument || !f.contentDocument.body) fail(); } catch (e) { fail(); }
  }, 4000);
})();
</script>

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
