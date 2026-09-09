// Offline tests. reference-vectors.json comes from AST-extracted originals;
// reference.py documents the deterministic controls and excluded entrypoints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as chaos from '../assets/js/challenge-practice/ports/chaos.mjs';
import * as mersenne from '../assets/js/challenge-practice/ports/real-mersenne.mjs';
import { Agent, LEVELS, feedback, run as runCheater } from '../assets/js/challenge-practice/ports/cheater-mind.mjs';
import { fraction, fractionFloat, fractionString, parseFloatGuess, parseGuess, pythonFixed } from '../assets/js/challenge-practice/ports/simple-helpers.mjs';
import { PythonRandom } from '../assets/js/challenge-practice/lib/python-random.mjs';
import { fromHex, hex } from '../assets/js/challenge-practice/lib/bytes.mjs';

const root = new URL('../', import.meta.url);
const refs = JSON.parse(readFileSync(new URL('agent_out/challenge-runtime/simple/reference-vectors.json', root), 'utf8'));
const reward = 'practice{local_dummy_reward}';
const entropy = fromHex(refs.control_entropy_hex);
const fromBits = s => Buffer.from(s, 'hex').readDoubleBE();
const toBits = n => { const b = Buffer.alloc(8); b.writeDoubleBE(n); return b.toString('hex'); };
const bigs = values => values.map(BigInt);

function protocolIO(guesses) {
  const output = [], prompts = [], wins = [];
  let readCount = 0, exhausted = 0, entropyCalls = 0;
  const io = {
    reward, output, prompts, wins,
    get readCount() { return readCount; },
    get exhausted() { return exhausted; },
    get entropyCalls() { return entropyCalls; },
    async read(prompt = '') {
      prompts.push(prompt);
      if (readCount >= guesses.length) { exhausted++; throw Error('test input exhausted'); }
      return guesses[readCount++];
    },
    write(text) { output.push(String(text)); },
    win(text = reward) { wins.push(text); io.write(text); },
    randomBytes(n) { assert.equal(n, 2496); entropyCalls++; return entropy.slice(); },
    randomBelow() { throw Error('unexpected randomBelow'); },
    now() { throw Error('unexpected clock'); },
    setDeadline() { throw Error('none of these original sources has an alarm'); },
    status() { throw Error('unexpected setup status'); },
  };
  return io;
}

function assertConsumed(io, guesses, entropyCalls) {
  assert.equal(io.readCount, guesses.length);
  assert.equal(io.exhausted, 0, 'port requested input beyond its quota/exit');
  assert.equal(io.entropyCalls, entropyCalls);
}

test('reference source hashes match all three inspected sources', () => {
  for (const meta of Object.values(refs.metadata)) {
    const actual = createHash('sha256').update(readFileSync(new URL(meta.path, root))).digest('hex');
    assert.equal(actual, meta.sha256, meta.path);
  }
  assert.deepEqual(LEVELS, refs.levels);
});

test(`chaos: ${refs.rotations.length} original rotation vectors, including 0/32 bits`, () => {
  for (const v of refs.rotations) {
    assert.equal(chaos.rotateLeft(v.word, v.count), v.left);
    assert.equal(chaos.rotateRight(v.word, v.count), v.right);
  }
});

test(`chaos: ${refs.chaos.length} original padding and hash vectors`, () => {
  for (const v of refs.chaos) {
    const input = fromHex(v.input), before = input.slice();
    assert.equal(hex(chaos.pad(input)), v.pad, `pad length ${input.length}`);
    assert.equal(hex(chaos.hash(input)), v.hash, `hash length ${input.length}`);
    assert.deepEqual(input, before, 'hash/pad changed input bytes');
    // Exercise nonzero byteOffset; callers need not pass an entire buffer.
    const container = new Uint8Array(input.length + 4);
    container.set(input, 2);
    assert.equal(hex(chaos.hash(container.subarray(2, -2))), v.hash);
  }
});

