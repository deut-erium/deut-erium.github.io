// RandSubWare, derived from SekaiCTF 2023's chall.py (SekaiCTF contributors).
// Original challenge attribution/license: GNU Affero General Public License v3.0.
// The archived challenge's weaknesses and parameters are intentional.
import { PythonRandom } from '../lib/python-random.mjs';
import { fromBigInt, fromHex, hex, integer, toBigInt } from '../lib/bytes.mjs';

export const BOX_SIZE = 6;
export const NUM_BOX = 16;
export const ROUNDS = 5;
export const QUOTA = 50000;
export const PROMPT = 'Choose API option\n1. Test encryption\n2. Get Flag\n';
export const QUOTA_ERROR = 'Encryption quota exceeded, buy pro subscription for $69/month';

export function gen_pbox(s, n) {
  const result = [];
  for (let j = 0; j < s; j++) {
    for (let i = 0; i < n; i++) result.push((s * i + j) % (n * s));
  }
  return result;
}

// rng is explicit so importing the module never consumes entropy.
export function gen_sbox(n, rng) {
  const a = 2 ** Math.floor((n + 1) / 2);
  const b = 2 ** Math.floor(n / 2);
  const x = Array.from({ length: a }, (_, i) => i);
  rng.shuffle(x);
  let res = x.slice();
  for (let i = 0; i < b - 1; i++) {
    for (let j = 0; j < x.length; j++) {
      // Python list.insert(-1, value) inserts BEFORE the last element.
      res.splice((i + 2) * j - 1, 0, a * (i + 1) + x[j]);
    }
    // Read every index from the old list, not the partially updated result.
    res = res.map(index => res[index]);
  }
  return res;
}

export function rotate_left(val, shift, mod) {
  val = BigInt(val);
  shift = ((shift % mod) + mod) % mod;
  return ((val << BigInt(shift)) | (val >> BigInt(mod - shift))) &
    ((1n << BigInt(mod)) - 1n);
}

export class SPN {
  constructor(SBOX, PBOX, key, rounds) {
    this.SBOX = SBOX;
    this.PBOX = PBOX;
    this.SINV = SBOX.map((_, i) => SBOX.indexOf(i));
    this.PINV = PBOX.map((_, i) => PBOX.indexOf(i));
    this.BLOCK_SIZE = PBOX.length;
    this.BOX_SIZE = Math.trunc(Math.log2(SBOX.length));
    this.NUM_SBOX = Math.floor(PBOX.length / this.BOX_SIZE);
    this.rounds = rounds;
    this.round_keys = this.expand_key(key, rounds);
  }

  perm(inp) {
    return this.apply_perm(BigInt(inp), this.PBOX);
  }

  inv_perm(inp) {
    return this.apply_perm(BigInt(inp), this.PINV);
  }

  apply_perm(inp, box) {
    let ct = 0n;
    for (let i = 0; i < box.length; i++) {
      ct |= ((inp >> BigInt(this.BLOCK_SIZE - 1 - i)) & 1n) <<
        BigInt(this.BLOCK_SIZE - 1 - box[i]);
    }
    return ct;
  }

  sbox(inp) {
    return this.apply_sbox(BigInt(inp), this.SBOX);
  }

  inv_sbox(inp) {
    return this.apply_sbox(BigInt(inp), this.SINV);
  }

  apply_sbox(inp, box) {
    const BS = BigInt(this.BOX_SIZE);
    const mask = (1n << BS) - 1n;
    let ct = 0n;
    for (let i = 0; i < this.NUM_SBOX; i++) {
      const shift = BigInt(i) * BS;
      ct |= BigInt(box[Number((inp >> shift) & mask)]) << shift;
    }
    return ct;
  }

  int_to_list(inp) {
    inp = BigInt(inp);
    const BS = BigInt(this.BOX_SIZE);
    const mask = (1n << BS) - 1n;
    return Array.from({ length: this.NUM_SBOX }, (_, i) =>
      Number((inp >> (BigInt(this.NUM_SBOX - 1 - i) * BS)) & mask));
  }

  list_to_int(lst) {
    let res = 0n;
    for (let i = 0; i < lst.length; i++) {
      res |= BigInt(lst[lst.length - 1 - i]) << BigInt(i * this.BOX_SIZE);
    }
    return res;
  }

