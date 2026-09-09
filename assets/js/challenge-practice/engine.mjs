// Shared wire limits and text handling. This module never imports a port.
export const LIMITS = Object.freeze({
  line: 2 * 1024 * 1024,
  batch: 4 * 1024 * 1024,
  lines: 4096,
  output: 8 * 1024 * 1024,
  transcript: 1024 * 1024,
  chunk: 16 * 1024,
  status: 1024,
});
export const REWARD = 'practice{local_dummy_reward}';
export const PORTS = Object.freeze({
  'b00tleg': './ports/b00tleg.mjs',
  'blokechain': './ports/blokechain.mjs',
  'chaos': './ports/chaos.mjs',
  'cheater-mind': './ports/cheater-mind.mjs',
  'desfunctional': './ports/desfunctional.mjs',
  'diffecient': './ports/diffecient.mjs',
  'diffecientwo': './ports/diffecientwo.mjs',
  'idea': './ports/idea.mjs',
  'law-and-order': './ports/law-and-order.mjs',
  'randsubware': './ports/randsubware.mjs',
  'real-mersenne': './ports/real-mersenne.mjs',
});

export function validateVariant(runtime, variant) {
  if (!Object.hasOwn(PORTS, runtime)) throw new Error('Unknown browser challenge.');
  const selected = variant ?? (runtime === 'law-and-order' ? 'corrected' : 'default');
  if (!(runtime === 'law-and-order' ? ['corrected', 'released'] : ['default']).includes(selected)) {
    throw new Error('Unsupported challenge variant.');
  }
  return selected;
}

// Count UTF-8 bytes without allocating an encoded copy. Lone surrogates count
// as the replacement character, as in TextEncoder and browser textarea values.
export function utf8Length(text, limit = Infinity) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes++;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length &&
             text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
      bytes += 4;
      i++;
    } else bytes += 3;
    if (bytes > limit) return bytes;
  }
  return bytes;
}

export function normalizeInput(input) {
  const lines = [];
  let bytes = 0;
  const add = line => {
    if (typeof line !== 'string' || line.includes('\n')) throw new TypeError('Each input line must be a string without LF.');
    if (lines.length >= LIMITS.lines) throw new RangeError('Input exceeds 4096 lines.');
    if (line.length > LIMITS.line || utf8Length(line, LIMITS.line) > LIMITS.line) {
      throw new RangeError('Input line exceeds 2 MiB (UTF-8).');
    }
    bytes += utf8Length(line) + (lines.length ? 1 : 0);
    if (bytes > LIMITS.batch) throw new RangeError('Input batch exceeds 4 MiB (UTF-8).');
    lines.push(line);
  };
  if (Array.isArray(input)) {
    if (!input.length || input.length > LIMITS.lines) throw new RangeError('Send between 1 and 4096 lines.');
    for (const line of input) add(line);
  } else if (typeof input === 'string') {
    // The final LF terminates a line; it does not introduce an extra blank line.
    // CRLF is accepted. A bare CR is preserved as part of a line.
    if (input.length > LIMITS.batch + LIMITS.lines + 1) throw new RangeError('Input batch exceeds 4 MiB (UTF-8).');
    let start = 0, end;
    while ((end = input.indexOf('\n', start)) !== -1) {
      add(input.slice(start, end > start && input[end - 1] === '\r' ? end - 1 : end));
      start = end + 1;
    }
    if (start < input.length || !lines.length) add(input.slice(start));
  } else throw new TypeError('Send a string or an array of lines.');
  return lines;
}

export const TRUNCATION_NOTICE = '[Earlier output truncated: browser transcript limit is 1 MiB.]\n';

// A bounded tail of the transcript, including the visible truncation notice.
// Dropping chunks avoids repeatedly encoding/copying the entire textarea.
export class Transcript {
  constructor() { this.clear(); }
  clear() { this.chunks = []; this.bytes = 0; this.truncated = false; }
  append(text) {
    if (!text) return;
    const bytes = utf8Length(text);
    this.chunks.push({ text, bytes });
    this.bytes += bytes;
    if (this.bytes > LIMITS.transcript) this.truncated = true;
    const cap = LIMITS.transcript - (this.truncated ? utf8Length(TRUNCATION_NOTICE) : 0);
    while (this.bytes > cap) {
      const first = this.chunks[0], excess = this.bytes - cap;
      if (first.bytes <= excess) {
        this.chunks.shift();
        this.bytes -= first.bytes;
      } else {
        let cut = 0, removed = 0;
        while (removed < excess) {
          const point = first.text.codePointAt(cut);
          removed += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
          cut += point > 0xffff ? 2 : 1;
        }
        first.text = first.text.slice(cut);
        first.bytes -= removed;
        this.bytes -= removed;
      }
    }
  }
  toString() { return (this.truncated ? TRUNCATION_NOTICE : '') + this.chunks.map(c => c.text).join(''); }
}

export function monotonicMilliseconds() {
  return performance.timeOrigin + performance.now();
}
