#!/usr/bin/env node
// Local command-line adapter for the browser practice ports. This is not an
// event server: it runs one fresh local session and awards only the public
// practice reward.
import readline from 'node:readline';
import { webcrypto } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { PORTS, REWARD, validateVariant } from '../assets/js/challenge-practice/engine.mjs';

const args = process.argv.slice(2);
if (args[0] === '--help' || args[0] === '-h') {
  process.stdout.write('Usage: node script/challenge-practice-cli.mjs RUNTIME [--variant released|corrected]\n');
  process.stdout.write(`RUNTIME: ${Object.keys(PORTS).join(', ')}\n`);
  process.exit(0);
}
const runtime = args[0];
let variant;
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--variant' && i + 1 < args.length) variant = args[++i];
  else if (args[i] === '--help' || args[i] === '-h') {
    process.stdout.write('Usage: node script/challenge-practice-cli.mjs RUNTIME [--variant released|corrected]\n');
    process.stdout.write(`RUNTIME: ${Object.keys(PORTS).join(', ')}\n`);
    process.exit(0);
  } else {
    process.stderr.write(`Unknown option: ${args[i]}\n`);
    process.exit(2);
  }
}
if (!runtime) {
  process.stderr.write('Usage: node script/challenge-practice-cli.mjs RUNTIME [--variant released|corrected]\n');
  process.exit(2);
}
let selected;
try { selected = validateVariant(runtime, variant); }
catch (error) { process.stderr.write(`${error.message}\n`); process.exit(2); }

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
let waiting = null;
let queued = [];
let closed = false;
let deadlineTimer = null;
let stopped = false;
const failRead = error => {
  const request = waiting;
  waiting = null;
  request?.reject(error);
};
input.on('line', line => {
  const request = waiting;
  if (request) {
    waiting = null;
    request.resolve(line);
  } else queued.push(line);
});
input.on('close', () => {
  closed = true;
  failRead(new Error('Connection closed by client.'));
});

const randomBytes = size => {
  if (!Number.isSafeInteger(size) || size < 0) throw new RangeError('Invalid entropy length.');
  const bytes = new Uint8Array(size);
  for (let offset = 0; offset < size; offset += 65536) {
    webcrypto.getRandomValues(bytes.subarray(offset, Math.min(offset + 65536, size)));
  }
  return bytes;
};
const randomBelow = bound => {
  if (typeof bound !== 'bigint' || bound <= 0n) throw new RangeError('Positive BigInt bound required.');
  const bits = bound.toString(2).length;
  const bytesNeeded = Math.ceil(bits / 8);
  for (;;) {
    const bytes = randomBytes(bytesNeeded);
    bytes[0] &= 255 >>> (bytesNeeded * 8 - bits);
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    if (value < bound) return value;
  }
};
const io = Object.freeze({
  reward: REWARD,
  read(prompt = '') {
    if (stopped) return Promise.reject(new Error('Session stopped.'));
    process.stdout.write(String(prompt));
    if (waiting) return Promise.reject(new Error('Concurrent reads are unsupported.'));
    if (queued.length) return Promise.resolve(queued.shift());
    if (closed) return Promise.reject(new Error('Connection closed by client.'));
    return new Promise((resolve, reject) => { waiting = { resolve, reject }; });
  },
  write(text) { process.stdout.write(`${String(text)}\n`); },
  win(text = REWARD) { process.stdout.write(`${String(text)}\n`); },
  randomBytes,
  randomBelow,
  now() { return performance.now() / 1000; },
  setDeadline(seconds) {
    if (deadlineTimer !== null) clearTimeout(deadlineTimer);
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Invalid deadline.');
    deadlineTimer = setTimeout(() => {
      stopped = true;
      failRead(new Error('Challenge deadline expired.'));
      input.close();
    }, seconds * 1000);
    deadlineTimer.unref?.();
  },
  status(text) { process.stderr.write(`[setup] ${String(text)}\n`); },
});

try {
  const portPath = PORTS[runtime].replace(/^\.\//, '');
  const module = await import(new URL(`../assets/js/challenge-practice/${portPath}`, import.meta.url));
  await module.run(io, runtime === 'law-and-order' ? { variant: selected } : {});
} catch (error) {
  if (!stopped) {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  }
} finally {
  stopped = true;
  if (deadlineTimer !== null) clearTimeout(deadlineTimer);
  input.close();
}