test('chaos: independently constructed equal-length collision matches the original hash', async () => {
  const initial = [0x0124fdce, 0x89ab57ea, 0xba89370a, 0xfedc45ef];
  const A = [0, 0, 0, 0], B = [1, 2, 3, 4], C = [0xffffffff, 0x87654321, 0xabcd1234, 0xf00d9876];
  function message(targets) {
    let state = initial;
    const out = new Uint8Array(64), view = new DataView(out.buffer);
    targets.forEach((q, i) => {
      q.forEach((v, j) => view.setUint32(i * 16 + j * 4, (v ^ state[j]) >>> 0, false));
      state = chaos.mix(...q);
    });
    return out;
  }
  const first = message([A, B, C, A]), second = message([B, A, C, A]);
  assert.equal(hex(first), refs.collision.first);
  assert.equal(hex(second), refs.collision.second);
  assert.equal(hex(chaos.hash(first)), refs.collision.hash);
  assert.equal(hex(chaos.hash(second)), refs.collision.hash);
  assert.equal(chaos.isCollision(first, second), true);
  assert.equal(chaos.isCollision(first, first), false);
  const guesses = [hex(first), hex(second)], io = protocolIO(guesses);
  await chaos.run(io);
  assert.deepEqual(io.output, [reward]);
  assert.deepEqual(io.wins, [reward]);
  assert.deepEqual(io.prompts, ['input first string to hash : ', 'input second string to hash : ']);
  assertConsumed(io, guesses, 0);
});

test('chaos: non-collisions, equal bytes, empty input and valid hex whitespace', async () => {
  for (const guesses of [['', ''], ['', '00'], ['\t00', '00'], ['ff 00\tAa\r', 'ff00aa']]) {
    const io = protocolIO(guesses);
    await chaos.run(io);
    assert.deepEqual(io.output, ['Never gonna give you up']);
    assert.deepEqual(io.wins, []);
    assertConsumed(io, guesses, 0);
  }
});

test('chaos: invalid/odd hex exits at the original input point', async () => {
  for (const text of ['0', 'a b', 'gg', '0x00', '00\u00a0ff', '00_00']) {
    for (const guesses of [[text], ['00', text]]) {
      const io = protocolIO(guesses);
      await chaos.run(io);
      assert.deepEqual(io.output, ['Never gonna let you down']);
      assert.deepEqual(io.wins, []);
      assertConsumed(io, guesses, 0);
    }
  }
});

test(`real_mersenne: ${refs.scores.length} exact original Fraction scores and binary64 conversions`, () => {
  for (const v of refs.scores) {
    if (v.error) assert.throws(() => mersenne.score(fromBits(v.a), fromBits(v.b)));
    else {
      const value = mersenne.score(fromBits(v.a), fromBits(v.b));
      assert.deepEqual(value, { numerator: BigInt(v.n), denominator: BigInt(v.d) });
      assert.equal(fractionString(value), v.string);
      assert.equal(toBits(fractionFloat(value)), v.float, `${v.n}/${v.d}`);
    }
  }
});

test(`numeric helpers: ${refs.fractions.length} Fraction ties, signs, subnormals and overflow`, () => {
  for (const v of refs.fractions) {
    const f = fraction(BigInt(v.n), BigInt(v.d));
    assert.equal(fractionString(f), v.string);
    if (v.error) assert.throws(() => fractionFloat(f));
    else assert.equal(toBits(fractionFloat(f)), v.float, v.string);
  }
  assert.deepEqual(fraction(10n, -20n), { numerator: -1n, denominator: 2n });
  assert.throws(() => fraction(1n, 0n));
});

test(`numeric helpers: ${refs.fixed.length} Python fixed-point strings`, () => {
  for (const v of refs.fixed) assert.equal(pythonFixed(fromBits(v.bits)), v.string, v.bits);
});

test(`numeric helpers: ${refs.float_inputs.length} Python float input spellings/rejections`, () => {
  for (const v of refs.float_inputs) {
    if (v.error) assert.throws(() => parseFloatGuess(v.input), v.input);
    else if (v.nan) assert.equal(Number.isNaN(parseFloatGuess(v.input)), true);
    else assert.equal(toBits(parseFloatGuess(v.input)), v.bits, v.input);
  }
});

test(`cheater-mind: ${refs.guess_inputs.length} integer-list parsing vectors`, () => {
  for (const v of refs.guess_inputs) {
    if (v.error) assert.throws(() => parseGuess(v.input), v.input);
    else assert.deepEqual(parseGuess(v.input), bigs(v.guess), v.input);
  }
});

test('shared MT integration: 2000 Python doubles and 2000 randint values from fresh entropy', () => {
  const doubles = PythonRandom.fresh(() => entropy.slice());
  for (const value of refs.mt_doubles) assert.equal(toBits(doubles.random()), value);
  const ints = PythonRandom.fresh(() => entropy.slice());
  refs.mt_ints.forEach((value, i) => assert.equal(ints.randint(1, i % 2 ? 6 : 8), value));
});

for (const protocol of refs.mersenne_protocols) {
  test(`real_mersenne full protocol: ${protocol.mode}, ${protocol.guesses.length} rounds (controlled entropy)`, async () => {
    const io = protocolIO(protocol.guesses);
    await mersenne.run(io);
    assert.deepEqual(io.output, protocol.output);
    assertConsumed(io, protocol.guesses, 1);
    assert.ok(io.prompts.every(p => p === 'enter your guess:\n'));
    assert.deepEqual(io.wins, protocol.mode === 'loss' ? [] : [reward]);
  });
}

