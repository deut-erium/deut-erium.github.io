// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Browser port of assets/challenges/google-ctf-2024-idea/chall.py.

import { integer, toBigInt } from '../lib/bytes.mjs';

export function mul16(x, y) {
  if (x === 0) x = 65536;
  if (y === 0) y = 65536;
  // The largest product is 2**32, exactly representable as a JS Number.
  return ((x * y) % 65537) % 65536;
}

export function add16(x, y) {
  return (x + y) & 0xffff;
}

// Count bits in a validated nonnegative BigInt mask.
export function bitCount(mask) {
  let count = 0;
  for (; mask > 0n; mask &= mask - 1n) count++;
  return count;
}

export function expandKey(key, rounds = 8) {
  key = BigInt(key);
  const subKeys = [];
  for (let i = 0; i < (rounds + 1) * 6; i++) {
    subKeys.push(Number((key >> BigInt(112 - 16 * (i % 8))) & 0xffffn));
    if (i % 8 === 7) key = BigInt.asUintN(128, (key << 25n) | (key >> 103n));
  }
  return Array.from({ length: rounds + 1 }, (_, i) => subKeys.slice(6 * i, 6 * i + 6));
}

export class IDEA {
  constructor(key, rounds = 8) {
    this.rounds = rounds;
    this.keys = expandKey(key, rounds);
  }

  encrypt(plaintext) {
    plaintext = BigInt(plaintext);
    let x1 = Number((plaintext >> 48n) & 0xffffn);
    let x2 = Number((plaintext >> 32n) & 0xffffn);
    let x3 = Number((plaintext >> 16n) & 0xffffn);
    let x4 = Number(plaintext & 0xffffn);
    for (let i = 0; i < this.rounds; i++) {
      const [k1, k2, k3, k4, k5, k6] = this.keys[i];
      [x1, x2, x3, x4] = [mul16(x1, k1), add16(x2, k2), add16(x3, k3), mul16(x4, k4)];
      const t0 = mul16(k5, x1 ^ x3);
      const t1 = mul16(k6, add16(t0, x2 ^ x4));
      const t2 = add16(t0, t1);
      [x1, x2, x3, x4] = [x1 ^ t1, x3 ^ t1, x2 ^ t2, x4 ^ t2];
    }
    const [k1, k2, k3, k4] = this.keys[this.rounds];
    return (BigInt(mul16(x1, k1)) << 48n)
      | (BigInt(add16(x3, k2)) << 32n)
      | (BigInt(add16(x2, k3)) << 16n)
      | BigInt(mul16(x4, k4));
  }
}

const PROMPT = 'Choose an API option\n'
  + '1. Test Encryption\n'
  + '2. Flip around some switches\n'
  + '3. Get the flag\n'
  + '4. Get balance\n';

export async function run(io, options = {}) {
  const origKey = toBigInt(io.randomBytes(16));
  let key = origKey;
  let cipher = new IDEA(key, 3);
  let credits = 2024;
  io.setDeadline(512);

  for (;;) {
    try {
      const option = integer(await io.read(PROMPT));
      if (option === 1n) {
        const pt = integer(await io.read('(hex) text: '), 16);
        if (pt < 0n || pt >= (1n << 64n)) throw Error('Inappropriate plain text');
        if (credits > 0) {
          credits--;
          io.write(cipher.encrypt(pt).toString());
        } else {
          io.write('-1');
        }
      } else if (option === 2n) {
        const mask = integer(await io.read('(hex) mask: '), 16);
        if (mask < 0n || mask >= (1n << 128n)) {
          throw Error('The switch you are trying to flip might be in another room');
        }
        // Check before charging: the original permits a negative balance.
        if (credits > 0) {
          credits -= 100 * bitCount(mask);
          key ^= mask;
          cipher = new IDEA(key, 3);
        }
      } else if (option === 3n) {
        const keyGuess = integer(await io.read('(hex) key_guess: '), 16);
        if (keyGuess < 0n || keyGuess >= (1n << 128n)) {
          throw Error("This key surely doesn't fit into my lock");
        }
        if (keyGuess !== origKey) throw Error('you have no idea');
        io.win(io.reward);
        return;
      } else if (option === 4n) {
        io.write(`Credits Remaining: ${credits}`);
      }
    } catch (error) {
      io.write(error.message);
      return;
    }
  }
}
