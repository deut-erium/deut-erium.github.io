// RandSubWare browser-practice tests. Reference definitions are SekaiCTF 2023
// challenge code (AGPL v3.0), extracted by the local reference.py generator.
// Known keys and entropy below are TEST CONTROLS, not independent puzzle solves.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  BOX_SIZE, NUM_BOX, ROUNDS, QUOTA, PROMPT, QUOTA_ERROR,
  gen_pbox, gen_sbox, rotate_left, SPN, Challenge, pad_query, parse_integer, run,
} from '../assets/js/challenge-practice/ports/randsubware.mjs';
import { PythonRandom } from '../assets/js/challenge-practice/lib/python-random.mjs';
import { fromHex, hex } from '../assets/js/challenge-practice/lib/bytes.mjs';

const vectors = JSON.parse(readFileSync(new URL('../agent_out/challenge-runtime/randsubware/vectors.json', import.meta.url)));
const control = vectors.entropy_control;
const reward = 'practice{local_dummy_reward}';
const banner = `sbox: ${hex(Uint8Array.from(control.sbox))}`;
const sha256 = text => createHash('sha256').update(text).digest('hex');
const cleanError = text => text.replace(/ at position \d+$/, '');

function spnFrom(vector) {
  const { kind, value } = vector.key;
  const key = kind === 'int' ? BigInt(value) : kind === 'bytes' ? fromHex(value) : value;
  return new SPN(vector.sbox, vector.pbox, key, vector.rounds);
}

function freshChallenge(quota = QUOTA) {
  return new Challenge(new SPN(control.sbox, gen_pbox(6, 16), BigInt(control.key), 5), quota);
}

function capture(action) {
  const writes = [];
  try {
    return { value: action(line => writes.push(line)) ?? null, writes, error: null };
  } catch (error) {
    return { value: null, writes, error: cleanError(error.message) };
  }
}

function expected(result) {
  return { ...result, error: result.error ? cleanError(result.error.message) : null };
}

function fixture(lines, keyBytesHex = control.key_bytes_hex) {
  const state = { writes: [], prompts: [], events: [], wins: [], entropy: [], used: 0, exhausted: false };
  const io = {
    reward,
    read: async prompt => {
      state.prompts.push(prompt);
      state.events.push(['read', prompt]);
      if (state.used >= lines.length) {
        state.exhausted = true;
        throw Error('test input exhausted');
      }
      return lines[state.used++];
    },
    write: text => {
      state.writes.push(String(text));
      state.events.push(['write', String(text)]);
    },
    win: (text = reward) => {
      state.wins.push(text);
      io.write(text);
    },
    randomBytes: n => {
      state.entropy.push(n);
      if (state.entropy.length === 1 && n === 2496) return fromHex(control.seed_bytes_hex);
      if (state.entropy.length === 2 && n === 12) return fromHex(keyBytesHex);
      throw Error(`unexpected entropy request ${n}`);
    },
    randomBelow: () => { throw Error('unexpected randomBelow'); },
    now: () => { throw Error('unexpected clock request'); },
    setDeadline: seconds => state.events.push(['deadline', seconds]),
    status: text => state.events.push(['status', text]),
  };
  return { io, state };
}

async function transcript(lines, keyBytesHex) {
  const { io, state } = fixture(lines, keyBytesHex);
  await run(io);
  assert.equal(state.exhausted, false, 'protocol unexpectedly requested more input');
  assert.deepEqual(state.entropy, [2496, 12]);
  assert.deepEqual(state.events.slice(0, 3), [
    ['write', banner], ['deadline', 500], ['read', PROMPT],
  ]);
  assert.deepEqual(state.events.filter(([kind]) => kind === 'deadline'), [['deadline', 500]]);
  return state;
}

test('reference source hash matches the inspected archive', () => {
  const bytes = readFileSync(new URL(`../${vectors.source}`, import.meta.url));
  assert.equal(sha256(bytes), vectors.source_sha256);
  assert.deepEqual([BOX_SIZE, NUM_BOX, ROUNDS, QUOTA], [6, 16, 5, 50000]);
});

