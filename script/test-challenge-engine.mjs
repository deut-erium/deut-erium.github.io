// Offline runtime tests for the unchanged browser script, using synthetic answers.
// This DOM subset handles only selectors used by the engine and rejects others.
// It does not parse HTML, lay out pages, load CSS, play audio, or draw confetti.
// Submit helpers await listener promises so native WebCrypto has settled before
// assertions; browsers do not await event listeners. Chromium remains separate.
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../assets/js/challenge.js', import.meta.url), 'utf8');
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const SALT = '0123456789abcdef0123456789abcdef';
const SOLVES = 'deuterium-solves', ATTEMPTS = 'deuterium-attempts';

class Element {
  constructor(tag, attributes = {}) {
    this.tagName = tag;
    this.attributes = {};
    this.dataset = {};
    this.children = [];
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.offsetWidth = 1;
    this.classList = {
      contains: token => this.className.split(/\s+/).includes(token),
      add: (...tokens) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...tokens])].join(' '); },
      remove: (...tokens) => { this.className = this.className.split(/\s+/).filter(token => !tokens.includes(token)).join(' '); },
    };
    for (const [name, value] of Object.entries(attributes)) this.setAttribute(name, value);
  }
  setAttribute(name, value) {
    value = String(value);
    this.attributes[name] = value;
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    else if (name === 'class') this.className = value;
    else if (['id', 'type', 'role'].includes(name)) this[name] = value;
    else if (['hidden', 'disabled'].includes(name)) this[name] = true;
  }
  appendChild(child) { this.children.push(child); return child; }
  insertBefore(child, reference) {
    const offset = this.children.indexOf(reference);
    assert.notEqual(offset, -1, 'insertBefore reference must be a child');
    this.children.splice(offset, 0, child);
    return child;
  }
  focus() { this.focused = true; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  querySelectorAll(selector) {
    const all = this.children.flatMap(child => [child, ...child.descendants()]);
    return all.filter(child => child.matches(selector));
  }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  matches(selector) {
    if (selector === '[data-flag-check]') return Object.hasOwn(this.dataset, 'flagCheck');
    if (selector === '[data-flag-input]') return Object.hasOwn(this.dataset, 'flagInput');
    if (selector === 'button[type="submit"]') return this.tagName === 'button' && this.type === 'submit';
    if (selector === 'output') return this.tagName === 'output';
    if (selector === '.record-head' || selector === '.solved-badge') return this.classList.contains(selector.slice(1));
    if (selector === '[data-hint]:not([data-hint-for])') return Object.hasOwn(this.dataset, 'hint') && !Object.hasOwn(this.dataset, 'hintFor');
    const hint = /^\[data-hint-for="([^"]+)"\]$/.exec(selector);
    if (hint) return this.dataset.hintFor === hint[1];
    throw new Error(`Unsupported fixture selector: ${selector}`);
  }
}

function makeForm({ id = 'synthetic', prefix, answer = `${prefix || 'flag'}{synthetic-test-only}`, salt = SALT,
                    hash = sha256(answer + salt), plaintext, omit = [] } = {}) {
  const attrs = { 'data-flag-check': '' };
  if (hash !== null) attrs['data-sha256'] = hash;
  if (salt !== null) attrs['data-salt'] = salt;
  if (prefix !== undefined) attrs['data-flag-prefix'] = prefix;
  if (plaintext !== undefined) attrs['data-answer'] = plaintext;
  const form = new Element('form', attrs);
  const input = new Element('input', { id: `flag-${id}`, 'data-flag-input': '', type: 'text' });
  const button = new Element('button', { type: 'submit', disabled: '' });
  button.textContent = 'Check flag';
  const output = new Element('output');
  output.textContent = 'The check runs locally in your browser.';
  for (const [kind, child] of [['input', input], ['button', button], ['output', output]]) {
    if (!omit.includes(kind)) form.appendChild(child);
  }
  return { id, form, input, button, output, answer,
    verdict: () => form.children.find(child => child.classList.contains('flag-check__verdict')) };
}

