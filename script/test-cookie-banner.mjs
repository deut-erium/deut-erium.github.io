// Deterministic boundary and lifecycle checks; no sampled frequency estimate.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../assets/js/features/cookie-banner.js', import.meta.url), 'utf8');

function page(roll, { bannerPresent = true, storageBlocked = false, scriptSrc = null } = {}) {
  const links = [], timers = new Map(), frames = [], listeners = new Map();
  let draws = 0, storageAccesses = 0, cookieAccesses = 0, nextTimer = 0;
  const makeBanner = () => ({
    hidden: true, isConnected: true,
    addEventListener(name, fn) { this[name] = fn; },
    contains(target) { return Boolean(target?.button); },
    remove() { this.isConnected = false; },
  });
  let banner = bannerPresent ? makeBanner() : null;
  const panel = { hidden: true };
  const document = {
    getElementById(id) {
      if (id === 'cookie-banner') return banner?.isConnected ? banner : null;
      if (id === 'cookie-banner-prefs') return panel;
      return null;
    },
    createElement(tag) { assert.equal(tag, 'link'); return {}; },
    currentScript: scriptSrc ? { src: scriptSrc } : null,
    head: { appendChild(link) { links.push(link); } },
    addEventListener(name, fn, capture) {
      assert.equal(capture, true);
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn, capture) {
      assert.equal(capture, true);
      listeners.get(name)?.delete(fn);
    },
  };
  Object.defineProperty(document, 'cookie', {
    get() { cookieAccesses++; throw new Error('Unexpected cookie read'); },
    set() { cookieAccesses++; throw new Error('Unexpected cookie write'); },
  });
  const sandbox = {
    document, window: { __deuteriumAssetVersion: 'test' }, URL,
    Math: { random() { draws++; return roll; } },
    setTimeout(fn, delay) { assert.equal(delay, 400); timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { frames.push(fn); },
  };
  for (const key of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(sandbox, key, { get() {
      storageAccesses++;
      if (storageBlocked) throw new Error('Storage blocked');
      return { getItem() { return '1'; }, setItem() { assert.fail('Unexpected storage write'); } };
    } });
  }
  const context = vm.createContext(sandbox);
  const run = () => vm.runInContext(source, context);
  const flushFrames = () => { while (frames.length) frames.shift()(); };
  const flushTimers = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); };
  const key = value => [...(listeners.get('keydown') || [])].forEach(fn => fn({ key: value }));
  const button = (prefs = false) => ({
    button: true, expanded: 'false',
    closest(selector) { assert.equal(selector, 'button'); return this; },
    hasAttribute(name) { return name === 'data-prefs' && prefs; },
    getAttribute(name) { assert.equal(name, 'aria-expanded'); return this.expanded; },
    setAttribute(name, value) { assert.equal(name, 'aria-expanded'); this.expanded = value; },
  });
  return {
    run, links, timers, frames, panel, listeners, key, button, flushFrames, flushTimers,
    banner: () => banner, draws: () => draws, storageAccesses: () => storageAccesses,
    cookieAccesses: () => cookieAccesses,
    replaceBanner() { banner = makeBanner(); return banner; },
    click(target) { banner.click({ target }); },
  };
}

for (const roll of [0, 0.005, 0.009999999999999998]) {
  test(`draw ${roll} selects the banner and loads CSS once`, () => {
    const p = page(roll); p.run();
    assert.equal(p.draws(), 1);
    assert.equal(p.banner().hidden, true);
    assert.equal(p.links.length, 1);
    assert.equal(p.links[0].href, '/assets/css/features/cookie-banner.css?v=test');
    p.links[0].onload(); p.flushFrames();
    assert.equal(p.banner().hidden, false);
    p.run(); p.flushTimers();
    assert.equal(p.draws(), 1);
    assert.equal(p.links.length, 1);
  });
}
for (const roll of [0.01, 0.010000000000000002, 0.5, 0.9999999999999999, NaN]) {
  test(`draw ${roll} skips the banner without CSS, timers or listeners`, () => {
    const p = page(roll); p.run();
    assert.equal(p.draws(), 1);
    assert.equal(p.banner().isConnected, false);
    assert.equal(p.links.length, 0);
    assert.equal(p.timers.size, 0);
    assert.equal(p.listeners.size, 0);
    p.run(); p.replaceBanner(); p.run();
    assert.equal(p.draws(), 1, 'Replacing the node must not reroll this document');
    assert.equal(p.banner().hidden, true);
  });
}

