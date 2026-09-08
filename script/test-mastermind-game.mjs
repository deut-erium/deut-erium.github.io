import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { createGame, validateOptions, COLOR_NAMES } from '../assets/js/mastermind/game.mjs';
import { chooseGuess, distanceToReplyFiber } from '../assets/js/mastermind/opponent.mjs';
import { answerRequest } from '../assets/js/mastermind/opponent-worker.mjs';

const reply = (exact, misplaced) => ({ exact, misplaced });
const small = { positions: 3, colors: 2 };
const codeKey = code => code.join(',');
const replyKey = r => `${r.exact},${r.misplaced}`;
const same = (a, b) => codeKey(a) === codeKey(b);
const hamming = (a, b) => a.filter((peg, i) => peg !== b[i]).length;

// Independent scorer: remove exact pegs, then consume unmatched colors.
function removalScore(secret, guess) {
  const remaining = secret.filter((peg, i) => peg !== guess[i]);
  let exact = 0, misplaced = 0;
  guess.forEach((peg, i) => {
    if (secret[i] === peg) exact++;
    else {
      const found = remaining.indexOf(peg);
      if (found !== -1) { misplaced++; remaining.splice(found, 1); }
    }
  });
  return { exact, misplaced };
}

function codes(n, m) {
  if (!n) return [[]];
  return codes(n - 1, m).flatMap(prefix => Array.from({ length: m }, (_, i) => [...prefix, i + 1]));
}

// Direct enumeration of temporary codes. Does not use a transform or any
// production scorer, cost function, candidate filter, or random generator.
function fibers(all, guess) {
  const result = new Map();
  for (const temporary of all) {
    const key = replyKey(removalScore(temporary, guess));
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(temporary);
  }
  return result;
}

function oracleCandidates(view) {
  const all = codes(view.positions, view.colors);
  const observations = view.turns.map(turn => ({
    guess: turn.guess, fiber: fibers(all, turn.guess).get(replyKey(turn.reply)) || [],
  }));
  return all.filter(secret => observations.every(({ guess, fiber }) => !same(secret, guess)
    && fiber.some(temporary => hamming(secret, temporary) <= view.cap)));
}

function oracleWorst(view, candidates, guess) {
  const groups = new Map();
  const all = codes(view.positions, view.colors);
  for (const secret of candidates) {
    if (same(secret, guess)) continue;
    const legal = new Set(all.filter(temporary => hamming(secret, temporary) <= view.cap)
      .map(temporary => replyKey(removalScore(temporary, guess))));
    for (const r of legal) groups.set(r, (groups.get(r) || 0) + 1);
  }
  return Math.max(0, ...groups.values());
}

function assertFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value));
  Object.values(value).forEach(assertFrozen);
}

function rejectedUnchanged(game, action) {
  const before = game.view();
  assert.throws(action);
  assert.deepEqual(game.view(), before);
}

function liar(options = {}) {
  return createGame({ role: 'liar', ...small, secret: [1, 1, 1], seed: 17, id: 'test-liar', ...options });
}

function breaker(options = {}) {
  return createGame({ role: 'breaker', ...small, secret: [1, 1, 1], seed: 17, id: 'test-breaker', ...options });
}

const request = (view, requestId = 7, generation = 3) => ({ type: 'choose', requestId, generation, view, seed: 123 });

