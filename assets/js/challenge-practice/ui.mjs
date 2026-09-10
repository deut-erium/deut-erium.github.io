import { createPracticeClient } from './client.mjs';
import { Transcript, validateVariant } from './engine.mjs';

export const STORAGE_KEY = 'deuterium-browser-practice-v1';

// Never cache the storage getter: even accessing localStorage can throw.
export function createCompletionStore(getStorage = () => globalThis.localStorage) {
  const read = () => {
    try {
      const parsed = JSON.parse(getStorage()?.getItem(STORAGE_KEY) || '{}');
      const records = Object.create(null);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          if (Number.isFinite(value) && value > 0) records[key] = value;
        }
      }
      return records;
    } catch { return Object.create(null); }
  };
  return Object.freeze({
    has(id, variant) { return Object.hasOwn(read(), `${id}:${variant}`); },
    mark(id, variant) {
      try {
        const records = read();
        records[`${id}:${variant}`] = Date.now();
        const storage = getStorage();
        if (!storage) return false;
        storage.setItem(STORAGE_KEY, JSON.stringify(records));
        return true;
      } catch { return false; }
    },
  });
}

export function mountPractice(root) {
  const control = name => root.querySelector(`[data-practice-${name}]`);
  const start = control('start'), stop = control('stop'), reset = control('reset');
  const send = control('send'), input = control('input'), output = control('output');
  const status = control('status'), variant = control('variant'), form = root.querySelector('form');
  const runtime = root.dataset.runtime, id = root.dataset.id;
  if (![start, stop, reset, send, input, output, status, variant, form].every(Boolean)) return null;
  if (typeof Worker !== 'function' || !globalThis.crypto?.getRandomValues || !globalThis.crypto?.subtle ||
      !['http:', 'https:'].includes(globalThis.location?.protocol)) return null;
  try { validateVariant(runtime, variant.value); if (!id) throw new Error('Missing challenge ID.'); }
  catch (error) { status.textContent = error.message; return null; }

  const transcript = new Transcript(), store = createCompletionStore();
  let frame = null, saved = false, completionStored = null, generation = 0;
  const storageNotice = () => completionStored === false ? ' Device storage is unavailable.' : '';
  const render = () => {
    frame = null;
    const atBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 32;
    output.value = transcript.toString();
    if (atBottom) output.scrollTop = output.scrollHeight;
  };
  const scheduleRender = () => { if (frame === null) frame = requestAnimationFrame(render); };
  const client = createPracticeClient({ runtime, onEvent(event) {
    const active = event.state === 'running' || event.state === 'awaiting-input';
    start.disabled = active;
    stop.disabled = !active;
    reset.disabled = false;
    variant.disabled = active;
    input.disabled = event.state !== 'awaiting-input';
    send.disabled = input.disabled;
    if (event.type === 'clear') {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      transcript.clear();
      output.value = '';
      input.value = '';
      saved = false;
      completionStored = null;
    } else if (event.type === 'output') {
      transcript.append(event.text);
      scheduleRender();
    } else if (event.type === 'win') {
      if (!saved) {
        saved = true;
        completionStored = store.mark(id, event.variant);
        status.textContent = completionStored ? 'Practice complete; saved on this device.' : 'Practice complete; device storage is unavailable.';
      }
    } else if (event.type === 'status') {
      if (!event.solved) status.textContent = event.text;
    } else if (event.type === 'error') {
      // Runtime failures are separate from unmodified program output.
      status.textContent = `${event.message}${event.solved ? ' Practice completed in this session.' : ''}`;
    } else if (event.type === 'state') {
      if (event.state === 'idle') {
        status.textContent = store.has(id, variant.value) ? 'Ready. This version has saved practice completion.' : 'Ready. Choose Start to run the challenge.';
      } else if (event.state === 'running') status.textContent = 'Running. Stop remains available during computation.';
      else if (event.state === 'awaiting-input') status.textContent = event.solved ? `Practice complete. The program is still waiting for input.${storageNotice()}` : 'Waiting for input.';
      else status.textContent = event.solved ? `Session ended. Practice complete.${storageNotice()}` : 'Session ended without practice completion.';
    }
  } });

  // Promise errors from a superseded session must not replace the new status.
  const invoke = async (method, argument) => {
    if (method !== 'send') generation++;
    const current = generation;
    try { return await client[method](argument); }
    catch (error) {
      if (current === generation && !error.result) status.textContent = error.message;
      throw error;
    }
  };
  const noArguments = (args, method) => {
    if (args.length) return Promise.reject(new TypeError(`${method} takes no arguments; use the version selector.`));
    return invoke(method, method === 'start' ? variant.value : undefined);
  };
  const api = Object.freeze({
    start: (...args) => noArguments(args, 'start'),
    send: (...args) => args.length === 1 ? invoke('send', args[0]) : Promise.reject(new TypeError('send takes one string or array of lines.')),
    stop: (...args) => noArguments(args, 'stop'),
    reset: (...args) => noArguments(args, 'reset'),
  });
  start.addEventListener('click', () => { api.start().catch(() => {}); });
  stop.addEventListener('click', () => { api.stop().catch(() => {}); });
  reset.addEventListener('click', () => { api.reset().catch(() => {}); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (send.disabled) return;
    const text = input.value, current = generation;
    // Keep rejected input available for correction. Do not clear a later edit.
    api.send(text).then(() => {
      if (current === generation && input.value === text) input.value = '';
    }, () => {});
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      if (!send.disabled) form.requestSubmit();
    }
  });
  variant.addEventListener('change', () => { api.reset().catch(() => {}); });
  // No port or Worker has been loaded. This reset only enables the controls.
  output.disabled = false;
  api.reset().catch(() => {});
  globalThis.addEventListener('pagehide', () => {
    generation++;
    client.reset();
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  });
  return api;
}

if (typeof document !== 'undefined') {
  const root = document.querySelector('[data-challenge-practice]');
  if (root) {
    const api = mountPractice(root);
    if (api) window.challengePractice = api;
  }
}
