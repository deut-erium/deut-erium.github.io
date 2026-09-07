import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configuration, score, enumerateCodes, attainableReplies, misread, createRandom,
  replyDistribution, wholeReplyCost, fieldDisagreementCost,
} from '../assets/js/mastermind/core.mjs';
import { boundedCandidates, rankByAgreement } from '../assets/js/mastermind/inference.mjs';
import { createGame } from '../assets/js/mastermind/referee.mjs';

const config = { positions: 4, colors: 6 };
const r = (exact, misplaced) => ({ exact, misplaced });
const drawSequence = values => {
  let index = 0;
  return () => {
    assert.ok(index < values.length, 'unexpected random draw');
    return values[index++];
  };
};
const almost = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);

// Independent oracle: remove exact matches, then consume remaining pegs.
function removalScore(secret, guess) {
  const remaining = secret.filter((peg, i) => peg !== guess[i]);
  let exact = 0;
  let misplaced = 0;
  guess.forEach((peg, i) => {
    if (secret[i] === peg) exact++;
    else {
      const index = remaining.indexOf(peg);
      if (index !== -1) { misplaced++; remaining.splice(index, 1); }
    }
  });
  return { exact, misplaced };
}

function recursiveCodes(n, c) {
  if (n === 0) return [[]];
  return recursiveCodes(n - 1, c).flatMap(prefix => Array.from({ length: c }, (_, i) => [...prefix, i + 1]));
}

function eventTreeDistribution(secret, guess, colors, p, model) {
  const found = new Map();
  function walk(prefix, weight) {
    if (prefix.length === secret.length) {
      const value = removalScore(prefix, guess);
      const key = `${value.exact},${value.misplaced}`;
      found.set(key, (found.get(key) || 0) + weight);
      return;
    }
    const original = secret[prefix.length];
    walk([...prefix, original], weight * (1 - p));
    const alternatives = Array.from({ length: colors }, (_, i) => i + 1)
      .filter(peg => model === 'redraw' || peg !== original);
    alternatives.forEach(peg => walk([...prefix, peg], weight * p / alternatives.length));
  }
  walk([], 1);
  return found;
}

function compareDistributions(a, b) {
  const keyed = values => new Map(values.map(x => [`${x.reply.exact},${x.reply.misplaced}`, x.probability]));
  const ma = keyed(a), mb = keyed(b);
  for (const key of new Set([...ma.keys(), ...mb.keys()])) almost(ma.get(key) || 0, mb.get(key) || 0);
}

test('article examples: exact, misplaced, duplicates, misses and win', () => {
  const secret = [1, 2, 1, 3]; // R B R G; Y is 4.
  for (const [guess, expected] of [
    [[1, 3, 4, 1], r(1, 2)], [[1, 1, 1, 1], r(2, 0)],
    [[2, 1, 3, 1], r(0, 4)], [[4, 4, 4, 4], r(0, 0)],
    [[1, 2, 1, 3], r(4, 0)], [[1, 2, 4, 3], r(3, 0)],
  ]) assert.deepEqual(score(secret, guess, config), expected);
});

test('scoring agrees with independent oracle on every pair in nine small domains', () => {
  let checks = 0;
  for (const positions of [1, 2, 3]) for (const colors of [2, 3, 4]) {
    const options = { positions, colors };
    const codes = enumerateCodes(options);
    assert.deepEqual(codes, recursiveCodes(positions, colors));
    for (const secret of codes) for (const guess of codes) {
      const result = score(secret, guess, options);
      assert.deepEqual(result, removalScore(secret, guess));
      assert.deepEqual(result, score(guess, secret, options));
      assert.ok(result.exact + result.misplaced <= positions);
      assert.notDeepEqual(result, r(positions - 1, 1));
      assert.equal(result.exact === positions, secret.join() === guess.join());
      checks++;
    }
  }
  assert.equal(checks, 5271);
});

