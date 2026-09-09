import { LIMITS, validateVariant, normalizeInput, utf8Length, monotonicMilliseconds } from './engine.mjs';

export const WORKER_URL = new URL('./worker.mjs', import.meta.url);

function browserWorker(url) {
  if (!globalThis.location || !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== globalThis.location.origin) throw new Error('Browser practice requires a same-origin module Worker.');
  return new Worker(url, { type: 'module', name: 'challenge-practice' });
}

function operationError(message, name = 'Error', result) {
  const error = new Error(message);
  error.name = name;
  if (result) error.result = result;
  return error;
}

// The factory seam is for offline lifecycle/worker_threads tests. The window
// facade does not expose it, module paths, rewards, entropy or port options.
export function createPracticeClient({ runtime, onEvent = () => {}, createWorker = browserWorker }) {
  validateVariant(runtime);
  let worker = null, handlers = null, timer = null, deadline = null;
  let session = 0, op = 0, pending = null;
  let state = 'idle', solved = false, variant = validateVariant(runtime);

  const snapshot = (output = '') => ({ output, state, solved });
  const notify = (type, extra = {}) => {
    // A view callback must not strand a request or disable the deadline.
    try { onEvent({ type, state, solved, variant, session, ...extra }); } catch { /* view failure */ }
  };
  const clearDeadline = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    deadline = null;
  };
  const dispose = () => {
    clearDeadline();
    const old = worker;
    worker = null;
    if (old) {
      if (handlers) for (const [type, handler] of Object.entries(handlers)) old.removeEventListener(type, handler);
      // Worker.terminate is synchronous in browsers, a Promise in the bridge.
      try { const result = old.terminate(); result?.catch?.(() => {}); } catch { /* already terminated */ }
    }
    handlers = null;
  };
  const terminate = (message, name = 'Error') => {
    const request = pending;
    pending = null;
    state = 'end';
    dispose();
    const result = snapshot(request ? request.chunks.join('') : '');
    const error = operationError(message, name, result);
    notify('error', { message, name });
    request?.reject(error);
    return result;
  };
  const armDeadline = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (deadline === null) return;
    const remaining = deadline - monotonicMilliseconds();
    if (remaining <= 0) { terminate('Challenge deadline expired.', 'TimeoutError'); return; }
    const current = session;
    timer = setTimeout(() => {
      timer = null;
      if (worker && current === session) armDeadline();
    }, Math.min(remaining, 2147483647));
  };
  const begin = () => {
    state = 'running';
    const promise = new Promise((resolve, reject) => { pending = { id: ++op, chunks: [], bytes: 0, resolve, reject }; });
    notify('state');
    return promise;
  };
  const post = data => {
    try { worker.postMessage({ ...data, session, op: pending.id }); }
    catch (error) { terminate(`Could not send Worker request: ${error.message}`); }
  };
  const receive = data => {
    if (!data || data.session !== session) return;
    if (deadline !== null && monotonicMilliseconds() >= deadline) {
      terminate('Challenge deadline expired.', 'TimeoutError');
      return;
    }
    if (!pending || data.op !== pending.id) {
      // An error can occur while the worker is waiting for input.
      if (data.type === 'error' && data.op == null) terminate(String(data.message).slice(0, LIMITS.status));
      return;
    }
    switch (data.type) {
      case 'output': {
        if (typeof data.text !== 'string' || data.text.length > LIMITS.chunk ||
            utf8Length(data.text, LIMITS.chunk) > LIMITS.chunk) {
          terminate('Invalid or oversized Worker output.');
          return;
        }
        const size = utf8Length(data.text);
        if (size > LIMITS.output - pending.bytes) {
          terminate('Output exceeds the browser limit of 8 MiB per operation.');
          return;
        }
        pending.bytes += size;
        pending.chunks.push(data.text);
        notify('output', { text: data.text });
        break;
      }
      case 'status':
        if (typeof data.text !== 'string') { terminate('Invalid Worker status.'); return; }
        notify('status', { text: data.text.slice(0, LIMITS.status) });
        break;
      case 'deadline':
        if (data.expiresAt !== null && !Number.isFinite(data.expiresAt)) { terminate('Invalid Worker deadline.'); return; }
        deadline = data.expiresAt;
        armDeadline();
        break;
      case 'win':
        solved = true;
        notify('win');
        break;
      case 'result': {
        if (!['awaiting-input', 'end'].includes(data.state) || data.solved !== solved) {
          terminate('Invalid Worker result.');
          return;
        }
        const request = pending;
        pending = null;
        state = data.state;
        if (state === 'end') dispose();
        const result = snapshot(request.chunks.join(''));
        notify('state');
        request.resolve(result);
        break;
      }
      case 'error':
        terminate(typeof data.message === 'string' ? data.message.slice(0, LIMITS.status) : 'Worker failed.');
        break;
      default: terminate('Unknown Worker response.');
    }
  };

  return Object.freeze({
    get state() { return state; },
    get solved() { return solved; },
    start(selectedVariant) {
      if (pending || worker) return Promise.reject(operationError('Session is active; stop or reset before starting again.', 'InvalidStateError'));
      try { variant = validateVariant(runtime, selectedVariant); }
      catch (error) { return Promise.reject(error); }
      session++;
      solved = false;
      notify('clear');
      const promise = begin();
      try {
        // Reconstruct the URL so consumers cannot mutate the exported URL object.
        const url = new URL('./worker.mjs', import.meta.url);
        if (url.origin !== new URL(import.meta.url).origin) throw new Error('Worker must be same-origin.');
        const current = session;
        worker = createWorker(url);
        const activeWorker = worker;
        const live = () => worker === activeWorker && session === current;
        handlers = {
          message: event => { if (live()) receive(event.data); },
          error: event => {
            if (!live()) return;
            event.preventDefault?.();
            terminate(`Worker failed: ${String(event.message || 'script error').slice(0, LIMITS.status)}`);
          },
          messageerror: () => { if (live()) terminate('Could not decode Worker response.'); },
        };
        for (const [type, handler] of Object.entries(handlers)) worker.addEventListener(type, handler);
        post({ type: 'start', runtime, variant });
      } catch (error) { terminate(`Could not start Worker: ${error.message}`); }
      return promise;
    },
    send(input) {
      if (pending || state !== 'awaiting-input' || !worker) return Promise.reject(operationError('Send requires an idle input prompt; concurrent operations are rejected.', 'InvalidStateError'));
      let lines;
      try { lines = normalizeInput(input); } catch (error) { return Promise.reject(error); }
      const promise = begin();
      post({ type: 'send', lines });
      return promise;
    },
    stop() {
      if (!worker && !pending) return Promise.resolve(snapshot());
      return Promise.resolve(terminate('Session stopped.', 'AbortError'));
    },
    reset() {
      const request = pending;
      pending = null;
      // Invalidate before termination; queued callbacks cannot reach the view.
      session++;
      dispose();
      state = 'idle';
      solved = false;
      request?.reject(operationError('Session reset.', 'AbortError', snapshot(request.chunks.join(''))));
      notify('clear');
      notify('state');
      return Promise.resolve(snapshot());
    },
  });
}
