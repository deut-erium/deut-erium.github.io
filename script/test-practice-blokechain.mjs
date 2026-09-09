// Public reference vectors and deterministic-IO controls for the archived
// Cyber Apocalypse 2023 Blokechain port. No service entrypoint or private
// answer/solver is loaded. Full protocol wins below are controls, not solves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PythonRandom } from '../assets/js/challenge-practice/lib/python-random.mjs';
import {
  PARAMETERS, PROMPT, pythonPositiveIntSet, randomFormula, evalFormula,
  getBalanced, PrivateHash, diagnosticHex, verifyChain, canDestroyVessels, run,
} from '../assets/js/challenge-practice/ports/blokechain.mjs';

const root = new URL('../', import.meta.url);
const vectors = JSON.parse(readFileSync(new URL('agent_out/challenge-runtime/blokechain/vectors.json', root), 'utf8'));
const entropy = Uint8Array.from(Buffer.from(vectors.private_hash.entropy_hex, 'hex'));
const fresh = () => PythonRandom.fresh(() => entropy.slice());
// Injected reference state is used only by pure-helper tests. run() constructs
// its own complete PrivateHash and cannot receive this object through options.
const referenceHash = Object.assign(Object.create(PrivateHash.prototype), {
  N_in: 50, N_out: 100, functions: vectors.private_hash.functions,
});
const blocks = vectors.chain.blocks.map(pair => pair.map(BigInt));
const correctHashes = vectors.chain.hashes.map(BigInt);

function makeIO(read) {
  const record = { events: [], statuses: [], deadlines: [], entropyRequests: [],
    randomBounds: [], clocks: [], wins: 0, clock: 0 };
  const io = {
    reward: 'practice{local_dummy_reward}',
    async read(prompt = '') {
      const answer = await read(prompt, record);
      assert.equal(typeof answer, 'string');
      record.events.push({ read: prompt, answer });
      return answer;
    },
    write(text) { record.events.push({ write: String(text) }); },
    win(text = io.reward) { record.wins++; record.events.push({ win: text }); },
    randomBytes(n) {
      record.entropyRequests.push(n);
      assert.equal(n, 2496);
      assert.equal(record.entropyRequests.length, 1);
      return entropy.slice();
    },
    randomBelow(n) {
      const call = record.randomBounds.length;
      record.randomBounds.push(n);
      assert.equal(n, call % 2 ? 100_000n : 1n << 50n);
      return call % 2 ? 99_999n : (BigInt(call / 2) * 0x123456789abn + 0x13579n) % n;
    },
    now() { record.clocks.push(record.clock); return record.clock; },
    setDeadline(seconds) {
      assert.equal(record.statuses.at(-1), 'Generating balanced DNFs: 100/100');
      assert.equal(record.events.length, 0, 'deadline follows setup and precedes input');
      record.deadlines.push(seconds);
    },
    status(text) { record.statuses.push(text); },
  };
  return { io, record };
}

function checkSetup(record) {
  assert.deepEqual(record.entropyRequests, [2496]);
  assert.deepEqual(record.deadlines, [2000]);
  assert.deepEqual(record.statuses, Array.from({ length: 101 }, (_, i) => `Generating balanced DNFs: ${i}/100`));
}

async function transcript(answers, atRead = () => {}) {
  let cursor = 0;
  const { io, record } = makeIO((prompt, state) => {
    assert.ok(cursor < answers.length, `unexpected read: ${prompt}`);
    atRead(cursor, prompt, state);
    return answers[cursor++];
  });
  await run(io);
  assert.equal(cursor, answers.length);
  checkSetup(record);
  return record;
}

function writes(record) { return record.events.filter(event => 'write' in event).map(event => event.write); }

test('reference provenance and unchanged production dimensions', () => {
  assert.equal(vectors.source.sha256, 'c4974c9b2a81981b399f1e1217af58dfbe4461c89f02d92c00fe51d15edce363');
  const source = new URL(vectors.source.path, root);
  const snapshot = new URL(vectors.source.snapshot_path, root);
  assert.equal(createHash('sha256').update(readFileSync(snapshot)).digest('hex'), vectors.source.snapshot_sha256);
  // CI may retain only this group's public vectors, snapshot and generator.
  if (existsSync(source)) {
    assert.equal(createHash('sha256').update(readFileSync(source)).digest('hex'), vectors.source.sha256);
  }
  assert.deepEqual(PARAMETERS, {
    inputs: 50, outputs: 100, clauses: 10, trials: 500,
    blocks: 60, miningRate: 1, deadline: 2000, payoutThreshold: 100_000_000n,
  });
  assert.ok(Object.isFrozen(PARAMETERS));
});

