// Native, offline tests of the session module. No real answers or browser APIs
// are substituted for cryptography; this module only owns bounded tab storage.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../assets/js/chain-session.js', import.meta.url), 'utf8');
const KEY = 'deuterium-chain-session';
function tab({ raw, blocked } = {}) {
  const storage = new Map(raw === undefined ? [] : [[KEY, raw]]), events = [];
  let block = blocked, localAccess = 0;
  const context = {
    window: {},
    document: { dispatchEvent(e) { events.push(e); } },
    CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } },
  };
  Object.defineProperty(context, 'sessionStorage', { get() {
    if (block === 'getter') throw new Error('blocked getter');
    return {
      getItem(key) { if (block === 'get') throw new Error('blocked read'); return storage.get(key) ?? null; },
      setItem(key, value) { if (block === 'set' || block === 'all-writes') throw new Error('blocked write'); storage.set(key, String(value)); },
      removeItem(key) { if (block === 'remove' || block === 'all-writes') throw new Error('blocked removal'); storage.delete(key); },
    };
  } });
  Object.defineProperty(context, 'localStorage', { get() { localAccess++; throw new Error('Persistent answers forbidden'); } });
  const run = () => vm.runInNewContext(source, context, { filename: 'assets/js/chain-session.js' });
  run();
  return { api: context.window.DeuteriumChainSession, storage, events, run, localAccess: () => localAccess, block: value => { block = value; } };
}
const state = answers => JSON.stringify({ version: 1, enabled: true, answers });

test('session is off by default and only strict boolean true opts in', () => {
  const t = tab();
  assert.equal(t.api.isEnabled(), false);
  for (const value of [1, 'true', {}, [], null, undefined]) assert.equal(t.api.setEnabled(value), false);
  assert.equal(t.api.remember('synthetic', 'synthetic-answer'), false);
  assert.equal(t.api.recall('synthetic'), null);
  assert.equal(t.storage.size, 0);
  assert.equal(t.api.setEnabled(true), true);
  assert.equal(t.api.remember('synthetic', 'synthetic-answer'), true);
  assert.equal(t.api.recall('synthetic'), 'synthetic-answer');
  assert.equal(t.localAccess(), 0);
  for (const event of t.events) {
    assert.equal(event.type, 'deuterium:chain-session');
    assert.deepEqual(Object.keys(event.detail), ['enabled']);
    assert.equal(typeof event.detail.enabled, 'boolean');
  }
});

test('opt-in persists through same-tab reload and disabling removes stored answers', () => {
  const first = tab(); first.api.setEnabled(true); first.api.remember('synthetic', 'synthetic-answer');
  const reload = tab({ raw: first.storage.get(KEY) });
  assert.equal(reload.api.isEnabled(), true);
  assert.equal(reload.api.recall('synthetic'), 'synthetic-answer');
  reload.api.setEnabled(false);
  assert.equal(reload.storage.size, 0); assert.equal(reload.api.recall('synthetic'), null);
  reload.api.setEnabled(true); assert.equal(reload.api.recall('synthetic'), null);
  reload.run(); assert.equal(reload.api.isEnabled(), true);
});

const disabledEvent = [{ type: 'deuterium:chain-session', detail: { enabled: false } }];
const eventData = t => JSON.parse(JSON.stringify(t.events));

test('forget removes one answer without events; clear removes the key and opts out observably', () => {
  const t = tab(); t.api.setEnabled(true); t.events.length = 0;
  t.storage.set('unrelated', 'keep');
  t.api.remember('first', 'synthetic-first'); t.api.remember('second', 'synthetic-second');
  assert.equal(t.api.forget('first'), true);
  assert.equal(t.api.recall('first'), null); assert.equal(t.api.recall('second'), 'synthetic-second');
  assert.deepEqual(t.events, [], 'answer changes do not emit events');
  assert.equal(t.api.clear(), true);
  assert.equal(t.api.isEnabled(), false); assert.equal(t.api.recall('second'), null);
  assert.equal(t.storage.has(KEY), false);
  assert.equal(t.storage.get('unrelated'), 'keep');
  assert.deepEqual(eventData(t), disabledEvent);
  assert.equal(t.api.remember('second', 'synthetic-second'), false, 'clear cancels the opt-in');
  const reload = tab({ raw: t.storage.get(KEY) });
  assert.equal(reload.api.isEnabled(), false);
  assert.equal(reload.api.recall('second'), null);
  t.api.setEnabled(true);
  assert.equal(t.api.recall('second'), null, 'opting in again cannot recover cleared answers');
});

test('clear notifies once on every call, even when already disabled', () => {
  const t = tab();
  for (let n = 0; n < 2; n++) {
    t.events.length = 0;
    assert.equal(t.api.clear(), true);
    assert.equal(t.api.isEnabled(), false);
    assert.equal(t.storage.has(KEY), false);
    assert.deepEqual(eventData(t), disabledEvent);
  }
});

test('clear removes post-load corruption without duplicate disabled notifications', () => {
  const t = tab({ raw: state({ synthetic: 'synthetic-secret' }) });
  t.storage.set(KEY, 'null');
  assert.equal(t.api.clear(), true);
  assert.equal(t.api.isEnabled(), false);
  assert.equal(t.storage.has(KEY), false);
  assert.deepEqual(eventData(t), disabledEvent);
});

for (const blocked of ['get', 'set']) {
  test(`clear succeeds with blocked ${blocked} because removal needs neither reads nor writes`, () => {
    const t = tab({ raw: state({ synthetic: 'synthetic-secret' }) });
    t.block(blocked);
    assert.equal(t.api.clear(), true);
    assert.equal(t.api.isEnabled(), false);
    assert.equal(t.storage.has(KEY), false);
    assert.deepEqual(eventData(t), disabledEvent);
    assert.equal(t.localAccess(), 0);
  });
}

