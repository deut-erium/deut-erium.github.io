// Offline tests for the three-round Google CTF 2024 IDEA browser port.
// Protocol wins below inject known entropy through IO. They are controls, not
// independent puzzle solves. Regenerate reference data with:
//   python3 agent_out/challenge-runtime/idea/reference.py
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { IDEA, add16, bitCount, expandKey, mul16, run } from '../assets/js/challenge-practice/ports/idea.mjs';

const root = new URL('../', import.meta.url);
const vectorURL = new URL('agent_out/challenge-runtime/idea/vectors.json', root);
const vectorBytes = readFileSync(vectorURL);
const vectors = JSON.parse(vectorBytes);
const manifest = JSON.parse(readFileSync(new URL('agent_out/challenge-runtime/idea/manifest.json', root)));
const reward = 'practice{local_dummy_reward}';
const sha256 = value => createHash('sha256').update(value).digest('hex');

function makeIO(vector) {
  const inputs = vector.steps.flatMap(step => Array.from({ length: step.repeat }, () => step.lines).flat());
  const events = [];
  const writes = [];
  let consumed = 0;
  let wins = 0;
  return {
    io: {
      reward,
      randomBytes(n) {
        assert.equal(n, 16, 'one original 128-bit key draw');
        events.push(['randomBytes', n]);
        return Uint8Array.from(Buffer.from(vector.key, 'hex'));
      },
      randomBelow() { assert.fail('IDEA does not use randomBelow'); },
      now() { assert.fail('the worker enforces the alarm, not a port clock'); },
      setDeadline(seconds) { events.push(['deadline', seconds]); },
      async read(prompt = '') {
        assert.ok(consumed < inputs.length, 'port read past the provided transcript');
        events.push(['read', prompt]);
        return inputs[consumed++];
      },
      write(text) {
        assert.equal(typeof text, 'string', 'format Python output explicitly');
        events.push(['write', text]);
        writes.push(text);
      },
      win(text = reward) {
        assert.equal(text, reward);
        wins++;
        events.push(['win', text]);
        this.write(text);
      },
      status(text) { events.push(['status', text]); },
    },
    events,
    writes,
    get consumed() { return consumed; },
    get wins() { return wins; },
  };
}

async function exercise(vector) {
  const result = makeIO(vector);
  await run(result.io);
  assert.equal(result.consumed, vector.consumed, 'exit/read count');
  assert.equal(result.wins, vector.winCount, 'original-key success predicate');
  assert.deepEqual(result.writes, vector.writes, 'Python transcript output');
  assert.equal(result.events.length, vector.eventCount, 'IO event count');
  assert.equal(sha256(JSON.stringify(result.events)), vector.eventSha256, 'ordered IO including prompts/deadline');
  if (vector.events) assert.deepEqual(result.events, vector.events);
  return result;
}

function protocol(name) {
  const result = vectors.protocols.find(vector => vector.name === name);
  assert.ok(result, `missing reference protocol ${name}`);
  return result;
}

test('original source and generated vector hashes', () => {
  assert.equal(sha256(readFileSync(new URL(vectors.source, root))), vectors.sourceSha256);
  assert.equal(vectors.sourceSha256, '5fb44f432cffbf19fec715a617be1c373f99d2f3e4a602ebab7c3668b7e040c0');
  assert.equal(sha256(vectorBytes), manifest.vectorsSha256);
  assert.equal(vectors.cipherVectors.length, manifest.counts.keySchedules);
  assert.equal(vectors.protocols.length, manifest.counts.protocols);
});

test('305 arithmetic edge/random pairs match AST-extracted Python functions', () => {
  for (const { x, y, mul, add } of vectors.wordVectors) {
    assert.equal(mul16(x, y), mul, `mul(${x}, ${y})`);
    assert.equal(add16(x, y), add, `add(${x}, ${y})`);
  }
  assert.equal(mul16(0, 0), 1);
  assert.equal(mul16(0, 1), 0);
  assert.equal(mul16(0, 2), 65535);
  assert.equal(add16(65535, 1), 0);
});

for (const sweep of vectors.arithmeticSweeps) {
  test(`all 65536 words with y=${sweep.y}: multiplication/addition reference digest`, () => {
    const buffer = Buffer.alloc(sweep.pairs * 4);
    for (let x = 0; x < sweep.pairs; x++) {
      buffer.writeUInt16BE(mul16(x, sweep.y), 4 * x);
      buffer.writeUInt16BE(add16(x, sweep.y), 4 * x + 2);
    }
    assert.equal(sha256(buffer), sweep.sha256);
  });
}