function page(specs = [{}], { scriptURL = 'https://fixture.invalid/assets/js/challenge.js', version = 'test-v1',
                           localBlock, sessionBlock, stored = {}, hints = [], digest } = {}) {
  const forms = specs.map(makeForm);
  const document = new Element('document');
  document.title = 'Synthetic challenge';
  document.currentScript = { src: scriptURL };
  document.head = document.appendChild(new Element('head'));
  document.body = document.appendChild(new Element('body'));
  const recordHead = document.body.appendChild(new Element('header', { class: 'record-head' }));
  for (const { form } of forms) document.body.appendChild(form);
  const hintNodes = hints.map(({ id, number, text = 'Synthetic clue' }) => {
    const attrs = { 'data-hint': number, hidden: '' };
    if (id !== undefined) attrs['data-hint-for'] = id;
    const hint = new Element('p', attrs);
    hint.textContent = text;
    document.body.appendChild(hint);
    return hint;
  });
  document.createElement = tag => {
    assert.ok(['link', 'p', 'button', 'div'].includes(tag), `Unexpected element creation: ${tag}`);
    return new Element(tag);
  };
  const events = [];
  document.dispatchEvent = event => { events.push(event); return true; };
  const local = new Map(Object.entries({ 'deuterium-challenge-mute': '1', ...stored }));
  const session = new Map();
  const accesses = { local: { getter: 0, get: 0, set: 0 }, session: { getter: 0, get: 0, set: 0 } };
  const digests = [], network = [];
  const context = {
    document,
    window: { __deuteriumAssetVersion: version, location: { href: 'https://fixture.invalid/unrelated/page/' } },
    URL, TextEncoder,
    crypto: { subtle: { digest: async (algorithm, bytes) => {
      digests.push({ algorithm, bytes: Buffer.from(bytes).toString('utf8') });
      return digest ? digest(algorithm, bytes) : webcrypto.subtle.digest(algorithm, bytes);
    } } },
    matchMedia: query => { assert.equal(query, '(prefers-reduced-motion:reduce)'); return { matches: true }; },
    CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } },
    fetch: (...args) => { network.push(args); throw new Error('Network is forbidden in this fixture'); },
    AudioContext: class { constructor() { throw new Error('Audio is outside this fixture'); } },
  };
  for (const [name, map, block, stats] of [['localStorage', local, localBlock, accesses.local], ['sessionStorage', session, sessionBlock, accesses.session]]) {
    Object.defineProperty(context, name, { get() {
      stats.getter++;
      if (block === 'getter') throw new Error('Storage getter blocked');
      return {
        getItem(key) { stats.get++; if (block === 'get') throw new Error('Storage read blocked'); return map.get(key) ?? null; },
        setItem(key, value) { stats.set++; if (block === 'set') throw new Error('Storage write blocked'); map.set(key, String(value)); },
      };
    } });
  }
  vm.runInNewContext(source, context, { filename: 'assets/js/challenge.js', timeout: 2000 });
  const submit = async (value, number = 0) => {
    const f = forms[number];
    f.input.value = value;
    const listeners = f.form.listeners.get('submit') || [];
    assert.equal(listeners.length, 1, 'exactly one submit handler must be initialized');
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    await Promise.all(listeners.map(listener => listener(event)));
    assert.equal(event.defaultPrevented, true, 'native submission must be cancelled');
    assert.equal(network.length, 0, 'grading must stay local');
    return f;
  };
  return { forms, document, recordHead, local, session, accesses, digests, events, hintNodes, submit,
    input(number = 0) { for (const listener of forms[number].input.listeners.get('input') || []) listener({}); } };
}

function expectVerdict(f, className, text) {
  assert.ok(f.verdict()?.classList.contains(className), `Expected ${className}, got ${f.verdict()?.className}: ${f.verdict()?.textContent}`);
  assert.match(f.verdict().textContent, text);
  assert.equal(f.button.disabled, false);
  assert.equal(f.button.textContent, 'Check flag');
}