test('configuration and code validation rejects malformed or unbounded input', () => {
  for (const options of [null, { positions: 0, colors: 6 }, { positions: 4, colors: 1 },
    { positions: 4.5, colors: 6 }, { positions: 4, colors: Infinity }]) {
    assert.throws(() => configuration(options));
  }
  for (const bad of [[1, 2], [0, 1, 1, 1], [7, 1, 1, 1], [NaN, 1, 1, 1],
    [1, 2, 3, undefined], new Array(4), '1234']) {
    assert.throws(() => score(bad, [1, 1, 1, 1], config));
    assert.throws(() => score([1, 1, 1, 1], bad, config));
  }
  assert.throws(() => enumerateCodes({ positions: 8, colors: 16 }), /limit/);
  assert.throws(() => enumerateCodes(config, Infinity));
  assert.throws(() => replyDistribution([1, 1, 1, 1, 1], [1, 1, 1, 1, 1],
    { positions: 5, colors: 8 }, { probability: 0.2 }), /limit/);
});

test('attainability depends on the guess, not just independent count ranges', () => {
  const allRed = attainableReplies([1, 1, 1, 1], config);
  assert.deepEqual(allRed, [r(0, 0), r(1, 0), r(2, 0), r(3, 0), r(4, 0)]);
  assert.ok(!attainableReplies([1, 2, 3, 4], config).some(x => x.exact === 3 && x.misplaced === 1));
});

test('forced changes use < p, never select the original color, and preserve the secret', () => {
  const options = { positions: 1, colors: 3 };
  const secret = [2];
  for (const [event, replacement, expected] of [[0, 0, 1], [0.199999, 0.99, 3], [0.2, 0, 2], [0.999999, 0, 2]]) {
    const result = misread(secret, [1], options, { probability: 0.2, random: drawSequence([event, replacement]) });
    assert.deepEqual(result.temporary, [expected]);
    assert.deepEqual(secret, [2]);
  }
  assert.deepEqual(misread(secret, [1], options, { probability: 0, random: drawSequence([0, 0]) }).temporary, secret);
  assert.equal(misread(secret, [1], options, { probability: 1, random: drawSequence([0.999999, 0]) }).changedPositions, 1);
});

test('redraws can retain a peg; changed pegs can preserve the entire reply', () => {
  const retained = misread([2], [1], { positions: 1, colors: 3 }, {
    probability: 1, model: 'redraw', random: drawSequence([0, 0.5]),
  });
  assert.equal(retained.attempted, 1);
  assert.equal(retained.changedPositions, 0);
  assert.equal(retained.changedReply, false);
  const unchangedScore = misread([1, 1], [3, 3], { positions: 2, colors: 3 }, {
    probability: 1, random: drawSequence([0, 0, 0, 0]),
  });
  assert.equal(unchangedScore.changedPositions, 2);
  assert.equal(unchangedScore.changedReply, false);
});

test('probabilities, noise names and random draws are validated', () => {
  for (const probability of [-1, 1.1, NaN, Infinity, undefined, '0.2']) {
    assert.throws(() => misread([1], [1], { positions: 1, colors: 2 }, { probability, random: () => 0 }));
  }
  assert.throws(() => misread([1], [1], { positions: 1, colors: 2 }, { probability: 0.2, model: 'other', random: () => 0 }));
  for (const random of [() => -0.1, () => 1, () => NaN, () => Infinity, null]) {
    assert.throws(() => misread([1], [1], { positions: 1, colors: 2 }, { probability: 0.2, random }));
  }
});

test('seeded streams replay exactly, including after a snapshot', () => {
  const a = createRandom(0), b = createRandom(0);
  assert.deepEqual(Array.from({ length: 40 }, () => a.next()), Array.from({ length: 40 }, () => b.next()));
  const restored = createRandom(a.snapshot());
  assert.deepEqual(Array.from({ length: 40 }, () => a.next()), Array.from({ length: 40 }, () => restored.next()));
  assert.throws(() => createRandom(-1));
});