test('128-bit mask popcount, including zero and maximum charge', () => {
  assert.equal(bitCount(0n), 0);
  assert.equal(bitCount((1n << 128n) - 1n), 128);
  for (let i = 0; i < 128; i++) assert.equal(bitCount(1n << BigInt(i)), 1);
  for (const { key } of vectors.cipherVectors) {
    const mask = BigInt(`0x${key}`);
    assert.equal(bitCount(mask), [...mask.toString(2)].filter(c => c === '1').length);
  }
});

test('164 complete key schedules match the original rotations and unused final words', () => {
  for (const vector of vectors.cipherVectors) {
    const key = BigInt(`0x${vector.key}`);
    assert.deepEqual(expandKey(key, vector.rounds), vector.keys);
    assert.deepEqual(new IDEA(key, vector.rounds).keys, vector.keys);
  }
});

for (const rounds of [3, 8]) {
  const cases = vectors.cipherVectors.filter(vector => vector.rounds === rounds);
  const count = cases.reduce((n, vector) => n + vector.blocks.length, 0);
  test(`${count} ${rounds}-round blocks match AST-extracted IDEA.encrypt`, () => {
    for (const vector of cases) {
      const cipher = new IDEA(BigInt(`0x${vector.key}`), rounds);
      for (const block of vector.blocks) {
        assert.equal(cipher.encrypt(BigInt(`0x${block.pt}`)), BigInt(`0x${block.ct}`),
          `rounds=${rounds} key=${vector.key} pt=${block.pt}`);
      }
      assert.deepEqual(cipher.keys, vector.keys, 'encryption does not mutate the key schedule');
    }
  });
}

test('default eight-round IDEA known-answer control (service uses three rounds)', () => {
  const key = 0x00010002000300040005000600070008n;
  const pt = 0x0000000100020003n;
  assert.equal(new IDEA(key).encrypt(pt), 0x11fbed2b01986de5n);
  assert.notEqual(new IDEA(key, 3).encrypt(pt), new IDEA(key).encrypt(pt));
});

for (const vector of vectors.protocols) {
  test(`protocol control: ${vector.name}`, async () => { await exercise(vector); });
}

test('quota controls retain exact zero, negative exhaustion, and no-op depleted flips', async () => {
  const exact = await exercise(protocol('2024-encryption-exact-exhaustion'));
  assert.deepEqual(exact.writes.slice(-5), ['Credits Remaining: 0', '-1', 'Credits Remaining: 0', '-1', reward]);
  const negative = await exercise(protocol('21-bit-flip-negative-balance'));
  assert.deepEqual(negative.writes, ['Credits Remaining: -76', '-1', 'Credits Remaining: -76', reward]);
  const maximal = await exercise(protocol('maximal-overdraft-from-one-credit'));
  assert.deepEqual(maximal.writes.slice(-5), [
    'Credits Remaining: 1', 'Credits Remaining: -12799', '-1', 'Credits Remaining: -12799', reward,
  ]);
});

test('success uses the original key even after flips; wrong guesses exit immediately', async () => {
  const wrong = await exercise(protocol('guess-current-flipped-key-is-rejected'));
  assert.deepEqual(wrong.writes, ['you have no idea']);
  assert.equal(wrong.wins, 0);
  const right = await exercise(protocol('guess-original-key-after-flip'));
  assert.deepEqual(right.writes, [reward]);
  assert.equal(right.wins, 1);
});

test('each run obtains a fresh key and starts with a 512-second deadline', async () => {
  for (const name of ['normal-related-key-and-flip-back', 'zero-original-key-success', 'maximum-original-key-success']) {
    const result = await exercise(protocol(name));
    assert.deepEqual(result.events.slice(0, 2), [['randomBytes', 16], ['deadline', 512]]);
    assert.equal(result.events.filter(event => event[0] === 'randomBytes').length, 1);
    assert.equal(result.events.filter(event => event[0] === 'deadline').length, 1);
  }
});

test('EOF from read exits through the original error path without a win', async () => {
  const result = makeIO(protocol('zero-original-key-success'));
  result.io.read = async () => { throw Error('EOF when reading a line'); };
  await run(result.io, {});
  assert.deepEqual(result.writes, ['EOF when reading a line']);
  assert.equal(result.wins, 0);
});
