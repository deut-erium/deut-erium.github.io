// Offline runtime tests for the browser scripts, using synthetic answers.
// This DOM subset handles only selectors used by the engine and rejects others.
// It does not parse HTML, lay out pages, load CSS, play audio, or draw confetti.
// Submit helpers await listener promises so native WebCrypto has settled before
// assertions; browsers do not await event listeners. Chromium remains separate.
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const sessionSource = readFileSync(new URL('../assets/js/chain-session.js', import.meta.url), 'utf8');
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
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
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
    if (selector === '[data-hint-for]') return Object.hasOwn(this.dataset, 'hintFor');
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
    verdict: () => form.children.find(child => child.classList.contains('flag-check__verdict')),
    reenter: () => form.descendants().find(child => Object.hasOwn(child.dataset, 'flagReenter')) };
}

function page(specs = [{}], { scriptURL = 'https://fixture.invalid/assets/js/challenge.js', version = 'test-v1',
                           localBlock, sessionBlock, stored = {}, sessionStored = {}, hints = [], digest } = {}) {
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
    assert.ok(['link', 'p', 'button', 'div', 'label', 'input', 'span'].includes(tag), `Unexpected element creation: ${tag}`);
    return new Element(tag);
  };
  const events = [];
  document.dispatchEvent = event => { events.push(event); for (const fn of document.listeners.get(event.type) || []) fn(event); return true; };
  const local = new Map(Object.entries({ 'deuterium-challenge-mute': '1', ...stored }));
  const session = new Map(Object.entries(sessionStored));
  const accesses = { local: { getter: 0, get: 0, set: 0 }, session: { getter: 0, get: 0, set: 0 } };
  const digests = [], network = [];
  let audioCalls = 0;
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
    AudioContext: class { constructor() { audioCalls++; throw new Error('Audio is outside this fixture'); } },
  };
  for (const [name, map, block, stats] of [['localStorage', local, localBlock, accesses.local], ['sessionStorage', session, sessionBlock, accesses.session]]) {
    Object.defineProperty(context, name, { get() {
      stats.getter++;
      if (block === 'getter') throw new Error('Storage getter blocked');
      return {
        removeItem(key) { if (block === 'set') throw new Error('Storage removal blocked'); map.delete(key); },
        getItem(key) { stats.get++; if (block === 'get') throw new Error('Storage read blocked'); return map.get(key) ?? null; },
        setItem(key, value) { stats.set++; if (block === 'set') throw new Error('Storage write blocked'); map.set(key, String(value)); },
      };
    } });
  }
  vm.runInNewContext(sessionSource, context, { filename: 'assets/js/chain-session.js', timeout: 2000 });
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
    engine: context.window.DeuteriumChallengeEngine, sessionAPI: context.window.DeuteriumChainSession,
    audioCalls: () => audioCalls, rerun: () => vm.runInNewContext(source, context),
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
    assert.equal(f.input.value, '', 'successful grading clears the raw input even without tab storage');
    assert.equal(f.reenter().hidden, false);
    assert.ok(f.form.classList.contains('is-solved'));
    assert.deepEqual(p.digests, [{ algorithm: 'SHA-256', bytes: f.answer + SALT }]);
    const saved = JSON.parse(p.local.get(SOLVES));
    assert.deepEqual(Object.keys(saved), [`id-${label}`]);
    assert.equal(saved[`id-${label}`].verified, true);
    assert.equal(Object.hasOwn(saved[`id-${label}`], 'flag'), false);
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
  assert.equal(JSON.parse(p.local.get(SOLVES)).synthetic.verified, true);
  assert.equal(p.local.get(SOLVES).includes('CTF{Synthetic-Case}'), false);
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

test('legacy plaintext fallback is refused and skips hashing', async () => {
  const p = page([{ hash: null, plaintext: 'flag{synthetic-legacy}' }]);
  expectVerdict(await p.submit('flag{synthetic-wrong}'), 'is-format', /Could not check/);
  expectVerdict(await p.submit('flag{synthetic-legacy}'), 'is-format', /Could not check/);
  assert.equal(p.local.has(SOLVES), false);
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
    assert.equal(p.forms[1].input.value, '');
    assert.ok(p.accesses.local.getter > 0);
    if (localBlock === 'set') assert.ok(p.accesses.local.set > 0);
    assert.equal(p.events.filter(event => event.type === 'deuterium:solved').length, 1);
  });
}