for (const prefix of [undefined, 'CTF', 'SEKAI', 'zh3r0']) {
  const label = prefix || 'flag';
  test(`${label}: salted correct answer clears the form and preserves its progress ID`, async () => {
    const p = page([{ id: `id-${label}`, prefix }]);
    const f = p.forms[0];
    assert.equal(f.button.disabled, false);
    await p.submit(f.answer);
    expectVerdict(f, 'is-clear', /^CLEARED - /);
    assert.equal(f.output.textContent, 'Correct.');
    assert.ok(f.form.classList.contains('is-solved'));
    assert.deepEqual(p.digests, [{ algorithm: 'SHA-256', bytes: f.answer + SALT }]);
    const saved = JSON.parse(p.local.get(SOLVES));
    assert.deepEqual(Object.keys(saved), [`id-${label}`]);
    assert.equal(saved[`id-${label}`].flag, f.answer);
    assert.ok(Number.isFinite(Date.parse(saved[`id-${label}`].at)));
    assert.equal(p.events.filter(event => event.type === 'deuterium:solved').length, 1);
    assert.equal(p.events[0].detail.correct, true);
    assert.equal(p.events[0].detail.id, `id-${label}`);
  });

  test(`${label}: wrong-case prefix is a format error`, async () => {
    const p = page([{ prefix }]);
    const wrongCase = label === label.toUpperCase() ? label.toLowerCase() : label.toUpperCase();
    const f = await p.submit(`${wrongCase}{synthetic-test-only}`);
    expectVerdict(f, 'is-format', /WRONG FORMAT/);
    assert.ok(f.verdict().textContent.includes(`${label}{...}`));
    assert.ok(f.verdict().textContent.includes('case-sensitive'));
    assert.equal(p.local.has(SOLVES), false);
    assert.equal(p.events[0].detail.correct, false);
  });

  test(`${label}: well-formed wrong value is not a format error`, async () => {
    const p = page([{ prefix }]);
    const f = await p.submit(`${label}{synthetic-wrong-value}`);
    expectVerdict(f, 'is-wrong', /^WRONG FLAG/);
    assert.equal(JSON.parse(p.local.get(ATTEMPTS)).synthetic, 1);
    assert.equal(p.local.has(SOLVES), false);
  });
}

test('prefixes are per-form when all four formats share a page', async () => {
  const prefixes = [undefined, 'CTF', 'SEKAI', 'zh3r0'];
  const p = page(prefixes.map((prefix, n) => ({ id: `mixed-${n}`, prefix })));
  for (let n = 0; n < prefixes.length; n++) {
    const other = (n + 1) % prefixes.length;
    expectVerdict(await p.submit(p.forms[other].answer, n), 'is-format', /WRONG FORMAT/);
    expectVerdict(await p.submit(p.forms[n].answer, n), 'is-clear', /CLEARED/);
  }
  assert.deepEqual(Object.keys(JSON.parse(p.local.get(SOLVES))).sort(), ['mixed-0', 'mixed-1', 'mixed-2', 'mixed-3']);
  assert.equal(p.recordHead.querySelectorAll('.solved-badge').length, 1);
});

for (const value of ['flag{}', 'flag{{synthetic}}', 'flag{synthetic}{other}', 'flag-synthetic', 'flag{synthetic']) {
  test(`malformed braces are rejected: ${value}`, async () => {
    const p = page();
    expectVerdict(await p.submit(value), 'is-format', /WRONG FORMAT/);
    assert.equal(p.local.has(SOLVES), false);
  });
}

test('blank input requests a flag without hashing or counting an attempt', async () => {
  const p = page();
  const f = await p.submit(' \t\n ');
  expectVerdict(f, 'is-format', /^Enter a flag first\./);
  assert.equal(f.input.focused, true);
  assert.equal(p.digests.length, 0);
  assert.equal(p.events.length, 0);
  assert.equal(p.local.has(ATTEMPTS), false);
});

test('surrounding whitespace is trimmed but flag contents remain case-sensitive', async () => {
  const p = page([{ answer: 'CTF{Synthetic-Case}', prefix: 'CTF' }]);
  expectVerdict(await p.submit('CTF{synthetic-case}'), 'is-wrong', /WRONG FLAG/);
  expectVerdict(await p.submit(' \nCTF{Synthetic-Case}\t '), 'is-clear', /CLEARED/);
  assert.equal(JSON.parse(p.local.get(SOLVES)).synthetic.flag, 'CTF{Synthetic-Case}');
});

test('prefix regex metacharacters are matched literally', async () => {
  const prefix = 'C.TF+[x]';
  const p = page([{ prefix }]);
  expectVerdict(await p.submit('CxTFFx{synthetic-test-only}'), 'is-format', /WRONG FORMAT/);
  expectVerdict(await p.submit(`${prefix}{synthetic-wrong-value}`), 'is-wrong', /WRONG FLAG/);
  expectVerdict(await p.submit(p.forms[0].answer), 'is-clear', /CLEARED/);
});

