// Derived from zh3r0 CTF 2021 b00tleg's organizer-practice.py.
// The archived source carries no license header. The tutorial's weaknesses
// (including empty XOR operands and lossy modular encoding) are intentional.
import {hex, toBigInt, powMod} from '../lib/bytes.mjs';

export const bytes_to_int = bytes => toBigInt(bytes).toString();
export const inc_by_one = bytes => hex(bytes.map(value => (value + 1) & 255));
export const mono_sub = (bytes, table) => hex(bytes.map(value => table[value]));
export const poly_sub = (bytes, tables) => hex(bytes.map((value, i) => tables[i % 15][value]));
export const pow_mod_prime = (bytes, p) => powMod(toBigInt(bytes), 3n, p).toString();
export const rand_pow_mod_prime = (bytes, p, e) => powMod(toBigInt(bytes), e, p).toString();

export function substitution(rng) {
  const table = Uint8Array.from({length: 256}, (_, i) => i);
  rng.shuffle(table);
  return table;
}

export function rand_subt(bytes, rng) {
  const result = new Uint8Array(bytes.length * 2);
  bytes.forEach((value, i) => {
    const t = rng.randint(0, 255);
    result[2 * i] = t;
    result[2 * i + 1] = (value - t + 256) & 255;
  });
  return hex(result);
}

export function xor(a, b) {
  // Python zip(cycle(empty), ...) is empty, even if the other input is not.
  if (!a.length || !b.length) return new Uint8Array();
  return Uint8Array.from({length: Math.max(a.length, b.length)},
    (_, i) => a[i % a.length] ^ b[i % b.length]);
}

export function random_pad(bytes, length, rng) {
  if (bytes.length % length === 0) return bytes;
  const result = new Uint8Array(bytes.length + length - bytes.length % length);
  result.set(bytes);
  for (let i = bytes.length; i < result.length; i++) result[i] = rng.randint(0, 255);
  return result;
}

export function xor_key_appended(bytes, rng) {
  // Key generation precedes padding in the original MT stream.
  const key = Uint8Array.from({length: 5}, () => rng.randint(0, 255));
  return hex(xor(random_pad(bytes, 5, rng), key)) + hex(key);
}

// Prime sampling below follows Crypto.Util.number (PyCryptodome), including
// its 10,000-prime trial sieve, byte order, rejection sampling, and ten distinct
// Miller-Rabin bases (the original default false-positive bound is 1e-6).
// Number-theoretic routines by Andrew M. Kuchling, Barry A. Warsaw, and others:
// The contents of this file are dedicated to the public domain. To the extent
// that dedication to the public domain is not available, everyone is granted
// a worldwide, perpetual, royalty-free, non-exclusive license to exercise all
// rights associated with the contents of this file for any purpose whatsoever.
// No rights are reserved.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

export function primeSieve() {
  const composite = new Uint8Array(104730);
  const primes = [];
  for (let p = 2; p < composite.length; p++) {
    if (composite[p]) continue;
    primes.push(BigInt(p));
    for (let k = p * p; k < composite.length; k += p) composite[k] = 1;
  }
  return primes;
}

export function getRandomInteger(bits, randomBytes) {
  const bytes = randomBytes(Math.floor(bits / 8));
  const oddBits = bits % 8;
  let value = toBigInt(bytes);
  if (oddBits) {
    value |= BigInt(randomBytes(1)[0] >> (8 - oddBits)) << BigInt(bytes.length * 8);
  }
  return value;
}

export function getRandomRange(a, b, randomBytes) {
  const range = b - a - 1n;
  if (range < 0n) throw Error('empty range');
  const bits = range === 0n ? 0 : range.toString(2).length;
  let value;
  do { value = getRandomInteger(bits, randomBytes); } while (value > range);
  return a + value;
}

export function rabinMiller(n, rounds, randomBytes) {
  if (n < 3n || (n & 1n) === 0n) return n === 2n;
  const n1 = n - 1n;
  let m = n1, b = 0;
  while ((m & 1n) === 0n) { m >>= 1n; b++; }
  const tested = new Set();
  for (let i = 0; i < rounds && BigInt(i) < n - 2n; i++) {
    let a;
    do { a = getRandomRange(2n, n, randomBytes); } while (tested.has(a));
    tested.add(a);
    let z = powMod(a, m, n);
    if (z === 1n || z === n1) continue;
    let composite = true;
    for (let r = 0; r < b; r++) {
      z = z * z % n;
      if (z === 1n) return false;
      if (z === n1) { composite = false; break; }
    }
    if (composite) return false;
  }
  return true;
}

export function isPrime(n, randomBytes, sieve = primeSieve()) {
  if (n < 3n || (n & 1n) === 0n) return n === 2n;
  for (const p of sieve) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  return rabinMiller(n, 10, randomBytes);
}

export function getPrime(bits, randomBytes, sieve = primeSieve()) {
  if (!Number.isSafeInteger(bits) || bits < 2) throw Error('N must be larger than 1');
  for (;;) {
    const n = getRandomInteger(bits - 1, randomBytes) | (1n << BigInt(bits - 1)) | 1n;
    if (isPrime(n, randomBytes, sieve)) return n;
  }
}
