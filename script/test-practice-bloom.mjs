// SekaiCTF diffecient/diffecientwo browser-port regression and native references.
// Run: node script/test-practice-bloom.mjs (requires local Python 3 and a C compiler).
// All generated files stay in agent_out/challenge-runtime/bloom/run-*.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fromHex, hex } from '../assets/js/challenge-practice/lib/bytes.mjs';
import { PythonRandom } from '../assets/js/challenge-practice/lib/python-random.mjs';
import { BloomFilter, adminKeyError, bloomPosition, bloomSecurity, murmur3 } from '../assets/js/challenge-practice/ports/bloom-helpers.mjs';
import { BANNER as passwordBanner, PasswordDB, randbytes, run as runPassword } from '../assets/js/challenge-practice/ports/diffecient.mjs';
import { BANNER as socialBanner, SocialCache, promotionPost, run as runSocial } from '../assets/js/challenge-practice/ports/diffecientwo.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidence = join(root, 'agent_out/challenge-runtime/bloom');
mkdirSync(evidence, { recursive: true });
const runDir = mkdtempSync(join(evidence, 'run-'));
const nativeLibrary = join(runDir, 'libmurmur3-reference.so');
const compile = spawnSync('cc', ['-std=c99', '-O2', '-Wall', '-Wextra', '-Werror', '-shared', '-fPIC',
  join(evidence, 'murmur3-reference.c'), '-o', nativeLibrary], { cwd: root, encoding: 'utf8' });
writeFileSync(join(runDir, 'native-build.log'), (compile.stdout || '') + (compile.stderr || '') + String(compile.error || ''));
assert.equal(compile.status, 0, `native reference compile failed; see ${runDir}`);
const generated = spawnSync('python3', [join(evidence, 'reference.py'), nativeLibrary], {
  cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
});
writeFileSync(join(runDir, 'reference-stderr.log'), (generated.stderr || '') + String(generated.error || ''));
assert.equal(generated.status, 0, `AST reference generation failed; see ${runDir}`);
writeFileSync(join(runDir, 'reference.json'), generated.stdout);
const reference = JSON.parse(generated.stdout);
const modulus = 2 ** 32 - 5;
const reward = 'practice{local_dummy_reward}';
const entropy = fromHex(reference.password.entropy_hex);
const sha256 = data => createHash('sha256').update(data).digest('hex');
const finite = n => Number.isFinite(n) ? n : 'Infinity';
const state = obj => ({ count: obj.num_passwords(), memory: obj.memory_consumption(), security: finite(obj.security()) });
let groups = 0;
async function check(name, fn) { await test(name, fn); groups++; }

function testIO(lines) {
  let cursor = 0;
  const io = {
    reward, output: [], prompts: [], statuses: [], events: [], wins: 0, entropyCalls: 0, eof: false,
    async read(prompt = '') {
      this.prompts.push(prompt);
      this.events.push(['read', prompt]);
      if (cursor === lines.length) { this.eof = true; throw Error('test EOF'); }
      return lines[cursor++];
    },
    write(text) { this.output.push(String(text)); this.events.push(['write', String(text)]); },
    win(text = this.reward) { this.wins++; this.write(text); },
    randomBytes(n) { assert.equal(n, 2496); this.entropyCalls++; return entropy.slice(); },
    randomBelow() { assert.fail('unexpected randomBelow'); },
    now() { assert.fail('no original clock'); },
    setDeadline() { assert.fail('no original alarm'); },
    status(text) { this.statuses.push(text); },
    consumed() { return cursor; },
  };
  return io;
}

await check('reference extraction hashes only the assigned original sources; exact banners', () => {
  assert.equal(reference.sources.length, 2);
  for (const source of reference.sources) assert.equal(sha256(readFileSync(join(root, source.path))), source.sha256);
  assert.equal(passwordBanner, reference.banners.diffecient);
  assert.equal(socialBanner, reference.banners.diffecientwo);
  assert.equal(promotionPost().length, 42);
});

await check(`MurmurHash3: ${reference.hash_vectors.length} native signed-hash and modulo vectors`, () => {
  let negative = 0;
  for (const vector of reference.hash_vectors) {
    const data = fromHex(vector.hex);
    const hash = murmur3(data, vector.seed);
    assert.equal(hash, vector.signed, `seed=${vector.seed}, length=${data.length}`);
    assert.equal(bloomPosition(hash, modulus), vector.position);
    // Nonzero byteOffset must not change hashing or accidentally read the whole buffer.
    const padded = new Uint8Array(data.length + 9);
    padded.fill(0xa7); padded.set(data, 3);
    assert.equal(murmur3(padded.subarray(3, data.length + 3), vector.seed), hash);
    if (hash < 0) negative++;
  }
  assert(negative > 500);
});