test('answer count and answer length are bounded', () => {
  const t = tab(); t.api.setEnabled(true);
  for (let n = 0; n < 40; n++) assert.equal(t.api.remember('synthetic-' + n, 'x'.repeat(4096)), true);
  const saved = JSON.parse(t.storage.get(KEY));
  assert.equal(Object.keys(saved.answers).length, 32);
  assert.equal(t.api.recall('synthetic-0'), null);
  assert.equal(t.api.recall('synthetic-39'), 'x'.repeat(4096));
  for (const answer of ['', 7, {}, null, 'x'.repeat(4097)]) assert.equal(t.api.remember('synthetic', answer), false);
  assert.ok(t.storage.get(KEY).length <= 160 * 1024);
});

test('keys are validated, including prototype names and overlong IDs', () => {
  const t = tab(); t.api.setEnabled(true);
  for (const id of ['', '__proto__', 'prototype', 'constructor', 'bad id', 'id"x', 'a'.repeat(129), null, {}]) {
    assert.equal(t.api.remember(id, 'synthetic'), false);
    assert.equal(t.api.recall(id), null); assert.equal(t.api.forget(id), false);
  }
  assert.equal(t.api.remember('toString', 'synthetic'), true);
  assert.equal(t.api.recall('toString'), 'synthetic');
  assert.equal({}.answer, undefined);
});

const corrupt = [
  '{', 'null', '[]', 'true', '5', '"text"', '{}',
  '{"version":1,"enabled":"true","answers":{}}',
  '{"version":2,"enabled":true,"answers":{}}',
  '{"version":1,"enabled":false,"answers":{"synthetic":"secret"}}',
  '{"version":1,"enabled":true,"answers":[]}',
  '{"version":1,"enabled":true,"answers":{},"extra":1}',
  '{"version":1,"enabled":true,"answers":{"__proto__":"secret"}}',
  '{"version":1,"enabled":true,"answers":{"constructor":"secret"}}',
  state({ synthetic: { flag: 'synthetic-secret' } }), state({ synthetic: 7 }), state({ synthetic: '' }),
  state({ synthetic: 'x'.repeat(4097) }),
  state(Object.fromEntries(Array.from({ length: 33 }, (_, n) => ['synthetic-' + n, 'synthetic']))),
  'x'.repeat(160 * 1024 + 1),
];
for (const [n, raw] of corrupt.entries()) {
  test(`corrupt session schema ${n + 1} is discarded rather than implicitly enabling storage`, () => {
    const t = tab({ raw }); assert.equal(t.api.isEnabled(), false);
    assert.equal(t.api.recall('synthetic'), null); assert.equal(t.storage.has(KEY), false);
  });
}

for (const blocked of ['getter', 'get', 'set', 'all-writes']) {
  test(`blocked ${blocked} fails closed without throwing or using localStorage`, () => {
    const t = tab({ blocked });
    t.api.setEnabled(true);
    assert.equal(t.api.isEnabled(), false);
    assert.equal(t.api.remember('synthetic', 'synthetic-secret'), false);
    assert.equal(t.api.recall('synthetic'), null);
    t.api.forget('synthetic'); t.api.clear(); t.api.setEnabled(false);
    assert.equal(t.localAccess(), 0);
  });
}

test('failed removal overwrites with a disabled answer-free shape if possible', () => {
  const t = tab({ raw: state({ synthetic: 'synthetic-secret' }), blocked: 'remove' });
  t.api.setEnabled(false);
  assert.equal(t.api.isEnabled(), false);
  assert.deepEqual(JSON.parse(t.storage.get(KEY)), { version: 1, enabled: false, answers: {} });
});

test('clear reports failed key removal even if a disabled answer-free overwrite succeeds', () => {
  const t = tab({ raw: state({ synthetic: 'synthetic-secret' }), blocked: 'remove' });
  assert.equal(t.api.clear(), false);
  assert.equal(t.api.isEnabled(), false);
  assert.equal(t.api.recall('synthetic'), null);
  assert.deepEqual(JSON.parse(t.storage.get(KEY)), { version: 1, enabled: false, answers: {} });
  assert.deepEqual(eventData(t), disabledEvent);
});

for (const blocked of ['all-writes', 'getter']) {
  test(`blocked clearing (${blocked}) reports failure but still disables and notifies`, () => {
    const t = tab({ raw: state({ synthetic: 'synthetic-secret' }) });
    t.block(blocked);
    assert.equal(t.api.clear(), false); assert.equal(t.api.isEnabled(), false);
    assert.equal(t.api.recall('synthetic'), null);
    assert.equal(t.api.remember('synthetic', 'synthetic-new-secret'), false);
    assert.deepEqual(eventData(t), disabledEvent);
    // The browser refused both overwrite and removal; existing bytes cannot be
    // deleted by this script. Do not claim clear succeeded under this condition.
    assert.ok(t.storage.get(KEY).includes('synthetic-secret'));
    t.block(undefined);
    t.events.length = 0;
    assert.equal(t.api.clear(), true, 'removal can be retried after storage recovers');
    assert.equal(t.storage.has(KEY), false);
    assert.deepEqual(eventData(t), disabledEvent);
  });
}

test('post-load corruption disables access and notifies without data in the event', () => {
  const t = tab({ raw: state({ synthetic: 'synthetic-secret' }) });
  t.storage.set(KEY, 'null');
  assert.equal(t.api.recall('synthetic'), null); assert.equal(t.api.isEnabled(), false);
  assert.equal(t.events.length, 1); assert.deepEqual(Object.keys(t.events[0].detail), ['enabled']);
  assert.equal(t.events[0].detail.enabled, false);
});
