// Playable Mastermind rules. Colors are 1..colors; repeated colors are legal.
// No DOM, storage, transport, or opponent dependency.
export const COLOR_NAMES = Object.freeze(['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange']);
const OPTION_KEYS = ['role', 'positions', 'colors', 'probability', 'cap', 'limit', 'seed', 'secret', 'id'];
let nextId = 0;

function integer(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

// Reject getters and unknown fields rather than copying caller-owned objects.
function record(value, keys, name) {
  if (!value || typeof value !== 'object'
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${name} must be a plain object`);
  }
  const copy = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!keys.includes(key) || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${name} contains an unknown field or accessor`);
    }
    copy[key] = descriptor.value;
  }
  return copy;
}

function code(value, positions, colors) {
  if (!Array.isArray(value) || value.length !== positions
    || Reflect.ownKeys(value).length !== positions + 1) {
    throw new RangeError(`A code needs ${positions} indexed colors`);
  }
  const copy = new Array(positions);
  for (let i = 0; i < positions; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('Code positions must be values, not holes or accessors');
    }
    copy[i] = integer(descriptor.value, 'color', 1, colors);
  }
  return copy;
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

// Pure normalization. Optional seed/id/secret remain absent until supplied.
export function validateOptions(options = {}) {
  const input = record(options, OPTION_KEYS, 'Options');
  const { role = 'breaker', positions = 4, colors = 6, probability = 0.1,
    cap = 1, limit = 16, seed, secret, id } = input;
  if (role !== 'breaker' && role !== 'liar') throw new RangeError('Role must be breaker or liar');
  integer(positions, 'positions', 3, 8);
  integer(colors, 'colors', 2, 6);
  integer(cap, 'position cap', 0, positions);
  integer(limit, 'guess limit', 6, 60);
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError('Probability must be between 0 and 1');
  }
  if (role === 'liar' && colors ** positions > 32768) {
    throw new RangeError('Liar mode supports at most 32,768 possible codes');
  }
  const result = { role, positions, colors, probability, cap, limit };
  if (seed !== undefined) result.seed = integer(seed, 'seed', 0, 0xffffffff);
  if (id !== undefined) {
    if (typeof id !== 'string' || !id.trim() || id.length > 128) {
      throw new TypeError('Game id must be a nonempty string of at most 128 characters');
    }
    result.id = id;
  }
  if (secret !== undefined) result.secret = code(secret, positions, colors);
  return freeze(result);
}

function randomSeed() {
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 0x100000000);
}

// A local stream for repeatable gameplay, not cryptographic secrecy. Its state
// is copied for a move and committed only with the completed move.
function stream(seed) {
  let state = seed;
  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let x = Math.imul(state ^ (state >>> 15), state | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 0x100000000;
    },
    state: () => state,
  };
}

function score(secret, guess, colors) {
  const a = new Array(colors).fill(0), b = new Array(colors).fill(0);
  let exact = 0, overlap = 0;
  for (let i = 0; i < secret.length; i++) {
    exact += Number(secret[i] === guess[i]);
    a[secret[i] - 1]++;
    b[guess[i] - 1]++;
  }
  for (let c = 0; c < colors; c++) overlap += Math.min(a[c], b[c]);
  return { exact, misplaced: overlap - exact };
}

const equal = (a, b) => a.every((peg, i) => peg === b[i]);
const distance = (a, b) => a.reduce((sum, peg, i) => sum + Number(peg !== b[i]), 0);

