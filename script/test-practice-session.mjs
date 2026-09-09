import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createPracticeClient, WORKER_URL } from '../assets/js/challenge-practice/client.mjs';
import { LIMITS, PORTS, REWARD, Transcript, TRUNCATION_NOTICE, normalizeInput, utf8Length, validateVariant, monotonicMilliseconds } from '../assets/js/challenge-practice/engine.mjs';
import { createCompletionStore, STORAGE_KEY } from '../assets/js/challenge-practice/ui.mjs';
import { ThreadAdapter } from '../agent_out/challenge-runtime/session/thread-adapter.mjs';

const fixtureURL = new URL('../agent_out/challenge-runtime/session/', import.meta.url);
const witness = JSON.parse(await readFile(new URL('chaos-collision.json', fixtureURL), 'utf8')).collision;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function actual(t, runtime = 'chaos', onEvent = () => {}) {
  const threads = [];
  const client = createPracticeClient({ runtime, onEvent, createWorker(url) {
    assert.equal(url.href, WORKER_URL.href);
    const thread = new ThreadAdapter();
    threads.push(thread);
    return thread;
  } });
  t.after(async () => { await client.reset(); await Promise.all(threads.map(thread => thread.exited)); });
  return { client, threads };
}

// Only lifecycle failure/hostile-message tests use this fake. Every port test
// below uses ThreadAdapter and imports the production worker and real ports.
class FakeWorker {
  constructor() { this.handlers = new Map(); this.requests = []; this.terminated = false; }
  addEventListener(type, fn) { this.handlers.set(type, fn); }
  removeEventListener(type, fn) { if (this.handlers.get(type) === fn) this.handlers.delete(type); }
  postMessage(data) { this.requests.push(data); }
  terminate() { this.terminated = true; }
  reply(type, extra = {}) {
    const request = this.requests.at(-1);
    this.handlers.get('message')?.({ data: { session: request.session, op: request.op, type, ...extra } });
  }
}
function fake(t, onEvent = () => {}) {
  const workers = [];
  const client = createPracticeClient({ runtime: 'chaos', onEvent, createWorker() {
    const worker = new FakeWorker(); workers.push(worker); return worker;
  } });
  t.after(() => client.reset());
  return { client, workers };
}

// Exact byte boundaries, including multibyte text and line-delimiter semantics.
test('input normalization preserves blank lines and bounds allocation', () => {
  assert.deepEqual(normalizeInput(''), ['']);
  assert.deepEqual(normalizeInput('\n'), ['']);
  assert.deepEqual(normalizeInput('a\r\nb\n\n'), ['a', 'b', '']);
  assert.deepEqual(normalizeInput(['a\r', '']), ['a\r', '']);
  assert.equal(normalizeInput('\n'.repeat(4096)).length, 4096);
  assert.throws(() => normalizeInput('\n'.repeat(4097)), /4096/);
  assert.throws(() => normalizeInput([]), /4096/);
  assert.throws(() => normalizeInput(['a\nb']), /without LF/);
  assert.throws(() => normalizeInput([1]), /string/);
  assert.throws(() => normalizeInput({}), /string/);
  assert.equal(normalizeInput('x'.repeat(LIMITS.line))[0].length, LIMITS.line);
  assert.throws(() => normalizeInput('x'.repeat(LIMITS.line + 1)), /2 MiB/);
  assert.equal(normalizeInput('\u{1f642}'.repeat(LIMITS.line / 4))[0].length, LIMITS.line / 2);
  assert.throws(() => normalizeInput('\u{1f642}'.repeat(LIMITS.line / 4 + 1)), /2 MiB/);
  assert.equal(normalizeInput(['x'.repeat(LIMITS.line), 'x'.repeat(LIMITS.line - 1)]).length, 2);
  assert.throws(() => normalizeInput(['x'.repeat(LIMITS.line), 'x'.repeat(LIMITS.line)]), /4 MiB/);
  assert.throws(() => normalizeInput('x'.repeat(LIMITS.batch + LIMITS.lines + 2)), /4 MiB/);
  for (const text of ['a', '\u00e9', '\u4e00', '\u{1f642}', '\ud800', '\udc00', '\ud800x']) {
    assert.equal(utf8Length(text), Buffer.byteLength(text));
  }
});

