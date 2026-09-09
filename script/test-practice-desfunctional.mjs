import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../assets/js/challenge-practice/ports/desfunctional.mjs';
import { tripleCBC } from '../assets/js/challenge-practice/ports/desfunctional-helpers.mjs';
import { hex } from '../assets/js/challenge-practice/lib/bytes.mjs';

const reward = 'practice{local_dummy_reward}';
const key = Uint8Array.from({ length: 24 }, (_, i) => i + 1);
const iv = Uint8Array.from({ length: 8 }, (_, i) => 0xa0 + i);
const challenge = Uint8Array.from({ length: 64 }, (_, i) => 0x40 + i);
const encrypted = tripleCBC(key, iv, challenge);

test('Desfunctional full run reaches the original plaintext predicate', async () => {
  const lines = ['1', '3', hex(challenge)];
  let cursor = 0;
  const writes = [], deadlines = [], entropy = [key, iv, challenge, new Uint8Array(2496)];
  const io = {
    reward,
    async read() { assert.ok(cursor < lines.length); return lines[cursor++]; },
    write(text) { writes.push(String(text)); },
    win(text = reward) { writes.push(String(text)); },
    randomBytes(size) { const value = entropy.shift(); assert.equal(value.length, size); return value.slice(); },
    setDeadline(seconds) { deadlines.push(seconds); },
  };
  await run(io);
  assert.deepEqual(deadlines, [128]);
  assert.deepEqual(writes, [hex(encrypted), `b'${reward}'`]);
  assert.equal(cursor, lines.length);
});
