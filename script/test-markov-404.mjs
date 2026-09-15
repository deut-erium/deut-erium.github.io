#!/usr/bin/env node
// Offline DOM fixture: execute the shipped script unchanged, without packages.
// BLOG_SITE optionally checks an existing Jekyll build too; it never builds.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../assets/js/features/markov-404.js', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../_layouts/404.html', import.meta.url), 'utf8');
const titles = ['Blue river flows', 'Red river freezes', 'Green river runs'];

function fixture({ candidates = titles, raw, initial = titles[0], missing = [], roll = 0 } = {}) {
  const forbidden = [], changes = [];
  let draws = 0;
  const deny = name => { forbidden.push(name); throw new Error(`Unexpected ${name}`); };
  class Element extends EventTarget {
    constructor(text = '') { super(); this.text = text; this.hidden = false; this.disabled = false; this.listeners = []; }
    get textContent() { return this.text; }
    set textContent(value) { assert.equal(typeof value, 'string'); this.text = value; changes.push(value); }
    set innerHTML(_) { deny('innerHTML'); }
    set outerHTML(_) { deny('outerHTML'); }
    insertAdjacentHTML() { deny('insertAdjacentHTML'); }
    focus() { deny('focus'); }
    appendChild() { deny('appendChild'); }
    addEventListener(name, callback, options) {
      this.listeners.push(name);
      super.addEventListener(name, callback, options);
    }
    click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
  }
  const title = new Element(initial);
  const button = new Element('Another nonexistent article');
  button.hidden = button.disabled = true;
  const data = new Element(raw ?? JSON.stringify(candidates));
  const elements = { 'markov-404-title': title, 'markov-404-another': button, 'markov-404-data': data };
  missing.forEach(id => { delete elements[id]; });
  const focused = {};
  const document = {
    getElementById(id) { return elements[id] || null; },
    createElement() { deny('createElement'); },
    get activeElement() { return focused; },
    get cookie() { return deny('cookie'); },
    set cookie(_) { deny('cookie'); },
  };
  const math = Object.create(Math);
  math.random = () => { draws++; return typeof roll === 'function' ? roll(draws) : roll; };
  const sandbox = { document, Math: math };
  for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Image', 'Worker',
    'navigator', 'location', 'localStorage', 'sessionStorage', 'setTimeout']) {
    Object.defineProperty(sandbox, name, { get() { return deny(name); } });
  }
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  return {
    title, button, document, focused, forbidden, changes,
    run() { vm.runInContext(source, context, { filename: 'markov-404.js', timeout: 1000 }); },
    draws: () => draws,
  };
}

