// Browser port of the zh3r0 CTF 2021 "chaos" challenge.
// Derived from assets/challenges/zh3r0-2021-chaos/challenge.py.
import { fromHex } from '../lib/bytes.mjs';

export function rotateLeft(value, bits) {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}
export function rotateRight(value, bits) {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

export function pad(text) {
  if (text.length > 0xffffffff) throw Error('integer too big to convert');
  const length = text.length + 1, remainder = length % 64;
  const zeroes = remainder <= 60 ? 60 - remainder : 124 - remainder;
  const result = new Uint8Array(length + zeroes + 4);
  result.set(text);
  result[text.length] = 0x80;
  new DataView(result.buffer).setUint32(result.length - 4, text.length, false);
  return result;
}

export function mix(X, Y, Z, U) {
  return [
    ((X & 0xffff) * (0xffff - (Y >>> 16)) ^ rotateLeft(Z, 1) ^ rotateRight(U, 1) ^ 0x401ab257) >>> 0,
    ((Y & 0xffff) * (0xffff - (Z >>> 16)) ^ rotateLeft(U, 2) ^ rotateRight(X, 2) ^ 0xb7cd34e1) >>> 0,
    ((Z & 0xffff) * (0xffff - (U >>> 16)) ^ rotateLeft(X, 3) ^ rotateRight(Y, 3) ^ 0x76b3a27c) >>> 0,
    ((U & 0xffff) * (0xffff - (X >>> 16)) ^ rotateLeft(Y, 4) ^ rotateRight(Z, 4) ^ 0xf13c3adf) >>> 0,
  ];
}

export function hash(text) {
  const bytes = pad(text), words = new DataView(bytes.buffer);
  let state = [0x0124fdce, 0x89ab57ea, 0xba89370a, 0xfedc45ef];
  const result = [0xe12f23cd, 0xc5ab6789, 0xf1234567, 0x9a8bc7ef];
  let inputs;
  const absorb = () => {
    state = mix(...inputs);
    for (let j = 0; j < 4; j++) result[j] = (result[j] ^ state[j]) >>> 0;
  };
  for (let i = 0; i < bytes.length; i += 16) {
    inputs = state.map((v, j) => (words.getUint32(i + 4 * j, false) ^ v) >>> 0);
    absorb();
  }
  // The original reuses X/Y/Z/U, not the newly assigned x/y/z/u. These four
  // identical XORs cancel; keep the actual final loop rather than "fixing" it.
  for (let i = 0; i < 4; i++) absorb();
  const out = new Uint8Array(16), view = new DataView(out.buffer);
  result.forEach((v, i) => view.setUint32(i * 4, v, false));
  return out;
}

const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
export function isCollision(first, second) {
  return !equal(first, second) && equal(hash(first), hash(second));
}

export async function run(io, options = {}) {
  try {
    const first = fromHex(await io.read('input first string to hash : '));
    const second = fromHex(await io.read('input second string to hash : '));
    if (isCollision(first, second)) io.win();
    else io.write('Never gonna give you up');
  } catch {
    io.write('Never gonna let you down');
  }
}