test('509 CPython positive-int set order vectors, including both small-table resizes', () => {
  assert.equal(vectors.sets.length, 509);
  for (const sample of vectors.sets) assert.deepEqual(pythonPositiveIntSet(sample.input), sample.output);
});

test('108 AST-extracted random_formula vectors and nine subsequent RNG states', () => {
  assert.equal(vectors.formulas.reduce((n, sample) => n + sample.formulas.length, 0), 108);
  for (const sample of vectors.formulas) {
    const rng = new PythonRandom(BigInt(sample.seed));
    for (const formula of sample.formulas) {
      assert.deepEqual(randomFormula(rng, sample.inputs, sample.clauses), formula);
    }
    assert.equal(rng.getrandbits(128).toString(), sample.next_bits);
  }
});

test('128 evaluator vectors: bit order, negation, empty inputs and eager invalid-index errors', () => {
  assert.equal(vectors.evaluations.length, 128);
  for (const sample of vectors.evaluations) {
    if ('error' in sample) {
      assert.throws(() => evalFormula(sample.formula, sample.bits), { message: sample.error });
    } else {
      assert.equal(evalFormula(sample.formula, sample.bits), Number(sample.value));
    }
  }
});

test('getBalanced default 512 trials/9 clauses matches Python without changing production settings', () => {
  const sample = vectors.balanced_default;
  const rng = new PythonRandom(BigInt(sample.seed));
  assert.deepEqual(getBalanced(rng, 50, 9), sample.formula);
  assert.equal(rng.getrandbits(128).toString(), sample.next_bits);
});

test('strict balance acceptance at +/-24 versus +/-26 using 50 inputs and 500 trials (controlled draws)', () => {
  // Ten identical +x1 clauses. Each attempt consumes every trial and all 50
  // variables even though evaluation can stop at the first satisfied clause.
  const words = [];
  const pushBit = bit => words.push(bit * 0x40000000);
  function attempt(positiveTrials) {
    for (let clause = 0; clause < 10; clause++) {
      words.push(0, 0); // randint(1,50) -> count=1, variable=1
      pushBit(1); // random.choice([-1,1]) -> +1
    }
    for (let trial = 0; trial < 500; trial++) {
      pushBit(Number(trial < positiveTrials));
      for (let v = 1; v < 50; v++) pushBit(0);
    }
  }
  for (const [reject, accept] of [[263, 262], [237, 238]]) {
    words.length = 0;
    attempt(reject); attempt(accept);
    let cursor = 0;
    const controlled = { uint32() { assert.ok(cursor < words.length); return words[cursor++]; } };
    assert.deepEqual(getBalanced(controlled, 50, 10, 500), Array.from({ length: 10 }, () => [1]));
    assert.equal(cursor, words.length);
  }
});

test('strict equality at +/-10 is rejected (200-trial, default-threshold control)', () => {
  // Reduced trial count is only to make exact equality reachable; production's
  // 500-trial balance is even, so the +/-25 equality cannot occur there.
  const words = [];
  for (const positives of [105, 95, 104]) {
    for (let c = 0; c < 10; c++) words.push(0, 0, 0x40000000);
    for (let t = 0; t < 200; t++) {
      words.push(t < positives ? 0x40000000 : 0);
      for (let v = 1; v < 50; v++) words.push(0);
    }
  }
  let cursor = 0;
  const controlled = { uint32() { assert.ok(cursor < words.length); return words[cursor++]; } };
  assert.deepEqual(getBalanced(controlled, 50, 10, 200), Array.from({ length: 10 }, () => [1]));
  assert.equal(cursor, words.length);
});

test('entire 50 -> 100 PrivateHash: ten clauses, 500 trials, all DNFs and final RNG state', () => {
  const rng = fresh(), progress = [];
  const H = new PrivateHash(50, 100, rng, 10, 500, (done, total) => progress.push([done, total]));
  assert.deepEqual(H.functions, vectors.private_hash.functions);
  assert.equal(rng.getrandbits(128).toString(), vectors.private_hash.next_bits);
  assert.deepEqual(progress, Array.from({ length: 101 }, (_, i) => [i, 100]));
});