test('without JS, the static title stays readable and the hidden disabled button is inert', () => {
  const page = fixture();
  page.button.click();
  assert.equal(page.title.textContent, titles[0]);
  assert.equal(page.button.hidden, true);
  assert.equal(page.button.disabled, true);
  assert.deepEqual(page.button.listeners, []);
  assert.deepEqual(page.changes, []);
  assert.equal(page.draws(), 0);
  assert.match(layout, /id="markov-404-another"[^>]*type="button"[^>]*hidden disabled>/);
  assert.match(layout, /id="markov-404-title"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(layout, /\{\{ _markov_titles\.first \| escape \}\}/);
  assert.match(layout, /<noscript><p>Enable JavaScript to try another title\.<\/p><\/noscript>/);
});

for (const roll of [0, 0.49, 0.9999999999999999]) {
  test(`load and repeated clicks select without immediate repeats at draw ${roll}`, () => {
    const page = fixture({ roll });
    page.run();
    assert.equal(page.draws(), 1);
    assert.notEqual(page.title.textContent, titles[0]);
    assert.equal(page.button.hidden, false);
    assert.equal(page.button.disabled, false);
    assert.deepEqual(page.button.listeners, ['click']);
    for (let i = 0; i < 100; i++) {
      const previous = page.title.textContent;
      page.button.click();
      assert.ok(titles.includes(page.title.textContent));
      assert.notEqual(page.title.textContent, previous);
    }
    assert.equal(page.draws(), 101);
    assert.equal(page.document.activeElement, page.focused);
    assert.deepEqual(page.forbidden, []);
  });
}

test('selection reaches every alternative slot, including when the static title is absent', () => {
  for (const initial of [...titles, 'Old static title']) {
    const choices = titles.filter(title => title !== initial);
    choices.forEach((expected, slot) => {
      const page = fixture({ initial, roll: (slot + 0.5) / choices.length });
      page.run();
      assert.equal(page.title.textContent, expected);
    });
  }
});

test('two candidates alternate even with a constant random draw', () => {
  const page = fixture({ candidates: titles.slice(0, 2) });
  page.run();
  for (let i = 0; i < 20; i++) {
    assert.equal(page.title.textContent, titles[i % 2 === 0 ? 1 : 0]);
    page.button.click();
  }
});

test('one distinct candidate stays static and offers no unusable control', () => {
  for (const candidates of [[titles[0]], [titles[0], titles[0]]]) {
    const page = fixture({ candidates });
    page.run(); page.button.click();
    assert.equal(page.title.textContent, titles[0]);
    assert.equal(page.button.hidden, true);
    assert.equal(page.button.disabled, true);
    assert.deepEqual(page.button.listeners, []);
    assert.equal(page.draws(), 1);
  }
});

test('empty, malformed, oversized and incomplete fixtures leave the fallback untouched', () => {
  const options = [
    { candidates: [] }, { raw: 'not json' }, { raw: '{' }, { candidates: null },
    { candidates: {} }, { candidates: 'title' }, { candidates: [null] },
    { candidates: ['', 'okay'] }, { candidates: ['   '] }, { candidates: [12] },
    { candidates: ['x'.repeat(321)] }, { candidates: Array(33).fill('title') },
    ...['markov-404-title', 'markov-404-data', 'markov-404-another'].map(id => ({ missing: [id] })),
  ];
  for (const option of options) {
    const page = fixture(option);
    page.run(); page.button.click();
    assert.equal(page.title.textContent, titles[0]);
    assert.equal(page.button.hidden, true);
    assert.equal(page.button.disabled, true);
    assert.deepEqual(page.button.listeners, []);
    assert.deepEqual(page.changes, []);
    assert.deepEqual(page.forbidden, []);
    assert.equal(page.draws(), 0);
  }
});

test('dangerous strings are inserted only as text, with no network or focus calls', () => {
  const attack = '</script><img src=x onerror="alert(1)"> & \' \u2028 \u2029';
  const page = fixture({ candidates: [titles[0], attack], raw: JSON.stringify([titles[0], attack]).replaceAll('<', '\\u003c') });
  page.run();
  assert.equal(page.title.textContent, attack);
  page.button.click();
  assert.equal(page.title.textContent, titles[0]);
  assert.deepEqual(page.forbidden, []);
  assert.equal(page.document.activeElement, page.focused);
});

test('maximum list and Unicode title sizes are accepted', () => {
  const candidates = Array.from({ length: 32 }, (_, i) => `Title ${i}`);
  candidates[31] = '\u{1f600}'.repeat(160);
  const page = fixture({ candidates, initial: candidates[0], roll: 0.9999999999999999 });
  page.run();
  assert.equal(page.title.textContent, candidates[31]);
  page.button.click();
  assert.equal(page.title.textContent, candidates[30]);
});

test('layout scopes assets to 404 and uses baseurl-safe, content-versioned paths', () => {
  for (const asset of ['/assets/js/features/markov-404.js', '/assets/css/features/markov-404.css']) {
    assert.ok(layout.includes(`{{ '${asset}' | relative_url }}?v={{ '${asset}' | asset_v }}`));
  }
  assert.match(layout, /if _markov_count > 0[\s\S]*<script defer src="[^\n]+markov-404\.js[\s\S]*else/);
  assert.match(layout, /No recombined title is available/);
  assert.match(layout, /'\/' \| relative_url/);
  assert.match(layout, /'\/archive\.html' \| relative_url/);
  assert.match(layout, /\{\{ content \}\}/);
  const css = readFileSync(new URL('../assets/css/features/markov-404.css', import.meta.url), 'utf8');
  assert.match(css, /\.error-shell \.markov-404 \[hidden\]\s*\{\s*display: none !important;/);
  assert.match(css, /button:focus-visible/);
});

if (process.env.BLOG_SITE) {
  test('built root and section 404s share candidates and resolve assets from nested missing routes', () => {
    const root = path.resolve(process.env.BLOG_SITE);
    const routes = ['404.html', 'WriteUps/404.html', 'ctf-tutorials/404.html', 'ramblings/404.html'];
    let expected;
    for (const route of routes) {
      const html = readFileSync(path.join(root, route), 'utf8');
      const raw = html.match(/<script id="markov-404-data" type="application\/json">(.*?)<\/script>/s)?.[1];
      assert.ok(raw, `${route}: missing embedded data`);
      const candidates = JSON.parse(raw);
      expected ??= candidates;
      assert.deepEqual(candidates, expected);
      assert.ok(candidates.length > 0 && candidates.length <= 32);
      assert.doesNotMatch(raw, /[<>&'\u2028\u2029]/);
      const page = fixture({ candidates, initial: candidates[0] });
      page.run(); page.button.click();
      assert.ok(candidates.includes(page.title.textContent));
      assert.deepEqual(page.forbidden, []);
      const assets = [...html.matchAll(/(?:src|href)="([^"]*\/assets\/(?:js|css)\/features\/markov-404\.(?:js|css)\?v=[a-f0-9]{8})"/g)].map(match => match[1]);
      assert.equal(assets.length, 2);
      for (const asset of assets) {
        assert.ok(asset.startsWith('/') && !asset.startsWith('//'));
        const resolved = new URL(asset, 'https://fixture.invalid/a/deep/missing/route');
        assert.equal(resolved.pathname + resolved.search, asset);
      }
    }
    assert.doesNotMatch(readFileSync(path.join(root, 'index.html'), 'utf8'), /markov-404/);
  });
}
