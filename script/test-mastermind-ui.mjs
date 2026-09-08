import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, restoreSession, MAX_SAVE_BYTES } from '../assets/js/mastermind/session.mjs';
import { chooseGuess, QUERY_CAP } from '../assets/js/mastermind/policies.mjs';
import { boundedCandidates, rankByAgreement } from '../assets/js/mastermind/inference.mjs';
import { enumerateCodes } from '../assets/js/mastermind/core.mjs';
import { answerRequest } from '../assets/js/mastermind/worker.mjs';
import { createSolverClient } from '../assets/js/mastermind/transport.mjs';

const initial = (changes = {}) => ({ positions: 3, colors: 3, secret: [1, 2, 1], seed: 7,
  mode: 'bounded', policy: 'bounded', lieBudget: 1, noiseModel: null, probability: null, ...changes });
const noisy = (changes = {}) => initial({ mode: 'misread', policy: 'fields', lieBudget: null,
  noiseModel: 'forced-change', probability: 0.2, ...changes });
const quick = { yieldControl: async () => {} };
const issue = s => s.issueGuess(chooseGuess(s.solverView(), s.initial.policy).guess);
const restored = s => restoreSession(s.exportText(), quick);
const changeSave = (s, fn) => { const value = JSON.parse(s.exportText()); fn(value); return JSON.stringify(value); };

// Independent selection from the core's exposed candidate arrays, not a second
// implementation of the query policy under test.
test('known-L selection sorts disagreement before lex; Watch uses the exposed rankings', () => {
  for (const policy of ['bounded', 'fields', 'replies']) {
    const s = createSession(policy === 'bounded' ? initial() : noisy({ policy }));
    while (!s.ending()) {
      const view = s.solverView();
      const rows = policy === 'bounded' ? [...boundedCandidates(view.config, view.turns, view.lieBudget)]
        .sort((a, b) => a.disagreements - b.disagreements || a.code.join('').localeCompare(b.code.join('')))
        : rankByAgreement(view.config, view.turns, policy);
      const result = chooseGuess(view, policy);
      assert.deepEqual(result.guess, rows[0].code);
      assert.equal(result.candidates, rows.length);
      s.issueGuess(result.guess);
      if (!s.ending()) policy === 'bounded' ? s.sendTruth() : s.sampleReply();
    }
  }
});

test('all 27 tiny secrets finish honestly with unique issued guesses, including equality', async () => {
  for (const secret of enumerateCodes({ positions: 3, colors: 3 })) {
    const s = createSession(initial({ secret, lieBudget: 0 }));
    while (!s.ending()) { issue(s); if (!s.ending()) s.sendTruth(); }
    const turns = s.solverView().turns;
    assert.equal(s.ending(), 'solved');
    assert.ok(turns.length <= 27);
    assert.equal(new Set(turns.map(t => t.guess.join(','))).size, turns.length);
    assert.equal(turns.at(-1).reply, null);
    assert.deepEqual((await restored(s)).snapshot(), s.snapshot());
  }
});

test('invalid replies do not alter history; exhausted lies fail; false all-exact cannot win', async () => {
  const s = createSession(initial());
  issue(s);
  const old = s.exportText();
  assert.throws(() => s.submitReply({ exact: 0, misplaced: 1 }), /not attainable/);
  assert.equal(s.exportText(), old);
  s.submitReply({ exact: 3, misplaced: 0 });
  assert.equal(s.ending(), null);
  assert.equal(s.oracleView().remainingBudget, 0);
  issue(s);
  assert.equal(s.ending(), null);
  const pending = s.exportText();
  const falseReply = s.oracleView().legalReplies.find(r => JSON.stringify(r) !== JSON.stringify(s.oracleView().truth));
  assert.throws(() => s.submitReply(falseReply), /No false replies/);
  assert.equal(s.exportText(), pending);
  s.sendTruth();
  while (!s.ending()) { issue(s); if (!s.ending()) s.sendTruth(); }
  assert.equal(s.review().spent, 1);
  assert.equal(s.review().annotations[0].changedReply, true);
  assert.deepEqual((await restored(s)).snapshot(), s.snapshot());
});

test('snapshots and action logs are immutable; pending guess survives restore with a new ID', async () => {
  const s = createSession(initial());
  issue(s);
  const before = s.solverView();
  assert.throws(() => before.turns[0].guess[0] = 3, TypeError);
  assert.throws(() => s.actionLog().push({ type: 'truth' }), TypeError);
  assert.throws(() => s.initial.secret[0] = 3, TypeError);
  const recovered = await restored(s);
  assert.notEqual(recovered.solverView().sessionId, s.solverView().sessionId);
  assert.equal(recovered.solverView().phase, 'awaiting-reply');
  assert.deepEqual(recovered.snapshot(), s.snapshot());
  s.sendTruth();
  assert.equal(before.turns[0].reply, null);
  recovered.sendTruth();
  assert.deepEqual(recovered.snapshot(), s.snapshot());
});