test('real_mersenne: invalid guesses, non-finite guesses and scaling overflow terminate', async () => {
  for (const text of ['', '  ', '0x10', '1__0', 'inf', '-Infinity', 'NaN', '1e400', '1e308', '\ufeff1', '\x1c1']) {
    const io = protocolIO([text]);
    await mersenne.run(io);
    assert.deepEqual(io.output, ['Error, exiting'], text);
    assert.deepEqual(io.wins, []);
    assertConsumed(io, [text], 1);
  }
});

test('real_mersenne: strict cap boundary preserves negative and positive scores', () => {
  assert.equal(fractionString(mersenne.score(0, 1 / 1024)), '-1024');
  assert.equal(fractionString(mersenne.score(0, -1 / 1024)), '1024');
  assert.equal(fractionString(mersenne.score(0, (1 / 1024) - 2 ** -63)), '1024');
});

for (const [index, v] of refs.agents.entries()) {
  test(`cheater-mind original Agent: level ${index + 1}, ${v.plays.length} mixed-length/mutation plays`, () => {
    const rng = new PythonRandom(BigInt(v.seed)), agent = new Agent(...v.level, rng);
    assert.deepEqual(agent.secret, bigs(v.secret));
    for (const play of v.plays) assert.deepEqual(agent.play(bigs(play.guess)), play.result);
    assert.equal(toBits(rng.random()), v.next_random, 'random consumption differs');
    assert.deepEqual(agent.secret, bigs(v.secret), 'mutations must not change the stored secret');
  });
}

test(`cheater-mind: ${refs.scripted_agents.length} scripted mutation-boundary controls`, () => {
  for (const v of refs.scripted_agents) {
    let r = 0, i = 0;
    const calls = [], rng = {
      random() { const value = v.floats[r++]; assert.notEqual(value, undefined); calls.push(['random', value]); return value; },
      randint(a, b) { const value = v.ints[i++]; assert.notEqual(value, undefined); calls.push(['randint', a, b, value]); return value; },
    };
    const agent = new Agent(6, 6, v.mutation, 7, rng);
    assert.deepEqual(agent.play(bigs(v.guess)), v.result, `${v.mutation}/${v.kind}`);
    assert.deepEqual(calls, v.calls, 'threshold or fast-path random consumption differs');
  }
});

test('cheater-mind: Counter intersection includes the tail, zip does not', () => {
  const secret = bigs([1, 1, 2, 2, 3, 3]);
  assert.deepEqual(feedback(secret, []), [0, 0]);
  assert.deepEqual(feedback(secret, bigs([1])), [1, 0]);
  assert.deepEqual(feedback(secret, bigs([1, 1, 1, 1, 1, 1, 2, 2, 3, 3])), [2, 4]);
  assert.deepEqual(feedback(secret, bigs([1, 1, 2, 2, 3, 3, 1, 2, 3])), [6, 0]);
  assert.deepEqual(feedback([9007199254740993n], [9007199254740992n]), [0, 0]);
});

for (const protocol of refs.cheater_protocols) {
  test(`cheater-mind full protocol: ${protocol.mode} (controlled entropy, original dimensions)`, async () => {
    const io = protocolIO(protocol.guesses);
    await runCheater(io);
    assert.deepEqual(io.output, protocol.output);
    assertConsumed(io, protocol.guesses, 1);
    assert.ok(io.prompts.every(p => p === 'enter your guess as space separated integers:\n'));
    assert.deepEqual(io.wins, protocol.mode.includes('win') ? [`you earned it : ${reward}`] : []);
  });
}

test('cheater-mind: malformed inputs abort without the quota-failure message', async () => {
  for (const text of ['a', '1.0', '0x10', '1__0', '\ufeff1']) {
    const io = protocolIO([text]);
    await runCheater(io);
    assert.equal(io.output.at(-1), 'Error, exiting');
    assert.equal(io.output.length, 3);
    assert.deepEqual(io.wins, []);
    assertConsumed(io, [text], 1);
  }
});

test('all ports: input rejection follows the original exception exit', async () => {
  for (const [run, last] of [[chaos.run, 'Never gonna let you down'], [mersenne.run, 'Error, exiting'], [runCheater, 'Error, exiting']]) {
    const io = protocolIO([]);
    await run(io);
    assert.equal(io.exhausted, 1);
    assert.equal(io.output.at(-1), last);
    assert.deepEqual(io.wins, []);
  }
});
