// Native, deterministic DOM/clock fixtures; no network, browser, or dependencies.
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { rulePreludes } from './css-rule-selectors.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const decorSource = read('assets/js/decorations.js');
const toySource = read('assets/js/features/toybox.js');
// Jekyll renders these two constructs before serving theme.js.
const themeSource = read('assets/js/theme.js').replace(/^---[\s\S]*?---\s*/, '')
  .replace(/const printHref = .*;/, "const printHref = '/assets/css/print.css?v=test';");

class Events {
  listeners = new Map();
  addEventListener(type, fn, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Map());
    this.listeners.get(type).set(fn, options);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, event = {}) {
    for (const [fn, options] of [...(this.listeners.get(type) || [])]) {
      if (options?.once) this.removeEventListener(type, fn);
      fn({ type, target: this, ...event });
    }
  }
}
class Classes {
  values = new Set();
  add(...names) { names.forEach(name => this.values.add(name)); }
  remove(...names) { names.forEach(name => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force = !this.contains(name)) { force ? this.add(name) : this.remove(name); return force; }
  toString() { return [...this.values].join(' '); }
}
class Style {
  values = new Map();
  setProperty(name, value, priority = '') { this.values.set(name, [value, priority]); }
  getPropertyValue(name) { return this.values.get(name)?.[0] || ''; }
  getPropertyPriority(name) { return this.values.get(name)?.[1] || ''; }
  removeProperty(name) { this.values.delete(name); }
}
class Element extends Events {
  constructor(tag, classes = '') {
    super(); this.tagName = tag.toUpperCase(); this.classList = new Classes();
    this.className = classes; this.children = []; this.dataset = {}; this.style = new Style();
    this.attrs = new Map(); this.hidden = false; this.id = ''; this.textContent = '';
  }
  set className(value) { this.classList.values = new Set(value.split(/\s+/).filter(Boolean)); }
  get className() { return this.classList.toString(); }
  get isConnected() { return this.tagName === 'HTML' || Boolean(this.parentNode?.isConnected); }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  hasAttribute(name) { return this.attrs.has(name); }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
  matches(selector) {
    if (selector === 'body[data-argon] .argon') return this.classList.contains('argon') && this.closest('body')?.hasAttribute('data-argon');
    if (selector === '.argon-rain[aria-hidden="true"] > .argon-rain__row') {
      return this.classList.contains('argon-rain__row') && this.parentNode?.classList.contains('argon-rain') && this.parentNode.getAttribute('aria-hidden') === 'true';
    }
    if (selector === 'a[href]') return this.tagName === 'A' && this.hasAttribute('href');
    if (selector === '[data-toybox]') return 'toybox' in this.dataset;
    if (selector.startsWith('#skin-picker option[value=')) return this.tagName === 'OPTION' && this.value === selector.match(/value="([^"]+)"/)[1];
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    return this.tagName.toLowerCase() === selector;
  }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
  querySelectorAll(selector) {
    const choices = selector.split(',').map(s => s.trim());
    const found = [];
    const visit = el => el.children.forEach(child => {
      if (choices.some(s => child.matches(s))) found.push(child);
      visit(child);
    });
    visit(this); return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  setPointerCapture(id) { this.capture = id; }
  releasePointerCapture(id) { if (this.capture === id) this.capture = null; }
  getBoundingClientRect() { throw new Error('Unexpected layout read'); }
}

function page({ reduced = false, io = true, shared = false, firstToy = null, context2d = true } = {}) {
  const window = new Events(), document = new Events(), motion = new Events(), scheme = new Events();
  motion.matches = reduced; scheme.matches = false;
  document.documentElement = new Element('html');
  document.head = document.documentElement.appendChild(new Element('head'));
  document.body = document.documentElement.appendChild(new Element('body'));
  document.hidden = false; document.readyState = 'complete'; document.baseURI = 'https://example.test/';
  document.querySelectorAll = selector => document.documentElement.querySelectorAll(selector);
  document.querySelector = selector => document.documentElement.querySelector(selector);
  const gradient = { addColorStop() {} };
  const ctx = { scale() {}, clearRect() {}, fillRect() {}, createLinearGradient: () => gradient };
  document.createElement = tag => {
    const el = new Element(tag);
    if (tag === 'canvas') el.getContext = () => context2d ? ctx : null;
    return el;
  };
  const add = (tag, cls, parent = document.body) => parent.appendChild(new Element(tag, cls));
  const buttons = [0, 1, 2].map(slot => {
    const button = add('button', 'site-footer__mystery');
    button.id = 'mystery-' + slot; button.dataset.toySlot = String(slot);
    // The loader is the sole mystery-click owner, before and after lazy load.
    button.addEventListener('click', () => window.__dtToy ? window.__dtToy.go(slot) : window.__dtToyPending = slot);
    return button;
  });
  const restore = add('button', 'site-footer__restore'); restore.hidden = true;
  const brand = add('strong', 'site-brand__name');
  const dice = add('button', 'skin-dice'), face = add('span', 'skin-dice__face', dice);
  const picker = add('select'); picker.id = 'skin-picker';
  picker.options = ['default', 'other'].map(value => {
    const option = add('option', '', picker); option.value = value; option.textContent = value; return option;
  });
  const sheet = add('link', '', document.head); sheet.id = 'skin-stylesheet';
  window.__deuteriumTheme = { colorKey: 'color', skinKey: 'skin', defaultSkin: 'default', skinFiles: { other: '/other.css' }, skinBase: '/' };
  const main = add('main');
  const game = add('div', 'game', main), svg = add('svg', '', game), canvas = add('canvas', '', game);
  const links = ['/a', '/b', '/c'].map(href => { const el = add('a', '', main); el.setAttribute('href', href); return el; });
  const frames = new Map(), timers = new Map(), observers = [], mutations = [];
  let now = 0, nextID = 0;
  class Intersection extends Events {
    targets = new Set();
    constructor(fn) { super(); this.fn = fn; observers.push(this); }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
  }
  class Mutation {
    targets = new Set();
    constructor(fn) { this.fn = fn; mutations.push(this); }
    observe(target, options) { assert.deepEqual({ ...options }, { childList: true, subtree: true }); this.targets.add(target); }
    disconnect() { this.targets.clear(); }
  }
  const math = Object.create(Math);
  let draws = 0;
  math.random = () => {
    const index = 6 - draws++;
    if (index < 1) return 0.25; // A derangement-producing draw, above the extra-toy threshold.
    return firstToy !== null && firstToy > 0 && index === firstToy ? 0 : 0.999999;
  };
  const sandbox = {
    window, document, URL, Math: math, console, TextEncoder, Node: { TEXT_NODE: 3 },
    location: { href: 'https://example.test/', origin: 'https://example.test' },
    localStorage: { getItem: () => null, setItem() {} },
    matchMedia: query => query.includes('reduced-motion') ? motion : scheme,
    performance: { now: () => now }, devicePixelRatio: 1, innerWidth: 800, innerHeight: 600,
    getComputedStyle: () => ({ backgroundColor: '#fff' }),
    requestAnimationFrame(fn) { frames.set(++nextID, fn); return nextID; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(fn, delay) { timers.set(++nextID, { fn, at: now + delay }); return nextID; },
    clearTimeout(id) { timers.delete(id); },
    setInterval() { assert.fail('No decorative/control polling interval is allowed'); },
    clearInterval() { assert.fail('Unexpected interval cleanup'); },
    MutationObserver: Mutation,
  };
  if (io) sandbox.IntersectionObserver = Intersection;
  const context = vm.createContext(sandbox);
  const run = source => vm.runInContext(source, context);
  const p = {
    window, document, buttons, restore, brand, dice, face, picker, game, svg, canvas, main, links,
    frames, timers, observers, mutations, add,
    runDecor: () => run(decorSource), runToy: () => run(toySource), runTheme: () => run(themeSource),
    intersect(target, visible) {
      observers.forEach(observer => {
        if (observer.targets.has(target)) observer.fn([{ target, isIntersecting: visible }]);
      });
    },
    hide(hidden = true) { document.hidden = hidden; document.emit('visibilitychange'); },
    reduce(value) { motion.matches = value; motion.emit('change', { matches: value }); },
    frame(delta = 16) { now += delta; const queue = [...frames.values()]; frames.clear(); queue.forEach(fn => fn(now)); },
    advance(delta) { now += delta; },
    flush() {
      let ticks = 0;
      while ([...timers.values()].some(job => job.at <= now)) {
        assert.ok(++ticks < 100, 'Timer loop must make progress');
        for (const [id, job] of [...timers]) if (job.at <= now) { timers.delete(id); job.fn(); }
      }
    },
    burnCanvas: () => document.querySelector('.toy-burn'),
    foreignWork: () => ({ frame: sandbox.requestAnimationFrame(() => {}), timer: sandbox.setTimeout(() => {}, 5000) }),
  };
  if (shared) p.runDecor();
  return p;
}

const paused = el => el.classList.contains('dt-decoration-paused');
const observeBurn = p => p.intersect(p.burnCanvas(), true);

test('explicit chrome and cursor targets pause offscreen without touching game nodes', () => {
  const p = page({ shared: true });
  assert.equal(p.observers.length, 1);
  assert.equal(p.observers[0].targets.size, 5); // Three buttons, face, cursor origin.
  for (const el of [...p.buttons, p.brand, p.face]) {
    assert.equal(paused(el), true);
    p.intersect(el, true); assert.equal(paused(el), false);
    p.intersect(el, false); assert.equal(paused(el), true);
  }
  assert.equal(p.brand.classList.contains('dt-decoration'), false, 'Only the cursor pseudo-element is marked');
  for (const el of [p.main, p.game, p.svg, p.canvas]) {
    assert.equal(p.observers[0].targets.has(el), false);
    assert.equal(el.className, el === p.game ? 'game' : '');
  }
  assert.equal(p.frames.size + p.timers.size, 0);
  p.runDecor(); assert.equal(p.observers.length, 1);
});

test('decorative reset/visibility handlers leave foreign game frames and timers alone', () => {
  const p = page({ shared: true }); p.runTheme(); p.runToy();
  const work = p.foreignWork();
  p.window.__dtToy.go(2); observeBurn(p);
  p.hide(); p.reduce(true); p.window.__dtToy.restore(); p.window.emit('pagehide');
  assert.equal(p.frames.has(work.frame), true);
  assert.equal(p.timers.has(work.timer), true);
  for (const el of [p.game, p.svg, p.canvas]) {
    assert.equal(el.classList.contains('dt-decoration'), false);
    assert.equal(el.classList.contains('dt-decoration-paused'), false);
  }
});

test('watch callbacks change once; hide, reduced motion, disposal, and bfcache do not duplicate subscriptions', () => {
  const p = page({ shared: true }), changes = [], target = p.add('div');
  const dispose = p.window.__dtDecorations.watch(target, running => changes.push(running));
  p.intersect(target, true); p.intersect(target, true);
  p.hide(); p.hide(); p.hide(false); p.hide(false);
  p.reduce(true); p.reduce(true); p.reduce(false);
  assert.deepEqual(changes, [false, true, false, true, false, true]);
  p.window.emit('pagehide', { persisted: true });
  assert.equal(p.observers[0].targets.size, 0);
  p.hide(false); assert.equal(changes.at(-1), false);
  p.window.emit('pageshow', { persisted: true }); p.window.emit('pageshow', { persisted: true });
  assert.equal(p.observers[0].targets.size, 6);
  assert.equal(changes.at(-1), false, 'Wait for restored intersection, not the old scroll position');
  p.intersect(target, true); assert.equal(changes.at(-1), true);
  dispose(); dispose();
  assert.equal(p.observers[0].targets.has(target), false);
  const count = changes.length;
  p.observers[0].fn([{ target, isIntersecting: false }]);
  assert.equal(changes.length, count);
});

test('shared observers support more than one subscriber and no-IO fallback', () => {
  const p = page({ io: false, shared: true }), changes = [];
  assert.equal(paused(p.buttons[0]), false);
  const stop = p.window.__dtDecorations.watch(p.buttons[0], running => changes.push(running));
  p.hide(); p.hide(false); p.reduce(true);
  assert.deepEqual(changes, [true, false, true, false]);
  stop(); p.reduce(false); assert.equal(paused(p.buttons[0]), false);
  assert.equal(p.frames.size + p.timers.size, 0);
});

test('argon discovery stays inside the locked container and stops after unlock', () => {
  const p = page(); p.document.body.setAttribute('data-argon', '');
  const box = p.add('div', 'argon'); p.runDecor();
  const mutation = p.mutations[0]; assert.deepEqual([...mutation.targets], [box]);
  const rain = p.add('div', 'argon-rain', box); rain.setAttribute('aria-hidden', 'true');
  const row = p.add('span', 'argon-rain__row', rain);
  mutation.fn(); assert.equal(paused(row), true);
  p.intersect(row, true); assert.equal(paused(row), false);
  p.window.emit('pagehide'); assert.equal(mutation.targets.size, 0);
  p.window.emit('pageshow'); assert.equal(mutation.targets.size, 1);
  box.dataset.state = 'open'; rain.remove(); mutation.fn();
  assert.equal(mutation.targets.size, 0);
  assert.equal(p.observers[0].targets.has(row), false);
});

for (const shared of [false, true]) {
  test(`burn has one frame across repeated visibility/motion notifications (shared=${shared})`, () => {
    const p = page({ shared }); p.window.__dtToyPending = 2; p.runToy();
    assert.equal('__dtToyPending' in p.window, false);
    assert.equal(p.frames.size, 0); observeBurn(p);
    assert.equal(p.frames.size, 1);
    p.runToy(); observeBurn(p); p.hide(false); p.reduce(false);
    assert.equal(p.frames.size, 1);
    assert.equal(p.document.querySelectorAll('#toybox-css').length, 1);
    const stale = [...p.frames.values()][0];
    p.frame(0); p.frame(1000);
    p.hide(); assert.equal(p.frames.size + p.timers.size, 0);
    p.advance(100000); p.hide(false); p.hide(false);
    stale(100001); assert.equal(p.frames.size, 1, 'Cancelled frames cannot fork the loop');
    p.frame(0); assert.ok(p.burnCanvas());
    p.reduce(true); assert.equal(p.frames.size, 0);
    assert.equal(p.burnCanvas().style.visibility, 'hidden');
    p.reduce(false); p.reduce(false); assert.equal(p.frames.size, 1);
    p.intersect(p.burnCanvas(), false); assert.equal(p.frames.size, 0);
    observeBurn(p); observeBurn(p); assert.equal(p.frames.size, 1);
    p.window.__dtToy.restore(); assert.equal(p.burnCanvas(), null);
    p.hide(); p.hide(false); p.reduce(true); p.reduce(false);
    assert.equal(p.frames.size + p.timers.size, 0);
    assert.equal(p.restore.hidden, true);
  });
}

test('burn started under reduced motion resumes once and releases resources at visual end', () => {
  const p = page({ reduced: true, shared: true }); p.runToy(); p.window.__dtToy.go(2); observeBurn(p);
  assert.equal(p.frames.size, 0);
  p.reduce(false); assert.equal(p.frames.size, 1);
  p.frame(0); p.frame(4000); assert.ok(p.burnCanvas());
  p.hide(); p.advance(10000); p.hide(false); p.frame(0);
  assert.ok(p.burnCanvas(), 'The fade keeps its active-time progress');
  p.frame(750); assert.equal(p.burnCanvas(), null);
  assert.equal(p.frames.size + p.timers.size, 0);
  assert.equal(p.restore.hidden, false, 'Static char remains explicitly resettable');
  p.hide(); p.hide(false); p.reduce(true); p.reduce(false);
  assert.equal(p.frames.size, 0, 'Finished visual effects never restart');
  assert.equal(p.observers[0].targets.size, 5);
  p.window.__dtToy.restore(); assert.equal(p.restore.hidden, true);
});

test('unavailable canvas context leaves only a static, resettable effect', () => {
  const p = page({ context2d: false }); p.runToy(); p.window.__dtToy.go(2);
  assert.equal(p.burnCanvas(), null); assert.equal(p.frames.size, 0);
  assert.equal(p.document.documentElement.classList.contains('tb-char'), true);
  p.window.__dtToy.restore(); assert.equal(p.document.documentElement.classList.contains('tb-char'), false);
});

test('the loader owns one click handler and all three control identities stay stable', () => {
  const p = page(); const ids = p.buttons.map(button => button.id);
  p.buttons[2].emit('click'); p.runToy(); observeBurn(p);
  assert.equal(p.frames.size, 1);
  assert.equal(p.buttons[2].listeners.get('click').size, 1);
  p.buttons[2].emit('click'); assert.equal(p.burnCanvas(), null);
  p.buttons[2].emit('click'); observeBurn(p); assert.equal(p.frames.size, 1);
  assert.deepEqual(p.buttons.map(button => button.id), ids);
  assert.deepEqual(p.buttons.map(button => button.dataset.toySlot), ['0', '1', '2']);
  p.window.__dtToy.restore(); assert.equal(p.frames.size + p.timers.size, 0);
});

test('chaos uses one deadline tick, not a footer poll; hidden expiry restores original links', () => {
  const p = page(); p.runToy(); const original = p.links.map(link => link.getAttribute('href'));
  p.window.__dtToy.go(0);
  assert.notDeepEqual(p.links.map(link => link.getAttribute('href')), original);
  assert.equal(p.timers.size, 2, 'One countdown timeout and one toast dismissal');
  p.hide(); assert.equal(p.timers.size, 0);
  p.advance(61000); p.hide(false); p.hide(false); assert.equal(p.timers.size, 2);
  p.flush(); assert.deepEqual(p.links.map(link => link.getAttribute('href')), original);
  assert.equal(p.document.querySelector('.toy-count').hidden, true);
  assert.equal(p.restore.hidden, true); assert.equal(p.timers.size, 0);
});

test('repeated chaos presses replace timers; reduced motion does not disable corrective deadlines', () => {
  const p = page({ reduced: true }); p.runToy();
  p.window.__dtToy.go(0); p.window.__dtToy.go(0);
  assert.equal(p.timers.size, 2);
  p.window.__dtToy.restore(); assert.equal(p.timers.size, 0);
  p.window.__dtToy.go(1); assert.equal(p.timers.size, 1);
  p.hide(); p.advance(31000); p.hide(false); p.flush();
  assert.equal(p.document.documentElement.classList.contains('tb-tilt'), false);
  assert.equal(p.restore.hidden, true); assert.equal(p.timers.size, 0);
});

test('reset cancels queued deadlines and old callbacks cannot remove a new effect', () => {
  const p = page(); p.runToy(); p.window.__dtToy.go(1);
  const stale = [...p.timers.values()][0].fn;
  p.window.__dtToy.restore(); p.window.__dtToy.restore();
  assert.equal(p.timers.size, 0);
  p.window.__dtToy.go(1); stale();
  assert.equal(p.document.documentElement.classList.contains('tb-tilt'), true);
  assert.equal(p.timers.size, 1);
  p.advance(30000); p.flush();
  assert.equal(p.document.documentElement.classList.contains('tb-tilt'), false);
  assert.equal(p.timers.size, 0);
});

test('static user-requested panic/hash effects need no footer timer', () => {
  for (const firstToy of [4, 5]) {
    const p = page({ firstToy }); p.runToy(); p.window.__dtToy.go(0);
    assert.equal(p.restore.hidden, false);
    assert.equal(p.frames.size + p.timers.size, 0);
    if (firstToy === 4) {
      p.document.emit('keydown', { key: 'Escape' });
      assert.equal(p.restore.hidden, true);
    } else {
      assert.equal(p.document.body.listeners.get('mousemove').size, 1);
      p.window.__dtToy.restore();
      assert.equal(p.document.body.listeners.get('mousemove').size, 0);
    }
    assert.equal(p.frames.size + p.timers.size, 0);
  }
});

test('pagehide resets active toys, timers, and observers; bfcache return does not replay effects', () => {
  const p = page({ shared: true }); p.runToy();
  p.window.__dtToy.go(0); p.window.__dtToy.go(1); p.window.__dtToy.go(2); observeBurn(p);
  assert.ok(p.timers.size); assert.equal(p.frames.size, 1);
  p.window.emit('pagehide', { persisted: true });
  assert.equal(p.frames.size + p.timers.size, 0); assert.equal(p.burnCanvas(), null);
  assert.equal(p.restore.hidden, true); assert.equal(p.observers[0].targets.size, 0);
  p.window.__dtToy.go(2); assert.equal(p.burnCanvas(), null, 'Do not activate a cached page');
  p.window.emit('pageshow', { persisted: true }); p.window.emit('pageshow', { persisted: true });
  assert.equal(p.frames.size + p.timers.size, 0);
  p.window.__dtToy.go(2); observeBurn(p); assert.equal(p.frames.size, 1);
});

test('gravity batches geometry reads and resets drag listeners, capture, and original inline styles', () => {
  const p = page({ firstToy: 3 });
  const events = [];
  p.main.children.forEach((el, i) => {
    el.getBoundingClientRect = () => { events.push('read'); return { height: 20, bottom: 30 * i }; };
    el.style.setProperty('transform', 'scale(1)', 'important');
    const set = el.style.setProperty.bind(el.style);
    el.style.setProperty = (...args) => { events.push('write'); set(...args); };
  });
  p.runToy(); p.window.__dtToy.go(0);
  assert.deepEqual(events.slice(0, p.main.children.length), p.main.children.map(() => 'read'));
  assert.equal(events.slice(p.main.children.length).includes('read'), false);
  const item = p.main.children[0];
  const down = { pointerType: 'mouse', button: 0, pointerId: 1, clientY: 100 };
  item.emit('pointerdown', down); item.emit('pointerdown', down);
  assert.equal(item.listeners.get('pointermove').size, 1);
  item.emit('pointermove', { pointerId: 1, clientY: 130 }); item.emit('pointerup');
  assert.equal(item.listeners.get('click').size, 1);
  p.reduce(true); assert.equal(item.style.getPropertyValue('transition'), 'none');
  p.window.__dtToy.restore();
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click']) assert.equal(item.listeners.get(type).size, 0);
  assert.equal(item.style.getPropertyValue('transform'), 'scale(1)');
  assert.equal(item.style.getPropertyPriority('transform'), 'important');
  assert.equal(item.capture, null); assert.equal(p.frames.size + p.timers.size, 0);
});

test('theme clicks coalesce to one frame; hidden/reduced/offscreen changes cancel only the flourish', () => {
  const p = page({ shared: true }); p.runTheme(); p.intersect(p.dice, true);
  p.dice.emit('click'); p.dice.emit('click'); p.dice.emit('click');
  assert.equal(p.frames.size, 1); assert.equal(p.picker.value, 'other');
  const stale = [...p.frames.values()][0];
  p.hide(); assert.equal(p.frames.size, 0); stale();
  assert.equal(p.dice.classList.contains('is-rolling'), false);
  p.hide(false); assert.equal(p.frames.size, 0);
  p.dice.emit('click'); p.frame(); p.frame(); assert.equal(p.dice.classList.contains('is-rolling'), true);
  p.reduce(true); assert.equal(p.dice.classList.contains('is-rolling'), false);
  p.dice.emit('click'); assert.equal(p.picker.value, 'other'); assert.equal(p.frames.size, 0);
  p.reduce(false); p.dice.emit('click'); assert.equal(p.frames.size, 1);
  p.intersect(p.dice, false); assert.equal(p.frames.size, 0);
  p.intersect(p.dice, true); p.dice.emit('click'); p.frame(); p.frame(); p.dice.emit('animationend', { animationName: 'skin-dice-roll' });
  assert.equal(p.dice.classList.contains('is-rolling'), false);
  p.runTheme(); assert.equal(p.dice.listeners.get('click').size, 1);
});

test('theme restart ignores cancellation of the previous roll and queues one frame at a time', () => {
  const p = page(); p.runTheme(); p.dice.emit('click'); p.frame(); p.frame();
  assert.equal(p.dice.classList.contains('is-rolling'), true);
  p.dice.emit('click'); assert.equal(p.frames.size, 1);
  p.frame(); assert.equal(p.frames.size, 1);
  p.dice.emit('animationcancel', { animationName: 'skin-dice-roll' });
  assert.equal(p.frames.size, 1);
  p.frame(); assert.equal(p.dice.classList.contains('is-rolling'), true);
  assert.equal(p.frames.size, 0);
  p.dice.emit('animationend', { animationName: 'skin-dice-roll' });
  assert.equal(p.dice.classList.contains('is-rolling'), false);
});

test('theme bfcache cleanup and reduced-motion fallback need no timer or shared script', () => {
  const p = page(); p.runTheme(); p.dice.emit('click'); assert.equal(p.frames.size, 1);
  p.window.emit('pagehide', { persisted: true }); assert.equal(p.frames.size, 0);
  p.window.emit('pageshow', { persisted: true }); assert.equal(p.frames.size, 0);
  p.dice.emit('click'); p.frame(); p.frame(); assert.equal(p.dice.classList.contains('is-rolling'), true);
  p.dice.emit('animationcancel', { animationName: 'skin-dice-roll' }); assert.equal(p.dice.classList.contains('is-rolling'), false);
  p.reduce(true); p.dice.emit('click'); assert.equal(p.frames.size + p.timers.size, 0);
});

test('CSS rule extraction succeeds with scoped pauses; skins define no extra keyframe animations', () => {
  const css = read('assets/css/components/decorations.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...rulePreludes(css)]; assert.ok(rules.length > 0);
  assert.doesNotMatch(css, /\*|\b(?:svg|canvas)\s*[,>{]/);
  assert.doesNotMatch(css, /animation\s*:|transition\s*:/);
  assert.match(css, /dt-decoration-after\.dt-decoration-paused::after/);
  assert.match(css, /animation-play-state:\s*paused\s*!important/);
  for (const file of readdirSync(new URL('../assets/css/skins/', import.meta.url)).filter(name => name.endsWith('.css'))) {
    const skin = read('assets/css/skins/' + file).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(skin, /@(?:-\w+-)?keyframes\b|animation(?:-name)?\s*:\s*(?!none\b|inherit\b|initial\b|unset\b)[\w-]+/i, file);
  }
  new vm.Script(themeSource); new vm.Script(toySource); new vm.Script(decorSource);
});