for (const sessionBlock of ['getter', 'get', 'set']) {
  test(`blocked sessionStorage ${sessionBlock} does not prevent a verdict`, async () => {
    const p = page([{}], { sessionBlock });
    expectVerdict(await p.submit(p.forms[0].answer), 'is-clear', /CLEARED/);
    assert.equal(p.forms[0].input.value, '');
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
    assert.match(p.forms[0].output.textContent, /Old local progress:.*Not verified/);
    assert.equal(p.forms[0].form.classList.contains('is-solved'), false);
    assert.deepEqual(JSON.parse(p.local.get(SOLVES)), { synthetic: { at: '2025-01-01T00:00:00Z', verified: false } });
    assert.equal(p.session.size, 0);
    assert.equal(p.digests.length, 0);
    assert.equal(p.events.length, 0);
    assert.equal(p.document.title.endsWith(' \u2713'), false);
    assert.equal(p.recordHead.querySelectorAll('.solved-badge').length, 0);
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

// Compatibility vectors remain synthetic. The 16-character hex salt matches
// the historical producer's shape; new helpers emit 32 characters.
test('16-character salt and explicit empty legacy salt still grade', async () => {
  for (const salt of ['0123456789abcdef', '']) {
    const p = page([{ salt }]);
    expectVerdict(await p.submit(p.forms[0].answer), 'is-clear', /CLEARED/);
    assert.equal(p.digests[0].bytes, p.forms[0].answer + salt);
  }
});

for (const salt of [' ', 'z'.repeat(16), '0'.repeat(15), '0'.repeat(17), '0'.repeat(31), '0'.repeat(33), 'abcd\n']) {
  test(`malformed nonempty salt (${JSON.stringify(salt)}) cannot grade even with a matching digest`, async () => {
    const p = page([{ salt }]);
    expectVerdict(await p.submit(p.forms[0].answer), 'is-format', /Could not check/);
    assert.equal(p.digests.length, 0);
    assert.equal(p.local.has(SOLVES), false);
  });
}
for (const hash of ['', 'f'.repeat(63), 'f'.repeat(65), 'g'.repeat(64), ' f'.repeat(32), '0'.repeat(64) + '\n']) {
  test(`invalid digest length/encoding (${JSON.stringify(hash)}) has no plaintext fallback`, async () => {
    const p = page([{ hash, plaintext: 'flag{synthetic-test-only}' }]);
    expectVerdict(await p.submit(p.forms[0].answer), 'is-format', /Could not check/);
    assert.equal(p.digests.length, 0);
    assert.equal(p.local.has(ATTEMPTS), false);
  });
}

test('init accepts a newly decrypted container or form and is idempotent, including script reevaluation', async () => {
  const p = page();
  const container = p.document.body.appendChild(new Element('section'));
  const extra = makeForm({ id: 'private-synthetic' }); container.appendChild(extra.form); p.forms.push(extra);
  const hint = container.appendChild(new Element('p', { 'data-hint': '1', 'data-hint-for': extra.id, hidden: '' }));
  p.engine.init(container); p.engine.init(extra.form); p.engine.init(p.document); p.rerun();
  assert.equal(extra.form.listeners.get('submit').length, 1);
  assert.equal(extra.input.listeners.get('input').length, 1);
  assert.equal(extra.form.children.filter(c => c.classList.contains('flag-check__session')).length, 1);
  assert.equal(extra.form.descendants().filter(c => Object.hasOwn(c.dataset, 'flagReenter')).length, 1);
  assert.equal(p.document.head.children.length, 1);
  assert.equal(p.document.listeners.get('deuterium:chain-session').length, 1);
  extra.form.children.find(c => c.classList.contains('flag-check__hints')).children[0].onclick();
  assert.equal(hint.hidden, false);
  expectVerdict(await p.submit(extra.answer, 1), 'is-clear', /CLEARED/);
});

test('a second submit during hashing is ignored rather than racing the first', async () => {
  let release;
  const p = page([{}], { digest: (algorithm, bytes) => new Promise(resolve => { release = () => resolve(webcrypto.subtle.digest(algorithm, bytes)); }) });
  const first = p.submit(p.forms[0].answer);
  await p.submit('flag{synthetic-wrong}');
  assert.equal(p.digests.length, 1);
  assert.equal(p.forms[0].button.disabled, true);
  release(); await first;
  expectVerdict(p.forms[0], 'is-clear', /CLEARED/);
  assert.equal(JSON.parse(p.local.get(ATTEMPTS)).synthetic, 1);
  assert.equal(p.events.filter(e => e.type === 'deuterium:solved').length, 1);
});

test('attempt counts continue across reloads and stale lower storage writes', async () => {
  const p = page([{}], { stored: { [ATTEMPTS]: '{"synthetic":17}' } });
  expectVerdict(await p.submit('flag{synthetic-wrong}'), 'is-again', /attempt 18/);
  p.local.set(ATTEMPTS, '{"synthetic":2}');
  await p.submit('flag{synthetic-wrong}');
  assert.equal(JSON.parse(p.local.get(ATTEMPTS)).synthetic, 19);
  p.local.set(ATTEMPTS, '{"synthetic":29}');
  await p.submit('flag{synthetic-wrong}');
  assert.equal(JSON.parse(p.local.get(ATTEMPTS)).synthetic, 30);
  const reload = page([{}], { stored: Object.fromEntries(p.local) });
  await reload.submit('flag{synthetic-wrong}');
  assert.equal(JSON.parse(reload.local.get(ATTEMPTS)).synthetic, 31);
  assert.equal(reload.session.size, 0);
});

test('attempt counts saturate at a safe integer, including blocked writes', async () => {
  const p = page([{}], { localBlock: 'set', stored: { [ATTEMPTS]: JSON.stringify({ synthetic: Number.MAX_SAFE_INTEGER }) } });
  await p.submit('flag{synthetic-wrong}'); await p.submit('flag{synthetic-wrong}');
  assert.equal(p.events.at(-1).detail.attempt, Number.MAX_SAFE_INTEGER);
  const fresh = page([{}], { localBlock: 'set' });
  await fresh.submit('flag{synthetic-wrong}'); await fresh.submit('flag{synthetic-wrong}');
  assert.equal(fresh.events.at(-1).detail.attempt, 2);
});

for (const bad of ['null', 'false', '7', '"text"', '[]', '{"synthetic":"3"}', '{"synthetic":-1}', '{"synthetic":1.5}', '{"synthetic":9007199254740992}']) {
  test(`corrupt progress values are type checked (${bad})`, async () => {
    const p = page([{}], { stored: { [SOLVES]: bad, [ATTEMPTS]: bad, 'deuterium-hints': bad } });
    await p.submit('flag{synthetic-wrong}');
    assert.deepEqual(JSON.parse(p.local.get(ATTEMPTS)), { synthetic: 1 });
    assert.deepEqual(JSON.parse(p.local.get(SOLVES)), {});
    assert.deepEqual(JSON.parse(p.local.get('deuterium-hints')), {});
  });
}

test('prototype keys are scrubbed; inherited Object names remain safe IDs', async () => {
  const p = page([{ id: '__proto__' }, { id: 'toString' }], { stored: {
    [SOLVES]: '{"__proto__":{"at":"2025-01-01T00:00:00Z","flag":"synthetic-secret"},"constructor":{"at":"2025-01-01T00:00:00Z","verified":true}}',
    [ATTEMPTS]: '{"__proto__":20,"constructor":10,"toString":"2"}',
    'deuterium-hints': '{"prototype":[1],"toString":{}}',
  } });
  expectVerdict(await p.submit(p.forms[0].answer), 'is-format', /Could not check/);
  expectVerdict(await p.submit(p.forms[1].answer, 1), 'is-clear', /CLEARED/);
  assert.deepEqual(Object.keys(JSON.parse(p.local.get(SOLVES))), ['toString']);
  assert.deepEqual(JSON.parse(p.local.get(ATTEMPTS)), { toString: 1 });
  assert.equal({}.at, undefined);
});

test('hints are capped at three unique valid levels and corrupt lists are dropped', () => {
  const p = page([{}], { hints: [1, 2, 3, 4, 'x', 1].map(number => ({ id: 'synthetic', number })),
    stored: { 'deuterium-hints': '{"synthetic":[1,1],"other":[0,4]}' } });
  const buttons = p.forms[0].form.children.find(c => c.classList.contains('flag-check__hints')).children;
  assert.equal(buttons.length, 3);
  for (const b of buttons) { b.onclick(); b.onclick(); }
  assert.deepEqual(JSON.parse(p.local.get('deuterium-hints')), { synthetic: [1, 2, 3] });
  assert.ok(p.hintNodes.slice(3).every(h => h.hidden));
});

test('migration scrubs every legacy flag without silent session handoff and preserves timestamps', async () => {
  const at = '2025-01-01T00:00:00Z';
  const p = page([{}], { stored: { [SOLVES]: JSON.stringify({ synthetic: { at, flag: 'synthetic-old-answer' }, unrelated: { at, flag: 'synthetic-private-answer' } }) },
    sessionStored: { 'deuterium-chain-session': '{"version":1,"enabled":true,"answers":{}}' } });
  assert.deepEqual(JSON.parse(p.local.get(SOLVES)), { synthetic: { at, verified: false }, unrelated: { at, verified: false } });
  assert.deepEqual(JSON.parse(p.session.get('deuterium-chain-session')).answers, {});
  await p.submit(p.forms[0].answer);
  assert.deepEqual(JSON.parse(p.local.get(SOLVES)).synthetic, { at, verified: true });
  assert.equal(p.sessionAPI.recall('synthetic'), p.forms[0].answer);
  assert.equal(p.sessionAPI.recall('unrelated'), null);
});

test('verified answer-free receipt restores local UI without new events or hashing', () => {
  const p = page([{}], { stored: { [SOLVES]: '{"synthetic":{"at":"2025-01-01T00:00:00Z","verified":true}}' } });
  expectVerdict(p.forms[0], 'is-clear', /CLEARED/);
  assert.equal(p.events.length, 0); assert.equal(p.digests.length, 0);
});

for (const restored of [false, true]) {
  test(`${restored ? 'restored receipt' : 'live success'} can re-enter without erasing progress and remember only a fresh correct grade`, async () => {
    const at = '2025-01-01T00:00:00Z';
    const p = page([{}], { stored: {
      ...(restored ? { [SOLVES]: JSON.stringify({ synthetic: { at, verified: true } }) } : {}),
      [ATTEMPTS]: '{"synthetic":8}', 'deuterium-hints': '{"synthetic":[1]}',
    }, hints: [{ id: 'synthetic', number: 1 }] });
    const f = p.forms[0], reenter = f.reenter();
    assert.equal(reenter.type, 'button');
    assert.equal(reenter.textContent, 'Enter answer again');
    if (!restored) {
      assert.equal(reenter.hidden, true);
      await p.submit(f.answer);
      assert.ok(f.form.classList.contains('is-ribbon'));
    }
    assert.equal(reenter.hidden, false);
    assert.equal(f.input.value, '');
    assert.equal(p.sessionAPI.recall(f.id), null);
    const controls = f.form.children.find(c => c.classList.contains('flag-check__session'));
    const opt = controls.children[0].children[0]; opt.checked = true; opt.onchange();
    assert.equal(p.sessionAPI.recall(f.id), null, 'opting in cannot recover the cleared answer');
    const local = [...p.local.entries()], session = [...p.session.entries()];
    const events = p.events.length, digests = p.digests.length;
    const receipt = JSON.parse(p.local.get(SOLVES)).synthetic;
    const attempts = JSON.parse(p.local.get(ATTEMPTS)).synthetic;
    f.input.value = 'synthetic-stale-input';
    f.form.classList.add('is-shaking'); f.input.classList.add('is-bad');
    reenter.onclick();
    for (const token of ['is-solved', 'is-ribbon', 'is-shaking']) assert.equal(f.form.classList.contains(token), false);
    assert.equal(f.input.classList.contains('is-bad'), false);
    assert.equal(f.verdict().textContent, '');
    assert.equal(f.verdict().classList.contains('is-clear'), false);
    assert.equal(f.output.classList.contains('is-correct'), false);
    assert.equal(f.input.value, ''); assert.equal(f.input.focused, true);
    assert.equal(reenter.hidden, true);
    assert.deepEqual([...p.local.entries()], local);
    assert.deepEqual([...p.session.entries()], session);
    assert.equal(p.events.length, events); assert.equal(p.digests.length, digests);
    assert.equal(p.hintNodes[0].hidden, false);
    assert.equal(f.form.children.find(c => c.classList.contains('flag-check__hints')).children[0].disabled, true);
    assert.equal(p.recordHead.querySelectorAll('.solved-badge').length, 1);
    assert.ok(p.document.title.endsWith(' \u2713'));
    await p.submit('flag{synthetic-wrong}');
    expectVerdict(f, 'is-again', new RegExp('attempt ' + (attempts + 1)));
    assert.equal(p.sessionAPI.recall(f.id), null);
    assert.deepEqual(JSON.parse(p.local.get(SOLVES)).synthetic, receipt);
    await p.submit('  ' + f.answer + '  ');
    expectVerdict(f, 'is-clear', /CLEARED/);
    assert.equal(p.sessionAPI.recall(f.id), f.answer, 'remember the trimmed answer before clearing the input');
    assert.equal(f.input.value, ''); assert.equal(reenter.hidden, false);
    assert.ok(f.form.classList.contains('is-ribbon'));
    assert.deepEqual(JSON.parse(p.local.get(SOLVES)).synthetic, receipt);
    assert.equal(JSON.parse(p.local.get(ATTEMPTS)).synthetic, attempts + 2);
    assert.deepEqual(JSON.parse(p.local.get('deuterium-hints')), { synthetic: [1] });
    assert.equal(p.digests.length, digests + 2, 're-entry must grade again rather than trust the receipt');
    for (const { type, detail } of p.events) {
      assert.deepEqual(Object.keys(detail).sort(), type === 'deuterium:attempt' ? ['attempt', 'correct', 'id'] : type === 'deuterium:solved' ? ['at', 'id'] : ['enabled']);
    }
    assert.ok(!JSON.stringify(p.events).includes(f.answer));
    assert.ok(![...p.local.values()].some(value => value.includes(f.answer)));
  });
}

test('re-entry stays scoped to its form and does not clear remembered tab answers', async () => {
  const p = page([{ id: 'a' }, { id: 'b' }]); p.sessionAPI.setEnabled(true);
  for (let n = 0; n < 2; n++) await p.submit(p.forms[n].answer, n);
  const local = [...p.local.entries()], session = [...p.session.entries()], events = p.events.length;
  p.forms[0].reenter().onclick();
  assert.equal(p.forms[0].form.classList.contains('is-solved'), false);
  assert.ok(p.forms[1].form.classList.contains('is-solved'));
  assert.equal(p.forms[1].reenter().hidden, false);
  assert.deepEqual([...p.local.entries()], local); assert.deepEqual([...p.session.entries()], session);
  assert.equal(p.events.length, events);
  const reloaded = page([{ id: 'a' }, { id: 'b' }], { stored: Object.fromEntries(p.local) });
  assert.ok(reloaded.forms.every(f => f.form.classList.contains('is-solved') && !f.reenter().hidden));
});

test('checker session controls synchronize and event payloads never contain answers', async () => {
  const p = page([{ id: 'a' }, { id: 'b' }]);
  const controls = p.forms.map(f => f.form.children.find(c => c.classList.contains('flag-check__session')));
  const checkboxes = controls.map(c => c.children[0].children[0]);
  assert.ok(checkboxes.every(c => !c.checked));
  await p.submit(p.forms[0].answer);
  assert.equal(p.sessionAPI.recall('a'), null);
  checkboxes[1].checked = true; checkboxes[1].onchange();
  assert.ok(checkboxes.every(c => c.checked));
  assert.equal(p.sessionAPI.recall('a'), null, 'enabling does not copy old answers');
  await p.submit(p.forms[1].answer, 1);
  assert.equal(p.sessionAPI.recall('b'), p.forms[1].answer);
  const priorEvents = p.events.length, progress = [...p.local.entries()];
  controls[0].children[2].onclick();
  assert.equal(p.sessionAPI.recall('b'), null);
  assert.equal(p.sessionAPI.isEnabled(), false, 'clear cancels the opted-in preference');
  assert.equal(p.session.has('deuterium-chain-session'), false);
  assert.ok(checkboxes.every(c => !c.checked));
  assert.deepEqual(JSON.parse(JSON.stringify(p.events.slice(priorEvents))), [
    { type: 'deuterium:chain-session', detail: { enabled: false } },
  ]);
  assert.deepEqual([...p.local.entries()], progress, 'clear leaves answer-free progress intact');
  assert.equal(controls[0].children.find(c => c.role === 'status').textContent, 'Tab answers cleared. Tab answer storage off.');
  assert.match(controls[0].children[1].textContent, /relocks an unlocked encrypted article on this page/);
  assert.match(controls[0].children[1].textContent, /does not erase local progress, saved copies, or browser memory/);
  await p.submit(p.forms[1].answer, 1);
  assert.equal(p.session.has('deuterium-chain-session'), false, 'later correct answers are not saved without another opt-in');
  for (const { type, detail } of p.events) {
    const expected = type === 'deuterium:attempt' ? ['attempt', 'correct', 'id'] : type === 'deuterium:solved' ? ['at', 'id'] : ['enabled'];
    assert.deepEqual(Object.keys(detail).sort(), expected);
    assert.equal(JSON.stringify(detail).includes('synthetic-test-only'), false);
  }
  assert.equal([...p.local.values()].some(v => v.includes('synthetic-test-only')), false);
});

test('clear during checker hashing cancels storage opt-in without discarding the local verdict', async () => {
  let release;
  const p = page([{}], { digest: (algorithm, bytes) => new Promise(resolve => { release = () => resolve(webcrypto.subtle.digest(algorithm, bytes)); }) });
  p.sessionAPI.setEnabled(true);
  const first = p.submit(p.forms[0].answer);
  const controls = p.forms[0].form.children.find(c => c.classList.contains('flag-check__session'));
  const priorEvents = p.events.length;
  controls.children[2].onclick();
  assert.equal(controls.children[0].children[0].checked, false);
  assert.deepEqual(JSON.parse(JSON.stringify(p.events.slice(priorEvents))), [
    { type: 'deuterium:chain-session', detail: { enabled: false } },
  ]);
  release(); await first;
  expectVerdict(p.forms[0], 'is-clear', /CLEARED/);
  assert.equal(p.sessionAPI.isEnabled(), false);
  assert.equal(p.sessionAPI.recall('synthetic'), null);
  assert.equal(p.session.has('deuterium-chain-session'), false);
  assert.ok(!JSON.stringify(p.events).includes(p.forms[0].answer));
});

test('reduced-motion suppresses audio even when the stored mute preference is false', async () => {
  const p = page([{}], { stored: { 'deuterium-challenge-mute': 'false' } });
  await p.submit(p.forms[0].answer);
  assert.equal(p.audioCalls(), 0);
  const sound = p.forms[0].form.children.find(c => c.classList.contains('flag-check__sound'));
  assert.equal(sound.disabled, true);
});

const receiptDate = '2025-01-01T00:00:00Z';
const known = [{ id: 'synthetic', aliases: ['alias'], sha256: sha256('flag{synthetic-test-only}' + SALT), salt: SALT }];
const transfer = (extra = {}) => JSON.stringify({ version: 3, solves: { synthetic: { at: receiptDate, verified: true } }, attempts: { synthetic: 3 }, hints: { synthetic: [1, 3] }, ...extra });

test('version 3 import downgrades claimed verification, merges aliases and never lowers counts', async () => {
  const p = page([], { stored: { [ATTEMPTS]: '{"synthetic":11}', 'deuterium-hints': '{"synthetic":[2]}' } });
  const result = await p.engine.progress.importJSON(transfer(), known);
  assert.equal(result.imported, 1); assert.equal(result.verified, 0);
  const exported = JSON.parse(p.engine.progress.exportJSON());
  assert.equal(exported.version, 3);
  assert.deepEqual(exported.solves, { synthetic: { at: receiptDate, verified: false } });
  assert.deepEqual(exported.attempts, { synthetic: 11 });
  assert.deepEqual(exported.hints, { synthetic: [1, 2, 3] });
  await p.engine.progress.importJSON(transfer({ solves: { alias: { at: receiptDate, verified: false } } }), known);
  assert.deepEqual(Object.keys(JSON.parse(p.local.get(SOLVES))), ['synthetic']);
});

test('legacy imports verify salted, short-salt and unsalted flags then discard them', async () => {
  for (const salt of [SALT, '0123456789abcdef', '']) {
    const p = page([]), answer = 'flag{synthetic-test-only}';
    const meta = [{ id: 'synthetic', sha256: sha256(answer + salt), ...(salt ? { salt } : {}) }];
    const result = await p.engine.progress.importJSON(transfer({ version: 2, solves: { synthetic: { at: receiptDate, flag: answer } } }), meta);
    assert.equal(result.verified, 1);
    assert.deepEqual(JSON.parse(p.local.get(SOLVES)), { synthetic: { at: receiptDate, verified: true } });
    assert.equal(p.engine.progress.exportJSON().includes(answer), false);
    assert.equal(p.session.size, 0);
  }
});

test('legacy timestamp-only import remains unverified', async () => {
  const p = page([]);
  await p.engine.progress.importJSON(transfer({ version: 2, solves: { synthetic: receiptDate } }), known);
  assert.equal(JSON.parse(p.local.get(SOLVES)).synthetic.verified, false);
});

test('unknown local progress is exported without answers but unknown IDs cannot be imported', async () => {
  const p = page([], { stored: { [SOLVES]: JSON.stringify({ retired: { at: receiptDate, flag: 'synthetic-retired-secret' } }) } });
  const output = p.engine.progress.exportJSON();
  assert.deepEqual(JSON.parse(output).solves, { retired: { at: receiptDate, verified: false } });
  await assert.rejects(p.engine.progress.importJSON(output, known));
});

const badTransfers = [
  'null', '[]', 'false', '{}', '{', transfer({ version: 4 }), transfer({ extra: true }),
  transfer({ attempts: [] }), transfer({ attempts: { synthetic: '4' } }), transfer({ attempts: { synthetic: -1 } }),
  transfer({ attempts: { synthetic: 1.25 } }), transfer({ attempts: { synthetic: Number.MAX_SAFE_INTEGER + 1 } }),
  transfer({ hints: { synthetic: [1, 1] } }), transfer({ hints: { synthetic: [0] } }), transfer({ hints: { synthetic: [4] } }),
  transfer({ hints: { synthetic: ['1'] } }), transfer({ hints: { synthetic: [1, 2, 3, 4] } }), transfer({ hints: { synthetic: {} } }),
  transfer({ solves: [] }), transfer({ solves: { synthetic: { at: receiptDate, verified: 'true' } } }),
  transfer({ solves: { synthetic: { at: '2025-02-30T00:00:00Z', verified: true } } }),
  transfer({ solves: { synthetic: { at: '2100-01-01T00:00:00Z', verified: true } } }),
  transfer({ solves: { synthetic: { at: 'today', verified: true } } }),
  transfer({ solves: { synthetic: { at: 1735689600000, verified: true } } }),
  transfer({ solves: { synthetic: { at: receiptDate, verified: true, flag: 'flag{synthetic-test-only}' } } }),
  transfer({ solves: { unknown: { at: receiptDate, verified: true } } }),
  transfer({ attempts: { unknown: 4 } }), transfer({ hints: { unknown: [1] } }),
  transfer({ solves: JSON.parse('{"__proto__":{"at":"2025-01-01T00:00:00Z","verified":true}}') }),
  transfer({ version: 2, solves: { synthetic: { at: receiptDate, flag: '' } } }),
  transfer({ version: 2, solves: { synthetic: { at: receiptDate, flag: 'flag{synthetic-wrong}' } } }),
  transfer({ version: 2, solves: { synthetic: { at: receiptDate, flag: true } } }),
  transfer({ version: 2, solves: { synthetic: { at: receiptDate, flag: 'x'.repeat(4097) } } }),
  ' '.repeat(1024 * 1024 + 1),
];
for (const [n, text] of badTransfers.entries()) {
  test(`strict import rejects malformed or unverifiable file ${n + 1} without any writes`, async () => {
    const p = page([]);
    await assert.rejects(p.engine.progress.importJSON(text, known));
    assert.equal(p.local.has(SOLVES), false); assert.equal(p.local.has(ATTEMPTS), false); assert.equal(p.local.has('deuterium-hints'), false);
  });
}

test('legacy import rejects invalid checker metadata and digest failures before writing', async () => {
  const text = transfer({ version: 2, solves: { synthetic: { at: receiptDate, flag: 'flag{synthetic-test-only}' } } });
  for (const meta of [{ ...known[0], sha256: '' }, { ...known[0], salt: 'bad' }, { ...known[0], salt: null }]) {
    const p = page([]); await assert.rejects(p.engine.progress.importJSON(text, [meta]));
    assert.equal(p.local.has(SOLVES), false);
  }
  const p = page([], { digest: () => { throw new Error('Synthetic crypto unavailable'); } });
  await assert.rejects(p.engine.progress.importJSON(text, known));
  assert.equal(p.local.has(SOLVES), false);
});

test('import supports safe Object prototype-name IDs without inherited values', async () => {
  const p = page([]);
  await p.engine.progress.importJSON(transfer({ solves: { toString: { at: receiptDate, verified: false } }, attempts: { toString: 1 }, hints: { toString: [1] } }), [{ id: 'toString' }]);
  assert.deepEqual(JSON.parse(p.local.get(ATTEMPTS)), { toString: 1 });
  assert.deepEqual(JSON.parse(p.local.get('deuterium-hints')), { toString: [1] });
});

test('record bounds reject an oversized import and scrub oversized local JSON', async () => {
  const p = page([], { stored: { [SOLVES]: ' '.repeat(1024 * 1024 + 1) } });
  assert.deepEqual(JSON.parse(p.local.get(SOLVES)), {});
  const attempts = Object.fromEntries(Array.from({ length: 2049 }, (_, n) => ['id-' + n, 0]));
  await assert.rejects(p.engine.progress.importJSON(transfer({ attempts }), known));
});

test('valid offset and fractional legacy timestamps are preserved without flags', () => {
  for (const at of ['2025-01-01T01:00:00+01:00', '2025-01-01T00:00:00.1Z']) {
    const p = page([], { stored: { [SOLVES]: JSON.stringify({ synthetic: { at, flag: 'synthetic-legacy-answer' } }) } });
    assert.deepEqual(JSON.parse(p.local.get(SOLVES)), { synthetic: { at, verified: false } });
  }
});

test('scoreboard export filters private and retired IDs while preserving known aliases', async () => {
  const p = page([], { stored: {
    [SOLVES]: JSON.stringify({ alias: { at: receiptDate, verified: true }, private: { at: receiptDate, verified: true } }),
    [ATTEMPTS]: '{"alias":2,"private":5}', 'deuterium-hints': '{"alias":[1],"private":[2]}',
  } });
  const data = JSON.parse(p.engine.progress.exportJSON(known));
  assert.deepEqual(Object.keys(data.solves), ['alias']);
  assert.deepEqual(data.attempts, { alias: 2 }); assert.deepEqual(data.hints, { alias: [1] });
  assert.ok(p.local.get(SOLVES).includes('private'), 'export must not remove device-only records');
  const destination = page([]);
  await destination.engine.progress.importJSON(JSON.stringify(data), known);
  assert.equal(JSON.parse(destination.local.get(SOLVES)).synthetic.verified, false);
});

test('a detached decrypted root gets the current session setting on init', () => {
  const p = page([]); p.sessionAPI.setEnabled(true);
  const f = makeForm(); const container = new Element('section'); container.appendChild(f.form);
  p.engine.init(container); p.engine.init(container);
  const controls = f.form.children.find(c => c.classList.contains('flag-check__session'));
  assert.equal(controls.children[0].children[0].checked, true);
  assert.equal(f.form.listeners.get('submit').length, 1);
});


test('nested output registers without blocking the following checker', () => {
  const p = page([]), first = makeForm({ id: 'nested' }), second = makeForm({ id: 'following' });
  const output = first.form.querySelector('output');
  first.form.children.splice(first.form.children.indexOf(output), 1);
  const wrapper = new Element('div'); wrapper.appendChild(output); first.form.appendChild(wrapper);
  const root = new Element('section'); root.appendChild(first.form); root.appendChild(second.form);
  p.engine.init(root);
  assert.equal(first.form.listeners.get('submit').length, 1);
  assert.equal(second.form.listeners.get('submit').length, 1);
  assert.ok(wrapper.children.some(child => child.classList.contains('flag-check__verdict')));
});