test('exact likelihoods agree with independent event enumeration', () => {
  for (const colors of [2, 3]) {
    const options = { positions: 2, colors };
    for (const secret of recursiveCodes(2, colors)) for (const guess of recursiveCodes(2, colors)) {
      for (const probability of [0, 0.2, 1]) for (const model of ['forced-change', 'redraw']) {
        const distribution = replyDistribution(secret, guess, options, { model, probability });
        almost(distribution.reduce((sum, x) => sum + x.probability, 0), 1);
        const independent = eventTreeDistribution(secret, guess, colors, probability, model);
        for (const entry of distribution) {
          const key = `${entry.reply.exact},${entry.reply.misplaced}`;
          almost(entry.probability, independent.get(key) || 0);
          independent.delete(key);
        }
        independent.forEach(weight => almost(weight, 0));
      }
    }
  }
});

test('redraw and forced-change agree after rate conversion', () => {
  const options = { positions: 3, colors: 3 };
  for (const probability of [0, 0.2, 0.8, 1]) {
    compareDistributions(
      replyDistribution([1, 2, 1], [2, 2, 3], options, { probability, model: 'redraw' }),
      replyDistribution([1, 2, 1], [2, 2, 3], options, { probability: probability * 2 / 3, model: 'forced-change' }),
    );
  }
});

test('no-information boundaries give the same likelihood for every secret', () => {
  const options = { positions: 2, colors: 3 };
  for (const noise of [{ model: 'forced-change', probability: 2 / 3 }, { model: 'redraw', probability: 1 }]) {
    for (const guess of enumerateCodes(options)) {
      const expected = replyDistribution([1, 1], guess, options, noise);
      for (const secret of enumerateCodes(options)) compareDistributions(expected, replyDistribution(secret, guess, options, noise));
    }
  }
  assert.deepEqual(replyDistribution([1, 2], [2, 1], { positions: 2, colors: 2 },
    { probability: 1 }), [{ reply: r(2, 0), probability: 1 }]);
});

test('article candidate counts distinguish a plausible wrong reply from contradiction', () => {
  const codes = enumerateCodes(config);
  const redGuess = [1, 1, 1, 1];
  assert.equal(codes.filter(candidate => removalScore(candidate, redGuess).exact === 2).length, 150);
  assert.equal(codes.filter(candidate => removalScore(candidate, redGuess).exact === 1).length, 500);
});

test('temporary-secret noise is not determined by the truthful score alone', () => {
  const options = { positions: 3, colors: 3 };
  const guess = [1, 1, 2];
  assert.deepEqual(score([1, 1, 1], guess, options), r(2, 0));
  assert.deepEqual(score([1, 1, 3], guess, options), r(2, 0));
  const probability = secret => replyDistribution(secret, guess, options, { probability: 0.25 })
    .find(entry => entry.reply.exact === 1 && entry.reply.misplaced === 2).probability;
  almost(probability([1, 1, 1]), 9 / 64);
  almost(probability([1, 1, 3]), 3 / 128);
});

test('one whole false reply can disagree with one or two legacy fields', () => {
  assert.deepEqual([r(0, 2), r(0, 0)].map(x => wholeReplyCost(r(1, 1), x)), [1, 1]);
  assert.deepEqual([r(0, 2), r(0, 0)].map(x => fieldDisagreementCost(r(1, 1), x)), [1, 2]);
});

const gameOptions = overrides => ({ ...config, secret: [1, 2, 1, 3], sessionId: 'game-a', lieBudget: 1, ...overrides });
const issue = (game, guess, turnId = 1, sessionId = 'game-a') => game.issueGuess({ sessionId, turnId, guess });
const submit = (game, value, turnId = 1, sessionId = 'game-a') => game.submitReply({ sessionId, turnId, reply: value });

