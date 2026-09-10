// Offline DOM stand-in, not a browser rendering/accessibility test. UI/client
// modules are loaded at a prefixed HTTPS identity, but all source reads and
// Worker execution are local. Every started session uses the actual ports.
import assert from 'node:assert/strict';
import { SourceTextModule, createContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { ThreadAdapter } from './thread-adapter.mjs';

class Control {
  constructor(value = '') {
    this.value = value;
    this.disabled = true;
    this.textContent = '';
    this.events = new Map();
    this.scrollHeight = 200;
    this.clientHeight = 100;
    this.scrollTop = 100;
  }
  set innerHTML(value) { throw Error(`Unexpected HTML sink: ${value}`); }
  addEventListener(type, listener) {
    if (!this.events.has(type)) this.events.set(type, []);
    this.events.get(type).push(listener);
  }
  dispatch(type, values = {}) {
    const event = { preventDefault() { this.prevented = true; }, ...values };
    for (const listener of this.events.get(type) || []) listener(event);
    return event;
  }
  requestSubmit() { this.dispatch('submit'); }
}
const controls = Object.fromEntries(['start', 'stop', 'reset', 'send', 'input', 'output', 'status', 'variant'].map(key => [key, new Control()]));
controls.variant.value = 'default';
const form = new Control();
const root = {
  dataset: { runtime: 'chaos', id: 'zh3r0-2021-chaos' },
  querySelector(selector) { return selector === 'form' ? form : controls[selector.match(/data-practice-(.*)\]/)?.[1]]; },
};
const threads = [], loads = [], storageKeys = [], records = new Map(), pageEvents = new Map();
let storageBlocked = false;
const prefix = 'https://practice.example.test/subsite/assets/js/challenge-practice/';
const sandbox = {
  console, URL, performance, setTimeout, clearTimeout, crypto: webcrypto,
  location: { protocol: 'https:', origin: 'https://practice.example.test' },
  document: { querySelector: () => root },
  Worker: class {
    constructor(url, options) {
      assert.equal(url.href, prefix + 'worker.mjs');
      assert.equal(options.type, 'module');
      const thread = new ThreadAdapter(); threads.push(thread); return thread;
    }
  },
  requestAnimationFrame: callback => setTimeout(callback, 0),
  cancelAnimationFrame: clearTimeout,
  addEventListener(type, listener) { pageEvents.set(type, listener); },
};
Object.defineProperty(sandbox, 'localStorage', { get() {
  if (storageBlocked) throw Error('Storage denied');
  return {
    getItem(key) { storageKeys.push(key); return records.get(key) ?? null; },
    setItem(key, value) { storageKeys.push(key); records.set(key, value); },
  };
} });
sandbox.window = sandbox;
const context = createContext(sandbox), modules = new Map();
function load(identifier) {
  if (modules.has(identifier)) return modules.get(identifier);
  const loading = (async () => {
    assert.ok(identifier.startsWith(prefix));
    const filename = identifier.slice(prefix.length);
    assert.ok(['ui.mjs', 'client.mjs', 'engine.mjs'].includes(filename), 'no ports imported on the main thread');
    loads.push(filename);
    const source = await readFile(new URL('../../../assets/js/challenge-practice/' + filename, import.meta.url), 'utf8');
    const module = new SourceTextModule(source, { context, identifier,
      initializeImportMeta(meta) { meta.url = identifier; },
    });
    await module.link((specifier, referencing) => load(new URL(specifier, referencing.identifier).href));
    return module;
  })();
  modules.set(identifier, loading);
  return loading;
}
const plain = value => JSON.parse(JSON.stringify(value));
const wait = async predicate => {
  const limit = performance.now() + 5000;
  while (!predicate()) {
    if (performance.now() > limit) throw Error('UI did not settle');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};
const witness = JSON.parse(await readFile(new URL('./chaos-collision.json', import.meta.url), 'utf8')).collision;

try {
  const module = await load(prefix + 'ui.mjs');
  await module.evaluate();
  const api = sandbox.challengePractice;
  assert.ok(api);
  assert.deepEqual(Object.keys(api), ['start', 'send', 'stop', 'reset']);
  assert.ok(Object.isFrozen(api));
  assert.equal(threads.length, 0, 'mount/reset must not start a worker');
  assert.deepEqual(loads.sort(), ['client.mjs', 'engine.mjs', 'ui.mjs']);
  assert.equal(controls.start.disabled, false);
  assert.equal(controls.stop.disabled, true);
  assert.equal(controls.input.disabled, true);
  assert.equal(controls.output.disabled, false);
  await assert.rejects(api.start({ rng: 'injected', reward: 'different' }), /no arguments/);
  assert.equal(threads.length, 0);
  sandbox.location.origin = 'https://other.example.test';
  await assert.rejects(api.start(), /same-origin/);
  assert.equal(threads.length, 0, 'cross-origin Worker must be rejected before construction');
  sandbox.location.origin = 'https://practice.example.test';
  await api.reset();

  const started = api.start();
  assert.equal(controls.stop.disabled, false);
  assert.equal(controls.start.disabled, true);
  assert.equal(controls.variant.disabled, true);
  await started;
  assert.equal(controls.input.disabled, false);
  const won = await api.send([witness.first, witness.second]);
  assert.deepEqual(plain(won), { output: 'input second string to hash : practice{local_dummy_reward}\n', state: 'end', solved: true });
  await wait(() => controls.output.value.includes('practice{local_dummy_reward}'));
  assert.equal(controls.output.value, 'input first string to hash : input second string to hash : practice{local_dummy_reward}\n');
  assert.ok(storageKeys.every(key => key === 'deuterium-browser-practice-v1'));
  const receipt = JSON.parse(records.get('deuterium-browser-practice-v1'));
  assert.deepEqual(Object.keys(receipt), ['zh3r0-2021-chaos:default']);
  assert.equal(typeof receipt['zh3r0-2021-chaos:default'], 'number');

  await api.reset();
  assert.equal(controls.output.value, '');
  assert.equal(threads.length, 1, 'reset must not autoplay');
  assert.match(controls.status.textContent, /saved practice completion/);
  await api.start();
  controls.input.value = witness.first;
  const newline = controls.input.dispatch('keydown', { key: 'Enter', shiftKey: true });
  assert.equal(newline.prevented, undefined);
  const composed = controls.input.dispatch('keydown', { key: 'Enter', isComposing: true });
  assert.equal(composed.prevented, undefined);
  const sent = controls.input.dispatch('keydown', { key: 'Enter', shiftKey: false });
  assert.equal(sent.prevented, true);
  await wait(() => !controls.send.disabled && controls.input.value === '');
  assert.equal(controls.input.disabled, false);
  controls.input.value = witness.second;
  form.requestSubmit();
  await wait(() => !controls.start.disabled);
  assert.match(controls.status.textContent, /Practice complete/);

  await api.reset();
  const pending = api.start();
  const aborted = assert.rejects(pending, { name: 'AbortError' });
  await api.reset();
  await aborted;
  await api.start();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(controls.status.textContent, 'Waiting for input.');
  assert.equal(controls.output.value, 'input first string to hash : ');
  await api.reset();

  storageBlocked = true;
  await api.start();
  assert.equal((await api.send([witness.first, witness.second])).solved, true);
  assert.match(controls.status.textContent, /storage is unavailable/);
  await api.reset();
  assert.match(controls.status.textContent, /Ready/);
  assert.equal(controls.output.value, '');
  await api.start();
  pageEvents.get('pagehide')();
  assert.equal(controls.start.disabled, false);
  assert.equal(controls.output.value, '');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(controls.output.value, '');
  console.log('UI harness passed: actual Chaos sessions, prefixed same-origin Worker, keyboard, storage, reset and pagehide.');
} finally {
  await sandbox.challengePractice?.reset();
  await Promise.all(threads.map(async thread => { await thread.terminate(); await thread.exited; }));
}
