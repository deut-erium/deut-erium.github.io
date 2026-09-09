// SPDX-License-Identifier: AGPL-3.0-only
// Browser port of SekaiCTF 2022 diffecient.
// Derived from assets/challenges/sekaictf-2022-diffecient/diffecient.py.
// The original Bloom-filter weaknesses and free-tier restrictions are intentional.
import { fromHex, hex, integer } from '../lib/bytes.mjs';
import { PythonRandom } from '../lib/python-random.mjs';
import { BloomFilter, adminKeyError, murmur3 } from './bloom-helpers.mjs';

export const BANNER = String.raw`
 ____  ____  ____  ____  ____  ___  ____  ____  _  _  ____
(  _ \(_  _)( ___)( ___)( ___)/ __)(_  _)( ___)( \( )(_  _)
 )(_) )_)(_  )__)  )__)  )__)( (__  _)(_  )__)  )  (   )(
(____/(____)(__)  (__)  (____)\___)(____)(____)(_)\_) (__)

Welcome to diffecient security key database API for securely
and efficiently saving tonnes of long security keys!
Feel FREE to query your security keys and pay a little to
add your own security keys to our state of the art DB!
We trust our product so much that we even save our own keys here
`;

/** Original random.randint(0, 255) per byte, not direct OS random bytes. */
export function randbytes(rng, length) {
  return Uint8Array.from({ length }, () => rng.randint(0, 255));
}

export class PasswordDB extends BloomFilter {
  constructor(modulus, hashes, security, rng, write = () => {}, hashFunc = murmur3) {
    super(modulus, hashes, hashFunc);
    this.write = write;
    this.add_keys(security, rng);
    this.addition_quota = 1;
    // Python's set of bytes compares contents, not object identities.
    this.added_keys = new Set();
  }

  add_keys(threshold, rng) {
    while (this.security() > threshold) this._add(randbytes(rng, 256));
    this.write(`Added ${this.num_passwords()} security keys to DB`);
    this.write(`Original size of keys ${Math.floor(this.num_passwords() / 4)} KB vs ${Math.floor(this.memory_consumption() / 1024)} KB in DB`);
  }

  check_admin(key) {
    const error = adminKeyError(key, this.added_keys.has(hex(key)));
    if (error !== null) {
      this.write(error);
      return false;
    }
    return this.check(key);
  }

  query_db(key) {
    this.write(this.check(key) ? 'Key present in DB' : 'Key not present in DB');
  }

  add_sample(key) {
    if (this.addition_quota > 0) {
      this._add(key);
      this.added_keys.add(hex(key));
      this.addition_quota -= 1;
      this.write('key added successfully to DB');
    } else {
      this.write('API quota exceeded');
    }
  }
}

export async function run(io, options = {}) {
  io.write(BANNER);
  const rng = PythonRandom.fresh(n => io.randomBytes(n));
  io.status?.('Initializing the original 47-hash security database (threshold 768).');
  const db = new PasswordDB(2 ** 32 - 5, 47, 768, rng, text => io.write(text));
  io.status?.('Security database ready.');
  while (true) {
    try {
      const option = integer(await io.read('Enter API option:\n'));
      if (option === 1n) {
        db.query_db(fromHex(await io.read('Enter key in hex\n')));
      } else if (option === 2n) {
        db.add_sample(fromHex(await io.read('Enter key in hex\n')));
      } else if (option === 3n) {
        if (db.check_admin(fromHex(await io.read('Enter key in hex\n')))) io.win();
        else io.write('No Admin no flag');
      } else if (option === 4n) {
        // The original bare except catches its own exit(0) / SystemExit.
        io.write('Something wrong happened');
        return;
      }
    } catch {
      io.write('Something wrong happened');
      return;
    }
  }
}
