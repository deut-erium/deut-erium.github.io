import { PIECE_TYPES } from "./pieces.js?v=20260907";

function seedWords(value) {
  const bytes = new TextEncoder().encode(String(value));
  const words = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (const byte of bytes) {
    for (let index = 0; index < words.length; index += 1) {
      words[index] = (words[index] ^ (byte + index * 0x9d)) >>> 0;
      words[index] = Math.imul(words[index], 0x01000193 + index * 2) >>> 0;
      words[index] = (words[index] ^ (words[index] >>> (13 + index))) >>> 0;
    }
  }
  if (words.every((word) => word === 0)) words[0] = 1;
  return words;
}

function rotateLeft(value, count) {
  return ((value << count) | (value >>> (32 - count))) >>> 0;
}

export class SeededRandom {
  constructor(seed) {
    this.seed = String(seed);
    this.state = seedWords(this.seed);
  }

  nextUint32() {
    const state = this.state;
    const result = Math.imul(rotateLeft(Math.imul(state[1], 5) >>> 0, 7), 9) >>> 0;
    const shifted = (state[1] << 9) >>> 0;
    state[2] ^= state[0];
    state[3] ^= state[1];
    state[1] ^= state[2];
    state[0] ^= state[3];
    state[2] ^= shifted;
    state[3] = rotateLeft(state[3], 11);
    return result;
  }

  next() {
    return this.nextUint32() / 0x100000000;
  }

  nextInt(limit) {
    if (!Number.isInteger(limit) || limit <= 0 || limit > 0x100000000) {
      throw new RangeError(`Invalid random integer limit: ${limit}`);
    }
    const range = 0x100000000;
    const ceiling = Math.floor(range / limit) * limit;
    let value;
    do value = this.nextUint32(); while (value >= ceiling);
    return value % limit;
  }
}

function randomIndex(random, limit) {
  if (typeof random?.nextInt === "function") return random.nextInt(limit);
  const value = typeof random === "function" ? random() : random.next();
  return Math.floor(value * limit);
}

export class Bag63Randomizer {
  constructor(random = Math.random) {
    this.random = random;
    this.bag = [];
  }

  refill() {
    this.bag = PIECE_TYPES.flatMap((type) => Array(9).fill(type));
    for (let i = this.bag.length - 1; i > 0; i -= 1) {
      const j = randomIndex(this.random, i + 1);
      [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
    }
  }

  next() {
    if (this.bag.length === 0) this.refill();
    return this.bag.pop();
  }
}

export class SeededBag63Randomizer extends Bag63Randomizer {
  constructor(seed) {
    const random = new SeededRandom(seed);
    super(random);
    this.seed = String(seed);
    this.seededRandom = random;
  }
}

export function seededBagSequence(seed, length) {
  if (!Number.isInteger(length) || length < 0) throw new RangeError(`Invalid sequence length: ${length}`);
  const randomizer = new SeededBag63Randomizer(seed);
  return Array.from({ length }, () => randomizer.next());
}

export class SequenceRandomizer {
  constructor(sequence) {
    if (!Array.isArray(sequence) || sequence.length === 0) {
      throw new Error("SequenceRandomizer needs at least one piece");
    }
    this.sequence = [...sequence];
    this.index = 0;
  }

  next() {
    const value = this.sequence[this.index % this.sequence.length];
    this.index += 1;
    return value;
  }
}