test('secret and returned state cannot be edited through caller references', () => {
  const secret = [1, 2, 1, 3];
  const game = createGame(gameOptions({ secret }));
  secret.fill(6);
  const guess = [1, 1, 1, 1];
  const state = issue(game, guess);
  guess.fill(6);
  assert.deepEqual(state.turns[0].guess, [1, 1, 1, 1]);
  assert.deepEqual(game.oracleView().secret, [1, 2, 1, 3]);
  assert.throws(() => state.turns.push({}));
  assert.throws(() => { state.turns[0].guess[0] = 6; });
  assert.throws(() => { game.oracleView().secret[0] = 6; });
  submit(game, r(2, 0));
  assert.equal(state.turns[0].reply, null, 'old snapshots do not change');
});

test('whole replies spend one budget unit; invalid submissions do not spend it', () => {
  const game = createGame(gameOptions({}));
  issue(game, [1, 3, 4, 1]); // truth (1,2)
  assert.throws(() => submit(game, r(4, 4)));
  assert.throws(() => submit(game, r(3, 1)));
  assert.equal(game.oracleView().remainingBudget, 1);
  submit(game, r(0, 0)); // both fields changed; one reply
  assert.equal(game.oracleView().remainingBudget, 0);
  issue(game, [1, 1, 1, 1], 2);
  assert.throws(() => submit(game, r(1, 0), 2), /No false/);
  game.sendTruth({ sessionId: 'game-a', turnId: 2 });
  assert.equal(game.oracleView().remainingBudget, 0);
});

test('noisy all-exact is not victory; true equality wins once and counts the terminal guess', () => {
  const game = createGame(gameOptions({}));
  issue(game, [1, 1, 1, 1]);
  assert.equal(submit(game, r(4, 0)).phase, 'ready');
  const won = issue(game, [1, 2, 1, 3], 2);
  assert.equal(won.phase, 'solved');
  assert.equal(won.turns.length, 2);
  assert.equal(won.turns[1].reply, null);
  assert.throws(() => submit(game, r(0, 0), 2));
  assert.throws(() => issue(game, [1, 2, 1, 3], 3));
  assert.equal(game.review().turns.length, 2);
});

test('randomly corrupted all-exact cannot win; true guess bypasses noise', () => {
  const options = { positions: 2, colors: 2, secret: [1, 2], mode: 'misread', probability: 1, seed: 7, sessionId: 'game-a' };
  const game = createGame(options);
  issue(game, [2, 1]);
  const state = game.sampleReply({ sessionId: 'game-a', turnId: 1 });
  assert.deepEqual(state.turns[0].reply, r(2, 0));
  assert.equal(state.phase, 'ready');
  issue(game, [1, 2], 2);
  assert.equal(game.solverView().phase, 'solved');
  const fresh = createGame(options);
  issue(fresh, [1, 2]);
  assert.equal(fresh.review().randomState, 7, 'no noise sampled for true equality');
});

test('session and turn IDs reject stale, duplicate and out-of-order work', () => {
  const game = createGame(gameOptions({}));
  assert.throws(() => issue(game, [1, 1, 1, 1], 1, 'old'));
  assert.throws(() => issue(game, [1, 1, 1, 1], 2));
  issue(game, [1, 1, 1, 1]);
  assert.throws(() => issue(game, [2, 2, 2, 2], 2));
  assert.throws(() => submit(game, r(2, 0), 2));
  submit(game, r(2, 0));
  assert.throws(() => submit(game, r(2, 0)));
  assert.throws(() => issue(game, [1, 1, 1, 1], 1), /next turn/);
  issue(game, [2, 2, 2, 2], 2);
  game.cancel({ sessionId: 'game-a' });
  assert.throws(() => submit(game, r(1, 0), 2));
  assert.throws(() => issue(game, [1, 2, 1, 3], 3));
  const replacement = createGame(gameOptions({ sessionId: 'game-b' }));
  assert.throws(() => issue(replacement, [1, 1, 1, 1]));
});