test('71 full-width hash vectors, including zero, leading zeros, maximum, negative and oversize inputs', () => {
  assert.equal(vectors.private_hash.hashes.length, 71);
  for (const sample of vectors.private_hash.hashes) {
    if ('error' in sample) {
      assert.throws(() => referenceHash.hash(BigInt(sample.input)), { message: sample.error });
    } else {
      assert.equal(referenceHash.hash(BigInt(sample.input)).toString(), sample.value);
    }
  }
});

test('MSB-first inputs and outputs (four-bit injected-state control)', () => {
  const H = Object.assign(Object.create(PrivateHash.prototype), {
    N_in: 4, N_out: 4, functions: [[[1]], [[2]], [[3]], [[4]]],
  });
  for (let i = 0n; i < 16n; i++) assert.equal(H.hash(i), i);
});

test('12 AST verify_chain vectors: clock boundaries, negative clock, malformed helper arrays and diagnostics', () => {
  assert.equal(vectors.chain.cases.length, 12);
  for (const sample of vectors.chain.cases) {
    const submitted = sample.submitted ? sample.submitted.map(BigInt) : correctHashes;
    if ('error' in sample) {
      assert.throws(() => verifyChain(referenceHash, blocks, submitted, sample.elapsed), { message: sample.error });
    } else {
      const got = verifyChain(referenceHash, blocks, submitted, sample.elapsed);
      assert.equal(got.payout.toString(), sample.value);
      assert.deepEqual(got.lines, sample.lines);
    }
  }
});

test('zero and maximum reward boundaries with real 100-bit hashes (controlled payouts)', () => {
  const custom = blocks.map(([n], i) => [n, [0n, 1n, 99_999n][i % 3]]);
  assert.equal(verifyChain(referenceHash, custom, correctHashes, 0).payout, 2_000_000n);
  assert.equal(verifyChain(referenceHash, custom, correctHashes, 59).payout, 99_999n);
  assert.equal(verifyChain(referenceHash, custom, correctHashes, 60).payout, 0n);
});

test('diagnostic formatting retains Python negative-hash slicing and does not truncate large submissions', () => {
  assert.equal(diagnosticHex(0n, 25), '0'.repeat(25));
  assert.equal(diagnosticHex(-1n, 25), '0'.repeat(23) + 'x1');
  assert.equal(diagnosticHex(-0x123n, 2), 'x123');
  assert.equal(diagnosticHex(1n << 100n, 25), '1' + '0'.repeat(25));
});

test('payout predicate is strictly greater than 100,000,000 and uses exact integers', () => {
  for (const n of [-1n, 0n, 99_999_999n, 100_000_000n]) assert.equal(canDestroyVessels(n), false);
  for (const n of [100_000_001n, 1n << 100n]) assert.equal(canDestroyVessels(n), true);
});

test('complete reference protocol success control: 23 submissions, 60 inputs each, refresh and repeated payout', async () => {
  const expected = vectors.protocol.events;
  let cursor = 0, stepIndex = 0;
  const { io, record } = makeIO((prompt, state) => {
    if (prompt === PROMPT) {
      const step = vectors.protocol.steps[stepIndex++];
      assert.ok(step);
      if ('now' in step) state.clock = step.now;
    }
    const event = expected[cursor++];
    assert.equal(event.read, prompt);
    return event.answer;
  });
  io.write = text => {
    const event = { write: String(text) };
    assert.deepEqual(event, expected[cursor++]);
    record.events.push(event);
  };
  io.win = text => {
    const event = { win: text };
    assert.deepEqual(event, expected[cursor++]);
    record.events.push(event);
    record.wins++;
  };
  await run(io);
  checkSetup(record);
  assert.equal(cursor, expected.length);
  assert.equal(stepIndex, vectors.protocol.steps.length);
  assert.deepEqual(record.events, expected);
  assert.equal(record.wins, 1);
  assert.equal(vectors.protocol.balance, '113998860');
  assert.equal(record.events.filter(event => 'read' in event).length, 1407);
  assert.equal(record.events.filter(event => event.read?.startsWith('enter hash')).length, 23 * 60);
  assert.deepEqual(record.randomBounds, vectors.protocol.draws.map(draw => BigInt(draw.bound)));
  assert.deepEqual(record.clocks, vectors.protocol.steps.filter(step => 'now' in step).map(step => step.now));
  assert.equal(writes(record).filter(line => line === 'Balance: 11999880').length, 3);
});

