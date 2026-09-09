// Offline tests. Python fixtures execute inspected original AST definitions,
// not the service loop. Winning transcripts are known-answer/entropy controls.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {B00tleg, run} from '../assets/js/challenge-practice/ports/b00tleg.mjs';
import * as h from '../assets/js/challenge-practice/ports/b00tleg-helpers.mjs';
import {fromHex, hex, fromBigInt, gcd} from '../assets/js/challenge-practice/lib/bytes.mjs';
import {PythonRandom} from '../assets/js/challenge-practice/lib/python-random.mjs';

const root = new URL('../', import.meta.url);
const vectors = JSON.parse(readFileSync(new URL('agent_out/challenge-runtime/b00tleg/vectors.json', root)));
const sha256 = data => createHash('sha256').update(data).digest('hex');

class Entropy {
  constructor(seed) {
    this.seed = Buffer.from(seed, 'ascii');
    this.counter = 0n;
    this.pending = Buffer.alloc(0);
    this.calls = [];
  }
  read(n) {
    this.calls.push(n);
    while (this.pending.length < n) {
      const counter = Buffer.alloc(8);
      counter.writeBigUInt64BE(this.counter++);
      const block = createHash('sha256').update(this.seed).update(counter).digest();
      this.pending = Buffer.concat([this.pending, block]);
    }
    const out = Uint8Array.from(this.pending.subarray(0, n));
    this.pending = this.pending.subarray(n);
    return out;
  }
  evidence() {
    return {calls: this.calls.length, bytes: this.calls.reduce((a, b) => a + b, 0),
      requests_sha256: sha256(this.calls.join(','))};
  }
}

const answers = vectors.protocol_control.inputs.filter((_, i) => i % 14 === 13);
assert.equal(answers.length, 8);
const prefix = level => answers.slice(0, level).flatMap(answer => ['2', answer]);

async function session(inputs, seed = vectors.protocol_control.seed) {
  const remaining = [...inputs], transcript = [], statuses = [], wins = [];
  const entropy = new Entropy(seed);
  let exhausted = false;
  await run({
    reward: 'practice{local_dummy_reward}',
    async read(prompt = '') {
      transcript.push(['read', prompt]);
      if (!remaining.length) { exhausted = true; throw Error('test EOF'); }
      return remaining.shift();
    },
    write(text) { transcript.push(['write', String(text)]); },
    win(text = 'practice{local_dummy_reward}') {
      wins.push(text);
      transcript.push(['write', String(text)]);
    },
    randomBytes: n => entropy.read(n),
    randomBelow() { throw Error('b00tleg must not replace either RNG with randomBelow'); },
    setDeadline() { throw Error('the original b00tleg has no alarm'); },
    now() { throw Error('the original b00tleg has no clock'); },
    status(text) { statuses.push(text); },
  });
  return {remaining, transcript, statuses, wins, entropy, exhausted};
}

function noWin(result, lastLine, accepted = 0) {
  assert.deepEqual(result.remaining, []);
  assert.equal(result.exhausted, false);
  assert.deepEqual(result.wins, []);
  assert.deepEqual(result.transcript.at(-1), ['write', lastLine]);
  assert.equal(result.transcript.filter(([kind, text]) => kind === 'write' && text === 'Correct').length, accepted);
}

test('reference source hash and extraction boundary', () => {
  assert.equal(sha256(readFileSync(new URL(vectors.source.path, root))), vectors.source.sha256);
  assert.match(vectors.source.extraction, /^FunctionDef plus /);
  assert.equal(vectors.source.crypto_fastmath, false);
  assert.match(vectors.protocol_control.label, /not an independent solve/);
});

test('80 original-function vectors, cached tables, real primes and exact entropy consumption', () => {
  const ref = vectors.helpers;
  const entropy = new Entropy(ref.entropy_seed);
  const statuses = [];
  const cipher = new B00tleg(new PythonRandom(BigInt(ref.seed)), n => entropy.read(n), text => statuses.push(text));
  for (const item of ref.cases) {
    assert.equal(cipher.encrypt(item.level, fromHex(item.hex)), item.out,
      `level ${item.level + 1}, ${item.hex.length / 2} bytes`);
  }
  const normalized = Object.fromEntries(Object.entries(cipher.constants).map(([key, value]) =>
    [key, typeof value === 'bigint' ? String(value) : Array.isArray(value) ? value.map(t => [...t]) : [...value]]));
  assert.deepEqual(normalized, ref.constants);
  assert.deepEqual(entropy.evidence(), ref.entropy);
  assert.equal(statuses.length, 2);
  assert.equal(cipher.constants.pow_mod_prime_p.toString(2).length, 1024);
  assert.equal(cipher.constants.RPMP_p.toString(2).length, 1024);
  assert.equal(cipher.constants.RPMP_e.toString(2).length, 7);
  assert.equal(gcd(cipher.constants.pow_mod_prime_p - 1n, 3n), 1n);
  assert.equal(gcd(cipher.constants.RPMP_p - 1n, cipher.constants.RPMP_e), 1n);
  const before = entropy.evidence();
  for (const level of [2, 3, 6, 7]) {
    const item = ref.cases.find(c => c.level === level && c.hex === 'ff');
    assert.equal(cipher.encrypt(level, fromHex(item.hex)), item.out);
  }
  assert.deepEqual(entropy.evidence(), before);
  assert.equal(statuses.length, 2);
});

