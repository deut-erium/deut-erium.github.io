// Lifecycle-only fixture, not a port or a port integration substitute.
import { parentPort, workerData } from 'node:worker_threads';
parentPort.on('message', data => {
  if (data.type !== 'start') return;
  const emit = (type, fields) => parentPort.postMessage({ type, session: data.session, op: data.op, ...fields });
  emit('status', { text: 'CPU fixture entered.' });
  if (workerData.deadline) emit('deadline', { expiresAt: performance.timeOrigin + performance.now() + 80 });
  for (;;) { /* No timers or message handling can interrupt this worker. */ }
});