test('rendered transcript is a UTF-8 bounded tail with a visible notice', () => {
  const text = new Transcript();
  text.append('<img src=x onerror=alert(1)>');
  assert.equal(text.toString(), '<img src=x onerror=alert(1)>');
  text.clear();
  text.append('a'.repeat(LIMITS.transcript));
  assert.equal(utf8Length(text.toString()), LIMITS.transcript);
  text.append('\u{1f642}'.repeat(100));
  assert.ok(text.toString().startsWith(TRUNCATION_NOTICE));
  assert.ok(text.toString().endsWith('\u{1f642}'.repeat(100)));
  assert.ok(utf8Length(text.toString()) <= LIMITS.transcript);
  text.append('\u{1f642}'.repeat(LIMITS.transcript));
  assert.ok(utf8Length(text.toString()) <= LIMITS.transcript);
  assert.ok(!text.toString().includes('\ufffd'));
  text.clear();
  assert.equal(text.toString(), '');
});

test('storage is separate, timestamp-only and safe when blocked or corrupt', () => {
  assert.equal(STORAGE_KEY, 'deuterium-browser-practice-v1');
  for (const getter of [() => { throw Error('getter blocked'); }, () => null,
    () => ({ getItem() { throw Error('read blocked'); }, setItem() { throw Error('write blocked'); } })]) {
    const store = createCompletionStore(getter);
    assert.equal(store.has('id', 'default'), false);
    assert.equal(store.mark('id', 'default'), false);
  }
  let saved = '{broken';
  const keys = [];
  const store = createCompletionStore(() => ({
    getItem(key) { keys.push(key); return saved; },
    setItem(key, value) { keys.push(key); saved = value; },
  }));
  assert.equal(store.has('event-chaos', 'default'), false);
  assert.equal(store.mark('event-chaos', 'default'), true);
  assert.equal(store.has('event-chaos', 'default'), true);
  assert.equal(store.has('event-chaos', 'corrected'), false);
  store.mark('event-law', 'released');
  store.mark('event-law', 'corrected');
  const records = JSON.parse(saved);
  assert.equal(Object.keys(records).length, 3);
  assert.ok(Object.values(records).every(value => typeof value === 'number' && value > 0));
  assert.ok(keys.every(key => key === STORAGE_KEY));
});