await check('MurmurHash3: independent SMHasher Murmur3A verification fingerprint', () => {
  const key = Uint8Array.from({ length: 256 }, (_, i) => i);
  const hashes = new Uint8Array(1024);
  const view = new DataView(hashes.buffer);
  for (let i = 0; i < 256; i++) view.setUint32(i * 4, murmur3(key.subarray(0, i), 256 - i) >>> 0, true);
  assert.equal(murmur3(hashes) >>> 0, 0xb0f57ee3);
  assert.equal(reference.native_verification, '0xb0f57ee3');
});

await check('signed modulo preserves the five-position unsigned-conversion difference', () => {
  for (const value of [-2147483648, -156908512, -5, -1]) {
    assert.equal(bloomPosition(value, modulus), Number((BigInt(value) + BigInt(modulus)) % BigInt(modulus)));
    assert.notEqual(bloomPosition(value, modulus), (value >>> 0) % modulus);
  }
  assert.equal(bloomPosition(-10, 5), 0);
  assert.equal(bloomPosition(0, modulus), 0);
  assert.equal(bloomPosition(2147483647, modulus), 2147483647);
});

await check(`Python byte-regex semantics: ${reference.regex_vectors.length} controlled-membership cases`, () => {
  for (const vector of reference.regex_vectors) {
    const error = adminKeyError(fromHex(vector.hex), vector.added);
    assert.equal(error, vector.error, vector.hex.slice(0, 100));
    assert.equal(error === null, vector.result);
  }
});

await check(`security estimate: ${reference.security_vectors.length} CPython counter controls, including full setup range`, () => {
  for (const vector of reference.security_vectors) {
    assert.equal(finite(bloomSecurity(modulus, vector.hashes, vector.count)), vector.value,
      `k=${vector.hashes}, count=${vector.count}`);
  }
  const count = reference.password.state.count;
  assert(bloomSecurity(modulus, 47, count - 1) > 768);
  assert(bloomSecurity(modulus, 47, count) <= 768);
});

await check('BloomFilter: empty/duplicate/binary insertions at both original hash counts', () => {
  for (const vector of reference.bloom_vectors) {
    const bf = new BloomFilter(modulus, vector.hashes);
    for (const operation of vector.operations) {
      const data = fromHex(operation.hex);
      assert.equal(bf.check(data), operation.before);
      bf._add(data);
      assert.equal(bf.check(data.slice()), operation.after);
      assert.deepEqual(state(bf), operation.state);
    }
  }
});

await check('BloomFilter: check short-circuits, insertion still uses all original seeds', () => {
  for (const hashes of [47, 64]) {
    const calls = [];
    const data = fromHex('ff000a');
    const bf = new BloomFilter(modulus, hashes, (key, seed) => { calls.push(seed); return murmur3(key, seed); });
    assert.equal(bf.check(data), false);
    assert.deepEqual(calls, [0]);
    calls.length = 0;
    bf._add(data);
    assert.deepEqual(calls, Array.from({ length: hashes }, (_, i) => i));
    calls.length = 0;
    assert.equal(bf.check(data), true);
    assert.equal(calls.length, hashes);
  }
});

await check('Diffecient: full security-768 setup matches CPython MT bytes, all keys and native digest set', () => {
  const output = [];
  const rng = PythonRandom.fresh(() => entropy.slice());
  const recordedKeys = [];
  let bytes = [];
  const recordingRng = { randint(a, b) {
    assert.equal(a, 0); assert.equal(b, 255);
    const value = rng.randint(a, b);
    bytes.push(value);
    if (bytes.length === 256) { recordedKeys.push(hex(Uint8Array.from(bytes))); bytes = []; }
    return value;
  } };
  const positions = new Set();
  const db = new PasswordDB(modulus, 47, 768, recordingRng, line => output.push(line), (key, seed) => {
    const digest = murmur3(key, seed);
    positions.add(bloomPosition(digest, modulus));
    return digest;
  });
  assert.deepEqual(output, reference.password.setup);
  assert.deepEqual(state(db), reference.password.state);
  assert.deepEqual(recordedKeys, reference.password.all_keys_hex);
  assert.equal(db.addition_quota, 1);
  assert.equal(db.added_keys.size, 0);
  assert.equal(db.memory_consumption(), positions.size * 4);
  const encodedPositions = Buffer.alloc(positions.size * 4);
  [...positions].sort((a, b) => a - b).forEach((value, i) => encodedPositions.writeUInt32LE(value, i * 4));
  assert.equal(sha256(encodedPositions), reference.password.digest_sha256);
  for (const key of recordedKeys) assert.equal(db.check(fromHex(key)), true);
  for (const action of reference.password.actions) {
    output.length = 0;
    const result = db[action.method](fromHex(action.hex));
    assert.equal(result ?? null, action.result);
    assert.deepEqual(output, action.output);
    assert.deepEqual(state(db), action.state);
  }
  assert.equal(db.addition_quota, 0);
});

