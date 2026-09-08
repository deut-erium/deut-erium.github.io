// Carry the include's content version into this adapter's module imports.
const dependency = file => import(new URL(file + new URL(import.meta.url).search, import.meta.url));
const engine = dependency('./policies.mjs');

// No referee, secret, actual spent/remaining allowance, seed or RNG is imported.
// The only game data in this envelope is the referee's public solverView.
export async function answerRequest(message) {
  const { chooseGuess } = await engine;
  const { sessionId, requestId, generation, policy, solverView } = message;
  if (sessionId !== solverView?.sessionId || typeof sessionId !== 'string'
    || !Number.isSafeInteger(requestId) || !Number.isSafeInteger(generation)) {
    throw new Error('Invalid worker correlation IDs');
  }
  const allowed = ['sessionId', 'config', 'mode', 'lieBudget', 'noise', 'phase', 'turns'];
  if (Object.keys(solverView).some(key => !allowed.includes(key))) throw new Error('Private or unknown solver fields');
  const envelope = { sessionId, requestId, generation };
  try {
    return { ...envelope, result: chooseGuess(solverView, policy) };
  } catch (error) {
    return { ...envelope, error: error.message };
  }
}

if (typeof self !== 'undefined' && typeof document === 'undefined') {
  // Install the handler before any asynchronous import completes. Otherwise an
  // immediately posted first request can arrive during module loading and vanish.
  self.onmessage = async event => {
    try { self.postMessage(await answerRequest(event.data)); }
    catch { self.postMessage({ error: 'Malformed worker request' }); }
  };
  self.postMessage({ type: 'ready' });
}