test('fixed allowlist, defaults and prefixed relative module URLs', async () => {
  assert.equal(Object.keys(PORTS).length, 11);
  assert.equal(validateVariant('law-and-order'), 'corrected');
  assert.equal(validateVariant('law-and-order', 'released'), 'released');
  assert.equal(validateVariant('chaos'), 'default');
  for (const slug of ['../chaos', 'constructor', '__proto__', 'https://example.test/port.mjs']) {
    assert.throws(() => createPracticeClient({ runtime: slug }), /Unknown/);
  }
  assert.throws(() => validateVariant('chaos', 'released'), /variant/);
  assert.throws(() => validateVariant('law-and-order', 'default'), /variant/);
  const prefix = new URL('https://example.test/subsite/assets/js/challenge-practice/client.mjs');
  assert.equal(new URL('./worker.mjs', prefix).pathname, '/subsite/assets/js/challenge-practice/worker.mjs');
  for (const path of Object.values(PORTS)) {
    const portURL = new URL(path, new URL('./worker.mjs', prefix));
    assert.equal(portURL.origin, prefix.origin);
    assert.ok(portURL.pathname.startsWith('/subsite/assets/js/challenge-practice/ports/'));
  }
  const source = await readFile(new URL('../assets/js/challenge-practice/client.mjs', import.meta.url), 'utf8');
  assert.match(source, /url\.origin !== globalThis\.location\.origin/);
  assert.doesNotMatch(source, /import\s+.*from\s+['"].*ports\//);
});

test('lazy start, invalid options and concurrent requests fail without transfer', async t => {
  const { client, workers } = fake(t);
  assert.equal(workers.length, 0);
  await assert.rejects(client.send('x'), /idle input/);
  await client.reset();
  assert.equal(workers.length, 0);
  await assert.rejects(client.start({ reward: 'changed' }), /variant/);
  const first = client.start();
  const worker = workers[0];
  await assert.rejects(client.start(), /active/);
  await assert.rejects(client.send('x'), /idle input/);
  worker.reply('result', { state: 'awaiting-input', solved: false });
  await first;
  await assert.rejects(client.send('x'.repeat(LIMITS.line + 1)), /2 MiB/);
  assert.equal(worker.requests.length, 1);
  const operation = client.send('x');
  await assert.rejects(client.send('y'), /concurrent/);
  const rejection = assert.rejects(operation, { name: 'AbortError' });
  await client.stop();
  await rejection;
  assert.equal(worker.handlers.size, 0);
  assert.ok(worker.terminated);
});

test('reset rejects partial operation and stale output/win cannot alter next session', async t => {
  const events = [];
  const { client, workers } = fake(t, event => events.push(event));
  const first = client.start(), old = workers[0];
  old.reply('output', { text: 'partial' });
  const staleHandler = old.handlers.get('message'), oldRequest = old.requests[0];
  const rejection = assert.rejects(first, error => error.name === 'AbortError' && error.result.output === 'partial');
  assert.deepEqual(await client.reset(), { output: '', state: 'idle', solved: false });
  await rejection;
  assert.equal(old.handlers.size, 0);
  const next = client.start(), fresh = workers[1], count = events.length;
  for (const type of ['output', 'win', 'result', 'deadline', 'error']) {
    staleHandler({ data: { ...oldRequest, type, text: 'stale', solved: true, state: 'end', expiresAt: 0 } });
    // Even spoofing the next session on an old worker cannot pass the closure guard.
    staleHandler({ data: { ...fresh.requests[0], type, text: 'stale', solved: true, state: 'end' } });
  }
  assert.equal(events.length, count);
  fresh.reply('result', { state: 'awaiting-input', solved: false });
  assert.equal((await next).solved, false);
  assert.equal(client.solved, false);
});

test('reset during send rejects it; old operation win is ignored in the same worker', async t => {
  const { client, workers } = fake(t);
  const first = client.start(), worker = workers[0], startRequest = worker.requests[0];
  worker.reply('result', { state: 'awaiting-input', solved: false });
  await first;
  const sent = client.send(['first', 'second']);
  worker.handlers.get('message')({ data: { ...startRequest, type: 'win' } });
  assert.equal(client.solved, false);
  const rejection = assert.rejects(sent, { name: 'AbortError' });
  await client.reset();
  await rejection;
  assert.equal(worker.handlers.size, 0);
});

for (const kind of ['error', 'messageerror', 'invalid-result', 'oversized-chunk', 'output-budget']) {
  test(`Worker lifecycle failure: ${kind} rejects and cleans up`, async t => {
    const { client, workers } = fake(t);
    const request = client.start(), worker = workers[0];
    const rejection = assert.rejects(request, error => error.result?.state === 'end');
    if (kind === 'error') worker.handlers.get('error')({ message: 'load failed', preventDefault() {} });
    if (kind === 'messageerror') worker.handlers.get('messageerror')({});
    if (kind === 'invalid-result') worker.reply('result', { state: 'end', solved: true });
    if (kind === 'oversized-chunk') worker.reply('output', { text: 'x'.repeat(LIMITS.chunk + 1) });
    if (kind === 'output-budget') {
      for (let i = 0; i <= LIMITS.output / LIMITS.chunk; i++) worker.reply('output', { text: 'x'.repeat(LIMITS.chunk) });
    }
    await rejection;
    assert.ok(worker.terminated);
    assert.equal(worker.handlers.size, 0);
  });
}

test('construction and postMessage exceptions reject instead of hanging', async () => {
  const broken = createPracticeClient({ runtime: 'chaos', createWorker() { throw Error('module workers blocked'); } });
  await assert.rejects(broken.start(), /module workers blocked/);
  const worker = new FakeWorker();
  worker.postMessage = () => { throw Error('clone failed'); };
  const client = createPracticeClient({ runtime: 'chaos', createWorker: () => worker });
  await assert.rejects(client.start(), /clone failed/);
  assert.equal(worker.handlers.size, 0);
  assert.ok(worker.terminated);
});

test('deadline remains active at an input prompt and is cleared on reset', async t => {
  const events = [];
  const { client, workers } = fake(t, event => events.push(event));
  const request = client.start(), worker = workers[0];
  worker.reply('deadline', { expiresAt: monotonicMilliseconds() + 30 });
  worker.reply('result', { state: 'awaiting-input', solved: false });
  await request;
  await delay(70);
  assert.equal(client.state, 'end');
  assert.ok(worker.terminated);
  assert.equal(events.at(-1).name, 'TimeoutError');
  const next = client.start();
  workers[1].reply('deadline', { expiresAt: monotonicMilliseconds() + 30 });
  const rejection = assert.rejects(next, { name: 'AbortError' });
  await client.reset(); await rejection;
  const final = client.start();
  workers[2].reply('result', { state: 'awaiting-input', solved: false });
  await final;
  await delay(70);
  assert.equal(client.state, 'awaiting-input');
});

test('expired deadline wins over a queued completion message', async t => {
  const { client, workers } = fake(t);
  const request = client.start();
  const rejection = assert.rejects(request, { name: 'TimeoutError' });
  workers[0].reply('deadline', { expiresAt: monotonicMilliseconds() - 1 });
  workers[0].reply('win');
  await rejection;
  assert.equal(client.solved, false);
});

for (const deadline of [false, true]) {
  test(`main-thread ${deadline ? 'deadline' : 'stop'} interrupts a CPU-bound thread`, { timeout: 5000 }, async t => {
    let entered;
    const ready = new Promise(resolve => { entered = resolve; });
    let thread;
    const client = createPracticeClient({ runtime: 'chaos',
      createWorker: () => (thread = new ThreadAdapter(new URL('cpu-worker.mjs', fixtureURL), { deadline })),
      onEvent: event => { if (event.type === 'status') entered(); },
    });
    t.after(() => client.reset());
    const before = performance.now(), request = client.start();
    const rejection = assert.rejects(request, { name: deadline ? 'TimeoutError' : 'AbortError' });
    await ready;
    if (!deadline) await client.stop();
    await rejection;
    await thread.exited;
    assert.ok(performance.now() - before < 4000);
    assert.equal(thread.listenerCount, 0);
    assert.ok(thread.terminated);
  });
}

test('actual chaos Worker: successful public collision, batching and fresh reset', { timeout: 10000 }, async t => {
  const events = [], { client, threads } = actual(t, 'chaos', event => events.push(event));
  assert.equal(threads.length, 0);
  assert.deepEqual(await client.start(), { output: 'input first string to hash : ', state: 'awaiting-input', solved: false });
  const result = await client.send([witness.first, witness.second, 'unused line']);
  assert.deepEqual(result, { output: `input second string to hash : ${REWARD}\n`, state: 'end', solved: true });
  assert.equal(events.filter(event => event.type === 'win').length, 1);
  assert.ok(threads[0].terminated);
  assert.equal(threads[0].listenerCount, 0);
  await client.reset();
  assert.equal(client.solved, false);
  await client.start();
  assert.equal(threads.length, 2);
  assert.deepEqual(await client.send('00\r\n00\r\n'), {
    output: 'input second string to hash : Never gonna give you up\n', state: 'end', solved: false,
  });
});

test('actual chaos: successive prompts, blank input and malformed input', { timeout: 10000 }, async t => {
  const { client } = actual(t);
  await client.start();
  assert.deepEqual(await client.send(''), { output: 'input second string to hash : ', state: 'awaiting-input', solved: false });
  assert.match((await client.send('')).output, /Never gonna give you up/);
  await client.start();
  const result = await client.send('<script>alert(1)</script>');
  assert.equal(result.state, 'end');
  assert.match(result.output, /Never gonna let you down/);
});

const smoke = [
  ['b00tleg', undefined, /basic cryptanalysis tutorial/, ['1', '00', '9'], /01\n[\s\S]*Unexpected option/],
  ['blokechain', undefined, /Get unmined blocks/, ['3'], /Attack blocked!/],
  ['cheater-mind', undefined, /Level 1, N=6/, ['bad'], /Error, exiting/],
  ['desfunctional', undefined, /Choose an API option/, ['1', 'bad'], /[0-9a-f]{128}/],
  ['diffecient', undefined, /Added \d+ security keys/, ['2', '00', '1', '00', '4'], /key added successfully[\s\S]*Key present in DB/],
  ['diffecientwo', undefined, /Enter API option/, ['4'], /Something wrong happened/],
  ['idea', undefined, /Test Encryption/, ['4', 'bad'], /Credits Remaining: 2024/],
  ['law-and-order', undefined, /Commitments from party 8/, ['bad'], /Invalid input integer/],
  ['law-and-order', 'released', /Commitments from party 8/, ['bad'], /Invalid input integer/],
  ['randsubware', undefined, /sbox: [0-9a-f]{128}/, ['bad'], /invalid literal/],
  ['real-mersenne', undefined, /enter your guess/, ['bad'], /Error, exiting/],
];
for (const [runtime, variant, banner, lines, expected] of smoke) {
  test(`actual port session: ${runtime}/${variant || 'default'}`, { timeout: 180000 }, async t => {
    const { client, threads } = actual(t, runtime);
    const start = await client.start(variant);
    assert.equal(start.state, 'awaiting-input');
    assert.match(start.output, banner);
    const result = await client.send(lines);
    assert.equal(result.state, 'end');
    assert.equal(result.solved, false);
    assert.match(result.output, expected);
    assert.equal(threads[0].listenerCount, 0);
    const deadline = threads[0].messages.find(message => message.type === 'deadline');
    if (['blokechain', 'desfunctional', 'idea', 'randsubware'].includes(runtime)) assert.ok(deadline);
    else assert.equal(deadline, undefined);
  });
}

test('actual b00tleg run exceeds the output budget without modifying puzzle state', { timeout: 30000 }, async t => {
  const transcript = new Transcript();
  const { client } = actual(t, 'b00tleg', event => { if (event.type === 'output') transcript.append(event.text); });
  await client.start();
  // These four tutorial strings are public literals in b00tleg.mjs. This is
  // direct public-source input, not an independent cryptanalysis of its stages.
  const tutorials = ['hello world! Lets get going', 'Nothing fancy, just standard bytes_to_int',
    'mono substitutions arent that creative', 'creating different substitutions for each char'];
  for (const text of tutorials) {
    const result = await client.send(['2', Buffer.from(text).toString('hex')]);
    assert.equal(result.state, 'awaiting-input');
    assert.match(result.output, /Correct/);
  }
  // Each level-5 encryption doubles its hex input. Many short lines stay below
  // both the byte and line input limits, but the total output exceeds 8 MiB.
  const lines = Array.from({ length: 2048 }, () => ['1', '00'.repeat(1022)]).flat();
  assert.equal(normalizeInput(lines).length, LIMITS.lines);
  await assert.rejects(client.send(lines), error => {
    assert.match(error.message, /8 MiB/);
    assert.equal(error.result.state, 'end');
    assert.equal(error.result.solved, false);
    assert.ok(utf8Length(error.result.output) <= LIMITS.output);
    assert.ok(utf8Length(error.result.output) > LIMITS.output - 10000);
    return true;
  });
  assert.ok(transcript.toString().startsWith(TRUNCATION_NOTICE));
  assert.ok(utf8Length(transcript.toString()) <= LIMITS.transcript);
});

test('actual Blokechain setup can be stopped before its original deadline is installed', { timeout: 5000 }, async t => {
  let client, stopped;
  const ready = new Promise(resolve => { stopped = resolve; });
  const actualSession = actual(t, 'blokechain', event => {
    if (event.type === 'status') { client.stop(); stopped(); }
  });
  client = actualSession.client;
  await assert.rejects(client.start(), { name: 'AbortError' });
  await ready;
  await actualSession.threads[0].exited;
  assert.equal(actualSession.threads[0].messages.some(message => message.type === 'deadline'), false);
});

test('actual IDEA starts with fresh entropy on every Worker', { timeout: 10000 }, async t => {
  const { client } = actual(t, 'idea');
  await client.start();
  const first = await client.send(['1', '0']);
  await client.reset();
  await client.start();
  const second = await client.send(['1', '0']);
  assert.notEqual(first.output, second.output); // Accidental collision probability about 2^-64.
});

test('actual Worker enforces input validation independently of the client', { timeout: 10000 }, async t => {
  const thread = new ThreadAdapter();
  t.after(() => thread.terminate());
  const messages = [];
  let next;
  thread.addEventListener('message', event => { messages.push(event.data); next?.(event.data); });
  const wait = predicate => new Promise(resolve => {
    const existing = messages.find(predicate);
    if (existing) resolve(existing);
    else next = data => { if (predicate(data)) { next = null; resolve(data); } };
  });
  thread.postMessage({ type: 'start', session: 1, op: 1, runtime: 'chaos', variant: 'default', reward: 'not accepted' });
  await wait(data => data.type === 'result');
  thread.postMessage({ type: 'send', session: 1, op: 2, lines: ['x'.repeat(LIMITS.line + 1)] });
  const error = await wait(data => data.type === 'error');
  assert.match(error.message, /2 MiB/);
  assert.equal(error.solved, false);
});

test('offline UI facade with real Workers at a prefixed same-origin URL', { timeout: 15000 }, async t => {
  const { stdout } = await promisify(execFile)(process.execPath,
    ['--experimental-vm-modules', fileURLToPath(new URL('ui-harness.mjs', fixtureURL))], { timeout: 10000 });
  assert.match(stdout, /UI harness passed/);
  t.diagnostic(stdout.trim());
});

test('include and UI keep output as text, disable no-JS controls and scope styles', async () => {
  const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const include = await read('_includes/challenge-browser.html');
  const css = await read('assets/css/features/challenge-practice.css');
  const ui = await read('assets/js/challenge-practice/ui.mjs');
  assert.match(include, /<noscript>/);
  assert.doesNotMatch(include, /<pre\b|<script\b/);
  assert.match(include, /<textarea[^>]*data-practice-output[^>]*readonly[^>]*disabled/);
  assert.match(include, /<textarea[^>]*data-practice-input[^>]*disabled/);
  assert.doesNotMatch(include.match(/<form[^>]*>/)[0], /\b(action|name)=/);
  assert.match(include, /aria-live="polite"/);
  for (const control of ['output', 'input', 'variant']) {
    assert.ok(include.includes(`for="{{ _browser_uid }}-${control}"`));
    assert.ok(include.includes(`id="{{ _browser_uid }}-${control}"`));
  }
  for (const control of ['start', 'stop', 'reset', 'send']) assert.ok(include.includes(`data-practice-${control} disabled`));
  assert.match(ui, /event\.key === 'Enter' && !event\.shiftKey && !event\.isComposing/);
  assert.doesNotMatch(ui, /innerHTML|outerHTML|insertAdjacentHTML|eval\(/);
  assert.match(ui, /output\.value = transcript\.toString\(\)/);
  assert.match(css, /overscroll-behavior: contain/);
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g);
  for (const [, group] of selectors) for (const selector of group.split(',')) assert.ok(selector.trim().startsWith('.challenge-practice'));
});