test('solver messages exclude private referee data and seed', () => {
  const game = createGame(gameOptions({ mode: 'misread', probability: 0.2, seed: 42 }));
  issue(game, [1, 1, 1, 1]);
  game.sampleReply({ sessionId: 'game-a', turnId: 1 });
  const view = game.solverView();
  assert.deepEqual(Object.keys(view).sort(), ['config', 'lieBudget', 'mode', 'noise', 'phase', 'sessionId', 'turns']);
  assert.deepEqual(Object.keys(view.turns[0]).sort(), ['guess', 'outcome', 'reply', 'turnId']);
  for (const privateName of ['secret', 'truth', 'remainingBudget', 'seed', 'randomState', 'changedReply', 'temporary']) {
    assert.ok(!JSON.stringify(view).includes(`"${privateName}"`));
  }
  assert.throws(() => game.review(), /Finish/);
});

test('seeded game replay reproduces replies without storing hidden data in solver messages', () => {
  const run = () => {
    const game = createGame(gameOptions({ mode: 'misread', probability: 0.4, seed: 91 }));
    [[1, 1, 1, 1], [2, 2, 2, 2], [3, 3, 3, 3]].forEach((guess, i) => {
      issue(game, guess, i + 1);
      game.sampleReply({ sessionId: 'game-a', turnId: i + 1 });
    });
    game.cancel({ sessionId: 'game-a' });
    return game.review();
  };
  assert.deepEqual(run(), run());
});

test('bounded inference retains truth under every allowed two-round tiny transcript', () => {
  const options = { positions: 2, colors: 2 };
  const codes = enumerateCodes(options);
  let checked = 0;
  for (const secret of codes) for (const budget of [0, 1, 2]) {
    function walk(history, spent) {
      const actual = boundedCandidates(options, history, budget);
      const expected = codes.filter(candidate => history.every(turn => candidate.join() !== turn.guess.join()))
        .map(candidate => ({ code: candidate, disagreements: history.filter(turn =>
          JSON.stringify(removalScore(candidate, turn.guess)) !== JSON.stringify(turn.reply)).length }))
        .filter(candidate => candidate.disagreements <= budget);
      assert.deepEqual(actual, expected);
      assert.ok(actual.some(x => x.code.join() === secret.join()));
      checked++;
      if (history.length === 2) return;
      for (const guess of codes) {
        if (guess.join() === secret.join()) continue;
        const truth = removalScore(secret, guess);
        for (const reported of attainableReplies(guess, options)) {
          const nextSpent = spent + Number(JSON.stringify(truth) !== JSON.stringify(reported));
          if (nextSpent <= budget) walk([...history, { guess, reply: reported, outcome: 'not-solved' }], nextSpent);
        }
      }
    }
    walk([], 0);
  }
  assert.ok(checked > 100);
});

test('inference consumes trusted non-wins, detects contradiction, and handles terminal equality', () => {
  const options = { positions: 2, colors: 2 };
  const history = [{ guess: [1, 1], reply: r(2, 0), outcome: 'not-solved' }];
  assert.deepEqual(boundedCandidates(options, history, 0), []);
  assert.equal(boundedCandidates(options, history, 1).length, 3);
  assert.equal(boundedCandidates(options, [{ guess: [1, 1], reply: null, outcome: 'not-solved' }], 0).length, 3);
  assert.deepEqual(boundedCandidates(options, [{ guess: [1, 2], reply: null, outcome: 'solved' }], 0), [{ code: [1, 2], disagreements: 0 }]);
  assert.throws(() => boundedCandidates(options, [{ guess: [1, 2], reply: r(2, 0), outcome: 'solved' }], 0));
  assert.throws(() => boundedCandidates(options, [{ guess: [1, 1], reply: r(0, 0) }], 0));
  assert.throws(() => boundedCandidates(options, new Array(1), 0));
});