test('normalized defaults, color convention, detached options, and configuration bounds', () => {
  assert.deepEqual(validateOptions(), {
    role: 'breaker', positions: 4, colors: 6, probability: 0.1, cap: 1, limit: 16,
  });
  assert.deepEqual(COLOR_NAMES, ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange']);
  assertFrozen(COLOR_NAMES);
  const secret = [1, 2, 1];
  const normalized = validateOptions({ ...small, secret, seed: 0, id: 'fixed' });
  secret[0] = 2;
  assert.deepEqual(normalized.secret, [1, 2, 1]);
  assertFrozen(normalized);
  assert.equal(createGame({ positions: 8, colors: 6, seed: 0 }).view().positions, 8);
  assert.equal(liar({ positions: 7, colors: 4, secret: undefined }).view().phase, 'setup');
  assert.notEqual(createGame().view().id, createGame().view().id);
  for (const options of [null, [], 3, { role: 'bounded' }, { positions: 2 }, { positions: 9 },
    { positions: 3.5 }, { colors: 1 }, { colors: 7 }, { probability: NaN }, { probability: -0.1 },
    { probability: 1.1 }, { probability: '0.1' }, { cap: -1 }, { cap: 5 }, { cap: 0.5 },
    { limit: 5 }, { limit: 61 }, { seed: -1 }, { seed: 2 ** 32 }, { seed: 1.5 }, { seed: null },
    { id: '' }, { id: 1 }, { id: 'x'.repeat(129) }, { secret: [1, 2] }, { mode: 'bounded' },
    { role: 'liar', positions: 8, colors: 6 }, { role: 'liar', positions: 6, colors: 6 }]) {
    assert.throws(() => validateOptions(options));
    assert.throws(() => createGame(options));
  }
});

test('duplicate scoring matches independent removal oracle on all pairs in small domains', t => {
  let pairs = 0;
  for (const [positions, colors] of [[3, 2], [3, 3], [4, 2]]) {
    const all = codes(positions, colors);
    for (const secret of all) for (const guess of all) {
      const game = createGame({ positions, colors, secret, seed: 0, probability: 0 });
      const state = game.guess(guess);
      const expected = removalScore(secret, guess);
      if (same(secret, guess)) {
        assert.equal(state.turns[0].outcome, 'win');
        assert.equal(state.turns[0].reply, null);
        assert.deepEqual(state.review[0].truth, expected);
      } else assert.deepEqual(state.turns[0].reply, expected);
      pairs++;
    }
  }
  const game = createGame({ secret: [1, 2, 1, 3], probability: 0, seed: 1 });
  assert.deepEqual(game.guess([1, 1, 1, 1]).turns[0].reply, reply(2, 0));
  assert.deepEqual(game.guess([2, 1, 3, 1]).turns[1].reply, reply(0, 4));
  t.diagnostic(`${pairs} exhaustive engine scoring pairs`);
});

test('breaker repeats are legal; forced-change extremes preserve the fixed secret', () => {
  for (const probability of [0, 1]) {
    const game = breaker({ probability });
    for (let i = 0; i < 5; i++) {
      const state = game.guess([2, 2, 2]);
      assert.equal(state.phase, 'guess');
      assert.equal(state.turns[i].outcome, 'miss');
      assert.deepEqual(state.turns[i].reply, reply(probability ? 3 : 0, 0));
      assert.equal(state.secret, null);
      assert.equal(state.review, null);
    }
    const over = game.giveUp();
    assert.deepEqual(over.secret, [1, 1, 1]);
    for (const row of over.review) {
      assert.deepEqual(row.truth, reply(0, 0));
      assert.equal(row.changedPositions, probability ? 3 : 0);
      assert.deepEqual(row.temporary, probability ? [2, 2, 2] : [1, 1, 1]);
    }
  }
});

test('intermediate noise is reproducible and fresh per position and per turn', () => {
  const options = { positions: 4, colors: 6, secret: [1, 2, 3, 4], probability: 0.4, limit: 60, seed: 1234, id: 'noise' };
  const a = createGame(options), b = createGame(options);
  for (let i = 0; i < 60; i++) {
    assert.deepEqual(a.guess([6, 6, 6, 6]), b.guess([6, 6, 6, 6]));
  }
  const review = a.view().review;
  assert.ok(review.some(row => row.changedPositions === 0));
  assert.ok(review.some(row => row.changedPositions > 1));
  assert.ok(new Set(review.map(row => codeKey(row.temporary))).size > 15);
  for (let p = 0; p < 4; p++) {
    assert.ok(review.some(row => row.temporary[p] === options.secret[p]));
    assert.ok(review.some(row => row.temporary[p] !== options.secret[p]));
  }
  for (const row of review) assert.equal(row.changedPositions, hamming(options.secret, row.temporary));
  // A selected event must choose each of the other five colors, never itself.
  const forced = createGame({ ...options, probability: 1 });
  for (let i = 0; i < 60; i++) forced.guess([6, 6, 6, 6]);
  for (let p = 0; p < 4; p++) {
    const seen = new Set(forced.view().review.map(row => row.temporary[p]));
    assert.equal(seen.size, 5);
    assert.ok(!seen.has(options.secret[p]));
  }
});

test('actual equality wins before feedback, including the final breaker move', () => {
  const game = breaker({ probability: 1, limit: 6 });
  for (let i = 0; i < 5; i++) game.guess([2, 2, 2]); // false perfect on every miss
  const over = game.guess([1, 1, 1]);
  assert.deepEqual(over.ending, { reason: 'solved', winner: 'player' });
  assert.equal(over.turns.length, 6);
  assert.deepEqual(over.turns[5], { number: 6, guess: [1, 1, 1], reply: null, outcome: 'win' });
  assert.deepEqual(over.review[5], { number: 6, truth: reply(3, 0), temporary: null, changedPositions: 0 });
  const first = breaker({ probability: 1 }).guess([1, 1, 1]);
  assert.equal(first.ending.reason, 'solved');
  assert.equal(first.review[0].temporary, null);
});

test('wrong final breaker move, including false-perfect feedback, ends at the limit', () => {
  const game = breaker({ probability: 1, limit: 6 });
  for (let i = 0; i < 6; i++) game.guess([2, 2, 2]);
  assert.deepEqual(game.view().ending, { reason: 'limit', winner: 'computer' });
  assert.equal(game.view().turns[5].outcome, 'miss');
  assert.deepEqual(game.view().turns[5].reply, reply(3, 0));
});

test('liar setup, secret locking, revision increments, and detached input rows', () => {
  const input = [1, 2, 1];
  const game = liar({ secret: input });
  input[0] = 2;
  assert.deepEqual(game.view().secret, [1, 2, 1]);
  assert.equal(game.view().revision, 0);
  const replacement = [2, 1, 2];
  assert.equal(game.setSecret(replacement).revision, 1);
  replacement.fill(1);
  assert.deepEqual(game.lockSecret().secret, [2, 1, 2]);
  assert.equal(game.view().phase, 'ready');
  assert.equal(game.view().revision, 2);
  rejectedUnchanged(game, () => game.setSecret([1, 1, 1]));
  rejectedUnchanged(game, () => game.lockSecret([1, 1, 1]));
  const direct = liar();
  assert.deepEqual(direct.lockSecret([2, 2, 1]).secret, [2, 2, 1]);
});

test('liar cap is per turn and measured from the original, not the preceding temporary row', () => {
  const game = liar({ cap: 1 });
  game.lockSecret();
  const guess = [2, 2, 2], temporary = [2, 1, 1];
  game.issueGuess(guess);
  guess.fill(1);
  game.submitTemporary(temporary);
  temporary.fill(2);
  game.issueGuess([2, 2, 2]);
  rejectedUnchanged(game, () => game.submitTemporary([2, 2, 1])); // one edit from prior row, two from secret
  game.submitTemporary([1, 2, 1]); // two from prior row, one from secret
  game.issueGuess([2, 2, 2]);
  game.submitTemporary([1, 1, 2]);
  assert.deepEqual(game.view().secret, [1, 1, 1]);
  assert.deepEqual(game.solverView().turns.map(turn => turn.reply), [reply(1, 0), reply(1, 0), reply(1, 0)]);
  const over = game.giveUp();
  assert.equal(over.review.reduce((sum, row) => sum + row.changedPositions, 0), 3);
});

test('liar zero/full caps and false-perfect scores do not manufacture a win', () => {
  const honest = liar({ cap: 0 });
  honest.lockSecret();
  honest.issueGuess([2, 1, 1]);
  rejectedUnchanged(honest, () => honest.submitTemporary([2, 1, 1]));
  assert.equal(honest.submitTemporary([1, 1, 1]).phase, 'ready');
  const game = liar({ cap: 3 });
  game.lockSecret();
  game.issueGuess([2, 2, 2]);
  const ready = game.submitTemporary([2, 2, 2]);
  assert.equal(ready.phase, 'ready');
  assert.equal(ready.ending, null);
  assert.equal(ready.turns[0].outcome, 'miss');
  assert.deepEqual(ready.turns[0].reply, reply(3, 0));
  assert.deepEqual(game.solverView().turns, [{ guess: [2, 2, 2], reply: reply(3, 0) }]);
  assert.equal(game.issueGuess([1, 1, 1]).ending.reason, 'solved');
});

test('liar final misses keep the reply phase; rejected final edits do not consume it', () => {
  const game = liar({ cap: 1, limit: 6 });
  game.lockSecret();
  for (let i = 0; i < 5; i++) {
    game.issueGuess([2, 2, 2]);
    game.submitTemporary([1, 1, 1]);
  }
  const pending = game.issueGuess([2, 1, 1]);
  assert.equal(pending.turns.length, 6);
  assert.equal(pending.phase, 'reply');
  assert.equal(pending.ending, null);
  assert.equal(pending.turns[5].reply, null);
  rejectedUnchanged(game, () => game.submitTemporary([2, 2, 1]));
  const over = game.submitTemporary([2, 1, 1]);
  assert.equal(over.phase, 'over');
  assert.deepEqual(over.ending, { reason: 'limit', winner: 'player' });
  assert.deepEqual(over.turns[5].reply, reply(3, 0));
  assert.equal(over.turns[5].outcome, 'miss');
});

test('actual liar equality wins immediately, including on the last permitted issue', () => {
  for (const misses of [0, 5]) {
    const game = liar({ limit: 6 });
    game.lockSecret();
    for (let i = 0; i < misses; i++) {
      game.issueGuess([2, 2, 2]);
      game.submitTemporary([1, 1, 1]);
    }
    const over = game.issueGuess([1, 1, 1]);
    assert.deepEqual(over.ending, { reason: 'solved', winner: 'computer' });
    assert.equal(over.turns.at(-1).reply, null);
    assert.equal(over.turns.at(-1).outcome, 'win');
    assert.equal(over.review.at(-1).temporary, null);
    rejectedUnchanged(game, () => game.submitTemporary([2, 1, 1]));
  }
});

test('every forbidden phase/role transition rejects atomically', () => {
  const actions = {
    setSecret: g => g.setSecret([1, 1, 1]), lockSecret: g => g.lockSecret(),
    guess: g => g.guess([2, 2, 2]), issueGuess: g => g.issueGuess([2, 2, 2]),
    submitTemporary: g => g.submitTemporary([1, 1, 1]), giveUp: g => g.giveUp(),
    solverView: g => g.solverView(),
  };
  const setup = liar(), ready = liar(), pending = liar(), active = breaker(), over = breaker();
  ready.lockSecret();
  pending.lockSecret(); pending.issueGuess([2, 2, 2]);
  over.guess([1, 1, 1]);
  for (const [game, allowed] of [
    [setup, ['setSecret', 'lockSecret']], [ready, ['issueGuess', 'giveUp', 'solverView']],
    [pending, ['submitTemporary', 'giveUp']], [active, ['guess', 'giveUp']], [over, []],
  ]) {
    for (const [name, action] of Object.entries(actions)) {
      if (!allowed.includes(name)) rejectedUnchanged(game, () => action(game));
    }
  }
});

test('malformed moves, holes, accessors, and custom array fields reject without state or RNG changes', () => {
  const getter = [1, 1, 1];
  Object.defineProperty(getter, '0', { get() { assert.fail('Getter must not run'); } });
  const iterator = [1, 1, 1];
  iterator[Symbol.iterator] = function* () { yield 2; };
  const badCodes = [null, '111', [1, 1], [1, 1, 1, 1], [0, 1, 1], [3, 1, 1],
    [1.5, 1, 1], [NaN, 1, 1], new Array(3), new Uint8Array([1, 1, 1]), getter, iterator];
  const game = breaker({ probability: 0.5 }), control = breaker({ probability: 0.5 });
  for (const bad of badCodes) {
    rejectedUnchanged(game, () => game.guess(bad));
    const setup = liar();
    rejectedUnchanged(setup, () => setup.setSecret(bad));
    rejectedUnchanged(setup, () => setup.lockSecret(bad));
    setup.lockSecret();
    rejectedUnchanged(setup, () => setup.issueGuess(bad));
    setup.issueGuess([2, 2, 2]);
    rejectedUnchanged(setup, () => setup.submitTemporary(bad));
  }
  for (let i = 0; i < 4; i++) assert.deepEqual(game.guess([2, 2, 2]), control.guess([2, 2, 2]));
  assert.deepEqual(game.giveUp(), control.giveUp());
  assert.throws(() => createGame({ get seed() { assert.fail('Option getter must not run'); } }));
});

test('views are recursively frozen and detached; active breaker history has no private data', () => {
  const game = breaker({ probability: 1 });
  const before = game.view();
  game.guess([2, 2, 2]);
  const active = game.view();
  assert.deepEqual(Object.keys(active), ['id', 'revision', 'role', 'positions', 'colors', 'probability', 'cap', 'limit',
    'phase', 'turns', 'secret', 'ending', 'review']);
  assert.equal(active.secret, null);
  assert.equal(active.review, null);
  assert.equal(active.ending, null);
  assert.deepEqual(Object.keys(active.turns[0]), ['number', 'guess', 'reply', 'outcome']);
  for (const forbidden of ['temporary', 'truth', 'seed', 'random', 'changedPositions']) {
    assert.ok(!JSON.stringify(active).includes(`"${forbidden}"`));
  }
  assertFrozen(active);
  assert.throws(() => active.turns[0].guess.fill(1));
  assert.throws(() => { active.turns[0].reply.exact = 0; });
  const again = game.view();
  assert.notEqual(active.turns, again.turns);
  assert.notEqual(active.turns[0].guess, again.turns[0].guess);
  assert.notEqual(active.turns[0].reply, again.turns[0].reply);
  const over = game.giveUp();
  assertFrozen(over);
  assert.deepEqual(over.secret, [1, 1, 1]);
  assert.equal(before.turns.length, 0);
  assert.equal(active.secret, null);
  assert.equal(active.review, null);
  assert.equal(active.phase, 'guess');
});

test('solver views contain only answered misses and cannot expose liar edits or seed', () => {
  const game = liar();
  game.lockSecret();
  const initial = game.solverView();
  assert.deepEqual(initial, { ...small, cap: 1, turns: [] });
  game.issueGuess([2, 2, 2]);
  assert.throws(() => game.solverView());
  game.submitTemporary([2, 1, 1]);
  const view = game.solverView();
  assert.deepEqual(view, { ...small, cap: 1, turns: [{ guess: [2, 2, 2], reply: reply(1, 0) }] });
  assertFrozen(view);
  assert.notEqual(view.turns[0].guess, game.view().turns[0].guess);
  assert.notEqual(view.turns[0].reply, game.solverView().turns[0].reply);
  assert.throws(() => { view.turns[0].reply.misplaced = 3; });
  assert.equal(initial.turns.length, 0);
  game.giveUp();
  assert.throws(() => game.solverView());
});

test('give-up preserves unanswered history without inventing a temporary code', () => {
  const game = liar();
  game.lockSecret();
  game.issueGuess([2, 2, 2]);
  const over = game.giveUp();
  assert.deepEqual(over.ending, { reason: 'giveup', winner: null });
  assert.equal(over.turns[0].outcome, 'pending');
  assert.equal(over.turns[0].reply, null);
  assert.deepEqual(over.review[0], { number: 1, truth: reply(0, 0), temporary: null, changedPositions: 0 });
  rejectedUnchanged(game, () => game.giveUp());
});

test('separable distances equal exhaustive fiber search in six small domains, including empty fibers', t => {
  let entries = 0, transforms = 0;
  for (const [positions, colors] of [[3, 2], [3, 3], [3, 4], [4, 2], [4, 3], [5, 2]]) {
    const all = codes(positions, colors);
    for (const guess of all) {
      const byReply = fibers(all, guess);
      for (let exact = 0; exact <= positions; exact++) for (let misplaced = 0; misplaced <= positions - exact; misplaced++) {
        const reported = reply(exact, misplaced);
        const fiber = byReply.get(replyKey(reported)) || [];
        const actual = distanceToReplyFiber(guess, reported, { positions, colors });
        assert.ok(actual instanceof Uint8Array);
        assert.equal(actual.length, all.length);
        for (let i = 0; i < all.length; i++) {
          const expected = fiber.reduce((minimum, temporary) => Math.min(minimum, hamming(all[i], temporary)), positions + 1);
          assert.equal(actual[i], expected, `${positions}x${colors}: ${guess}; ${replyKey(reported)}; ${all[i]}`);
          entries++;
        }
        transforms++;
      }
    }
  }
  t.diagnostic(`${transforms} transforms; ${entries} distances checked against exhaustive search`);
});

test('all legal single-turn fibers give the exact candidate count and a compatible sampled guess', () => {
  const all = codes(3, 2);
  for (const guess of all) for (const key of fibers(all, guess).keys()) {
    const [exact, misplaced] = key.split(',').map(Number);
    for (let cap = 0; cap <= 3; cap++) {
      const view = { ...small, cap, turns: [{ guess, reply: reply(exact, misplaced) }] };
      const expected = oracleCandidates(view);
      if (!expected.length) assert.throws(() => chooseGuess(view, { seed: 0, probeLimit: 1 }));
      else {
        const result = chooseGuess(view, { seed: 0, probeLimit: 1 });
        assert.equal(result.candidates, expected.length);
        assert.ok(expected.some(candidate => same(candidate, result.guess)));
      }
    }
  }
});

test('every true secret survives legal per-turn edits and arbitrary failed-guess exclusions', t => {
  let transcripts = 0;
  for (const colors of [2, 3]) {
    const all = codes(3, colors);
    for (const secret of all) for (let cap = 0; cap <= 3; cap++) {
      const turns = [];
      for (const guess of all.filter(code => !same(code, secret))) {
        const temporary = secret.slice();
        for (let j = 0; j < cap; j++) {
          const position = (turns.length + j) % 3;
          temporary[position] = temporary[position] % colors + 1;
        }
        turns.push({ guess, reply: removalScore(temporary, guess) });
        if (turns.length <= 3) {
          const view = { positions: 3, colors, cap, turns };
          const expected = oracleCandidates(view);
          assert.ok(expected.some(candidate => same(candidate, secret)));
          const result = chooseGuess(view, { seed: turns.length, probeLimit: 1 });
          assert.equal(result.candidates, expected.length);
          assert.ok(expected.some(candidate => same(candidate, result.guess)));
        }
      }
      // Every other code is now an authenticated miss. If truth was removed
      // by even one observation, this must fail instead of returning it.
      const result = chooseGuess({ positions: 3, colors, cap, turns }, { seed: 3 });
      assert.equal(result.candidates, 1);
      assert.deepEqual(result.guess, secret);
      transcripts++;
    }
  }
  t.diagnostic(`${transcripts} full-elimination transcripts retained their true secret`);
});

test('engine and opponent complete legal small-board rounds without losing truth or repeating misses', () => {
  for (const secret of codes(3, 2)) for (let cap = 0; cap <= 3; cap++) {
    const game = liar({ secret, cap, limit: 8 });
    game.lockSecret();
    while (game.view().phase !== 'over') {
      const view = game.solverView();
      const compatible = oracleCandidates(view);
      assert.ok(compatible.some(candidate => same(candidate, secret)));
      const choice = chooseGuess(view, { seed: 100 + view.turns.length });
      assert.equal(choice.candidates, compatible.length);
      assert.ok(!view.turns.some(turn => same(turn.guess, choice.guess)));
      const issued = game.issueGuess(choice.guess);
      if (same(choice.guess, secret)) {
        assert.equal(issued.phase, 'over');
        assert.equal(issued.ending.reason, 'solved');
      } else {
        assert.equal(issued.phase, 'reply');
        const temporary = secret.slice();
        for (let i = 0; i < cap; i++) {
          const p = (view.turns.length + i) % 3;
          temporary[p] = 3 - temporary[p];
        }
        game.submitTemporary(temporary);
      }
    }
    assert.equal(game.view().ending.reason, 'solved'); // eight fresh guesses exhaust this eight-code domain
    assert.deepEqual(game.view().secret, secret);
  }
});

test('largest permitted code space remains bounded; large breaker boards need no enumeration', () => {
  const choice = chooseGuess({ positions: 7, colors: 4, cap: 1, turns: [] }, { seed: 0 });
  assert.equal(choice.candidates, 16384);
  assert.equal(choice.probes, 16);
  assert.equal(choice.guess.length, 7);
  const game = createGame({ positions: 8, colors: 6, seed: 0, secret: Array(8).fill(1), probability: 1 });
  assert.equal(game.guess(Array(8).fill(6)).phase, 'guess');
  assert.equal(game.guess(Array(8).fill(1)).ending.reason, 'solved');
});

test('position-fiber cost differs from whole-reply disagreements and never accumulates across turns', () => {
  const view = { ...small, cap: 1, turns: [{ guess: [1, 1, 2], reply: reply(3, 0) }] };
  // A false perfect requires the temporary code to equal the guess exactly.
  // Only its three Hamming neighbors survive, not all seven non-guessed codes.
  assert.equal(chooseGuess(view, { seed: 0 }).candidates, 3);
  view.turns = Array.from({ length: 60 }, () => ({ guess: [1, 1, 2], reply: reply(3, 0) }));
  assert.equal(chooseGuess(view, { seed: 0 }).candidates, 3);
  assert.throws(() => chooseGuess({ ...view, cap: 0 }, { seed: 0 }));
  const impossible = { ...small, cap: 3, turns: [{ guess: [1, 1, 1], reply: reply(2, 1) }] };
  assert.throws(() => chooseGuess(impossible, { seed: 0 }), /No secret/);
});

test('probe objective matches exhaustive worst legal groups, with equality removed before feedback', () => {
  for (const colors of [2, 3]) for (let cap = 0; cap <= 3; cap++) {
    const initial = { positions: 3, colors, cap, turns: [] };
    const afterMiss = { ...initial, turns: [{ guess: [1, 1, 1], reply: reply(1, 0) }] };
    for (const view of [initial, afterMiss]) {
      const candidates = oracleCandidates(view);
      const available = codes(3, colors).filter(code => !view.turns.some(turn => same(turn.guess, code)));
      const best = Math.min(...available.map(guess => oracleWorst(view, candidates, guess)));
      for (const seed of [0, 1, 17]) {
        const result = chooseGuess(view, { seed, probeLimit: 64 });
        assert.equal(result.candidates, candidates.length);
        assert.equal(oracleWorst(view, candidates, result.guess), best);
        assert.ok(!view.turns.some(turn => same(turn.guess, result.guess)));
        assert.equal(result.probes, candidates.length === 1 ? 1 : available.length);
      }
    }
  }
});

test('shortlists are bounded, ties use private seeds, and results do not mutate input', () => {
  const view = { positions: 4, colors: 6, cap: 2, turns: [] };
  const saved = structuredClone(view);
  const choices = new Set();
  for (let seed = 0; seed < 12; seed++) {
    const a = chooseGuess(view, { seed, probeLimit: 3 });
    const b = chooseGuess(view, { seed, probeLimit: 3 });
    assert.deepEqual(a, b);
    assert.deepEqual(Object.keys(a), ['guess', 'candidates', 'probes']);
    assert.equal(a.candidates, 1296);
    assert.equal(a.probes, 3);
    assertFrozen(a);
    choices.add(codeKey(a.guess));
  }
  assert.ok(choices.size > 1);
  // Same full shortlist, identical objective for every probe: differences here
  // come from tie-breaking, not merely from drawing different shortlists.
  const tied = new Set(Array.from({ length: 12 }, (_, seed) => codeKey(
    chooseGuess({ ...small, cap: 3, turns: [] }, { seed, probeLimit: 64 }).guess)));
  assert.ok(tied.size > 1);
  assert.deepEqual(view, saved);
  assert.equal(chooseGuess(view, { seed: 0 }).probes, 16);
});

test('reviewed 4x6 cap-2 constant-(2,0) hiding result holds for every secret/query pair', t => {
  const options = { positions: 4, colors: 6 }, all = codes(4, 6), reported = reply(2, 0);
  const canonical = [[1, 1, 1, 1], [1, 1, 1, 2], [1, 1, 2, 2], [1, 1, 2, 3], [1, 2, 3, 4]];
  // Independently search every secret in all five multiplicity classes.
  for (const guess of canonical) {
    const fiber = fibers(all, guess).get(replyKey(reported));
    const actual = distanceToReplyFiber(guess, reported, options);
    all.forEach((secret, i) => {
      const expected = fiber.reduce((minimum, temporary) => Math.min(minimum, hamming(secret, temporary)), 5);
      assert.equal(actual[i], expected);
      assert.ok(expected <= 2);
    });
  }
  for (const guess of all) {
    const distances = distanceToReplyFiber(guess, reported, options);
    for (const distance of distances) assert.ok(distance <= 2);
  }
  // These replies must remove only distinct confirmed misses, even after 60
  // turns. The move goal is not a deduction or worst-case success guarantee.
  const view = { ...options, cap: 2, turns: [] };
  for (let i = 0; i < 60; i++) {
    const result = chooseGuess(view, { seed: i, probeLimit: i < 3 ? 16 : 1 });
    assert.equal(result.candidates, 1296 - i);
    assert.ok(!view.turns.some(turn => same(turn.guess, result.guess)));
    view.turns.push({ guess: result.guess, reply: reported });
  }
  assert.equal(chooseGuess(view, { seed: 60, probeLimit: 1 }).candidates, 1236);
  const control = chooseGuess({ ...options, cap: 1, turns: [{ guess: [1, 1, 1, 1], reply: reported }] }, { seed: 0, probeLimit: 1 });
  assert.ok(control.candidates < 1295);
  t.diagnostic('1,679,616 secret/query distances <= 2; 6,480 canonical distances independently searched; 60 hiding turns');
});

test('opponent rejects private/unknown fields, pending turns, malformed arrays, and excessive work', () => {
  const view = { ...small, cap: 1, turns: [] };
  for (const field of ['secret', 'truth', 'temporary', 'seed', 'review', 'phase', 'id', 'random', 'limit']) {
    assert.throws(() => chooseGuess({ ...view, [field]: null }, { seed: 0 }));
  }
  for (const bad of [null, [], { ...view, positions: 2 }, { ...view, colors: 7 }, { ...view, cap: 4 },
    { ...view, cap: '1' }, { ...view, positions: 8, colors: 6 }, { ...view, turns: new Array(1) },
    { ...view, turns: Array(61).fill({ guess: [1, 1, 1], reply: reply(1, 0) }) },
    { ...view, turns: [{ guess: [1, 1, 1], reply: null }] },
    { ...view, turns: [{ guess: [1, 1, 1], reply: reply(1, 0), truth: reply(1, 0) }] },
    { ...view, turns: [{ guess: [1, 1, 1], reply: { ...reply(1, 0), temporary: [1, 1, 1] } }] },
    { ...view, turns: [{ guess: [1, 1, 3], reply: reply(1, 0) }] },
    { ...view, turns: [{ guess: [1, 1, 1], reply: reply(3, 1) }] },
    { ...view, turns: [{ guess: [1, 1, 1], reply: reply(0.5, 0) }] },
    { ...view, get turns() { assert.fail('View getter must not run'); } }]) {
    assert.throws(() => chooseGuess(bad, { seed: 0 }));
  }
  for (const options of [null, { seed: -1 }, { seed: 2 ** 32 }, { seed: 0.5 }, { probeLimit: 0 },
    { probeLimit: 65 }, { probeLimit: NaN }, { secret: [1, 1, 1] }]) {
    assert.throws(() => chooseGuess(view, options));
  }
  assert.throws(() => distanceToReplyFiber([1, 1, 1], reply(0, 0), { ...small, cap: 1 }));
});

test('pure worker boundary returns matching IDs and rejects full/private views without echoing them', async () => {
  const game = liar(); game.lockSecret();
  const message = request(game.solverView());
  const saved = structuredClone(message);
  const response = await answerRequest(message);
  assert.deepEqual(response, { type: 'choice', requestId: 7, generation: 3, result: chooseGuess(message.view, { seed: 123 }) });
  assert.deepEqual(message, saved);
  for (const bad of [
    { ...message, type: 'other' }, { ...message, seed: -1 }, { ...message, seed: '123' },
    { ...message, view: game.view() }, { ...message, secret: 'do-not-echo' },
    { ...message, view: { ...message.view, secret: 'do-not-echo' } },
    { ...message, view: { ...message.view, turns: [{ guess: [2, 2, 2], reply: reply(1, 0), temporary: 'do-not-echo' }] } },
    { ...message, view: { ...message.view, turns: [{ guess: [2, 2, 2], reply: { ...reply(1, 0), truth: 'do-not-echo' } }] } },
    { ...message, view: { ...message.view, turns: [{ guess: [2, 2, 2], reply: null }] } },
    { ...message, view: { ...message.view, cap: 0, turns: [{ guess: [2, 2, 2], reply: reply(3, 0) }] } },
  ]) {
    const error = await answerRequest(bad);
    assert.equal(error.type, 'error');
    assert.equal(error.requestId, 7);
    assert.equal(error.generation, 3);
    assert.equal(typeof error.message, 'string');
    assert.ok(!JSON.stringify(error).includes('do-not-echo'));
    assert.deepEqual(Object.keys(error), ['type', 'requestId', 'generation', 'message']);
  }
  for (const bad of [null, [], {}, { ...message, requestId: {} }, { ...message, generation: -1 }]) {
    assert.equal((await answerRequest(bad)).type, 'error');
  }
  assert.equal((await answerRequest({ ...message, requestId: '7' })).requestId, null);
  const noSeed = { ...message }; delete noSeed.seed;
  assert.equal((await answerRequest(noSeed)).type, 'error');
});

test('pure worker snapshots public requests before asynchronous loading and never runs accessors', async () => {
  const message = request({ ...small, cap: 1, turns: [{ guess: [2, 2, 2], reply: reply(1, 0) }] });
  const expected = chooseGuess(structuredClone(message.view), { seed: message.seed });
  const pending = answerRequest(message);
  message.requestId = 100;
  message.generation = 100;
  message.seed = 0;
  message.view.turns[0].guess.fill(1);
  message.view.turns[0].reply.exact = 3;
  message.view.secret = 'do-not-echo';
  assert.deepEqual(await pending, { type: 'choice', requestId: 7, generation: 3, result: expected });
  const getter = request({ ...small, cap: 1, get turns() { assert.fail('Worker view getter must not run'); } });
  assert.equal((await answerRequest(getter)).type, 'error');
  const getterCode = [1, 1, 1];
  Object.defineProperty(getterCode, '0', { get() { assert.fail('Worker code getter must not run'); } });
  const response = await answerRequest(request({ ...small, cap: 1, turns: [{ guess: getterCode, reply: reply(0, 0) }] }));
  assert.equal(response.type, 'error');
  assert.equal(response.requestId, 7);
});

test('worker correlation survives concurrent requests and stale generations without shared state', async () => {
  const view = { ...small, cap: 1, turns: [] };
  const messages = [request(view, 10, 8), request(view, 11, 7), request(view, 12, 9)];
  const responses = await Promise.all(messages.map(message => answerRequest(message)));
  // Deliberately deliver in a different order. UI may discard old generations;
  // this stateless adapter must preserve them, not rewrite them as current.
  for (const response of responses.reverse()) {
    const original = messages.find(message => message.requestId === response.requestId);
    assert.equal(response.generation, original.generation);
    assert.deepEqual(response.result, chooseGuess(original.view, { seed: original.seed }));
  }
});

test('real worker adapter accepts an immediate first request; dependency imports preserve asset version', async () => {
  const workerURL = new URL('../assets/js/mastermind/opponent-worker.mjs?v=backend-contract-test', import.meta.url);
  const source = await readFile(new URL('../assets/js/mastermind/opponent-worker.mjs', import.meta.url), 'utf8');
  assert.match(source, /file \+ new URL\(import\.meta\.url\)\.search/);
  assert.ok(!source.includes('./game.mjs'));
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    const queued = [];
    globalThis.self = { postMessage: value => parentPort.postMessage(value) };
    parentPort.on('message', data => self.onmessage ? self.onmessage({ data }) : queued.push(data));
    import(${JSON.stringify(workerURL.href)}).then(() => {
      for (const data of queued) self.onmessage({ data });
    });
  `, { eval: true });
  try {
    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker response timed out')), 10000);
      worker.once('message', result => { clearTimeout(timeout); resolve(result); });
      worker.once('error', error => { clearTimeout(timeout); reject(error); });
      worker.postMessage(request({ ...small, cap: 1, turns: [] }, 42, 99));
    });
    assert.equal(response.type, 'choice');
    assert.equal(response.requestId, 42);
    assert.equal(response.generation, 99);
    assert.equal(response.result.candidates, 8);
  } finally { await worker.terminate(); }
});
