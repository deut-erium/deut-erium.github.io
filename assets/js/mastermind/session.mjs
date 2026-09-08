// Carry the include's content version into this adapter's module imports.
const dependency = file => import(new URL(file + new URL(import.meta.url).search, import.meta.url));
const { createGame } = await dependency('./referee.mjs');
const { code, integer, reply, sameCode } = await dependency('./core.mjs');
const { chooseGuess, checkDimensions, checkPolicy, QUERY_CAP } = await dependency('./policies.mjs');

export const SAVE_FORMAT = 'mastermind-reference-session';
export const SAVE_VERSION = 1;
export const MAX_SAVE_BYTES = 262144;
let serial = 0;
export function freshSessionId() {
  // A new ID even on same-millisecond resets; never taken from an imported save.
  return `${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}-${++serial}`;
}

function keys(value, names) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...names].sort().join(',')) {
    throw new TypeError('Unexpected or missing save fields');
  }
}
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const withoutId = view => {
  const { sessionId, ...rest } = view;
  return rest;
};
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function validateInitial(input) {
  keys(input, ['positions', 'colors', 'secret', 'seed', 'mode', 'policy', 'lieBudget', 'noiseModel', 'probability']);
  checkDimensions(input);
  checkPolicy(input.mode, input.policy);
  integer(input.seed, 'seed', 0, 0xffffffff);
  const secret = code(input.secret, input);
  if (input.mode === 'bounded') {
    integer(input.lieBudget, 'false-reply allowance', 0, 60);
    if (input.noiseModel !== null || input.probability !== null) throw new Error('Bounded games have no noise channel');
  } else {
    if (input.lieBudget !== null || !['forced-change', 'redraw'].includes(input.noiseModel)
      || !Number.isFinite(input.probability) || input.probability < 0 || input.probability > 1) {
      throw new Error('Invalid noise configuration');
    }
  }
  return freeze({ ...input, secret });
}

// This controller owns private referee state. Only solverView(), plus policy and
// correlation IDs, is sent to the inference worker. Snapshots never expose arrays
// that can mutate the referee or the action log.
export function createSession(input, sessionId = freshSessionId()) {
  const initial = validateInitial(input);
  const game = createGame({ ...initial, sessionId });
  const actions = [];
  let ending = null;
  const active = () => {
    if (ending) throw new Error('The session has ended');
  };
  const turnMessage = () => ({ sessionId, turnId: game.solverView().turns.length });
  const record = action => actions.push(freeze(action));
  const cap = () => {
    const view = game.solverView();
    if (view.phase === 'ready' && view.turns.length === QUERY_CAP) {
      game.cancel({ sessionId });
      ending = 'capped';
    }
  };
  const snapshot = () => freeze({
    solver: withoutId(game.solverView()), oracle: withoutId(game.oracleView()),
    review: ending ? withoutId(game.review()) : null, ending,
  });
  return Object.freeze({
    initial,
    solverView: game.solverView,
    oracleView: game.oracleView,
    review: game.review,
    ending: () => ending,
    actionLog: () => Object.freeze(actions.slice()),
    issueGuess(guess) {
      active();
      const view = game.solverView();
      if (view.turns.length >= QUERY_CAP) throw new Error('Query cap reached');
      const valid = code(guess, initial);
      if (view.turns.some(t => sameCode(t.guess, valid))) throw new Error('Repeated guess');
      game.issueGuess({ sessionId, turnId: view.turns.length + 1, guess: valid });
      record({ type: 'guess', guess: valid });
      if (game.solverView().phase === 'solved') ending = 'solved';
    },
    sendTruth() {
      active();
      game.sendTruth(turnMessage());
      record({ type: 'truth' });
      cap();
    },
    submitReply(value) {
      active();
      const reported = reply(value, initial.positions);
      game.submitReply({ ...turnMessage(), reply: reported });
      record({ type: 'reply', reply: reported });
      cap();
    },
    sampleReply() {
      active();
      game.sampleReply(turnMessage());
      record({ type: 'sample' });
      cap();
    },
    cancel() {
      active();
      game.cancel({ sessionId });
      ending = 'cancelled';
      record({ type: 'cancel' });
    },
    snapshot,
    exportText() {
      return JSON.stringify({ format: SAVE_FORMAT, version: SAVE_VERSION, initial,
        actions, state: snapshot() }, null, 2);
    },
  });
}

// Private referee replay stays local. The browser supplies query() via the same
// public-view-only worker used for live turns; Node defaults to the pure policy.
// This hook is a trusted transport, never a function supplied by a save. Checking
// every policy choice rejects forged guesses as well as mismatched histories.
export async function restoreSession(text, { yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)),
  isCancelled = () => false, query = chooseGuess } = {}) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_SAVE_BYTES) {
    throw new RangeError('Save is missing or larger than 256 KiB');
  }
  const saved = JSON.parse(text);
  keys(saved, ['format', 'version', 'initial', 'actions', 'state']);
  if (saved.format !== SAVE_FORMAT || saved.version !== SAVE_VERSION) throw new Error('Unsupported save format or version');
  if (!Array.isArray(saved.actions) || saved.actions.length > QUERY_CAP * 2 + 1) throw new Error('Too many saved actions');
  const session = createSession(saved.initial);
  for (const action of saved.actions) {
    if (isCancelled()) throw new DOMException('Restore cancelled', 'AbortError');
    switch (action?.type) {
      case 'guess': {
        keys(action, ['type', 'guess']);
        const guess = code(action.guess, session.initial);
        const expected = await query(session.solverView(), session.initial.policy);
        if (isCancelled()) throw new DOMException('Restore cancelled', 'AbortError');
        if (!sameCode(guess, expected.guess)) throw new Error('Saved guess does not match the reference policy');
        session.issueGuess(guess);
        break;
      }
      case 'reply':
        keys(action, ['type', 'reply']);
        keys(action.reply, ['exact', 'misplaced']);
        session.submitReply(action.reply);
        break;
      case 'truth': keys(action, ['type']); session.sendTruth(); break;
      case 'sample': keys(action, ['type']); session.sampleReply(); break;
      case 'cancel': keys(action, ['type']); session.cancel(); break;
      default: throw new Error('Unknown saved action');
    }
    await yieldControl();
  }
  if (isCancelled()) throw new DOMException('Restore cancelled', 'AbortError');
  if (canonical(saved.state) !== canonical(session.snapshot())) throw new Error('Saved history or private state does not match replay');
  // The text parser detached all caller data; snapshot/export stay immutable.
  return session;
}
