import { LIMITS, PORTS, REWARD, validateVariant, normalizeInput, utf8Length, monotonicMilliseconds } from './engine.mjs';

// One worker, one run(io), no restart or caller-defined modules/rewards/state.
// Exported only so a local worker_threads bridge can exercise this exact code.
export function attachPracticeWorker(scope) {
  let session, operation, started = false, ended = false, solved = false;
  let queued = [], cursor = 0, reader = null, output = '', outputBytes = 0;
  let lastStatusAt = -Infinity;
  const emit = (type, extra = {}) => scope.postMessage({ type, session, op: operation?.id, ...extra });
  const flush = () => {
    if (output) emit('output', { text: output });
    output = '';
    outputBytes = 0;
  };
  const checkAlive = () => { if (ended) throw new Error('Session ended.'); };
  const fail = error => {
    if (ended) return;
    ended = true;
    flush();
    queued = [];
    reader = null;
    emit('error', { message: String(error?.message ?? error).slice(0, LIMITS.status), solved });
  };
  const append = text => {
    checkAlive();
    const bytes = utf8Length(text, LIMITS.output);
    if (!operation || bytes > LIMITS.output - operation.bytes) {
      const error = new RangeError('Output exceeds the browser limit of 8 MiB per operation.');
      fail(error);
      throw error;
    }
    operation.bytes += bytes;
    // Split only at code point boundaries; each wire message is bounded too.
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + LIMITS.chunk / 4, text.length);
      const c = text.charCodeAt(end - 1);
      if (end < text.length && c >= 0xd800 && c <= 0xdbff &&
          text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff) end--;
      const part = text.slice(start, end), size = utf8Length(part);
      if (outputBytes + size > LIMITS.chunk) flush();
      output += part;
      outputBytes += size;
      start = end;
    }
  };
  const boundary = state => {
    flush();
    emit('result', { state, solved });
    operation = null;
  };
  const randomBytes = n => {
    checkAlive();
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('Invalid entropy length.');
    const bytes = new Uint8Array(n);
    for (let offset = 0; offset < n; offset += 65536) {
      crypto.getRandomValues(bytes.subarray(offset, Math.min(offset + 65536, n)));
    }
    return bytes;
  };
  const io = Object.freeze({
    reward: REWARD,
    write(text) { append(String(text) + '\n'); },
    read(prompt = '') {
      checkAlive();
      if (reader) throw new Error('Concurrent port reads are unsupported.');
      append(String(prompt));
      if (cursor < queued.length) return Promise.resolve(queued[cursor++]);
      queued = [];
      cursor = 0;
      return new Promise(resolve => {
        reader = resolve;
        boundary('awaiting-input');
      });
    },
    win(text = REWARD) {
      append(String(text) + '\n');
      flush();
      solved = true;
      emit('win');
    },
    randomBytes,
    randomBelow(n) {
      if (typeof n !== 'bigint' || n <= 0n) throw new RangeError('Positive BigInt bound required.');
      const bits = n.toString(2).length, length = Math.ceil(bits / 8);
      for (;;) {
        const bytes = randomBytes(length);
        bytes[0] &= 255 >>> (length * 8 - bits);
        let value = 0n;
        for (const byte of bytes) value = (value << 8n) | BigInt(byte);
        if (value < n) return value;
      }
    },
    now() { return performance.now() / 1000; },
    setDeadline(seconds) {
      checkAlive();
      if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(seconds * 1000)) throw new RangeError('Invalid deadline.');
      flush();
      emit('deadline', { expiresAt: seconds === 0 ? null : monotonicMilliseconds() + seconds * 1000 });
    },
    status(text) {
      checkAlive();
      // Progress is not program output. At most four progress updates/second.
      const now = performance.now();
      if (now - lastStatusAt < 250) return;
      lastStatusAt = now;
      flush();
      emit('status', { text: String(text).slice(0, LIMITS.status) });
    },
  });

  scope.addEventListener('message', event => {
    const data = event.data;
    if (!data || typeof data !== 'object' || ended) return;
    if (started && data.session !== session) return;
    try {
      if (data.type === 'start' && !started) {
        started = true;
        session = data.session;
        operation = { id: data.op, bytes: 0 };
        if (!Number.isSafeInteger(session) || !Number.isSafeInteger(data.op)) throw new Error('Invalid session identifiers.');
        const variant = validateVariant(data.runtime, data.variant);
        const url = new URL(PORTS[data.runtime], import.meta.url);
        if (url.origin !== new URL(import.meta.url).origin) throw new Error('Port must be same-origin.');
        // Import happens only after a validated explicit start message.
        import(url.href).then(module => module.run(io, data.runtime === 'law-and-order' ? { variant } : {}))
          .then(() => {
            if (ended) return;
            ended = true;
            queued = [];
            boundary('end');
          }, fail);
      } else if (data.type === 'send' && started && reader && !operation) {
        operation = { id: data.op, bytes: 0 };
        if (!Number.isSafeInteger(data.op)) throw new Error('Invalid operation identifier.');
        queued = normalizeInput(data.lines);
        cursor = 1;
        const resume = reader;
        reader = null;
        resume(queued[0]);
      } else throw new Error('Unexpected or concurrent Worker operation.');
    } catch (error) { fail(error); }
  });
  scope.addEventListener('messageerror', () => fail(new Error('Worker could not decode the request.')));
}

if (typeof document === 'undefined' && typeof globalThis.addEventListener === 'function' && typeof globalThis.postMessage === 'function') {
  attachPracticeWorker(globalThis);
}
