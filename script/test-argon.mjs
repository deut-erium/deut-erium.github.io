// Offline tests of the unchanged browser client with native WebCrypto.
// The DOM fixture does not parse HTML or load CSS/resources. Browser E2E is separate.
// All plaintexts and passwords here are synthetic; no historic articles are decrypted.
import { readFileSync } from 'node:fs';
import { webcrypto, pbkdf2Sync, createCipheriv } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { rulePreludes } from './css-rule-selectors.mjs';

const source = readFileSync(new URL('../assets/js/features/argon.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/features/argon.css', import.meta.url), 'utf8');
const ANSWER = 'flag{synthetic-client-test-only}';
const SALT = '0123456789abcdef0123456789abcdef';
const NEEDS = 'synthetic-predecessor';
const HTML = '<h2>Synthetic private article</h2><form data-flag-check><input data-flag-input></form>';
const FAILURE = 'Could not unlock the article. Check the flag and try again.';
const MAX_BYTES = 24 * 1024 * 1024;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

// Independent producer path: Node's OpenSSL cipher API, not the client's WebCrypto calls.
function envelope({ version = 2, plaintext = HTML, needs = NEEDS, salt = SALT, answer = ANSWER } = {}) {
  const iterations = version === 1 ? 120000 : 200000;
  const iv = Buffer.from('0102030405060708090a0b0c', 'hex'); // Fixed only in this synthetic fixture.
  const key = pbkdf2Sync(answer, Buffer.from(salt, 'hex'), iterations, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (version === 2) cipher.setAAD(Buffer.from(JSON.stringify(['deuterium-argon', 2, 200000, salt.toLowerCase(), needs])));
  const payload = Buffer.concat([iv, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]).toString('base64');
  return { payload, attrs: { 'data-salt': salt, 'data-needs': needs,
    ...(version === 2 ? { 'data-version': '2', 'data-iterations': '200000' } : {}) } };
}
const v1 = envelope({ version: 1 });
const v2 = envelope();

class Element {
  constructor(tag, attrs = {}) {
    this.tagName = tag;
    this.attrs = {};
    this.dataset = {};
    this.children = [];
    this.listeners = new Map();
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.className = '';
    this._text = '';
    this._html = '';
    this.htmlWrites = [];
    this.style = { setProperty() {} };
    this.classList = {
      contains: token => this.className.split(/\s+/).includes(token),
      add: token => { if (!this.classList.contains(token)) this.className += ` ${token}`; },
      remove: token => { this.className = this.className.split(/\s+/).filter(x => x !== token).join(' '); },
      toggle: (token, force) => { const enabled = force ?? !this.classList.contains(token); this.classList[enabled ? 'add' : 'remove'](token); return enabled; },
    };
    for (const [key, value] of Object.entries(attrs)) if (value !== null) this.setAttribute(key, value);
  }
  setAttribute(key, value) {
    value = String(value);
    this.attrs[key] = value;
    if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = value;
    if (key === 'class') this.className = value;
  }
  getAttribute(key) { return this.attrs[key] ?? null; }
  hasAttribute(key) { return Object.hasOwn(this.attrs, key); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(text) { this.replaceChildren(); this._text = String(text); }
  get innerHTML() { return this._html; }
  set innerHTML(html) { this.replaceChildren(); this._html = String(html); this.htmlWrites.push(this._html); }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  appendChild(node) {
    node.remove();
    node.parent = this;
    this.children.push(node);
    return node;
  }
  replaceChildren(...nodes) {
    this.children.forEach(node => { node.parent = null; });
    this.children = [];
    this._text = '';
    this._html = '';
    this.append(...nodes);
  }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  after(node) {
    assert.ok(this.parent);
    node.parent = this.parent;
    this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, node);
  }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  querySelector(selector) {
    assert.equal(selector, '.argon', 'fixture rejects unexpected selectors');
    return this.descendants().find(child => child.classList.contains('argon')) ?? null;
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  emit(type, detail) {
    const event = { type, detail, prevented: false, preventDefault() { this.prevented = true; } };
    const work = (this.listeners.get(type) ?? []).map(fn => fn(event));
    if (type === 'submit') assert.equal(event.prevented, true, 'no native key submission');
    return Promise.all(work);
  }
  focus() { this.focusCount = (this.focusCount || 0) + 1; }
}

function page(fixture = v2, options = {}) {
  const document = new Element('document');
  document.hidden = options.hidden ?? false;
  document.currentScript = { src: options.scriptURL ?? 'https://fixture.invalid/blog/assets/js/features/argon.js?old=1' };
  document.head = document.appendChild(new Element('head'));
  document.body = document.appendChild(new Element('body', { 'data-argon': '', ...options.bodyAttrs }));
  const box = document.body.appendChild(new Element('div', { class: 'argon', ...fixture.attrs, ...options.attrs }));
  box.textContent = options.payload ?? fixture.payload;
  document.createElement = tag => new Element(tag);
  const window = new Element('window');
  const emitted = [], operations = [], storageAccess = [], network = [], sessionCalls = [], engineCalls = [], eventErrors = [];
  document.dispatchEvent = window.dispatchEvent = event => { emitted.push(event); return true; };
  const entered = deferred(), release = deferred();
  let enabled = options.enabled ?? false;
  const saved = new Map(Object.entries(options.saved ?? {}));
  const blocked = name => {
    if (options.blocked === 'all' || options.blocked === name) throw new Error('Synthetic blocked storage');
  };
  const session = {
    isEnabled() { sessionCalls.push(['isEnabled']); blocked('isEnabled'); return enabled; },
    setEnabled(value) {
      sessionCalls.push(['setEnabled', value]); blocked('setEnabled'); enabled = value;
      if (!value) saved.clear();
      emitted.push({ type: 'deuterium:chain-session', detail: { enabled } });
      return document.emit('deuterium:chain-session', { enabled });
    },
    recall(id) { sessionCalls.push(['recall', id]); blocked('recall'); return enabled ? saved.get(id) : null; },
    remember(id, answer) {
      sessionCalls.push(['remember', id]); blocked('remember'); if (enabled) saved.set(id, answer);
      if (options.clearOnRemember) {
        document.descendants().find(node => node.tagName === 'button' && node.textContent === 'Clear saved answers and lock').emit('click');
      }
    },
    forget(id) { sessionCalls.push(['forget', id]); blocked('forget'); saved.delete(id); },
    clear() {
      sessionCalls.push(['clear']); blocked('clear'); saved.clear(); enabled = false;
      emitted.push({ type: 'deuterium:chain-session', detail: { enabled } });
      return document.emit('deuterium:chain-session', { enabled });
    },
  };
  if (options.blocked === 'getter') Object.defineProperty(window, 'DeuteriumChainSession', { get() { throw new Error('Synthetic blocked module'); } });
  else if (!options.missingSession) window.DeuteriumChainSession = session;
  window.DeuteriumChallengeEngine = {
    init(root) { engineCalls.push({ root, html: root.innerHTML, state: root.dataset.state }); if (options.engineThrows) throw new Error('Synthetic checker failure'); },
  };
  const subtle = {};
  for (const method of ['importKey', 'deriveKey', 'decrypt']) {
    subtle[method] = async (...args) => {
      const record = { method };
      if (method === 'deriveKey') Object.assign(record, { iterations: args[0].iterations, hash: args[0].hash,
        salt: Buffer.from(args[0].salt).toString('hex'), extractable: args[3], uses: [...args[4]] });
      if (method === 'decrypt') Object.assign(record, { aad: args[0].additionalData ? Buffer.from(args[0].additionalData).toString('utf8') : null,
        tagLength: args[0].tagLength, ivLength: args[0].iv.length });
      operations.push(record);
      if (options.unsupportedOperation === method) { const error = new Error('Synthetic unsupported algorithm'); error.name = 'NotSupportedError'; throw error; }
      const result = await webcrypto.subtle[method](...args);
      if (options.pauseStage === method) { entered.resolve(); await release.promise; }
      return result;
    };
  }
  let atobCalls = 0;
  const context = {
    document, window, URL, TextEncoder, TextDecoder,
    crypto: options.cryptoMissing ? undefined : { subtle },
    atob(text) { atobCalls++; if (options.atobThrows) throw new Error('Synthetic decoder failure'); return atob(text); },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    fetch(...args) { network.push(args); throw new Error('No network permitted'); },
    navigator: { sendBeacon(...args) { network.push(args); throw new Error('No telemetry permitted'); } },
  };
  if (options.decoderMissing) context.TextDecoder = undefined;
  let storageBlock;
  const realStored = new Map();
  if (options.enabled) realStored.set('deuterium-chain-session', JSON.stringify({ version: 1, enabled: true, answers: options.saved ?? {} }));
  const realStorage = {
    getItem(key) { if (storageBlock === 'get') throw new Error('Synthetic blocked read'); return realStored.get(key) ?? null; },
    setItem(key, value) { if (storageBlock === 'set' || storageBlock === 'all-writes') throw new Error('Synthetic blocked write'); realStored.set(key, value); },
    removeItem(key) { if (storageBlock === 'remove' || storageBlock === 'all-writes') throw new Error('Synthetic blocked remove'); realStored.delete(key); },
  };
  for (const name of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(context, name, { get() {
      if (options.realSession && name === 'sessionStorage') {
        if (storageBlock === 'getter') throw new Error('Synthetic blocked storage getter');
        return realStorage;
      }
      storageAccess.push(name); throw new Error('Client must use the shared module, not direct storage');
    } });
    Object.defineProperty(window, name, { get() { storageAccess.push(name); throw new Error('Client must use the shared module, not direct storage'); } });
  }
  if (options.realSession) {
    delete window.DeuteriumChainSession;
    document.dispatchEvent = event => {
      emitted.push(event);
      document.emit(event.type, event.detail).catch(error => eventErrors.push(error));
      return true;
    };
    const sessionSource = readFileSync(new URL('../assets/js/chain-session.js', import.meta.url), 'utf8');
    vm.runInNewContext(sessionSource, context, { filename: 'assets/js/chain-session.js', timeout: 2000 });
  }
  vm.runInNewContext(source, context, { filename: 'assets/js/features/argon.js', timeout: 10000 });
  document.currentScript = null;
  const nodes = document.descendants();
  const input = nodes.find(node => node.id === 'argon-key');
  const remember = nodes.find(node => node.id === 'argon-remember');
  const form = nodes.find(node => node.tagName === 'form');
  const button = nodes.find(node => node.type === 'submit');
  const clear = nodes.find(node => node.textContent === 'Clear saved answers and lock');
  const lock = nodes.find(node => node.type === 'button' && node !== clear);
  const note = nodes.find(node => node.id === 'argon-note');
  const rain = nodes.find(node => node.className === 'argon-rain');
  const p = { document, window, box, input, remember, form, button, clear, lock, note, rain, saved,
    session: options.realSession ? window.DeuteriumChainSession : session, storedSession: realStored,
    emitted, operations, storageAccess, network, sessionCalls, engineCalls, eventErrors, entered: entered.promise, release: release.resolve,
    blockStorage(method) { storageBlock = method; },
    get atobCalls() { return atobCalls; },
    submit(value = ANSWER) { input.value = value; return form.emit('submit'); },
    clickClear() { return clear.emit('click'); },
    clickLock() { return lock.emit('click'); },
    optIn(value = true) { remember.checked = value; return remember.emit('change'); },
    async sessionEvent(value) { enabled = value; if (!value) saved.clear(); return document.emit('deuterium:chain-session', { enabled: value }); },
    rerun() { vm.runInNewContext(source, context, { timeout: 10000 }); },
  };
  return p;
}

async function settled(p) {
  const start = Date.now();
  while (p.button.disabled && p.box.dataset.state !== 'open') {
    assert.ok(Date.now() - start < 5000, 'WebCrypto did not settle');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  // Drain the finally block after an automatic open.
  await new Promise(resolve => setImmediate(resolve));
}
function assertNoLeaks(p) {
  assert.deepEqual(p.storageAccess, [], 'no direct local/session storage');
  assert.deepEqual(p.network, [], 'no network or telemetry');
  assert.deepEqual(p.eventErrors, [], 'no rejected event handler promises');
  for (const event of p.emitted) {
    assert.equal(event.type, 'deuterium:chain-session');
    assert.deepEqual(Object.keys(event.detail), ['enabled']);
    assert.equal(typeof event.detail.enabled, 'boolean');
  }
  assert.ok(!JSON.stringify(p.emitted).includes(ANSWER));
  assert.ok(!JSON.stringify(p.emitted).includes(HTML));
}
function assertLocked(p) {
  assert.equal(p.box.dataset.state, 'locked');
  assert.equal(p.box.innerHTML, '');
  assert.equal(p.box.htmlWrites.length, 0, 'no transient plaintext insertion');
  assert.equal(p.engineCalls.length, 0);
  assertNoLeaks(p);
}

for (const [name, fixture, iterations] of [['unversioned v1', v1, 120000], ['v2', v2, 200000]]) {
  test(`${name}: decrypts a synthetic article and initializes its private checker`, async () => {
    const p = page(fixture);
    assert.equal(p.input.type, 'password');
    assert.equal(p.input.focusCount, undefined, 'no focus theft at load');
    assert.ok(!p.box.textContent.includes(fixture.payload), 'raw base64 replaced');
    assert.equal(p.remember.checked, false);
    await p.submit(`  ${ANSWER}\t`);
    assert.equal(p.box.dataset.state, 'open');
    assert.equal(p.box.innerHTML, HTML);
    assert.equal(p.input.value, '');
    assert.equal(p.engineCalls.length, 1);
    assert.equal(p.engineCalls[0].root, p.box);
    assert.equal(p.engineCalls[0].state, 'open');
    assert.equal(p.engineCalls[0].html, HTML);
    const derive = p.operations.find(op => op.method === 'deriveKey');
    assert.deepEqual(derive, { method: 'deriveKey', iterations, hash: 'SHA-256', salt: SALT, extractable: false, uses: ['decrypt'] });
    const decrypt = p.operations.find(op => op.method === 'decrypt');
    assert.equal(decrypt.aad, iterations === 120000 ? null : JSON.stringify(['deuterium-argon', 2, 200000, SALT, NEEDS]));
    assert.equal(decrypt.tagLength, 128);
    assert.equal(decrypt.ivLength, 12);
    assert.equal(p.saved.size, 0, 'opt-out never remembers');
    assert.equal(p.sessionCalls.filter(call => call[0] === 'recall').length, 0);
    assertNoLeaks(p);
  });

  test(`${name}: wrong key and changed nonce/ciphertext/tag have the same failure`, async () => {
    const wrong = page(fixture);
    await wrong.submit('flag{synthetic-wrong}');
    assertLocked(wrong);
    assert.equal(wrong.note.textContent, FAILURE);
    for (const offset of [0, 12, Buffer.from(fixture.payload, 'base64').length - 1]) {
      const bytes = Buffer.from(fixture.payload, 'base64'); bytes[offset] ^= 1;
      const p = page(fixture, { payload: bytes.toString('base64') });
      await p.submit();
      assertLocked(p);
      assert.equal(p.note.textContent, FAILURE);
    }
  });
}

test('v2 canonicalizes salt case and authenticates needs, including escaped Unicode', async () => {
  const p = page(v2, { attrs: { 'data-salt': SALT.toUpperCase() } });
  await p.submit();
  assert.equal(p.box.innerHTML, HTML);
  const unicode = envelope({ needs: 'synthetic-"\\\n\u03bb' });
  const q = page(unicode);
  await q.submit();
  assert.equal(q.box.innerHTML, HTML);
});

test('v2 does not authenticate page routes or optional chain position', async () => {
  const p = page(v2, { scriptURL: 'https://fixture.invalid/moved/assets/js/features/argon.js',
    attrs: { 'data-chain-position': '2', 'data-chain-length': '3' } });
  assert.match(p.box.textContent, /chain step 2 of 3/);
  assert.equal(p.document.head.children[0].href, 'https://fixture.invalid/moved/assets/css/features/argon.css?v=');
  await p.submit();
  assert.equal(p.box.innerHTML, HTML);
});

test('valid-looking altered salt and needs fail authentication, never initialization', async () => {
  for (const attrs of [{ 'data-salt': 'ff'.repeat(16) }, { 'data-needs': 'different-id' }, { 'data-needs': null }]) {
    const p = page(v2, { attrs });
    await p.submit();
    assertLocked(p);
    assert.equal(p.note.textContent, FAILURE);
    assert.equal(p.operations.filter(op => op.method === 'decrypt').length, 1);
  }
});

test('removing both v2 headers cannot decrypt under v1, even with the correct answer', async () => {
  const p = page(v2, { attrs: { 'data-version': null, 'data-iterations': null } });
  await p.submit();
  assertLocked(p);
  assert.equal(p.note.textContent, FAILURE);
  assert.equal(p.operations.find(op => op.method === 'deriveKey').iterations, 120000);
});

test('v1 keeps needs as an unauthenticated hint and supports wrapped HTML base64', async () => {
  const p = page(v1, { attrs: { 'data-needs': 'a-different-legacy-hint' }, payload: `\n ${v1.payload.match(/.{1,60}/g).join('\r\n')}\t` });
  await p.submit();
  assert.equal(p.box.innerHTML, HTML);
});

const badHeaders = [
  { 'data-version': '1' }, { 'data-version': '3' }, { 'data-version': '' }, { 'data-version': '02' },
  { 'data-version': '2 ' }, { 'data-version': null }, { 'data-iterations': null },
  { 'data-iterations': '120000' }, { 'data-iterations': '200001' }, { 'data-iterations': '0200000' },
  { 'data-iterations': '200000.0' }, { 'data-iterations': '2e5' }, { 'data-iterations': '200000 ' },
  { 'data-iterations': '999999999999999999999999999999' }, { 'data-salt': null },
  { 'data-salt': '' }, { 'data-salt': SALT.slice(1) }, { 'data-salt': SALT + '0' },
  { 'data-salt': SALT + '\n' }, { 'data-salt': 'gg'.repeat(16) }, { 'data-salt': '00 '.repeat(16) },
];
for (const attrs of badHeaders) {
  test(`rejects malformed header before decoding or crypto: ${JSON.stringify(attrs)}`, async () => {
    const p = page(v2, { attrs });
    assert.equal(p.note.textContent, FAILURE);
    await p.submit();
    assertLocked(p);
    assert.equal(p.atobCalls, 0);
    assert.deepEqual(p.operations, []);
  });
}

test('legacy does not accept a version or an iterations field', async () => {
  for (const attrs of [{ 'data-iterations': '120000' }, { 'data-iterations': '200000' },
    { 'data-version': '1' }, { 'data-version': '2' }, { 'data-version': '1', 'data-iterations': '120000' }]) {
    const p = page(v1, { attrs });
    await p.submit();
    assertLocked(p);
    assert.equal(p.atobCalls, 0);
    assert.deepEqual(p.operations, []);
  }
});

const base28 = Buffer.alloc(28).toString('base64'); // Ends AA==; spare padding bits must be zero.
const base29 = Buffer.alloc(29).toString('base64'); // Ends AAA=.
const badBase64 = ['', '!!!!', base28.slice(0, -1), base28 + '=',
  base28.slice(0, -3) + 'B==', base29.slice(0, -2) + 'B=',
  '=' + base28.slice(1), base28 + base28, base28.replace('A', '-'), base28.replace('A', '_'),
  base28 + '\u00a0', base28 + '\u200b', Buffer.alloc(27).toString('base64')];
for (const [n, payload] of badBase64.entries()) {
  test(`rejects noncanonical/short base64 before decoding or crypto, case ${n}`, async () => {
    const p = page(v2, { payload });
    await p.submit();
    assertLocked(p);
    assert.equal(p.note.textContent, FAILURE);
    assert.equal(p.atobCalls, 0);
    assert.deepEqual(p.operations, []);
  });
}

test('24 MiB decoded payload is accepted for parsing; one extra byte is rejected before atob', async () => {
  const maximum = page(v2, { payload: 'A'.repeat(MAX_BYTES / 3 * 4) });
  assert.equal(maximum.atobCalls, 1);
  assert.equal(maximum.note.textContent, '');
  assert.equal(maximum.rain.children.length, 14);
  const oversized = page(v2, { payload: 'A'.repeat(MAX_BYTES / 3 * 4) + 'AA==' });
  await oversized.submit();
  assertLocked(oversized);
  assert.equal(oversized.atobCalls, 0);
  assert.deepEqual(oversized.operations, []);
});

test('atob exceptions never prevent the unlock UI from mounting', async () => {
  const p = page(v2, { atobThrows: true });
  assert.ok(p.form);
  await p.submit();
  assertLocked(p);
  assert.equal(p.note.textContent, FAILURE);
  assert.deepEqual(p.operations, []);
});

test('authenticated invalid UTF-8 is rejected before the HTML sink', async () => {
  const p = page(envelope({ plaintext: Buffer.from([0xc0, 0xaf]) }));
  await p.submit();
  assertLocked(p);
  assert.equal(p.note.textContent, FAILURE);
});

test('empty authenticated plaintext is allowed at the nonce/tag minimum', async () => {
  const p = page(envelope({ plaintext: '' }));
  await p.submit();
  assert.equal(p.box.dataset.state, 'open');
  assert.equal(p.box.innerHTML, '');
  assert.equal(p.engineCalls.length, 1);
});

for (const options of [{ cryptoMissing: true }, { decoderMissing: true }, { unsupportedOperation: 'deriveKey' }]) {
  test(`unsupported crypto has readable feedback: ${JSON.stringify(options)}`, async () => {
    const p = page(v2, options);
    await p.submit();
    assertLocked(p);
    assert.match(p.note.textContent, /up-to-date browser over HTTPS/);
  });
}

test('blank manual input never starts crypto; label and tab opt-in are accessible', async () => {
  const p = page();
  const nodes = p.document.descendants();
  assert.ok(nodes.some(node => node.tagName === 'label' && node.htmlFor === p.input.id));
  assert.ok(nodes.some(node => node.tagName === 'label' && node.htmlFor === p.remember.id));
  assert.equal(p.input.getAttribute('aria-describedby'), p.note.id);
  assert.equal(p.note.getAttribute('role'), 'status');
  assert.equal(p.input.getAttribute('name'), null, 'password is not a native form parameter');
  await p.submit(' \t ');
  assert.match(p.note.textContent, /Enter the flag first/);
  assert.deepEqual(p.operations, []);
  assert.equal(p.input.focusCount, 1);
});

test('repeated submits share one in-flight unlock and one HTML insertion', async () => {
  const p = page(v2, { pauseStage: 'deriveKey' });
  const first = p.submit();
  await p.entered;
  await Promise.all([p.submit(), p.submit('flag{synthetic-wrong}'), p.form.emit('submit')]);
  assert.equal(p.operations.filter(op => op.method === 'importKey').length, 1);
  assert.equal(p.button.disabled, true);
  p.release();
  await first;
  assert.equal(p.box.innerHTML, HTML);
  assert.equal(p.box.htmlWrites.length, 1);
  assert.equal(p.engineCalls.length, 1);
  assertNoLeaks(p);
});

for (const stage of ['importKey', 'deriveKey', 'decrypt']) {
  for (const action of ['relock', 'clear', 'external-clear', 'opt-out', 'pagehide']) {
    test(`${action} during ${stage} cancels stale completion without overlapping work`, async () => {
      const p = page(v2, { pauseStage: stage, enabled: true });
      const first = p.submit();
      await p.entered;
      if (action === 'relock') await p.clickLock();
      if (action === 'clear') await p.clickClear();
      if (action === 'external-clear') await p.sessionEvent(false);
      if (action === 'opt-out') await p.optIn(false);
      if (action === 'pagehide') await p.window.emit('pagehide');
      assert.equal(p.input.value, '');
      await p.form.emit('submit');
      assert.equal(p.operations.filter(op => op.method === 'importKey').length, 1);
      p.release();
      await first;
      assertLocked(p);
      assert.equal(p.input.value, '');
      assert.equal(p.button.disabled, false);
      assert.ok(!p.sessionCalls.some(call => call[0] === 'remember'));
      if (action !== 'pagehide') {
        await p.submit();
        assert.equal(p.box.innerHTML, HTML, 'manual retry works after the cancelled operation settles');
      }
    });
  }
}

test('relock removes plaintext, restores rain, clears the input, and suppresses immediate auto-reopen', async () => {
  const p = page(v2, { enabled: true });
  await p.submit();
  assert.equal(p.saved.get(NEEDS), ANSWER);
  p.input.value = 'synthetic-leftover';
  await p.clickLock();
  assert.equal(p.box.innerHTML, '');
  assert.equal(p.box.dataset.state, 'locked');
  assert.equal(p.input.value, '');
  assert.ok(p.box.children.includes(p.rain));
  assert.equal(p.rain.hidden, false);
  const count = p.operations.length;
  await p.document.emit('deuterium:solved', { id: NEEDS, at: new Date().toISOString() });
  await p.sessionEvent(true);
  assert.equal(p.operations.length, count, 'relock does not consume the still-saved answer');
  await p.submit();
  assert.equal(p.box.innerHTML, HTML);
  await p.clickClear();
  assert.equal(p.box.innerHTML, '');
  assert.equal(p.saved.size, 0);
  assert.equal(p.remember.checked, false);
  assert.equal(p.input.value, '');
  assertNoLeaks(p);
});

test('load auto-unlocks only with opted-in recall; no focus changes and no re-remember', async () => {
  const p = page(v2, { enabled: true, saved: { [NEEDS]: ANSWER } });
  await settled(p);
  assert.equal(p.box.innerHTML, HTML);
  assert.equal(p.input.focusCount, undefined);
  assert.ok(p.sessionCalls.some(call => call[0] === 'recall' && call[1] === NEEDS));
  assert.ok(!p.sessionCalls.some(call => call[0] === 'remember'));
  assertNoLeaks(p);
});

test('automatic wrong answers keep focus and input intact', async () => {
  const p = page(v2, { enabled: true, saved: { [NEEDS]: 'flag{synthetic-wrong}' } });
  p.input.value = 'synthetic-manual-draft';
  await settled(p);
  assertLocked(p);
  assert.equal(p.note.textContent, FAILURE);
  assert.equal(p.input.value, 'synthetic-manual-draft');
  assert.equal(p.input.focusCount, undefined);
  assert.equal(p.form.classList.contains('is-shaking'), false);
  await p.submit();
  assert.equal(p.box.innerHTML, HTML);
});

test('matching solved events try recall, not timestamps or event answers', async () => {
  const p = page(v2, { enabled: true });
  await p.document.emit('deuterium:solved', { id: NEEDS, at: new Date().toISOString(), flag: ANSWER });
  assertLocked(p);
  assert.deepEqual(p.operations, []);
  assert.equal(p.input.focusCount, undefined);
  p.saved.set(NEEDS, ANSWER);
  await p.document.emit('deuterium:solved', { id: 'different-id', at: 'synthetic' });
  assert.deepEqual(p.operations, []);
  await p.document.emit('deuterium:solved', { id: NEEDS, at: 'not-a-timestamp' });
  assert.equal(p.box.innerHTML, HTML);
  assertNoLeaks(p);
});

test('opt-out skips recall even if a saved answer or solved event exists', async () => {
  const p = page(v2, { saved: { [NEEDS]: ANSWER } });
  await p.document.emit('deuterium:solved', { id: NEEDS, at: 'synthetic', flag: ANSWER });
  await p.document.emit('deuterium:chain-session', { enabled: true });
  assertLocked(p);
  assert.deepEqual(p.operations, []);
  assert.ok(!p.sessionCalls.some(call => call[0] === 'recall'));
  await p.optIn();
  await settled(p);
  assert.equal(p.box.innerHTML, HTML);
  assertNoLeaks(p);
});

test('a new external opt-in after clear can hand off an answer', async () => {
  const p = page(v2, { enabled: true });
  await p.sessionEvent(false);
  p.saved.set(NEEDS, ANSWER);
  await p.sessionEvent(true);
  assert.equal(p.box.innerHTML, HTML);
});

test('missing needs never recalls or remembers under a page route', async () => {
  const p = page(envelope({ needs: '' }), { enabled: true, saved: { [NEEDS]: ANSWER } });
  assert.ok(!p.sessionCalls.some(call => call[0] === 'recall'));
  await p.submit();
  assert.equal(p.box.innerHTML, HTML);
  assert.ok(!p.sessionCalls.some(call => call[0] === 'remember'));
});

for (const blocked of ['all', 'getter', 'isEnabled', 'recall', 'remember', 'clear', 'setEnabled']) {
  test(`blocked session ${blocked} does not break manual decryption or local clear`, async () => {
    const p = page(v2, { blocked, enabled: true });
    await p.optIn();
    await p.submit();
    assert.equal(p.box.innerHTML, HTML);
    p.input.value = 'synthetic-leftover';
    await p.clickClear();
    assert.equal(p.box.dataset.state, 'locked');
    assert.equal(p.box.innerHTML, '');
    assert.equal(p.input.value, '');
    assertNoLeaks(p);
    if (['all', 'getter', 'clear'].includes(blocked)) assert.match(p.note.textContent, /could not be cleared/);
  });
}

test('absent shared module still allows manual decryption', async () => {
  const p = page(v2, { missingSession: true });
  await p.optIn();
  assert.equal(p.remember.checked, false);
  assert.match(p.note.textContent, /still unlock manually/);
  await p.submit();
  assert.equal(p.box.innerHTML, HTML);
  assertNoLeaks(p);
});

test('synchronous session clear during remember removes plaintext and skips engine initialization', async () => {
  const p = page(v2, { enabled: true, clearOnRemember: true });
  await p.submit();
  assert.equal(p.box.dataset.state, 'locked');
  assert.equal(p.box.innerHTML, '');
  assert.equal(p.input.value, '');
  assert.equal(p.engineCalls.length, 0);
});

test('checker initialization failure does not misreport a verified decryption as a bad flag', async () => {
  const p = page(v2, { engineThrows: true });
  await p.submit();
  assert.equal(p.box.innerHTML, HTML);
  assert.match(p.note.textContent, /Article unlocked.*could not be initialized/);
});

test('visibility and page lifecycle stop rain; bfcache return does not restore plaintext', async () => {
  const p = page(v2, { hidden: true, enabled: true });
  assert.equal(p.rain.hidden, true);
  p.document.hidden = false;
  await p.document.emit('visibilitychange');
  assert.equal(p.rain.hidden, false);
  p.document.hidden = true;
  await p.document.emit('visibilitychange');
  assert.equal(p.rain.hidden, true);
  p.document.hidden = false;
  await p.submit();
  await p.window.emit('pagehide');
  assert.equal(p.box.innerHTML, '');
  assert.equal(p.rain.hidden, true);
  await p.window.emit('pageshow');
  assert.equal(p.box.dataset.state, 'locked');
  assert.equal(p.box.innerHTML, '');
  assert.equal(p.rain.hidden, false);
  assert.equal(p.input.focusCount, undefined);
});

test('chain position is optional, numeric, bounded, and can come from body', () => {
  const p = page(v2, { bodyAttrs: { 'data-chain-position': '1', 'data-chain-length': '3' } });
  assert.match(p.box.textContent, /chain step 1 of 3/);
  for (const [position, length] of [['0', '3'], ['4', '3'], ['1', 'x'], ['01', '3'], ['1000000', '1000000'], ['/secret/route', '3']]) {
    const q = page(v2, { attrs: { 'data-chain-position': position, 'data-chain-length': length } });
    assert.ok(!q.box.textContent.includes('chain step'));
    assert.ok(!q.box.textContent.includes('/secret/route'));
  }
});

test('stylesheet honors script baseurl; duplicate script execution does not duplicate handlers', () => {
  const p = page();
  assert.equal(p.document.head.children[0].href, 'https://fixture.invalid/blog/assets/css/features/argon.css?v=');
  p.rerun();
  assert.equal(p.document.head.children.length, 1);
  assert.equal(p.form.listeners.get('submit').length, 1);
});

test('CSS parses, limits password sizing to password inputs, and respects reduced motion', () => {
  assert.doesNotThrow(() => rulePreludes(css));
  const selectors = rulePreludes(css).map(rule => rule.prelude);
  assert.ok(selectors.includes(".argon-unlock input[type='password']"));
  assert.ok(selectors.includes('@media (prefers-reduced-motion: reduce)'));
  assert.ok(selectors.includes('.argon-rain[hidden] .argon-rain__row'));
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.argon-rain__row\s*\{\s*animation: none;/);
});

// Shared-module integration remains local and uses only synthetic session records.
test('shared session: opt-in, successful manual handoff, and clear leave no input or saved answer', async () => {
  const p = page(v2, { realSession: true });
  await p.optIn();
  assert.equal(p.session.isEnabled(), true);
  await p.submit();
  assert.equal(p.box.innerHTML, HTML);
  assert.equal(p.session.recall(NEEDS), ANSWER);
  await p.clickClear();
  assert.equal(p.box.innerHTML, '');
  assert.equal(p.input.value, '');
  assert.equal(p.session.recall(NEEDS), null);
  assert.equal(p.session.isEnabled(), false);
  assertNoLeaks(p);
});

for (const method of ['get', 'set', 'getter', 'all-writes']) {
  test(`shared session: blocked ${method} at optional remember cannot undo manual decryption`, async () => {
    const p = page(v2, { realSession: true, enabled: true, pauseStage: 'decrypt' });
    const first = p.submit();
    await p.entered;
    p.blockStorage(method);
    p.release();
    await first;
    assert.equal(p.box.innerHTML, HTML);
    assert.equal(p.box.dataset.state, 'open');
    assert.equal(p.input.value, '');
    assert.equal(p.engineCalls.length, 1);
    assert.equal(p.remember.checked, false);
    assertNoLeaks(p);
  });
}

function assertExternalClear(p, priorEvents) {
  assert.equal(p.session.isEnabled(), false);
  assert.equal(p.session.recall(NEEDS), null);
  assert.equal(p.remember.checked, false);
  assert.equal(p.input.value, '');
  assert.deepEqual(JSON.parse(JSON.stringify(p.emitted.slice(priorEvents))), [
    { type: 'deuterium:chain-session', detail: { enabled: false } },
  ], 'external clear emits exactly one answer-free opt-out notification');
  assertNoLeaks(p);
}

for (const stage of ['importKey', 'deriveKey', 'decrypt']) {
  for (const enabled of [false, true]) {
    test(`shared session: external clear during manual ${stage} cancels completion (enabled=${enabled})`, async () => {
      const p = page(v2, { realSession: true, enabled, pauseStage: stage,
        saved: enabled ? { unrelated: 'synthetic-unrelated-answer' } : {} });
      const first = p.submit();
      await p.entered;
      const priorEvents = p.emitted.length;
      assert.equal(p.session.clear(), true); // No client clear handler or fabricated event.
      assertExternalClear(p, priorEvents);
      assert.equal(p.storedSession.has('deuterium-chain-session'), false);
      assert.equal(p.button.disabled, true, 'cancelled work retains the guard until crypto settles');
      await p.submit();
      assert.equal(p.operations.filter(op => op.method === 'importKey').length, 1);
      p.release();
      await first;
      assertLocked(p);
      assert.equal(p.button.disabled, false);
      assert.equal(p.storedSession.has('deuterium-chain-session'), false);
      await p.submit();
      assert.equal(p.box.innerHTML, HTML, 'manual retry still works after cancellation');
      assert.equal(p.session.recall(NEEDS), null);
      assert.equal(p.storedSession.has('deuterium-chain-session'), false, 'retry does not silently opt in');
      assertNoLeaks(p);
    });
  }
}

for (const automatic of [false, true]) {
  test(`shared session: external clear relocks an article opened ${automatic ? 'automatically' : 'manually'}`, async () => {
    const p = page(v2, { realSession: true, enabled: true, saved: automatic ? { [NEEDS]: ANSWER } : {} });
    if (automatic) await settled(p); else await p.submit();
    assert.equal(p.box.innerHTML, HTML);
    assert.equal(p.engineCalls.length, 1);
    p.input.value = 'synthetic-leftover';
    const priorEvents = p.emitted.length;
    assert.equal(p.session.clear(), true);
    assertExternalClear(p, priorEvents);
    assert.equal(p.box.dataset.state, 'locked');
    assert.equal(p.box.innerHTML, '');
    assert.equal(p.storedSession.has('deuterium-chain-session'), false);
    await p.document.emit('deuterium:solved', { id: NEEDS, at: 'synthetic' });
    p.session.setEnabled(true);
    await settled(p);
    assert.equal(p.box.innerHTML, '', 'progress and a fresh opt-in cannot restore the cleared answer');
    assert.equal(p.box.htmlWrites.length, 1);
    assert.equal(p.engineCalls.length, 1);
    assertNoLeaks(p);
  });
}

test('shared session: failed external clear still cancels a manual unlock and reports failure', async () => {
  const p = page(v2, { realSession: true, enabled: true, pauseStage: 'decrypt', saved: { unrelated: 'synthetic-unrelated-answer' } });
  const first = p.submit();
  await p.entered;
  p.blockStorage('all-writes');
  const priorEvents = p.emitted.length;
  assert.equal(p.session.clear(), false);
  assertExternalClear(p, priorEvents);
  assert.ok(p.storedSession.has('deuterium-chain-session'), 'blocked storage could not be removed');
  p.release();
  await first;
  assertLocked(p);
});

for (const method of ['clear', 'forget']) {
  test(`shared session: ${method} cancels an automatic unlock ${method === 'clear' ? 'with an opt-out notification' : 'without a settings event'}`, async () => {
    const p = page(v2, { realSession: true, enabled: true, saved: { [NEEDS]: ANSWER }, pauseStage: 'decrypt' });
    await p.entered;
    const priorEvents = p.emitted.length;
    assert.equal(p.session[method](NEEDS), true);
    if (method === 'clear') assertExternalClear(p, priorEvents);
    else assert.equal(p.emitted.length, priorEvents, 'forget does not emit answer events');
    p.release();
    await settled(p);
    assertLocked(p);
  });
}

test('shared session: opted-in recall can unlock at load', async () => {
  const p = page(v2, { realSession: true, enabled: true, saved: { [NEEDS]: ANSWER } });
  await settled(p);
  assert.equal(p.box.innerHTML, HTML);
  assert.equal(p.input.focusCount, undefined);
  assertNoLeaks(p);
});

for (const stage of ['importKey', 'deriveKey', 'decrypt']) {
  test(`automatic ${stage}: repeated events do not overlap work, and local clear cancels it`, async () => {
    const p = page(v2, { enabled: true, saved: { [NEEDS]: ANSWER }, pauseStage: stage });
    await p.entered;
    await p.document.emit('deuterium:solved', { id: NEEDS, at: 'synthetic' });
    await p.sessionEvent(true);
    await p.form.emit('submit');
    assert.equal(p.operations.filter(op => op.method === 'importKey').length, 1);
    await p.clickClear();
    p.release();
    await settled(p);
    assertLocked(p);
    assert.equal(p.input.value, '');
    assert.equal(p.input.focusCount, undefined);
  });
}