test('12 cycle/zip XOR vectors, including either or both operands empty', () => {
  for (const item of vectors.xor) assert.equal(hex(h.xor(fromHex(item.a), fromHex(item.b))), item.out);
});

test('14 Python bytes.fromhex acceptance/rejection vectors', () => {
  for (const item of vectors.fromhex) {
    if (item.out === null) assert.throws(() => fromHex(item.text));
    else assert.equal(hex(fromHex(item.text)), item.out);
  }
});

test('unchanged aligned padding consumes no MT output; empty keyed XOR returns just the key', () => {
  const rng = {randint() { throw Error('unexpected padding draw'); }};
  for (const size of [0, 5, 10, 255]) {
    const bytes = new Uint8Array(size);
    assert.equal(h.random_pad(bytes, 5, rng), bytes);
  }
  let calls = 0;
  assert.equal(h.xor_key_appended(new Uint8Array(), {randint(a, b) {
    assert.equal(a, 0); assert.equal(b, 255); return calls++;
  }}), '0001020304');
  assert.equal(calls, 5);
});

test('additive and appended-key invariants retain all byte values at production message lengths', () => {
  const rng = new PythonRandom(101n);
  for (const size of [0, 1, 4, 5, 6, 15, 16, 256, 1024]) {
    const bytes = Uint8Array.from({length: size}, (_, i) => i & 255);
    const additive = fromHex(h.rand_subt(bytes, rng));
    assert.equal(additive.length, 2 * size);
    assert.deepEqual(Uint8Array.from({length: size}, (_, i) => (additive[2 * i] + additive[2 * i + 1]) & 255), bytes);
    const keyed = fromHex(h.xor_key_appended(bytes, rng));
    assert.equal(keyed.length, Math.ceil(size / 5) * 5 + 5);
    assert.deepEqual(h.xor(keyed.subarray(0, -5), keyed.subarray(-5)).subarray(0, size), bytes);
  }
});

test('Crypto number vectors: 13 bit draws, 5 rejection ranges, 19 prime/composite tests', () => {
  const ref = vectors.number;
  const entropy = new Entropy(ref.seed), bytes = n => entropy.read(n), sieve = h.primeSieve();
  assert.equal(sieve.length, 10000);
  assert.equal(sieve.at(-1), 104729n);
  for (const item of ref.integer) assert.equal(String(h.getRandomInteger(item.bits, bytes)), item.out);
  for (const item of ref.ranges) assert.equal(String(h.getRandomRange(BigInt(item.a), BigInt(item.b), bytes)), item.out);
  for (const item of ref.prime) assert.equal(h.isPrime(BigInt(item.n), bytes, sieve), item.out, item.n);
  assert.deepEqual(entropy.evidence(), ref.entropy);
});

test('known-candidate control exercises both prime resampling loops at 1024 bits', () => {
  const ref = vectors.resampling_control;
  const candidates = ref.events.map(item => ({bits: item.bits, prime: BigInt(item.prime)}));
  const entropy = new Entropy('b00tleg-resampling-mr-v1');
  let tail = null;
  const bytes = n => {
    if (tail !== null) {
      assert.equal(n, 1);
      const out = Uint8Array.of(tail);
      tail = null;
      return out;
    }
    // Candidate draws are 127+1 bytes (1024-bit primes) or 0+1 (7-bit
    // exponents). All 1024-bit MR bases use full 128-byte rejection draws.
    if (n === 127 || n === 0) {
      const item = candidates.shift();
      assert.ok(item, 'unexpected prime resampling');
      assert.equal(n, item.bits === 1024 ? 127 : 0);
      if (item.bits === 7) {
        tail = Number((item.prime & 63n) << 2n);
        return new Uint8Array();
      }
      const whole = fromBigInt(item.prime, 128);
      tail = (whole[0] & 127) << 1;
      return whole.subarray(1);
    }
    assert.equal(n, 128);
    return entropy.read(n);
  };
  const cipher = new B00tleg(new PythonRandom(123n), bytes);
  assert.equal(cipher.encrypt(6, fromHex('010203')), ref.outputs[0]);
  assert.equal(cipher.encrypt(7, fromHex('010203')), ref.outputs[1]);
  assert.equal(candidates.length, 0);
  assert.equal(tail, null);
  assert.equal(cipher.constants.RPMP_e, 127n);
  assert.equal(cipher.constants.pow_mod_prime_p.toString(2).length, 1024);
  assert.equal(cipher.constants.RPMP_p.toString(2).length, 1024);
});