test('live diagnostic replay wins at the real threshold (known entropy, frozen clock and maximum-payout IO control)', async () => {
  const learned = new Map();
  let submits = 0, initialized = false, currentHashes = 0;
  const { io, record } = makeIO(prompt => {
    if (prompt === PROMPT) {
      if (!initialized) { initialized = true; return '1'; }
      if (submits === 18) return '3';
      submits++;
      currentHashes = 0;
      return '2';
    }
    const match = /^enter hash for (\d+): $/.exec(prompt);
    assert.ok(match);
    currentHashes++;
    return submits === 1 ? '0' : learned.get(match[1]).toString();
  });
  const originalWrite = io.write;
  io.write = text => {
    const match = /^expected hash ([0-9a-f]+) for (\d+) got /.exec(text);
    if (match) learned.set(match[2], BigInt('0x' + match[1]));
    originalWrite(text);
  };
  await run(io);
  checkSetup(record);
  assert.equal(learned.size, 60);
  assert.equal(currentHashes, 60);
  assert.equal(submits, 18);
  assert.equal(record.wins, 1);
  assert.ok(writes(record).includes('Balance: 101998980'));
});

test('destroy without earnings exits without a reward; unknown signed/large integer options keep looping', async () => {
  const record = await transcript(['-1', '999999999999999999999999999999999999', '0', '+0_3']);
  assert.deepEqual(writes(record), ['Attack blocked!']);
  assert.equal(record.wins, 0);
  assert.equal(record.randomBounds.length, 0);
});

for (const answer of ['', 'not-an-integer', '0x2', '2.0']) {
  test(`invalid menu input ${JSON.stringify(answer)} exits through the original exception path`, async () => {
    const record = await transcript([answer]);
    assert.deepEqual(writes(record), ['invalid literal for int() with base 10', 'Enabling self defend system in: 1...']);
    assert.equal(record.wins, 0);
  });
}

test('submitting before requesting a pool preserves the missing-blokes error', async () => {
  const record = await transcript(['2']);
  assert.deepEqual(writes(record), ["'BlokeChain' object has no attribute 'blokes'", 'Enabling self defend system in: 1...']);
  assert.equal(record.wins, 0);
  assert.equal(record.randomBounds.length, 0);
});

test('blank first hash aborts; 60 actual block/reward pairs were generated', async () => {
  const record = await transcript(['1', '2', '']);
  assert.deepEqual(writes(record), ['Retriving new blokes in the pool', 'invalid literal for int() with base 10', 'Enabling self defend system in: 1...']);
  assert.equal(record.randomBounds.length, 120);
  assert.equal(record.wins, 0);
});

test('invalid 60th hash discards the submission without diagnostic leaks or partial payout', async () => {
  const record = await transcript(['1', '2', ...correctHashes.slice(0, 59).map(String), '1e10']);
  assert.deepEqual(writes(record), ['Retriving new blokes in the pool', 'invalid literal for int() with base 10', 'Enabling self defend system in: 1...']);
  assert.equal(record.events.filter(event => event.read?.startsWith('enter hash')).length, 60);
  assert.equal(record.wins, 0);
});

test('mining clock is checked after all 60 inputs; expired blocks pay nothing and reveal no hashes', async () => {
  const record = await transcript(['1', '2', ...correctHashes.map(String), '3'], (i, prompt, state) => {
    if (prompt.startsWith('enter hash')) state.clock = i - 1;
  });
  assert.deepEqual(record.clocks, [0, 60]);
  assert.deepEqual(writes(record), ['Retriving new blokes in the pool', 'Balance: 0', 'Attack blocked!']);
  assert.equal(record.wins, 0);
});

test('IO EOF follows the original exception exit and optional status is not required', async () => {
  const { io, record } = makeIO(() => { throw Error('EOF when reading a line'); });
  delete io.status;
  io.setDeadline = seconds => record.deadlines.push(seconds);
  await run(io);
  assert.deepEqual(record.deadlines, [2000]);
  assert.deepEqual(writes(record), ['EOF when reading a line', 'Enabling self defend system in: 1...']);
  assert.equal(record.wins, 0);
});
