import {
  configuration, code, reply, score, sameCode, sameReply, attainableReplies,
  misread, createRandom, integer, MAX_CODES, NOISE_MODELS,
} from './core.mjs';

// A local rules referee, not a tamper-proof leaderboard. Only solverView()
// should cross the worker boundary; oracleView() and review() contain truth.
// Replacing a game requires a NEW sessionId to reject old worker callbacks.
export function createGame(options) {
  const config = configuration(options);
  if (config.colors ** config.positions > MAX_CODES) throw new RangeError('Game exceeds the current code-space limit');
  const secret = code(options.secret, config);
  const sessionId = options.sessionId;
  if (typeof sessionId !== 'string' || sessionId.length === 0) throw new TypeError('A nonempty session ID is required');
  const mode = options.mode ?? 'bounded';
  if (!['bounded', 'misread'].includes(mode)) throw new RangeError('Unknown game mode');
  const lieBudget = mode === 'bounded' ? integer(options.lieBudget ?? 0, 'false-reply allowance', 0, 60) : null;
  let noise = null;
  let rng = null;
  if (mode === 'misread') {
    const probability = options.probability;
    const model = options.noiseModel ?? 'forced-change';
    if (!Number.isFinite(probability) || probability < 0 || probability > 1 || !NOISE_MODELS.includes(model)) {
      throw new RangeError('A valid noise model and probability are required');
    }
    noise = Object.freeze({ model, probability });
    rng = createRandom(options.seed);
  }
  let phase = 'ready';
  let spent = 0;
  const turns = [];
  const annotations = [];
  let legal = null;

  const checkSession = id => {
    if (id !== sessionId) throw new Error('Stale session');
  };
  const activeTurn = message => {
    checkSession(message.sessionId);
    if (phase !== 'awaiting-reply' || message.turnId !== turns.length) throw new Error('Reply does not belong to the active turn');
    return turns.at(-1);
  };
  const copyTurn = turn => Object.freeze({
    turnId: turn.turnId, guess: turn.guess, outcome: turn.outcome, reply: turn.reply,
  });
  const solverView = () => Object.freeze({
    sessionId, config, mode, lieBudget, noise, phase,
    turns: Object.freeze(turns.map(copyTurn)),
  });
  const legalReplies = () => {
    if (phase !== 'awaiting-reply') return Object.freeze([]);
    legal ??= attainableReplies(turns.at(-1).guess, config);
    return legal;
  };
  const finishReply = (turn, reported, annotation) => {
    turn.reply = reported;
    annotations.push(Object.freeze({ turnId: turn.turnId, ...annotation }));
    phase = 'ready';
    return solverView();
  };
  const submitReply = message => {
    const turn = activeTurn(message);
    if (mode !== 'bounded') throw new Error('Random replies must be sampled by the referee');
    const reported = reply(message.reply, config.positions);
    if (!legalReplies().some(r => sameReply(r, reported))) throw new RangeError('That reply is not attainable for this guess');
    const truth = score(secret, turn.guess, config);
    const changedReply = !sameReply(truth, reported);
    if (changedReply && spent === lieBudget) throw new RangeError('No false replies remain');
    spent += Number(changedReply);
    return finishReply(turn, reported, { truth, changedReply });
  };

  return Object.freeze({
    solverView,
    issueGuess(message) {
      checkSession(message.sessionId);
      if (phase !== 'ready' || message.turnId !== turns.length + 1) {
        throw new Error('Guess does not belong to the next turn');
      }
      const guess = code(message.guess, config);
      const solved = sameCode(secret, guess);
      turns.push({ turnId: turns.length + 1, guess, outcome: solved ? 'solved' : 'not-solved', reply: null });
      legal = null;
      phase = solved ? 'solved' : 'awaiting-reply';
      return solverView();
    },
    submitReply,
    sendTruth(message) {
      const turn = activeTurn(message);
      return submitReply({ ...message, reply: score(secret, turn.guess, config) });
    },
    sampleReply(message) {
      const turn = activeTurn(message);
      if (mode !== 'misread') throw new Error('This game uses player-supplied replies');
      const result = misread(secret, turn.guess, config, { ...noise, random: rng.next });
      return finishReply(turn, result.reported, result);
    },
    oracleView() {
      const turn = phase === 'awaiting-reply' ? turns.at(-1) : null;
      return Object.freeze({
        sessionId, phase, secret,
        turnId: turn?.turnId ?? null,
        truth: turn ? score(secret, turn.guess, config) : null,
        remainingBudget: mode === 'bounded' ? lieBudget - spent : null,
        legalReplies: mode === 'bounded' ? legalReplies() : Object.freeze([]),
      });
    },
    cancel(message) {
      checkSession(message.sessionId);
      if (['solved', 'cancelled'].includes(phase)) throw new Error('The game has already ended');
      phase = 'cancelled';
      return solverView();
    },
    review() {
      if (!['solved', 'cancelled'].includes(phase)) throw new Error('Finish the game before reviewing it');
      return Object.freeze({
        ...solverView(), secret, spent: mode === 'bounded' ? spent : null,
        annotations: Object.freeze(annotations.slice()),
        randomState: rng?.snapshot() ?? null,
      });
    },
  });
}