test('wrong salt rejects the otherwise correct synthetic answer', async () => {
  const answer = 'flag{synthetic-test-only}';
  const p = page([{ answer, hash: sha256(answer + SALT), salt: 'f'.repeat(32) }]);
  expectVerdict(await p.submit(answer), 'is-wrong', /WRONG FLAG/);
  assert.equal(p.digests[0].bytes, answer + 'f'.repeat(32));
  assert.equal(p.local.has(SOLVES), false);
});

test('hashing uses flag plus salt, not salt plus flag', async () => {
  const answer = 'flag{synthetic-order-check}';
  const p = page([{ answer, hash: sha256(SALT + answer) }]);
  expectVerdict(await p.submit(answer), 'is-wrong', /WRONG FLAG/);
  assert.equal(p.digests[0].bytes, answer + SALT);
});

test('uppercase digest metadata and UTF-8 flag bytes work with native WebCrypto', async () => {
  const answer = 'flag{synthetic-\u03bb}';
  const p = page([{ answer, hash: sha256(answer + SALT).toUpperCase() }]);
  expectVerdict(await p.submit(answer), 'is-clear', /CLEARED/);
  assert.equal(p.digests[0].bytes, answer + SALT);
});

test('unsalted legacy hashes still grade', async () => {
  const answer = 'flag{synthetic-unsalted}';
  const p = page([{ answer, salt: null, hash: sha256(answer) }]);
  expectVerdict(await p.submit(answer), 'is-clear', /CLEARED/);
  assert.equal(p.digests[0].bytes, answer);
});

test('legacy plaintext fallback is exact and skips hashing', async () => {
  const p = page([{ hash: null, plaintext: 'flag{synthetic-legacy}' }]);
  expectVerdict(await p.submit('flag{synthetic-wrong}'), 'is-wrong', /WRONG FLAG/);
  expectVerdict(await p.submit('flag{synthetic-legacy}'), 'is-clear', /CLEARED/);
  assert.equal(p.digests.length, 0);
});

test('hash metadata takes precedence over any plaintext fallback', async () => {
  const p = page([{ plaintext: 'flag{synthetic-plaintext-bypass}' }]);
  expectVerdict(await p.submit('flag{synthetic-plaintext-bypass}'), 'is-wrong', /WRONG FLAG/);
  assert.equal(p.local.has(SOLVES), false);
});

for (const localBlock of ['getter', 'get', 'set']) {
  test(`blocked localStorage ${localBlock} does not abort initialization or grading`, async () => {
    const p = page([{ id: 'blocked-a' }, { id: 'blocked-b', prefix: 'SEKAI' }], { localBlock });
    assert.ok(p.forms.every(f => !f.button.disabled && f.verdict()));
    expectVerdict(await p.submit('flag{synthetic-wrong}'), 'is-wrong', /WRONG FLAG/);
    expectVerdict(await p.submit(p.forms[1].answer, 1), 'is-clear', /CLEARED/);
    assert.ok(p.accesses.local.getter > 0);
    if (localBlock === 'set') assert.ok(p.accesses.local.set > 0);
    assert.equal(p.events.filter(event => event.type === 'deuterium:solved').length, 1);
  });
}

for (const sessionBlock of ['getter', 'get', 'set']) {
  test(`blocked sessionStorage ${sessionBlock} does not prevent a verdict`, async () => {
    const p = page([{}], { sessionBlock });
    expectVerdict(await p.submit(p.forms[0].answer), 'is-clear', /CLEARED/);
    assert.ok(p.accesses.session.getter > 0);
  });
}

test('invalid stored JSON falls back without aborting form initialization', async () => {
  const p = page([{}], { stored: { [SOLVES]: '{invalid', [ATTEMPTS]: 'invalid', 'deuterium-hints': 'not-json', 'deuterium-challenge-mute': '{' } });
  expectVerdict(await p.submit(p.forms[0].answer), 'is-clear', /CLEARED/);
});