test('both seeded channels replay complete private review and resume the next draw exactly', async () => {
  for (const noiseModel of ['forced-change', 'redraw']) {
    for (const policy of ['fields', 'replies']) {
      const s = createSession(noisy({ secret: [3, 3, 3], noiseModel, policy, probability: 0.7 }));
      issue(s); s.sampleReply(); issue(s);
      const recovered = await restored(s);
      assert.deepEqual(recovered.snapshot(), s.snapshot());
      if (!s.ending()) { s.sampleReply(); recovered.sampleReply(); }
      assert.deepEqual(recovered.snapshot(), s.snapshot());
      if (!s.ending()) { s.cancel(); recovered.cancel(); }
      assert.deepEqual(recovered.review().randomState, s.review().randomState);
      assert.deepEqual((await restored(recovered)).snapshot(), s.snapshot());
    }
  }
});

test('60-query cap is terminal, retains the final noisy reply, and replays exactly', async () => {
  const s = createSession(noisy({ positions: 4, colors: 6, secret: [6, 6, 6, 6], probability: 1 }));
  while (!s.ending()) { issue(s); if (!s.ending()) s.sampleReply(); }
  assert.equal(s.ending(), 'capped');
  assert.equal(s.solverView().turns.length, QUERY_CAP);
  assert.notEqual(s.solverView().turns.at(-1).reply, null);
  assert.equal(s.review().annotations.length, QUERY_CAP);
  assert.throws(() => issue(s));
  assert.throws(() => s.sampleReply(), /ended/);
  assert.deepEqual((await restored(s)).snapshot(), s.snapshot());
});

test('restore rejects malformed, oversized, impossible, mismatched and off-policy saves', async () => {
  const s = createSession(initial());
  issue(s); s.sendTruth(); issue(s);
  const edits = [
    v => v.version++, v => v.extra = true, v => v.initial.positions = 8,
    v => v.initial.secret = [0, 2, 1], v => v.initial.seed = -1,
    v => v.initial.policy = 'fields', v => v.initial.lieBudget = 61,
    v => v.actions[0].guess = [3, 3, 3], v => v.actions[1] = { type: 'sample' },
    v => v.actions[1] = { type: 'reply', reply: { exact: 0, misplaced: 1 } },
    v => v.actions[1].extra = true, v => v.actions[0].guess = [1, 1],
    v => v.actions.push({ type: 'guess', guess: [1, 1, 3] }),
    v => v.actions = new Array(122).fill({ type: 'cancel' }),
    v => v.state.solver.turns[0].reply.exact++, v => v.state.oracle.remainingBudget++,
    v => v.state.ending = 'solved', v => v.state.oracle.secret = [3, 3, 3],
    v => v.state.solver.sessionId = 'reuse-me',
  ];
  for (const edit of edits) await assert.rejects(restoreSession(changeSave(s, edit), quick));
  for (const value of ['', '{', 'null', '[]', 'x'.repeat(MAX_SAVE_BYTES + 1), null]) {
    await assert.rejects(restoreSession(value, quick));
  }
  const n = createSession(noisy({ probability: 1 }));
  issue(n); n.sampleReply(); n.cancel();
  await assert.rejects(restoreSession(changeSave(n, v => v.state.review.randomState++), quick), /does not match/);
  let yields = 0;
  await assert.rejects(restoreSession(s.exportText(), {
    yieldControl: async () => { yields++; }, isCancelled: () => yields > 0,
  }), { name: 'AbortError' });
});

test('asynchronous replay queries receive only public views and cancellation is checked after await', async () => {
  const s = createSession(noisy());
  issue(s); s.sampleReply(); issue(s);
  const seen = [];
  const recovered = await restoreSession(s.exportText(), { ...quick,
    query: async (view, policy) => {
      assert.doesNotMatch(JSON.stringify(view), /secret|truth|remainingBudget|spent|random|seed|annotations/);
      seen.push(view);
      return chooseGuess(view, policy);
    },
  });
  assert.equal(seen.length, 2);
  assert.deepEqual(recovered.snapshot(), s.snapshot());
  let cancelled = false;
  await assert.rejects(restoreSession(s.exportText(), { ...quick,
    query: async (view, policy) => { cancelled = true; return chooseGuess(view, policy); },
    isCancelled: () => cancelled,
  }), { name: 'AbortError' });
});