await check('randbytes uses Python randint for zero and 256-byte boundaries', () => {
  const rng = PythonRandom.fresh(() => entropy.slice());
  assert.equal(randbytes(rng, 0).length, 0);
  assert.equal(hex(randbytes(rng, 256)), reference.password.first_key_hex);
});

await check('Diffecientwo: full 22-post class transcript and separately labelled injected-state success control', () => {
  const output = [];
  let wins = 0;
  const cache = new SocialCache(modulus, 64, 32, 22, line => output.push(line));
  function compare(action) {
    output.length = 0;
    const result = action.method === 'grant_free_api'
      ? cache.grant_free_api(() => { wins++; output.push(reward); })
      : cache[action.method](fromHex(action.hex));
    assert.equal(result ?? null, action.result);
    assert.deepEqual(output, action.output);
    assert.deepEqual(state(cache), action.state);
  }
  for (const action of reference.social.actions) compare(action);
  assert.equal(cache._num_posts, 0);
  assert.equal(cache.num_passwords(), 22);
  assert.equal(wins, 0);
  // CONTROL: _add bypasses the 32-byte limit. This is not a protocol solution.
  cache._add(promotionPost());
  compare(reference.social.success_control);
  compare(reference.social.success_control);
  assert.equal(wins, 2);
});

await check('Diffecient: full protocol success with known test entropy (control, not an independent solve)', async () => {
  const lines = ['-1', '9999999999999999999999999999999999999'];
  const expected = [passwordBanner, ...reference.password.setup];
  const methodOptions = { query_db: '1', add_sample: '2', check_admin: '3' };
  for (const action of reference.password.actions) {
    lines.push(methodOptions[action.method], action.hex);
    expected.push(...action.output);
    if (action.method === 'check_admin') expected.push(action.result ? reward : 'No Admin no flag');
  }
  lines.push('3', reference.password.admin_key_hex, '4');
  expected.push(reward, 'Something wrong happened');
  const io = testIO(lines);
  await runPassword(io);
  assert.deepEqual(io.output, expected);
  assert.equal(io.wins, 2);
  assert.equal(io.entropyCalls, 1);
  assert.equal(io.consumed(), lines.length);
  assert.equal(io.eof, false);
  assert(io.statuses.length >= 1);
  assert(io.prompts.every(prompt => prompt === 'Enter API option:\n' || prompt === 'Enter key in hex\n'));
  writeFileSync(join(runDir, 'diffecient-known-entropy-control.json'), JSON.stringify({
    classification: 'Full protocol success control using known test entropy; not an independent puzzle solve.',
    input: lines, events: io.events, wins: io.wins,
  }, null, 2));
});

await check('Diffecientwo: full production-size protocol transcript rejects the oversized target and exhausts 22 slots', async () => {
  const lines = ['0', '-999999999999999999999999999'];
  const expected = [socialBanner];
  const methodOptions = { find_post: '1', add_post: '2', grant_free_api: '3' };
  for (const action of reference.social.actions) {
    lines.push(methodOptions[action.method]);
    if (action.hex !== null) lines.push(action.hex);
    expected.push(...action.output);
  }
  lines.push('4'); expected.push('Something wrong happened');
  const io = testIO(lines);
  await runSocial(io);
  assert.deepEqual(io.output, expected);
  assert.equal(io.wins, 0);
  assert.equal(io.entropyCalls, 0);
  assert.equal(io.consumed(), lines.length);
  assert.equal(io.eof, false);
  assert(io.prompts.every(prompt => prompt === 'Enter API option:\n' || prompt === 'Enter post in hex\n'));
  writeFileSync(join(runDir, 'diffecientwo-full-quota-transcript.json'), JSON.stringify({ input: lines, events: io.events, wins: io.wins }, null, 2));
});

await check('Diffecient: adding the known database key still blocks that byte-equal key from admin', async () => {
  const key = reference.password.admin_key_hex;
  const io = testIO(['2', key.toUpperCase(), '3', key, '1', key, '4']);
  await runPassword(io);
  assert.deepEqual(io.output, [passwordBanner, ...reference.password.setup,
    'key added successfully to DB', 'Admin account restricted for free tier',
    'No Admin no flag', 'Key present in DB', 'Something wrong happened']);
  assert.equal(io.wins, 0);
});