export function createGame(options = {}) {
  const config = validateOptions(options);
  const { role, positions, colors, probability, cap, limit } = config;
  const random = stream(config.seed ?? randomSeed());
  const secret = config.secret ? config.secret.slice()
    : Array.from({ length: positions }, () => role === 'breaker' ? 1 + Math.floor(random.next() * colors) : 1);
  const id = config.id ?? `mastermind-${++nextId}`;
  let state = {
    revision: 0, phase: role === 'breaker' ? 'guess' : 'setup', secret,
    turns: [], ending: null, random: random.state(),
  };
  const readCode = value => code(value, positions, colors);

  function requirePhase(...phases) {
    if (!phases.includes(state.phase)) throw new Error('This action is not available in the current phase');
  }

  function view() {
    const over = state.phase === 'over';
    // Explicit projections: private rows never travel with active history.
    return freeze({
      id, revision: state.revision, role, positions, colors, probability, cap, limit,
      phase: state.phase,
      turns: state.turns.map(turn => ({
        number: turn.number, guess: turn.guess.slice(),
        reply: turn.reply ? { ...turn.reply } : null, outcome: turn.outcome,
      })),
      secret: role === 'liar' || over ? state.secret.slice() : null,
      ending: state.ending ? { ...state.ending } : null,
      review: over ? state.turns.map(turn => ({
        number: turn.number, truth: { ...turn.truth },
        temporary: turn.temporary ? turn.temporary.slice() : null,
        changedPositions: turn.changedPositions,
      })) : null,
    });
  }

  function commit(patch) {
    state = { ...state, ...patch, revision: state.revision + 1 };
    return view();
  }

  function ending(reason) {
    return { reason, winner: reason === 'giveup' ? null
      : (reason === 'solved') === (role === 'breaker') ? 'player' : 'computer' };
  }

  function turnFor(guess, outcome) {
    return {
      number: state.turns.length + 1, guess, outcome, reply: null,
      truth: score(state.secret, guess, colors), temporary: null, changedPositions: 0,
    };
  }

  function win(guess) {
    return commit({
      turns: [...state.turns, turnFor(guess, 'win')],
      phase: 'over', ending: ending('solved'),
    });
  }

  return Object.freeze({
    view,
    solverView() {
      requirePhase('ready');
      // Only liar games can reach ready. No game id, seed, phase, truth, or
      // unsubmitted temporary row belongs in an opponent request.
      return freeze({ positions, colors, cap, turns: state.turns.map(turn => ({
        guess: turn.guess.slice(), reply: { ...turn.reply },
      })) });
    },
    setSecret(value) {
      requirePhase('setup');
      const nextSecret = readCode(value);
      return commit({ secret: nextSecret });
    },
    lockSecret(value) {
      requirePhase('setup');
      const nextSecret = value === undefined ? state.secret.slice() : readCode(value);
      return commit({ secret: nextSecret, phase: 'ready' });
    },
    guess(value) {
      requirePhase('guess');
      const guess = readCode(value);
      if (equal(guess, state.secret)) return win(guess);
      const rng = stream(state.random);
      const temporary = state.secret.map(peg => {
        const event = rng.next(), replacement = 1 + Math.floor(rng.next() * (colors - 1));
        return event < probability ? replacement + Number(replacement >= peg) : peg;
      });
      const turn = {
        ...turnFor(guess, 'miss'), reply: score(temporary, guess, colors), temporary,
        changedPositions: distance(state.secret, temporary),
      };
      const atLimit = turn.number === limit;
      return commit({
        turns: [...state.turns, turn], random: rng.state(),
        phase: atLimit ? 'over' : 'guess', ending: atLimit ? ending('limit') : null,
      });
    },
    issueGuess(value) {
      requirePhase('ready');
      const guess = readCode(value);
      if (equal(guess, state.secret)) return win(guess);
      return commit({ turns: [...state.turns, turnFor(guess, 'pending')], phase: 'reply' });
    },
    submitTemporary(value) {
      requirePhase('reply');
      const temporary = readCode(value);
      const changedPositions = distance(state.secret, temporary);
      if (changedPositions > cap) throw new RangeError('Temporary code exceeds the per-turn position cap');
      const pending = state.turns[state.turns.length - 1];
      const turn = {
        ...pending, outcome: 'miss', temporary, changedPositions,
        reply: score(temporary, pending.guess, colors),
      };
      const atLimit = turn.number === limit;
      return commit({
        turns: [...state.turns.slice(0, -1), turn],
        phase: atLimit ? 'over' : 'ready', ending: atLimit ? ending('limit') : null,
      });
    },
    giveUp() {
      requirePhase('guess', 'ready', 'reply');
      return commit({ phase: 'over', ending: ending('giveup') });
    },
  });
}