  expand_key(key, rounds) {
    if (Array.isArray(key)) key = this.list_to_int(key);
    else if (key instanceof Uint8Array) key = toBigInt(key);
    const mask = (1n << BigInt(this.BLOCK_SIZE)) - 1n;
    const keys = [BigInt(key) & mask];
    for (let i = 0; i < rounds; i++) {
      keys.push(this.sbox(rotate_left(keys[keys.length - 1], this.BOX_SIZE + 1, this.BLOCK_SIZE)));
    }
    return keys;
  }

  encrypt(pt) {
    let ct = BigInt(pt) ^ this.round_keys[0];
    for (const key of this.round_keys.slice(1, -1)) {
      ct = this.perm(this.sbox(ct)) ^ key;
    }
    return this.sbox(ct) ^ this.round_keys[this.round_keys.length - 1];
  }

  decrypt(ct) {
    ct = this.inv_sbox(BigInt(ct) ^ this.round_keys[this.round_keys.length - 1]);
    for (let i = this.round_keys.length - 2; i > 0; i--) {
      ct = this.inv_sbox(this.inv_perm(ct ^ this.round_keys[i]));
    }
    return ct ^ this.round_keys[0];
  }

  encrypt_bytes(pt) {
    const blockLen = Math.floor(this.BLOCK_SIZE / 8);
    if (pt.length % blockLen !== 0) throw Error(''); // Python AssertionError.
    const result = new Uint8Array(pt.length);
    for (let i = 0; i < pt.length; i += blockLen) {
      result.set(fromBigInt(this.encrypt(toBigInt(pt.subarray(i, i + blockLen))), blockLen), i);
    }
    return result;
  }
}

export function pad_query(textHex, blockLen) {
  // Parity is measured BEFORE fromhex removes whitespace. An odd nibble is
  // padded on the right, and then the decoded bytes are zero-padded to a block.
  if (Array.from(textHex).length & 1) textHex += '0';
  const text = fromHex(textHex);
  const result = new Uint8Array(text.length + ((blockLen - text.length % blockLen) % blockLen));
  result.set(text);
  return result;
}

// Explicit state constructor for pure-function tests; run never accepts keys,
// boxes, quota changes, or RNG seeds through options.
export class Challenge {
  constructor(spn, maxMess = QUOTA) {
    this.spn = spn;
    this.quota = maxMess;
  }

  query(textHex, write) {
    const blockLen = Math.floor(this.spn.BLOCK_SIZE / 8);
    const text = pad_query(textHex, blockLen);
    // Preserve the overdraft: only the OLD balance is checked.
    if (this.quota <= 0) throw Error(QUOTA_ERROR);
    this.quota -= text.length / blockLen;
    write(`Quota remaining: ${this.quota}`);
    return hex(this.spn.encrypt_bytes(text));
  }

  get_flag(keyGuess, win) {
    if (keyGuess !== this.spn.round_keys[0]) throw Error('There is no free lunch');
    win();
  }
}

export function parse_integer(text) {
  // Python int() rejects BOM but accepts NEXT LINE as whitespace; JS trim()
  // does the reverse. Keep these conversions local to this port.
  if (text.includes('\ufeff')) throw Error('invalid literal for int() with base 10');
  return integer(text.replaceAll('\u0085', ' '));
}

export async function run(io, options = {}) {
  const rng = PythonRandom.fresh(n => io.randomBytes(n));
  const sbox = gen_sbox(BOX_SIZE, rng);
  // secrets.randbits(96) and random.shuffle use independent entropy paths.
  const key = toBigInt(io.randomBytes(12));
  const challenge = new Challenge(new SPN(sbox, gen_pbox(BOX_SIZE, NUM_BOX), key, ROUNDS));
  io.write(`sbox: ${hex(Uint8Array.from(sbox))}`);
  io.setDeadline(500);
  while (true) {
    try {
      const option = parse_integer(await io.read(PROMPT));
      if (option === 1n) {
        const text = await io.read('(hex) text: ');
        io.write(challenge.query(text, line => io.write(line)));
      } else if (option === 2n) {
        const guess = parse_integer(await io.read('(int) key: '));
        challenge.get_flag(guess, () => io.win(io.reward));
        return;
      }
    } catch (error) {
      io.write(error.message);
      return;
    }
  }
}