await check('Diffecientwo: duplicate empty posts consume all 22 slots; queries and grants remain available', async () => {
  const lines = [];
  for (let i = 0; i < 23; i++) lines.push('2', '');
  lines.push('1', '', '3', '3', '4');
  const io = testIO(lines);
  await runSocial(io);
  assert.deepEqual(io.output, [socialBanner,
    ...Array.from({ length: 22 }, (_, i) => `Added successfully! Posts remaining ${21 - i}`),
    'User exceeded number of allowed posts', 'Found the post in our DB',
    'Sorry, you dont seem to have posted about us', 'Sorry, you dont seem to have posted about us',
    'Something wrong happened']);
  assert.equal(io.wins, 0);
});

await check('both ports: ASCII integer/hex whitespace, underscore spellings and empty bytes', async () => {
  for (const [run, banner, setup, added, found] of [
    [runPassword, passwordBanner, reference.password.setup, 'key added successfully to DB', 'Key present in DB'],
    [runSocial, socialBanner, [], 'Added successfully! Posts remaining 21', 'Found the post in our DB'],
  ]) {
    const lines = [' +0_2 ', ' \t00\vff\f01\r ', '\t0_1 ', '00 FF 01', '4'];
    const io = testIO(lines);
    delete io.status; // Optional under the worker contract.
    await run(io);
    assert.deepEqual(io.output, [banner, ...setup, added, found, 'Something wrong happened']);
    assert.equal(io.wins, 0);
    const empty = testIO(['2', ' \t\v\f\r ', '1', '', '4']);
    await run(empty);
    assert.deepEqual(empty.output, [banner, ...setup, added, found, 'Something wrong happened']);
  }
});

const invalidOptions = ['', 'abc', '1.0', '0x1', '1__0'];
await check(`both ports: ${invalidOptions.length * 2} invalid menu inputs terminate with original error`, async () => {
  for (const [run, banner, setup] of [
    [runPassword, passwordBanner, reference.password.setup], [runSocial, socialBanner, []],
  ]) {
    for (const line of invalidOptions) {
      const io = testIO([line, '4']);
      await run(io);
      assert.deepEqual(io.output, [banner, ...setup, 'Something wrong happened']);
      assert.equal(io.consumed(), 1);
      assert.equal(io.wins, 0);
    }
  }
});

const invalidHex = ['a', 'a a', 'zz', '0x12', '11\u00a022', '\u3042', '01 2', ' 0 0 '];
await check(`both ports: ${invalidHex.length * 5} malformed hex cases across every byte-input option`, async () => {
  for (const [run, banner, setup, options] of [
    [runPassword, passwordBanner, reference.password.setup, ['1', '2', '3']],
    [runSocial, socialBanner, [], ['1', '2']],
  ]) {
    for (const option of options) {
      for (const line of invalidHex) {
        const io = testIO([option, line, '4']);
        await run(io);
        assert.deepEqual(io.output, [banner, ...setup, 'Something wrong happened']);
        assert.equal(io.consumed(), 2);
        assert.equal(io.wins, 0);
      }
    }
  }
});

await check('both ports: EOF at menu/data and option 4 follow caught SystemExit behavior', async () => {
  for (const [run, banner, setup] of [
    [runPassword, passwordBanner, reference.password.setup], [runSocial, socialBanner, []],
  ]) {
    for (const lines of [[], ['1'], ['2'], ['4', '2', '']]) {
      const io = testIO(lines);
      await run(io);
      assert.deepEqual(io.output, [banner, ...setup, 'Something wrong happened']);
      assert.equal(io.eof, lines.length !== 3);
      assert.equal(io.wins, 0);
    }
  }
});

writeFileSync(join(runDir, 'coverage-counts.json'), JSON.stringify({
  groups, hashVectors: reference.hash_vectors.length, regexVectors: reference.regex_vectors.length,
  securityVectors: reference.security_vectors.length,
  setupKeys: reference.password.state.count, setupMemory: reference.password.state.memory,
  invalidMenuTranscripts: invalidOptions.length * 2, invalidHexTranscripts: invalidHex.length * 5,
  limitations: ['Native mmh3 is absent; canonical C reference checked with known answers and the SMHasher fingerprint.',
    'Diffecient winning protocol uses known test entropy, not an independent solve.',
    'Diffecientwo winning predicate is an injected-state class control, not a full winning protocol.',
    'No Chromium or Worker/UI integration was run.'],
}, null, 2));
console.log(`# Evidence: ${runDir}`);
