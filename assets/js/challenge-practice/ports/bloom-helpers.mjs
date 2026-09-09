// SPDX-License-Identifier: AGPL-3.0-only
// Bloom filter logic derived from SekaiCTF 2022 diffecient and 2023 diffecientwo.
// MurmurHash3 x86_32 is Austin Appleby's public-domain algorithm.

const rotateLeft = (word, count) => (word << count) | (word >>> (32 - count));

/** mmh3.hash(bytes, seed), with its default signed 32-bit result. */
export function murmur3(bytes, seed = 0) {
  let hash = seed | 0;
  const blockEnd = bytes.length - (bytes.length % 4);
  for (let offset = 0; offset < blockEnd; offset += 4) {
    let word = bytes[offset] | (bytes[offset + 1] << 8)
      | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
    word = Math.imul(word, 0xcc9e2d51);
    word = Math.imul(rotateLeft(word, 15), 0x1b873593);
    hash ^= word;
    hash = (Math.imul(rotateLeft(hash, 13), 5) + 0xe6546b64) | 0;
  }
  let tail = 0;
  // Intentional fallthrough: the tail is a little-endian partial word.
  switch (bytes.length & 3) {
    case 3: tail ^= bytes[blockEnd + 2] << 16;
    // falls through
    case 2: tail ^= bytes[blockEnd + 1] << 8;
    // falls through
    case 1:
      tail ^= bytes[blockEnd];
      tail = Math.imul(tail, 0xcc9e2d51);
      tail = Math.imul(rotateLeft(tail, 15), 0x1b873593);
      hash ^= tail;
  }
  hash ^= bytes.length;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) | 0;
}

/** Python's signed-hash modulo, not unsigned conversion before reduction. */
export function bloomPosition(digest, modulus) {
  const remainder = digest % modulus;
  return remainder < 0 ? remainder + modulus : remainder === 0 ? 0 : remainder;
}

/** Original floating-point estimate and int(...).bit_length(). */
export function bloomSecurity(modulus, hashes, count) {
  const falsePositive = Math.pow(
    1 - Math.pow(Math.E, -hashes * count / modulus), hashes);
  const reciprocal = 1 / falsePositive;
  if (!Number.isFinite(reciprocal)) return Infinity;
  return BigInt(Math.trunc(reciprocal)).toString(2).length;
}

export class BloomFilter {
  #modulus;
  #hashes;
  #count = 0;
  #digests = new Set();

  constructor(modulus, hashes, hashFunc = murmur3) {
    this.#modulus = modulus;
    this.#hashes = hashes;
    this.hash = hashFunc;
  }

  security() {
    return bloomSecurity(this.#modulus, this.#hashes, this.#count);
  }

  _add(item) {
    this.#count += 1;
    for (let seed = 0; seed < this.#hashes; seed++) {
      this.#digests.add(bloomPosition(this.hash(item, seed), this.#modulus));
    }
  }

  check(item) {
    for (let seed = 0; seed < this.#hashes; seed++) {
      if (!this.#digests.has(bloomPosition(this.hash(item, seed), this.#modulus))) {
        return false;
      }
    }
    return true;
  }

  num_passwords() { return this.#count; }
  memory_consumption() { return 4 * this.#digests.size; }
}

/** Python re.match on bytes: dot excludes LF; byte classes are ASCII only. */
export function adminKeyError(key, wasAdded = false) {
  const newline = key.indexOf(10);
  const firstLineLength = newline < 0 ? key.length : newline;
  if (firstLineLength < 32) return 'Admin key should be atleast 32 characters long';
  // The final character in each lookahead can itself be LF (notably \\W).
  const lookahead = predicate => {
    for (const byte of key) {
      if (predicate(byte)) return true;
      if (byte === 10) break;
    }
    return false;
  };
  const lower = b => b >= 97 && b <= 122;
  const upper = b => b >= 65 && b <= 90;
  const digit = b => b >= 48 && b <= 57;
  if (!lookahead(lower)) return 'Admin key should contain atleast 1 lowercase character';
  if (!lookahead(upper)) return 'Admin key should contain atleast 1 uppercase character';
  if (!lookahead(digit)) return 'Admin key should contain atleast 1 digit character';
  if (!lookahead(b => !(lower(b) || upper(b) || digit(b) || b === 95))) {
    return 'Admin key should contain atleast 1 special character';
  }
  if (wasAdded) return 'Admin account restricted for free tier';
  return null;
}
