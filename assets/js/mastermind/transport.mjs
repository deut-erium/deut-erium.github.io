export function createSolverClient({ url, workerFactory = value => new Worker(value, { type: 'module' }),
  timeoutMs = 15000 } = {}) {
  let generation = 0;
  let requestId = 0;
  let active = null;
  let worker = null;
  let ready = false;
  const abort = () => new DOMException('Computation cancelled', 'AbortError');
  function terminate() {
    if (!worker) return;
    worker.onmessage = worker.onerror = worker.onmessageerror = null;
    worker.terminate();
    worker = null;
    ready = false;
  }
  function settle(job, error, value) {
    if (active !== job) return;
    active = null;
    clearTimeout(job.timer);
    if (error) terminate();
    if (error) job.reject(error); else job.resolve(value);
  }
  function send(job) {
    if (!ready || job.sent || active !== job) return;
    job.sent = true;
    try { worker.postMessage(job.message); }
    catch (error) { settle(job, error); }
  }
  function startWorker() {
    const instance = workerFactory(url);
    worker = instance;
    instance.onmessage = event => {
      // This check rejects even a captured callback invoked after termination.
      if (worker !== instance) return;
      const data = event.data;
      if (data?.type === 'ready') {
        ready = true;
        if (active) send(active);
        return;
      }
      const job = active;
      if (!job || !job.sent || job.generation !== generation
        || data?.generation !== job.generation || data?.requestId !== job.requestId
        || data?.sessionId !== job.sessionId) return;
      if (data.error) settle(job, new Error(String(data.error)));
      else if (!data.result || !Array.isArray(data.result.guess)) settle(job, new Error('Malformed solver response'));
      else settle(job, null, data.result);
    };
    const fail = message => {
      if (worker !== instance) return;
      if (active) settle(active, new Error(message)); else terminate();
    };
    instance.onerror = event => { event.preventDefault?.(); fail('Solver worker failed; retry the turn'); };
    instance.onmessageerror = () => fail('Unreadable solver response');
  }
  return Object.freeze({
    busy: () => active !== null,
    cancel() {
      generation++;
      if (active) settle(active, abort());
      // Cancellation also destroys an idle worker retained from the last turn.
      terminate();
    },
    request(solverView, policy) {
      if (active) return Promise.reject(new Error('A solver turn is already in flight'));
      return new Promise((resolve, reject) => {
        const job = { resolve, reject, generation, requestId: ++requestId,
          sessionId: solverView.sessionId, timer: null, sent: false };
        job.message = { sessionId: job.sessionId, requestId: job.requestId,
          generation: job.generation, policy, solverView };
        active = job;
        job.timer = setTimeout(() => settle(job, new Error('Solver exceeded its 15-second limit; retry or reset')), timeoutMs);
        try {
          // One reusable worker avoids repeatedly downloading and starting a
          // module graph during a 60-guess save validation. Turns stay serial.
          if (!worker) startWorker();
          send(job);
        } catch (error) { settle(job, error); }
      });
    },
  });
}