test('exactly one of 100 equally spaced midpoint draws selects the banner', () => {
  let selected = 0;
  for (let i = 0; i < 100; i++) {
    const p = page((i + 0.5) / 100); p.run();
    selected += Number(p.links.length === 1);
  }
  assert.equal(selected, 1);
});

test('a document without the banner does not draw or request CSS', () => {
  const p = page(0, { bannerPresent: false }); p.run();
  assert.equal(p.draws(), 0);
  assert.equal(p.links.length, 0);
});

for (const storageBlocked of [false, true]) {
  test(`storage ${storageBlocked ? 'blocked' : 'with an old dismissal'} is never consulted`, () => {
    for (const roll of [0, 0.5]) {
      const p = page(roll, { storageBlocked }); p.run();
      if (roll === 0) { p.flushTimers(); p.click(p.button()); }
      assert.equal(p.storageAccesses(), 0);
      assert.equal(p.cookieAccesses(), 0);
      assert.equal(p.links.length, roll === 0 ? 1 : 0);
    }
  });
}

test('preferences toggle without dismissal or another draw', () => {
  const p = page(0); p.run(); p.flushTimers();
  const prefs = p.button(true);
  p.click(prefs);
  assert.equal(prefs.expanded, 'true');
  assert.equal(p.panel.hidden, false);
  p.click(prefs);
  assert.equal(prefs.expanded, 'false');
  assert.equal(p.panel.hidden, true);
  assert.equal(p.banner().isConnected, true);
  assert.equal(p.draws(), 1);
  p.key('Enter');
  assert.equal(p.banner().isConnected, true);
});

for (const action of ['accept', 'reject', 'Escape']) {
  test(`${action} dismisses and late stylesheet callbacks cannot reveal or reroll`, () => {
    const p = page(0); p.run();
    const lateLoad = p.links[0].onload;
    if (action === 'Escape') p.key('Escape'); else p.click(p.button());
    assert.equal(p.banner().isConnected, false);
    assert.equal(p.timers.size, 0);
    assert.equal(p.listeners.get('keydown').size, 0);
    assert.equal(p.links[0].onload, null);
    lateLoad(); p.flushFrames(); p.flushTimers(); p.run();
    assert.equal(p.banner().hidden, true);
    p.replaceBanner(); p.run();
    assert.equal(p.banner().hidden, true);
    assert.equal(p.draws(), 1);
    assert.equal(p.links.length, 1);
    const nextPage = page(0); nextPage.run(); nextPage.flushTimers();
    assert.equal(nextPage.banner().hidden, false, 'New documents get a fresh draw');
  });
}

test('deferred stylesheet follows the configured script baseurl', () => {
  const p = page(0, { scriptSrc: 'https://example.test/archive-test/assets/js/features/cookie-banner.js?v=test' });
  p.run();
  assert.equal(p.links[0].href, 'https://example.test/archive-test/assets/css/features/cookie-banner.css?v=test');
});

test('markup is hidden by default and shared CSS keeps hidden elements out of layout', () => {
  const markup = readFileSync(new URL('../_includes/cookie-banner.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../assets/css/main.css', import.meta.url), 'utf8');
  assert.match(markup, /<aside\b[^>]*\bid="cookie-banner"[^>]*\bhidden>/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.doesNotMatch(markup, /<noscript>/);
});
