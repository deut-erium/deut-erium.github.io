// Offline browser-global bridge. It imports the production Worker unchanged.
import { parentPort } from 'node:worker_threads';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
const listeners = new Map(), queued = [];
let ready = false;
globalThis.addEventListener = (type, listener) => {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(listener);
};
globalThis.postMessage = message => parentPort.postMessage(message);
const dispatch = (type, data) => {
  for (const listener of listeners.get(type) || []) listener({ data });
};
parentPort.on('message', data => {
  if (ready) dispatch('message', data);
  else queued.push(data);
});
parentPort.on('messageerror', error => dispatch('messageerror', error));
await import('../../../assets/js/challenge-practice/worker.mjs');
ready = true;
for (const data of queued) dispatch('message', data);
queued.length = 0;
