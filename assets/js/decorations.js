/* Only named decorative chrome is observed. No animation discovery, scroll
   polling, or rules for arbitrary descendants (including game SVG/canvas). */
(() => {
  'use strict';
  if (window.__dtDecorations) return;
  const D = document;
  const root = D.documentElement;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const records = new Map();
  let away = false;
  const observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const record = records.get(entry.target);
        if (!record) return;
        record.visible = entry.isIntersecting;
        update(record);
      });
    }) : null;

  const update = (record) => {
    const running = !away && !D.hidden && !motion.matches && record.visible && record.target.isConnected;
    if (running === record.running) return;
    record.running = running;
    [...record.listeners].forEach((listener) => listener(running));
  };
  const refresh = () => {
    root.classList.toggle('dt-decorations-paused', away || D.hidden || motion.matches);
    records.forEach(update);
  };
  const watch = (target, listener) => {
    let record = records.get(target);
    if (!record) {
      record = { target, listeners: new Set(), visible: !observer, running: undefined };
      records.set(target, record);
      if (!away) observer?.observe(target);
    }
    record.listeners.add(listener);
    // Deliver the initial state even when another subscriber already watches it.
    if (record.running === undefined) update(record);
    else listener(record.running);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      record.listeners.delete(listener);
      if (record.listeners.size) return;
      observer?.unobserve(target);
      records.delete(target);
    };
  };
  window.__dtDecorations = { watch };

  const mark = (target, className) => {
    target.classList.add(className);
    return watch(target, (running) => target.classList.toggle('dt-decoration-paused', !running));
  };
  D.querySelectorAll('.site-footer__mystery, .skin-dice__face').forEach((target) => mark(target, 'dt-decoration'));
  // Observe the originating element but pause only its cursor pseudo-element.
  D.querySelectorAll('.site-brand__name').forEach((target) => mark(target, 'dt-decoration-after'));

  // The locked article adds/removes its rain asynchronously. Observe just that
  // container, never the whole document or the decrypted article's animations.
  const rains = new Map();
  const boxes = Array.from(D.querySelectorAll('body[data-argon] .argon'));
  const scanRain = () => {
    rains.forEach((dispose, target) => {
      if (target.isConnected) return;
      dispose();
      rains.delete(target);
    });
    boxes.forEach((box) => {
      if (box.dataset.state === 'open') return;
      box.querySelectorAll('.argon-rain[aria-hidden="true"] > .argon-rain__row').forEach((target) => {
        if (!rains.has(target)) rains.set(target, mark(target, 'dt-decoration'));
      });
    });
  };
  const mutations = boxes.length && typeof MutationObserver === 'function' ? new MutationObserver(() => observeRain()) : null;
  const observeRain = () => {
    if (away) return;
    mutations?.disconnect();
    boxes.forEach((box) => {
      if (box.isConnected && box.dataset.state !== 'open') mutations?.observe(box, { childList: true, subtree: true });
    });
    scanRain();
  };
  observeRain();
  D.addEventListener('visibilitychange', refresh);
  if (motion.addEventListener) motion.addEventListener('change', refresh);
  else motion.addListener?.(refresh);
  window.addEventListener('pagehide', () => {
    away = true;
    observer?.disconnect();
    mutations?.disconnect();
    refresh();
  });
  window.addEventListener('pageshow', () => {
    if (!away) return;
    away = false;
    records.forEach((record) => {
      // bfcache can restore a different scroll position. Wait for fresh entries.
      record.visible = !observer;
      observer?.observe(record.target);
    });
    observeRain();
    refresh();
  });
  refresh();
})();