test('agreement rankings use the declared objective and stable lexicographic ties', () => {
  const options = { positions: 2, colors: 3 };
  const history = [{ guess: [1, 2], reply: r(0, 2), outcome: 'not-solved' }];
  for (const objective of ['fields', 'replies']) {
    const ranked = rankByAgreement(options, history, objective);
    for (const candidate of ranked) {
      const truth = removalScore(candidate.code, history[0].guess);
      const expected = objective === 'fields'
        ? Number(truth.exact !== 0) + Number(truth.exact + truth.misplaced !== 2)
        : Number(truth.exact !== 0 || truth.misplaced !== 2);
      assert.equal(candidate.disagreements, expected);
    }
    assert.deepEqual(ranked[0], { code: [2, 1], disagreements: 0 });
    const ties = ranked.filter(x => x.disagreements === 1).map(x => x.code.join());
    assert.deepEqual(ties, [...ties].sort());
  }
  assert.throws(() => rankByAgreement(options, [], 'unknown'));
});

test('caller-defined iterators cannot replace indexed codes or histories', () => {
  const secret = [1, 1];
  secret[Symbol.iterator] = function* () { yield 2; };
  assert.deepEqual(score(secret, [1, 1], { positions: 2, colors: 2 }), r(2, 0));
  const distribution = replyDistribution(secret, [1, 1], { positions: 2, colors: 2 }, { probability: 0 });
  assert.deepEqual(distribution, [{ reply: r(2, 0), probability: 1 }]);
  const history = [{ guess: [1, 1], reply: null, outcome: 'not-solved' }];
  history[Symbol.iterator] = function* () {};
  assert.equal(boundedCandidates({ positions: 2, colors: 2 }, history, 0).length, 3);
});

test('inference rejects unattainable replies and histories beyond its explicit work limit', () => {
  const options = { positions: 2, colors: 2 };
  const invalid = [{ guess: [1, 1], reply: r(0, 1), outcome: 'not-solved' }];
  for (const run of [history => boundedCandidates(options, history, 1),
    history => rankByAgreement(options, history)]) {
    assert.throws(() => run(invalid), /not attainable/);
    assert.throws(() => run(Array.from({ length: 61 }, () => ({ guess: [1, 1], reply: r(0, 0), outcome: 'not-solved' }))), /history length/);
  }
});

test('caller edits cannot change configuration, allowance or submitted feedback', () => {
  const options = gameOptions({});
  const game = createGame(options);
  options.lieBudget = 60; options.colors = 2; options.sessionId = 'other';
  issue(game, [1, 1, 1, 1]);
  const response = r(0, 0);
  submit(game, response);
  response.exact = 4;
  assert.deepEqual(game.solverView().turns[0].reply, r(0, 0));
  assert.equal(game.solverView().config.colors, 6);
  assert.equal(game.solverView().lieBudget, 1);
  assert.equal(game.oracleView().remainingBudget, 0);
});

test('game validation rejects unsupported modes/configurations and wrong reply channels', () => {
  for (const bad of [{ mode: 'unknown' }, { lieBudget: -1 }, { sessionId: '' },
    { mode: 'misread', probability: 0.1 }, { mode: 'misread', seed: 1, probability: NaN },
    { positions: 8, colors: 16, secret: Array(8).fill(1) }]) {
    assert.throws(() => createGame(gameOptions(bad)));
  }
  const bounded = createGame(gameOptions({}));
  issue(bounded, [1, 1, 1, 1]);
  assert.throws(() => bounded.sampleReply({ sessionId: 'game-a', turnId: 1 }));
  const noisy = createGame(gameOptions({ mode: 'misread', probability: 0.1, seed: 1 }));
  issue(noisy, [1, 1, 1, 1]);
  assert.throws(() => submit(noisy, r(2, 0)));
  assert.throws(() => noisy.sendTruth({ sessionId: 'game-a', turnId: 1 }));
});