for (const scriptURL of ['https://fixture.invalid/assets/js/challenge.js',
                         'https://fixture.invalid/preview/assets/js/challenge.js?v=old',
                         'https://static.fixture.invalid/blog/assets/js/challenge.js']) {
  test(`stylesheet path follows the loaded script: ${new URL(scriptURL).pathname}`, () => {
    const p = page([{}], { scriptURL, version: 'fixture +/version' });
    assert.equal(p.document.head.children.length, 1);
    const link = p.document.head.children[0];
    const expected = new URL('../css/features/challenge.css', scriptURL);
    expected.searchParams.set('v', 'fixture +/version');
    assert.equal(link.rel, 'stylesheet');
    assert.equal(link.href, expected.href);
    assert.equal(p.forms[0].button.disabled, false);
  });
}

test('stylesheet URL works without an asset version', () => {
  const p = page([{}], { version: null });
  assert.equal(p.document.head.children[0].href, 'https://fixture.invalid/assets/css/features/challenge.css?v=');
});

for (const omit of ['input', 'button', 'output']) {
  test(`a malformed form missing ${omit} does not stop later forms`, async () => {
    const p = page([{ omit: [omit] }, { id: 'valid' }]);
    assert.equal(p.forms[0].form.listeners.has('submit'), false);
    expectVerdict(await p.submit(p.forms[1].answer, 1), 'is-clear', /CLEARED/);
  });
}

for (const storedSolve of ['2025-01-01T00:00:00Z', { at: '2025-01-01T00:00:00Z', flag: 'flag{synthetic-previous}' }]) {
  test(`existing ${typeof storedSolve === 'string' ? 'timestamp' : 'object'} progress survives initialization`, () => {
    const p = page([{}], { stored: { [SOLVES]: JSON.stringify({ synthetic: storedSolve }) } });
    expectVerdict(p.forms[0], 'is-clear', /CLEARED/);
    assert.equal(p.digests.length, 0);
    assert.equal(p.events.length, 0);
    assert.ok(p.document.title.endsWith(' \u2713'));
    assert.equal(p.recordHead.querySelectorAll('.solved-badge').length, 1);
  });
}

test('wrong attempts and hints stay scoped to their form', async () => {
  const p = page([{ id: 'a' }, { id: 'b' }], { hints: [{ id: 'a', number: 2 }, { id: 'b', number: 1 }, { id: 'a', number: 1 }] });
  for (let n = 0; n < 3; n++) await p.submit('flag{synthetic-wrong}', 0);
  expectVerdict(p.forms[0], 'is-again', /^WRONG AGAIN/);
  assert.deepEqual(JSON.parse(p.local.get(ATTEMPTS)), { a: 3 });
  assert.ok(p.hintNodes[0].classList.contains('is-highlighted'));
  assert.equal(p.hintNodes[1].classList.contains('is-highlighted'), false);
  assert.ok(p.hintNodes[2].classList.contains('is-highlighted'));
  const strip = p.forms[0].form.children.find(child => child.classList.contains('flag-check__hints'));
  strip.children[0].onclick();
  assert.equal(p.hintNodes[2].hidden, false);
  assert.equal(p.hintNodes[0].hidden, true);
  assert.deepEqual(JSON.parse(p.local.get('deuterium-hints')), { a: [1] });
  p.input(0);
  assert.equal(p.forms[0].input.classList.contains('is-bad'), false);
  assert.equal(p.forms[0].verdict().textContent, '');
});

test('a single legacy form can use unscoped hints', () => {
  const p = page([{}], { hints: [{ number: 1 }] });
  const strip = p.forms[0].form.children.find(child => child.classList.contains('flag-check__hints'));
  assert.ok(strip);
  strip.children[0].onclick();
  assert.equal(p.hintNodes[0].hidden, false);
});

test('digest failures restore the button and allow a later retry', async () => {
  let fail = true;
  const p = page([{}], { digest: (algorithm, bytes) => {
    if (fail) throw new Error('Synthetic digest failure');
    return webcrypto.subtle.digest(algorithm, bytes);
  } });
  expectVerdict(await p.submit(p.forms[0].answer), 'is-format', /Could not check the flag/);
  assert.equal(p.local.has(SOLVES), false);
  assert.equal(p.events.length, 0);
  fail = false;
  expectVerdict(await p.submit(p.forms[0].answer), 'is-clear', /CLEARED/);
});
