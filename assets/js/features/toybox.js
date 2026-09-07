/* The mystery buttons (footer) and their toys (roadmap 10b/10e).
   Loaded lazily by the first footer ? press, so pages that never
   press anything never download this file. Three ? buttons each
   secretly map to one of the toys, reshuffled on every load, so the
   map cannot be learned. Nothing persists: a reload restores the
   page exactly as built.
   Overlays live in a div appended to document.documentElement so body-level
   transforms (tilt, chaos rotation) and filters (burn) cannot detach them
   from the viewport. */
(() => {
  'use strict';
  if (window.__dtToy) return;

  const D = document;
  const root = D.documentElement;
  const body = D.body;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  /* ------------------------------------------------------------------ */
  /* Scaffold: stylesheet + overlay root                                 */
  /* ------------------------------------------------------------------ */

  const css = D.createElement('style');
  css.id = 'toybox-css';
  css.textContent = `
.toy-count{position:fixed;top:.7rem;left:50%;transform:translateX(-50%);z-index:1001;padding:.3rem .75rem;border:2px solid #fff;border-radius:999px;background:var(--pink,#ff3b9d);color:#fff;font-family:var(--keys,ui-monospace,monospace);font-size:.95rem}
.toy-count[hidden]{display:none}
.toy-toast{position:fixed;left:.8rem;bottom:.8rem;z-index:1001;max-width:min(24rem,calc(100vw - 1.6rem));margin:0;padding:.6rem .8rem;border:3px solid var(--navy,#101426);border-radius:.5rem;background:var(--paper,#fffdf7);color:var(--ink,#101426);font-size:.95rem;box-shadow:.35rem .35rem 0 rgba(7,9,20,.55)}
html.tb-rot{overflow-x:hidden}
html.tb-rot body,html.tb-tilt body{transform:rotate(1.5deg);transform-origin:50% 0}
html.tb-tilt{overflow-x:hidden}
html.tb-tilt body{transition:transform .45s ease}
html.tb-char body{filter:sepia(.8) brightness(.55) contrast(1.25) saturate(.65);transition:filter 4s linear}
@media (prefers-reduced-motion:reduce){html.tb-char body{transition:none}}
html.tb-slow body,html.tb-slow body *,html.tb-slow body *::before,html.tb-slow body *::after{transition-duration:2s !important}
@media (prefers-reduced-motion:reduce){html.tb-tilt body{transition:none}}
.toy-burn{position:fixed;inset:0;width:100vw;height:100vh;z-index:800;pointer-events:none}
.toy-panic{position:fixed;inset:0;z-index:950;overflow:auto;padding:3rem 1.25rem 2rem;background:#f0e7d3;color:#463f2f;font-family:Georgia,"Times New Roman",serif}
.toy-panic__inner{max-width:40rem;margin:auto}
.toy-panic__brand{margin:0 0 .4rem;font-size:.8rem;letter-spacing:.42em;text-transform:uppercase;color:#8a7f63}
.toy-panic h2{margin:0 0 1.4rem;font-size:2rem;line-height:1.15;color:#2e2920;border-bottom:2px solid #d8cbab;padding-bottom:.8rem}
.toy-panic__lede{font-style:italic;color:#6d6449}
.toy-panic p{margin:0 0 1.1rem;font-size:1.05rem;line-height:1.75}
.toy-panic__foot{margin-top:2rem;padding-top:.8rem;border-top:1px solid #d8cbab;font-size:.85rem;color:#8a7f63}
.toy-src{position:fixed;inset:0;z-index:900;overflow:auto;padding:1rem;background:var(--navy,#101426);color:#e8eaf6}
.toy-src__bar{position:sticky;top:0;margin:0 0 .7rem;padding:.5rem .7rem;background:rgba(36,43,70,.95);border:2px solid #59617e;border-radius:.4rem;font-family:var(--keys,ui-monospace,monospace);font-size:.85rem;color:var(--lcd,#c9ff73)}
.toy-src pre{margin:0;white-space:pre-wrap;word-break:break-word;font:13.5px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.tok-tag{color:#7ee787}
.tok-attr{color:#79c0ff}
.tok-val{color:#ffa657}
.tok-punct{color:#8b949e}
.tok-comment{color:#8b949e;font-style:italic}
.tok-link{color:var(--pink,#ff3b9d)}
.toy-tip{position:fixed;z-index:1002;pointer-events:none;max-width:min(34rem,90vw);padding:.35rem .5rem;border:2px solid #59617e;border-radius:.4rem;background:var(--navy,#101426);color:var(--lcd,#c9ff73);font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all}
.toy-tip[hidden]{display:none}
html.toy-grav main>*{will-change:transform}
html.toy-grav main{user-select:none}
`;
  D.head.appendChild(css);

  const toyRoot = D.createElement('div');
  toyRoot.dataset.toybox = '';
  root.appendChild(toyRoot);

  const ce = (tag, className, text) => {
    const el = D.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  };

  /* Rotation and burn change body geometry; pin html's background so no
     browser-default white flashes through behind a tilted body. */
  const paintRoot = () => {
    root.style.backgroundColor = getComputedStyle(body).backgroundColor;
  };
  const unpaintRoot = () => {
    if (!root.classList.contains('tb-rot') && !root.classList.contains('tb-tilt')) {
      root.style.removeProperty('background-color');
    }
  };

  let toastTimer = 0;
  const toast = (message) => {
    toyRoot.querySelector('.toy-toast')?.remove();
    const el = ce('p', 'toy-toast', message);
    el.setAttribute('role', 'status');
    toyRoot.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 4200);
  };

  /* ------------------------------------------------------------------ */
  /* Toy 1: the chaos ladder                                            */
  /* ------------------------------------------------------------------ */

  const countdown = ce('div', 'toy-count', 'chaos: 60s');
  countdown.setAttribute('aria-live', 'off');
  countdown.hidden = true;
  toyRoot.appendChild(countdown);

  const internalLinks = () => Array.from(body.querySelectorAll('a[href]')).filter((a) => {
    if (a.closest('[data-toybox]')) return false;
    const raw = a.getAttribute('href');
    if (!raw || raw.charAt(0) === '#') return false;
    let url;
    try {
      url = new URL(raw, location.href);
    } catch (_) {
      return false;
    }
    return url.origin === location.origin && (url.protocol === 'http:' || url.protocol === 'https:');
  });

  const derange = (n) => {
    const idx = Array.from({ length: n }, (_, i) => i);
    if (n < 2) return idx;
    for (let attempt = 0; attempt < 64; attempt += 1) {
      for (let i = n - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }
      if (idx.every((to, from) => to !== from)) return idx;
    }
    return idx;
  };

  const chaos = {
    presses: 0,
    timer: 0,
    remaining: 0,
    locked: false,
    saved: null,
    get active() {
      return Boolean(this.saved) || root.classList.contains('tb-rot');
    },
    press() {
      if (this.locked) return;
      this.presses += 1;
      if (this.presses >= 3) {
        this.locked = true;
        restoreAll();
        toast('you were warned. chaos is done until you reload.');
        return;
      }
      this.shuffle();
      this.runTimer();
      if (this.presses === 2) {
        root.classList.add('tb-rot', 'tb-slow');
        paintRoot();
        toast('escalated: the page leans and transitions slow down.');
      } else {
        toast('this page has been shuffled. good luck.');
      }
    },
    shuffle() {
      // Put any earlier shuffle back first so `saved` always holds the
      // pristine hrefs, even when the ladder escalates mid-shuffle.
      if (this.saved) this.saved.forEach(([a, href]) => a.setAttribute('href', href));
      const links = internalLinks();
      if (links.length < 2) return;
      const originals = links.map((a) => a.getAttribute('href'));
      let order = null;
      for (let attempt = 0; attempt < 64 && !order; attempt += 1) {
        const candidate = derange(originals.length);
        if (originals.every((href, i) => href !== originals[candidate[i]])) order = candidate;
      }
      if (!order) order = derange(originals.length);
      this.saved = links.map((a) => [a, a.getAttribute('href')]);
      links.forEach((a, i) => a.setAttribute('href', originals[order[i]]));
    },
    unshuffle() {
      clearInterval(this.timer);
      countdown.hidden = true;
      if (this.saved) {
        this.saved.forEach(([a, href]) => a.setAttribute('href', href));
        this.saved = null;
      }
    },
    runTimer() {
      clearInterval(this.timer);
      this.remaining = 60;
      countdown.hidden = false;
      countdown.textContent = 'chaos: 60s';
      this.timer = setInterval(() => {
        this.remaining -= 1;
        countdown.textContent = `chaos: ${this.remaining}s`;
        if (this.remaining <= 0) {
          this.unshuffle();
          sync();
        }
      }, 1000);
    },
    restore() {
      this.unshuffle();
      root.classList.remove('tb-rot', 'tb-slow');
      unpaintRoot();
    },
    pill() {
      if (this.locked) return 'done for the session';
      if (this.saved) return root.classList.contains('tb-rot') ? 'shuffling · leaning' : 'shuffling';
      if (root.classList.contains('tb-rot')) return 'leaning · slow';
      return null;
    },
  };

  /* ------------------------------------------------------------------ */
  /* Toy 2: tilt                                                        */
  /* ------------------------------------------------------------------ */

  const tilt = {
    timer: 0,
    active: false,
    press() {
      if (this.active) this.restore();
      else this.start();
    },
    start() {
      this.active = true;
      root.classList.add('tb-tilt');
      paintRoot();
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.restore();
        sync();
      }, 30000);
    },
    restore() {
      this.active = false;
      clearTimeout(this.timer);
      root.classList.remove('tb-tilt');
      unpaintRoot();
    },
    pill() {
      return this.active ? 'leaning' : null;
    },
  };

  /* ------------------------------------------------------------------ */
  /* Toy 3: burn this page                                              */
  /* ------------------------------------------------------------------ */

  const burn = {
    canvas: null,
    raf: 0,
    fade: 0,
    active: false,
    press() {
      if (this.active) this.restore();
      else this.start();
    },
    start() {
      this.active = true;
      root.classList.add('tb-char');
      if (reduced.matches) return; // instant sepia flash, no ember loop
      const scale = devicePixelRatio || 1;
      const canvas = ce('canvas', 'toy-burn');
      canvas.width = Math.floor(innerWidth * scale);
      canvas.height = Math.floor(innerHeight * scale);
      toyRoot.appendChild(canvas);
      this.canvas = canvas;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      const W = innerWidth;
      const H = innerHeight;
      const embers = [];
      const t0 = performance.now();
      const frame = (now) => {
        const t = Math.min(1, (now - t0) / 4000);
        const y = t * H;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(23,15,9,.96)';
        ctx.fillRect(0, 0, W, Math.max(0, y - 80));
        const charFade = ctx.createLinearGradient(0, Math.max(0, y - 150), 0, y);
        charFade.addColorStop(0, 'rgba(23,15,9,.96)');
        charFade.addColorStop(1, 'rgba(23,15,9,0)');
        ctx.fillStyle = charFade;
        ctx.fillRect(0, Math.max(0, y - 150), W, 150);
        for (let i = 0; i < 50; i += 1) {
          const fx = Math.random() * W;
          const fy = Math.random() * Math.max(1, y - 70);
          ctx.fillStyle = Math.random() < 0.5 ? 'rgba(66,45,25,.55)' : 'rgba(9,6,4,.5)';
          ctx.fillRect(fx, fy, 2 + Math.random() * 5, 2 + Math.random() * 4);
        }
        const line = ctx.createLinearGradient(0, y - 26, 0, y + 12);
        line.addColorStop(0, 'rgba(255,120,24,0)');
        line.addColorStop(0.6, 'rgba(255,150,40,.9)');
        line.addColorStop(1, 'rgba(255,224,90,.95)');
        ctx.fillStyle = line;
        ctx.fillRect(0, y - 26, W, 38);
        if (t < 1) {
          for (let i = 0; i < 3; i += 1) {
            embers.push({
              x: Math.random() * W,
              y: y + Math.random() * 12,
              vy: -(0.7 + Math.random() * 2.1),
              life: 0.8 + Math.random() * 0.4,
              seed: Math.random() * 9,
            });
          }
        }
        for (let i = embers.length - 1; i >= 0; i -= 1) {
          const p = embers[i];
          p.x += Math.sin(p.y / 24 + p.seed) * 0.8;
          p.y += p.vy;
          p.vy -= 0.012;
          p.life -= 0.011;
          if (p.life <= 0 || p.y < -10) {
            embers.splice(i, 1);
            continue;
          }
          ctx.fillStyle = `rgba(255,${120 + Math.floor(100 * p.life)},40,${(p.life * 0.9).toFixed(3)})`;
          ctx.fillRect(p.x, p.y, 2.2, 2.2);
        }
        if (t >= 1) {
          canvas.style.transition = 'opacity .7s ease';
          canvas.style.opacity = '0';
          this.fade = setTimeout(() => {
            canvas.remove();
            if (this.canvas === canvas) this.canvas = null;
            sync();
          }, 750);
          return;
        }
        this.raf = requestAnimationFrame(frame);
      };
      this.raf = requestAnimationFrame(frame);
    },
    restore() {
      cancelAnimationFrame(this.raf);
      clearTimeout(this.fade);
      this.canvas?.remove();
      this.canvas = null;
      this.active = false;
      // Snap the char off instantly instead of un-burning over four seconds.
      body.style.transition = 'filter 0s';
      root.classList.remove('tb-char');
      setTimeout(() => body.style.removeProperty('transition'), 80);
    },
    pill() {
      return this.active ? (this.canvas ? 'burning' : 'charred') : null;
    },
  };

  /* ------------------------------------------------------------------ */
  /* Toy 4: gravity                                                     */
  /* ------------------------------------------------------------------ */

  const grav = {
    active: false,
    items: [],
    press() {
      if (this.active) this.restore();
      else this.start();
    },
    start() {
      const main = D.querySelector('main');
      if (!main) return;
      const kids = Array.from(main.children).filter((el) => {
        const tag = el.tagName.toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'template') return false;
        return el.getBoundingClientRect().height > 2;
      });
      if (!kids.length) return;
      this.active = true;
      root.classList.add('toy-grav');
      const instant = reduced.matches;
      let pileTop = innerHeight - 8;
      this.items = kids.map((el) => {
        const rect = el.getBoundingClientRect();
        const item = {
          el,
          dy: Math.round(pileTop - rect.bottom),
          pointer: -1,
          startY: 0,
          startDy: 0,
          moved: false,
          onDown: null,
          onMove: null,
          onUp: null,
        };
        pileTop = pileTop - rect.height - 6;
        el.style.setProperty('transition', instant ? 'none' : 'transform .7s cubic-bezier(.5,0,1,.6)');
        el.style.setProperty('transform', `translateY(${item.dy}px)`);
        return item;
      });
      this.items.forEach((item) => {
        item.onDown = (e) => this.grab(item, e);
        item.el.addEventListener('pointerdown', item.onDown);
      });
    },
    grab(item, e) {
      if (e.pointerType === 'touch' || e.button > 0) return; // touch keeps page scrolling
      item.pointer = e.pointerId;
      item.startY = e.clientY;
      item.startDy = item.dy;
      item.moved = false;
      try {
        item.el.setPointerCapture(e.pointerId);
      } catch (_) {
        /* capture is a convenience, not a requirement */
      }
      item.onMove = (ev) => this.drag(item, ev);
      item.onUp = () => this.release(item);
      item.el.addEventListener('pointermove', item.onMove);
      item.el.addEventListener('pointerup', item.onUp);
      item.el.addEventListener('pointercancel', item.onUp);
    },
    drag(item, ev) {
      if (item.pointer !== ev.pointerId) return;
      const delta = ev.clientY - item.startY;
      if (!item.moved && Math.abs(delta) < 6) return;
      if (!item.moved) {
        item.moved = true;
        item.el.style.setProperty('transition', 'none');
      }
      item.dy = item.startDy + delta;
      item.el.style.setProperty('transform', `translateY(${item.dy}px)`);
    },
    release(item) {
      item.el.removeEventListener('pointermove', item.onMove);
      item.el.removeEventListener('pointerup', item.onUp);
      item.el.removeEventListener('pointercancel', item.onUp);
      item.pointer = -1;
      if (!item.moved) return;
      const swallow = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
      };
      item.el.addEventListener('click', swallow, { capture: true, once: true });
    },
    restore() {
      this.active = false;
      root.classList.remove('toy-grav');
      this.items.forEach((item) => {
        item.el.removeEventListener('pointerdown', item.onDown);
        item.el.removeEventListener('pointermove', item.onMove);
        item.el.removeEventListener('pointerup', item.onUp);
        item.el.removeEventListener('pointercancel', item.onUp);
        item.el.style.removeProperty('transition');
        item.el.style.removeProperty('transform');
      });
      this.items = [];
    },
    pill() {
      return this.active ? 'dropped' : null;
    },
  };

  /* ------------------------------------------------------------------ */
  /* Toy 5: panic key                                                   */
  /* ------------------------------------------------------------------ */

  const panic = {
    node: null,
    get active() {
      return !!this.node;
    },
    press() {
      if (this.active) this.restore();
      else this.start();
    },
    start() {
      const node = ce('div', 'toy-panic');
      node.setAttribute('role', 'document');
      node.setAttribute('aria-label', 'Synergy Insights - Thoughts on Leadership');
      const inner = ce('div', 'toy-panic__inner');
      inner.append(
        ce('p', 'toy-panic__brand', 'Synergy Insights'),
        ce('h2', null, 'Thoughts on Leadership'),
        ce('p', 'toy-panic__lede', 'Trusted perspectives for modern operations leaders. New thinking, every quarter.'),
        ce('p', null, 'Leadership is less about having every answer and more about asking better questions in the right meetings. In this issue we walk through three durable frameworks for aligning teams around outcomes instead of output.'),
        ce('p', null, 'High-performing organizations rarely need more meetings; they need clearer decision rights. Our ownership canvas helps leaders map accountability across the delivery lifecycle, from discovery through to measurable value.'),
        ce('p', null, 'Culture is what happens between the slides. Protect focus time, align incentives with the behaviors you actually want, and let the synergies emerge organically. The rest, as ever, is execution.'),
        ce('p', 'toy-panic__foot', '© Synergy Insights. Press Escape to return to reality.'),
      );
      node.appendChild(inner);
      toyRoot.appendChild(node);
      this.node = node;
    },
    restore() {
      this.node?.remove();
      this.node = null;
    },
    pill() {
      return this.active ? 'synergy' : null;
    },
  };

  /* ------------------------------------------------------------------ */
  /* Toy 6: hash everything                                             */
  /* ------------------------------------------------------------------ */

  const hash = {
    active: false,
    tip: null,
    word: '',
    seq: 0,
    cache: new Map(),
    press() {
      if (this.active) this.restore();
      else this.start();
    },
    start() {
      this.active = true;
      this.tip = ce('div', 'toy-tip');
      this.tip.hidden = true;
      toyRoot.appendChild(this.tip);
      body.addEventListener('mousemove', this.onMove);
    },
    onMove(e) {
      if (!hash.active) return;
      const word = wordAt(e.clientX, e.clientY);
      if (!word) {
        hash.hide();
        return;
      }
      if (word !== hash.word) {
        hash.word = word;
        hash.show(word, e.clientX, e.clientY);
      } else {
        hash.place(e.clientX, e.clientY);
      }
    },
    show(word, x, y) {
      const tip = this.tip;
      tip.textContent = '…';
      tip.hidden = false;
      this.place(x, y);
      const ticket = ++this.seq;
      this.digest(word).then((hex) => {
        if (!this.active || ticket !== this.seq || this.word !== word) return;
        tip.textContent = `${hex} ${word}`;
        this.place(x, y);
      });
    },
    place(x, y) {
      const tip = this.tip;
      tip.style.left = Math.max(4, Math.min(x + 14, innerWidth - tip.offsetWidth - 8)) + 'px';
      tip.style.top = Math.max(4, Math.min(y + 18, innerHeight - tip.offsetHeight - 8)) + 'px';
    },
    hide() {
      this.word = '';
      if (this.tip) this.tip.hidden = true;
    },
    async digest(word) {
      if (this.cache.has(word)) return this.cache.get(word);
      const bytes = new TextEncoder().encode(word);
      const buf = await crypto.subtle.digest('SHA-256', bytes);
      const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
      this.cache.set(word, hex);
      return hex;
    },
    restore() {
      this.active = false;
      body.removeEventListener('mousemove', this.onMove);
      this.tip?.remove();
      this.tip = null;
      this.word = '';
    },
    pill() {
      return this.active ? 'hashing' : null;
    },
  };

  /* Find the word under a point without touching the DOM. */
  const wordAt = (x, y) => {
    let node = null;
    let offset = 0;
    if (D.caretPositionFromPoint) {
      const pos = D.caretPositionFromPoint(x, y);
      if (pos) {
        node = pos.offsetNode;
        offset = pos.offset;
      }
    } else if (D.caretRangeFromPoint) {
      const range = D.caretRangeFromPoint(x, y);
      if (range) {
        node = range.startContainer;
        offset = range.startOffset;
      }
    }
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;
    const text = node.textContent;
    const wordChar = /[\w'’\u00C0-\u024F-]/;
    let start = offset;
    let end = offset;
    while (start > 0 && wordChar.test(text.charAt(start - 1))) start -= 1;
    while (end < text.length && wordChar.test(text.charAt(end))) end += 1;
    const word = text.slice(start, end);
    return /[\dA-Za-z\u00C0-\u024F]/.test(word) ? word : null;
  };

  /* ------------------------------------------------------------------ */
  /* Toy 7: view-source skin                                            */
  /* ------------------------------------------------------------------ */

  const renderSource = (code, src) => {
    const addText = (t) => {
      if (t) code.appendChild(D.createTextNode(t));
    };
    const span = (cls, t) => code.appendChild(ce('span', cls, t));
    const tagRe = /(<!--[\s\S]*?-->)|(<\/?)([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?>)/g;
    const attrRe = /([\w:.-]+)(\s*=\s*)("[^"]*"|'[^']*')|([\w:.-]+)/g;
    let last = 0;
    let m;
    while ((m = tagRe.exec(src))) {
      addText(src.slice(last, m.index));
      if (m[1]) {
        span('tok-comment', m[1]);
      } else {
        span('tok-punct', m[2]);
        span('tok-tag', m[3]);
        const attrs = m[4] || '';
        let attrLast = 0;
        let am;
        attrRe.lastIndex = 0;
        while ((am = attrRe.exec(attrs))) {
          addText(attrs.slice(attrLast, am.index));
          if (am[4]) {
            span('tok-attr', am[4]);
          } else {
            span('tok-attr', am[1]);
            addText(am[2]);
            const quoted = am[3];
            const inner = quoted.slice(1, -1);
            if (am[1].toLowerCase() === 'href') {
              addText(quoted.charAt(0));
              const a = ce('a', 'tok-link', inner);
              try {
                a.href = new URL(inner, location.href).href;
              } catch (_) {
                a.removeAttribute('href');
                a.className = 'tok-val';
              }
              code.appendChild(a);
              addText(quoted.charAt(0));
            } else {
              span('tok-val', quoted);
            }
          }
          attrLast = attrRe.lastIndex;
        }
        addText(attrs.slice(attrLast));
        span('tok-punct', m[5]);
      }
      last = tagRe.lastIndex;
    }
    addText(src.slice(last));
  };

  const source = {
    node: null,
    get active() {
      return !!this.node;
    },
    press() {
      if (this.active) this.restore();
      else this.start();
    },
    start() {
      const clone = root.cloneNode(true);
      clone.querySelectorAll('[data-toybox]').forEach((n) => n.remove());
      clone.querySelectorAll('#toybox-css').forEach((n) => n.remove());
      clone.querySelectorAll('script[src*="toybox.js"]').forEach((n) => n.remove());
      const node = ce('div', 'toy-src');
      const bar = ce('p', 'toy-src__bar', 'view-source skin: the page wearing itself. reload to close.');
      const pre = ce('pre');
      const code = ce('code');
      renderSource(code, `<!DOCTYPE html>\n${clone.outerHTML}`);
      pre.appendChild(code);
      node.append(bar, pre);
      toyRoot.appendChild(node);
      this.node = node;
    },
    restore() {
      this.node?.remove();
      this.node = null;
    },
    pill() {
      return this.active ? 'source on' : null;
    },
  };

  /* ------------------------------------------------------------------ */
  /* Footer controller: the mystery ? buttons                           */
  /* ------------------------------------------------------------------ */

  const TOYS = [chaos, tilt, burn, grav, panic, hash, source];
  const activeCount = () => TOYS.reduce((n, t) => n + (t.active ? 1 : 0), 0);

  const buttons = Array.from(D.querySelectorAll('.site-footer__mystery'));
  const restoreBtn = D.querySelector('.site-footer__restore');
  const slotOf = (button) => Number(button.dataset.toySlot || 0);

  /* Secret per-load assignment: the toys are shuffled and the first
     buttons.length of them are dealt, so the map changes every visit. */
  const deck = TOYS.slice();
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const slots = deck.slice(0, Math.max(1, buttons.length));

  const sync = () => {
    buttons.forEach((button) => {
      const toy = slots[slotOf(button)];
      const on = Boolean(toy && toy.active);
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', String(on));
    });
    if (restoreBtn) restoreBtn.hidden = activeCount() === 0;
  };

  /* Toys can end on their own (tilt stands back up, the chaos ladder
     finishes); poll while anything runs so the footer stays honest. */
  let poll = 0;
  const watch = () => {
    clearInterval(poll);
    poll = setInterval(() => {
      sync();
      if (activeCount() === 0) clearInterval(poll);
    }, 1000);
  };

  const restoreAll = () => {
    TOYS.forEach((toy) => toy.restore());
    sync();
  };

  const go = (slot) => {
    const toy = slots[slot];
    if (!toy) return;
    toy.press();
    /* The box leaks: sometimes a second mystery escapes with the first. */
    const idle = TOYS.filter((t) => !t.active && t !== toy);
    if (idle.length && activeCount() < 3 && Math.random() < 0.16) {
      idle[Math.floor(Math.random() * idle.length)].press();
    }
    sync();
    watch();
  };

  window.__dtToy = { go, restore: restoreAll };

  buttons.forEach((button) => {
    button.addEventListener('click', () => go(slotOf(button)));
  });

  if (restoreBtn) {
    restoreBtn.addEventListener('click', () => {
      restoreAll();
      toast('everything is back the way it was.');
    });
  }

  D.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panic.active) {
      panic.restore();
      sync();
    }
  });

  /* A press may have queued before this file finished loading. */
  if (typeof window.__dtToyPending === 'number') {
    const pending = window.__dtToyPending;
    delete window.__dtToyPending;
    go(pending);
  }
})();