test('modular encodings keep leading-zero loss, reduction, empty input and the full-size modulus', () => {
  const p = BigInt(vectors.helpers.constants.pow_mod_prime_p);
  const p8 = BigInt(vectors.helpers.constants.RPMP_p), e = BigInt(vectors.helpers.constants.RPMP_e);
  assert.equal(h.bytes_to_int(new Uint8Array()), '0');
  assert.equal(h.bytes_to_int(fromHex('000001')), '1');
  assert.equal(h.pow_mod_prime(new Uint8Array(), p), '0');
  assert.equal(h.pow_mod_prime(fromBigInt(p, 128), p), '0');
  assert.equal(h.pow_mod_prime(fromBigInt(p + 1n, 128), p), '1');
  assert.equal(h.pow_mod_prime(fromBigInt(p - 1n, 128), p), String(p - 1n));
  assert.equal(h.rand_pow_mod_prime(fromBigInt(p8, 128), p8, e), '0');
  assert.equal(h.rand_pow_mod_prime(fromBigInt(p8 + 1n, 128), p8, e), '1');
  assert.equal(h.rand_pow_mod_prime(fromBigInt(p8 - 1n, 128), p8, e), String(p8 - 1n));
});

test('full eight-level known-answer protocol control, 48 oracle queries and exact original transcript', async () => {
  const result = await session(vectors.protocol_control.inputs);
  assert.equal(result.exhausted, false);
  assert.deepEqual(result.remaining, []);
  assert.deepEqual(result.transcript, vectors.protocol_control.transcript);
  assert.deepEqual(result.wins, ['Shh, you got the flag already']);
  assert.deepEqual(result.entropy.evidence(), vectors.protocol_control.entropy);
  assert.equal(result.statuses.length, 2);
  const levels = result.transcript.filter(([kind, text]) => kind === 'write' && text.startsWith('Level:'));
  assert.deepEqual(levels.map(([, text]) => Number(text.match(/^Level: (\d+)/)[1])), [1, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(result.transcript.filter(([, text]) => text === 'Correct').length, 8);
});

test('unlimited oracle and whitespace/uppercase flags: a second full known-answer control', async () => {
  const inputs = Array.from({length: 1025}, () => [' +0_1 ', 'ff']).flat();
  for (const answer of answers) inputs.push(' +0_2 ', ' \t' + answer.toUpperCase().match(/../g).join(' ') + ' ');
  const result = await session(inputs, 'b00tleg-protocol-v2');
  assert.equal(result.exhausted, false);
  assert.deepEqual(result.remaining, []);
  assert.deepEqual(result.wins, ['Shh, you got the flag already']);
  assert.equal(result.transcript.filter(([kind, text]) => kind === 'write' && text === '00').length, 1025);
  assert.equal(result.statuses.length, 2);
});

for (let level = 0; level < 8; level++) {
  test(`level ${level + 1} rejects a wrong flag without awarding completion`, async () => {
    const answer = answers[level];
    // Equal-length wrong content at even stages; an extra leading zero at
    // odd stages (the integer transform would otherwise hide that zero).
    const wrong = level % 2 ? '00' + answer : (answer.startsWith('ff') ? '00' : 'ff') + answer.slice(2);
    const result = await session([...prefix(level), '2', wrong]);
    noWin(result, 'Incorrect, exiting', level);
  });
}

test('invalid menu integers and well-formed but unknown options retain separate exits', async () => {
  for (const option of ['', ' ', '1__0', '1.0', '--1', '0x1', '\0']) {
    noWin(await session([option]), 'Error, Exiting');
  }
  for (const option of ['0', '-1', '3', '1_0', '-0', '9007199254740993']) {
    noWin(await session([option]), 'Unexpected option, exiting');
  }
});

test('malformed oracle/submission hex errors exit; a blank flag is a wrong answer', async () => {
  for (const option of ['1', '2']) {
    for (const message of ['0', '0 0', 'ffg0', '0x01', 'aa_bb']) {
      noWin(await session([option, message]), 'Error, Exiting');
    }
  }
  noWin(await session(['2', '']), 'Incorrect, exiting');
});

test('read failure follows the original caught EOF error path', async () => {
  for (const inputs of [[], ['1'], ['2']]) {
    const result = await session(inputs);
    assert.equal(result.exhausted, true);
    assert.deepEqual(result.wins, []);
    assert.deepEqual(result.transcript.at(-1), ['write', 'Error, Exiting']);
  }
});

test('restarts do not retain substitutions or cached prime state', () => {
  const first = new B00tleg(new PythonRandom(1n), () => { throw Error('unneeded entropy'); });
  const second = new B00tleg(new PythonRandom(2n), () => { throw Error('unneeded entropy'); });
  const message = Uint8Array.from({length: 256}, (_, i) => i);
  assert.notEqual(first.encrypt(2, message), second.encrypt(2, message));
  assert.equal(first.constants.poly_trans, undefined);
  assert.equal(second.constants.pow_mod_prime_p, undefined);
  assert.equal(second.constants.RPMP_p, undefined);
});
