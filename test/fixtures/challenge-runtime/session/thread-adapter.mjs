import { Worker } from 'node:worker_threads';

export class ThreadAdapter {
  constructor(url = new URL('./browser-worker-bridge.mjs', import.meta.url), workerData) {
    this.listeners = new Map();
    this.terminated = false;
    this.messages = [];
    this.worker = new Worker(url, { workerData });
    this.exited = new Promise(resolve => this.worker.once('exit', resolve));
    this.worker.on('message', data => {
      this.messages.push(data.type === 'output' ? { ...data, text: data.text.slice(0, 200) } : data);
      this.emit('message', { data });
    });
    this.worker.on('messageerror', error => this.emit('messageerror', { error }));
    this.worker.on('error', error => this.emit('error', { message: error.message }));
    this.worker.on('exit', code => {
      if (!this.terminated) this.emit('error', { message: `Worker exited unexpectedly (${code}).` });
    });
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  emit(type, event) { for (const handler of this.listeners.get(type) || []) handler(event); }
  postMessage(data) { this.worker.postMessage(data); }
  terminate() { this.terminated = true; return this.worker.terminate(); }
  get listenerCount() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
}