class FakeWorker {
  constructor() { this.terminated = 0; this.sent = null; this.readySent = false; }
  ready() { this.readySent = true; this.onmessage({ data: { type: 'ready' } }); }
  postMessage(value) { this.sent = structuredClone(value); this.deliver = this.onmessage; this.fail = this.onerror; }
  terminate() { this.terminated++; }
  async respond(value) { this.deliver({ data: value ?? await answerRequest(this.sent) }); }
}
function fixture(timeoutMs = 500) {
  const workers = [];
  const transport = createSolverClient({ url: '/local-worker.mjs', timeoutMs,
    workerFactory: () => { const w = new FakeWorker(); workers.push(w); return w; } });
  const client = { ...transport, request(...args) {
    const result = transport.request(...args);
    if (!workers.at(-1).readySent) workers.at(-1).ready();
    return result;
  } };
  return { workers, client };
}

test('worker sees only solverView plus public policy/correlation IDs; single awaited turn', async () => {
  const { client, workers } = fixture();
  const s = createSession(initial());
  const promise = client.request(s.solverView(), s.initial.policy);
  const envelope = workers[0].sent;
  assert.deepEqual(Object.keys(envelope).sort(), ['generation', 'policy', 'requestId', 'sessionId', 'solverView']);
  assert.deepEqual(envelope.solverView, s.solverView());
  assert.doesNotMatch(JSON.stringify(envelope), /secret|truth|remainingBudget|spent|random|seed|annotations/);
  await assert.rejects(client.request(s.solverView(), s.initial.policy), /already in flight/);
  await workers[0].respond();
  assert.deepEqual((await promise).guess, [1, 1, 1]);
  assert.equal(workers[0].terminated, 0, 'successful turns retain one idle worker');
  assert.equal(client.busy(), false);
  client.cancel();
  assert.equal(workers[0].terminated, 1, 'cancel terminates an idle worker too');
});

test('cancel physically terminates; delayed old callbacks and wrong generations cannot settle a new request', async () => {
  const { client, workers } = fixture();
  const s = createSession(initial());
  const old = client.request(s.solverView(), 'bounded');
  const rejected = assert.rejects(old, { name: 'AbortError' });
  client.cancel();
  await rejected;
  assert.equal(workers[0].terminated, 1);
  const fresh = client.request(s.solverView(), 'bounded');
  await workers[0].respond();
  workers[0].fail({ preventDefault() {} });
  const good = await answerRequest(workers[1].sent);
  for (const key of ['sessionId', 'requestId', 'generation']) await workers[1].respond({ ...good, [key]: 'stale' });
  assert.equal(client.busy(), true);
  await workers[1].respond();
  assert.deepEqual((await fresh).guess, [1, 1, 1]);
  assert.equal(workers[1].terminated, 0);
  client.cancel();
  assert.equal(workers[1].terminated, 1);
});

test('retained worker rejects a duplicate result from the previous request', async () => {
  const { client, workers } = fixture();
  const s = createSession(initial());
  const first = client.request(s.solverView(), 'bounded');
  const oldResult = await answerRequest(workers[0].sent);
  await workers[0].respond(oldResult);
  await first;
  const second = client.request(s.solverView(), 'bounded');
  assert.equal(workers.length, 1);
  await workers[0].respond(oldResult);
  assert.equal(client.busy(), true);
  await workers[0].respond();
  await second;
  client.cancel();
});

test('startup handshake precedes the first message and a late ready cannot revive a cancelled worker', async () => {
  const worker = new FakeWorker();
  const client = createSolverClient({ url: '/local.mjs', workerFactory: () => worker });
  const pending = client.request(createSession(initial()).solverView(), 'bounded');
  assert.equal(worker.sent, null);
  const lateReady = worker.onmessage;
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  client.cancel();
  await rejected;
  lateReady({ data: { type: 'ready' } });
  assert.equal(worker.sent, null);
  assert.equal(worker.terminated, 1);
});

test('worker timeout/errors terminate once; retry starts a distinct request', async () => {
  const { client, workers } = fixture(10);
  await assert.rejects(client.request(createSession(initial()).solverView(), 'bounded'), /exceeded/);
  assert.equal(workers[0].terminated, 1);
  const pending = client.request(createSession(initial()).solverView(), 'bounded');
  const error = assert.rejects(pending, /worker failed/);
  workers[1].fail({ preventDefault() {} });
  await error;
  assert.equal(workers[1].terminated, 1);
  await workers[1].respond();
  client.cancel();
  assert.equal(workers[1].terminated, 1);
});