test('import has no entropy, DOM, or IO dependency', () => {
  const moduleURL = new URL('../assets/js/challenge-practice/ports/randsubware.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    Object.defineProperty(globalThis, 'crypto', { get() { throw Error('entropy on import'); } });
    Math.random = () => { throw Error('random on import'); };
    await import(${JSON.stringify(moduleURL)});
  `], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, '');
});

test('27 AST S-box vectors preserve Python insert(-1) and simultaneous indexing', () => {
  for (const { bits, seed, sbox } of vectors.sboxes) {
    const actual = gen_sbox(bits, new PythonRandom(BigInt(seed)));
    assert.deepEqual(actual, sbox, `bits=${bits}, seed=${seed}`);
    assert.deepEqual(actual.slice().sort((a, b) => a - b), Array.from({ length: 2 ** bits }, (_, i) => i));
  }
});

test('production P-box and four auxiliary dimension vectors', () => {
  for (const { s, n, pbox } of vectors.pboxes) assert.deepEqual(gen_pbox(s, n), pbox);
});

test('54 full-width rotate vectors include negative shifts and oversized/negative inputs', () => {
  for (const v of vectors.rotations) assert.equal(rotate_left(BigInt(v.value), v.shift, v.width), BigInt(v.result));
});

test('fresh MT OS-word seed control matches independent Python integer seeding', () => {
  const calls = [];
  const rng = PythonRandom.fresh(n => { calls.push(n); return fromHex(control.seed_bytes_hex); });
  assert.deepEqual(calls, [2496]);
  assert.deepEqual(gen_sbox(6, rng), control.sbox);
});

for (const [index, v] of vectors.spns.entries()) {
  test(`AST production SPN ${index + 1}: ${v.key.kind} key, 96 bits and 5 rounds`, () => {
    const spn = spnFrom(v);
    assert.equal(spn.BLOCK_SIZE, 96);
    assert.equal(spn.BOX_SIZE, 6);
    assert.equal(spn.NUM_SBOX, 16);
    assert.equal(spn.rounds, 5);
    assert.deepEqual(spn.round_keys.map(String), v.round_keys);
    assert.equal(spn.round_keys.length, 6);
    for (const sample of v.samples) {
      const inp = BigInt(sample.input);
      for (const method of ['perm', 'inv_perm', 'sbox', 'inv_sbox', 'encrypt', 'decrypt']) {
        assert.equal(spn[method](inp), BigInt(sample[method]), `${method}(${inp})`);
      }
      assert.deepEqual(spn.int_to_list(inp), sample.int_to_list);
      assert.equal(spn.list_to_int(sample.int_to_list), BigInt(sample.list_to_int));
      assert.equal(spn.decrypt(spn.encrypt(inp)), BigInt(sample.round_trip));
      assert.equal(spn.decrypt(spn.encrypt(inp)), inp & ((1n << 96n) - 1n));
    }
    for (const bytes of v.bytes) assert.equal(hex(spn.encrypt_bytes(fromHex(bytes.input))), bytes.cipher);
    for (const bad of v.invalid_bytes) {
      assert.deepEqual(capture(() => spn.encrypt_bytes(new Uint8Array(bad.length))), expected(bad.result));
    }
  });
}

test('20 Python integer reference spellings, including BOM rejection guard', () => {
  for (const v of vectors.integers) {
    if (v.result.error) assert.throws(() => parse_integer(v.text), /invalid literal for int\(\) with base 10/);
    else assert.equal(String(parse_integer(v.text)), v.result.value);
  }
});

test('all Python Unicode whitespace characters plus BOM at integer edges and interior', () => {
  for (const v of vectors.integer_whitespace) {
    if (v.result.error) assert.throws(() => parse_integer(v.text), /invalid literal for int\(\) with base 10/);
    else assert.equal(String(parse_integer(v.text)), v.result.value);
  }
});

test('explicit nibble-right and byte-zero padding, including empty input', () => {
  assert.equal(hex(pad_query('', 12)), '');
  assert.equal(hex(pad_query('a', 12)), 'a0' + '00'.repeat(11));
  assert.equal(hex(pad_query('abc', 12)), 'abc0' + '00'.repeat(10));
  assert.equal(hex(pad_query('aa bb ', 12)), 'aabb' + '00'.repeat(10));
  assert.equal(pad_query('0'.repeat(23), 12).length, 12);
  assert.equal(pad_query('0'.repeat(24), 12).length, 12);
  assert.equal(pad_query('0'.repeat(25), 12).length, 24);
  assert.throws(() => pad_query('aa bb', 12));
  assert.throws(() => pad_query(' ', 12));
  assert.equal(pad_query('  ', 12).length, 0);
});

test('25 AST query vectors: ASCII whitespace, odd length, invalid and boundary hex', () => {
  for (const v of vectors.queries) {
    const challenge = freshChallenge();
    assert.equal(challenge.quota, v.before);
    assert.deepEqual(capture(write => challenge.query(v.text, write)), expected(v.result), JSON.stringify(v.text));
    assert.equal(challenge.quota, v.after);
  }
});

test('injected quota boundary controls: overdraft, empty calls, and parse-before-quota ordering', () => {
  for (const v of vectors.quota_controls) {
    const challenge = freshChallenge(v.quota);
    for (const step of v.steps) {
      assert.equal(challenge.quota, step.before);
      assert.deepEqual(capture(write => challenge.query(step.text, write)), expected(step.result));
      assert.equal(challenge.quota, step.after);
    }
  }
});

test('AST key equality controls: exact key only, without masking oversized guesses', () => {
  for (const v of vectors.success_controls) {
    const challenge = freshChallenge();
    assert.deepEqual(capture(write => challenge.get_flag(BigInt(v.guess), () => write(reward))), expected(v.result));
  }
});

test('correct key still succeeds at negative quota (injected quota control)', () => {
  const challenge = freshChallenge(-1);
  assert.deepEqual(capture(write => challenge.get_flag(BigInt(control.key), () => write(reward))),
    expected(vectors.full_quota_control.key_after_overdraft));
});

test('full successful protocol control: real encryption, quota updates, and dummy reward', async () => {
  const texts = ['', 'abc', '0'.repeat(24)];
  const lines = texts.flatMap(text => ['1', text]).concat(['2', control.key]);
  const state = await transcript(lines);
  const outputs = [banner];
  let used = 0;
  for (const text of texts) {
    const v = vectors.queries.find(v => v.text === text);
    used += 50000 - v.after;
    outputs.push(`Quota remaining: ${50000 - used}`, v.result.value);
  }
  outputs.push(reward);
  assert.deepEqual(state.writes, outputs);
  assert.deepEqual(state.prompts, [PROMPT, '(hex) text: ', PROMPT, '(hex) text: ',
    PROMPT, '(hex) text: ', PROMPT, '(int) key: ']);
  assert.equal(state.used, lines.length);
  assert.deepEqual(state.wins, [reward]);
});

test('unknown integer menu choices repeat the original menu', async () => {
  const state = await transcript(['0', '-3', '3', '99999999999999999999999999999', '2', control.key]);
  assert.deepEqual(state.writes, [banner, reward]);
  assert.equal(state.used, 6);
  assert.equal(state.prompts.filter(p => p === PROMPT).length, 5);
  assert.deepEqual(state.wins, [reward]);
});

test('Python ASCII integer signs, whitespace, leading zeros and underscores', async () => {
  const spacedKey = `\t+00${control.key.split('').join('_')} `;
  const state = await transcript([' +0_1 ', '', ' +00_2 ', spacedKey]);
  assert.deepEqual(state.writes, [banner, 'Quota remaining: 50000', '', reward]);
  assert.deepEqual(state.wins, [reward]);
});

test('NEXT LINE whitespace preserves Python menu/key acceptance through IO', async () => {
  const state = await transcript(['\u00852\u0085', `\u0085${control.key}\u0085`]);
  assert.deepEqual(state.writes, [banner, reward]);
  assert.deepEqual(state.wins, [reward]);
});

test('wrong or oversized key terminates without completion', async () => {
  for (const guess of [BigInt(control.key) + 1n, BigInt(control.key) + (1n << 96n), -1n]) {
    const state = await transcript(['2', String(guess), '2', control.key]);
    assert.deepEqual(state.writes, [banner, 'There is no free lunch']);
    assert.equal(state.used, 2);
    assert.deepEqual(state.wins, []);
  }
});

test('zero and maximum 96-bit secret keys work through IO entropy controls', async () => {
  for (const [keyHex, key] of [['00'.repeat(12), 0n], ['ff'.repeat(12), (1n << 96n) - 1n]]) {
    const state = await transcript(['2', String(key)], keyHex);
    assert.deepEqual(state.writes, [banner, reward]);
    assert.deepEqual(state.wins, [reward]);
  }
});

test('invalid decimal menu input exits rather than silently selecting an option', async () => {
  for (const invalid of ['', '1.0', '0x1', '1__0', '1e0', '+', '1 0', '\ufeff2']) {
    const state = await transcript([invalid, '2', control.key]);
    assert.deepEqual(state.writes, [banner, 'invalid literal for int() with base 10']);
    assert.equal(state.used, 1);
    assert.deepEqual(state.wins, []);
  }
});

test('invalid decimal key input exits without completion', async () => {
  for (const invalid of ['', '1.0', '0x1', '1__0', '1e0', '-', '1 0', `\ufeff${control.key}`]) {
    const state = await transcript(['2', invalid, '2', control.key]);
    assert.deepEqual(state.writes, [banner, 'invalid literal for int() with base 10']);
    assert.equal(state.used, 2);
    assert.deepEqual(state.wins, []);
  }
});

test('all malformed reference hex cases terminate the protocol without quota output', async () => {
  for (const v of vectors.queries.filter(v => v.result.error)) {
    const state = await transcript(['1', v.text, '2', control.key]);
    assert.deepEqual(state.writes, [banner, cleanError(v.result.error.message)], JSON.stringify(v.text));
    assert.equal(state.used, 2);
    assert.deepEqual(state.wins, []);
  }
});

test('multiple empty encryptions consume no quota and still perform the API operation', async () => {
  const state = await transcript(['1', '', '1', '', '1', '', '2', control.key]);
  assert.deepEqual(state.writes, [banner, 'Quota remaining: 50000', '',
    'Quota remaining: 50000', '', 'Quota remaining: 50000', '', reward]);
  assert.deepEqual(state.wins, [reward]);
});

test('full production protocol overdraft: 50001 blocks, negative quota, then exact-key success control', async () => {
  const v = vectors.full_quota_control;
  const state = await transcript(['1', '00'.repeat(12 * v.blocks), '2', control.key]);
  assert.equal(v.blocks, 50001);
  assert.equal(state.writes.length, 4);
  assert.equal(state.writes[0], banner);
  assert.equal(state.writes[1], 'Quota remaining: -1');
  assert.equal(state.writes[2].length, v.ciphertext_hex_length);
  assert.equal(sha256(state.writes[2]), v.ciphertext_hex_sha256);
  assert.equal(state.writes[3], reward);
  assert.deepEqual(state.wins, [reward]);
  const challenge = freshChallenge(-1);
  assert.deepEqual(capture(write => challenge.query('', write)), expected(v.next_empty));
  assert.equal(challenge.quota, -1);
  assert.equal(v.next_empty.error.message, QUOTA_ERROR);
});

test('full production exact exhaustion: 50000 blocks followed by an empty query exits', async () => {
  const v = vectors.full_exact_quota_control;
  const state = await transcript(['1', '00'.repeat(12 * v.blocks), '1', '', '2', control.key]);
  assert.equal(v.blocks, 50000);
  assert.equal(state.writes.length, 4);
  assert.equal(state.writes[0], banner);
  assert.equal(state.writes[1], 'Quota remaining: 0');
  assert.equal(state.writes[2].length, v.ciphertext_hex_length);
  assert.equal(sha256(state.writes[2]), v.ciphertext_hex_sha256);
  assert.equal(state.writes[3], v.next_empty.error.message);
  assert.equal(state.used, 4);
  assert.deepEqual(state.wins, []);
});

test('full production overdraft then invalid hex reports parsing failure before quota', async () => {
  const v = vectors.full_quota_control;
  const state = await transcript(['1', '00'.repeat(12 * v.blocks), '1', 'zz', '2', control.key]);
  assert.equal(state.writes.length, 4);
  assert.equal(state.writes[1], 'Quota remaining: -1');
  assert.equal(sha256(state.writes[2]), v.ciphertext_hex_sha256);
  assert.equal(state.writes[3], cleanError(vectors.full_exact_quota_control.next_invalid.error.message));
  assert.equal(state.used, 4);
  assert.deepEqual(state.wins, []);
});
