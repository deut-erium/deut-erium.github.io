// Preserve the include's asset version on the worker's dependency too.
const dependency = file => import(new URL(file + new URL(import.meta.url).search, import.meta.url));
const opponent = dependency('./opponent.mjs');
const FIELDS = ['type', 'requestId', 'generation', 'view', 'seed'];
const validId = value => Number.isSafeInteger(value) && value >= 0;

function ownValue(object, key) {
  if (!object || typeof object !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function record(value, fields) {
  if (!value || typeof value !== 'object'
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== fields.length) {
    throw new TypeError('Malformed opponent request object');
  }
  const copy = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!fields.includes(key) || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('Opponent request contains a private, unknown, or accessor field');
    }
    copy[key] = descriptor.value;
  }
  return copy;
}

function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError('Opponent request contains an out-of-range integer');
  }
  return value;
}

function array(value, min, max, read) {
  if (!Array.isArray(value) || value.length < min || value.length > max
    || Reflect.ownKeys(value).length !== value.length + 1) {
    throw new TypeError('Opponent request contains a malformed array');
  }
  const copy = new Array(value.length);
  for (let i = 0; i < copy.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('Opponent request arrays must contain values');
    }
    copy[i] = read(descriptor.value);
  }
  return copy;
}

function publicView(value) {
  const input = record(value, ['positions', 'colors', 'cap', 'turns']);
  const positions = integer(input.positions, 3, 8), colors = integer(input.colors, 2, 6);
  const cap = integer(input.cap, 0, positions);
  if (colors ** positions > 32768) throw new RangeError('Opponent supports at most 32,768 possible codes');
  const turns = array(input.turns, 0, 60, value => {
    const turn = record(value, ['guess', 'reply']);
    const score = record(turn.reply, ['exact', 'misplaced']);
    const exact = integer(score.exact, 0, positions), misplaced = integer(score.misplaced, 0, positions);
    if (exact + misplaced > positions) throw new RangeError('A peg can only count once');
    return {
      guess: array(turn.guess, positions, positions, peg => integer(peg, 1, colors)),
      reply: { exact, misplaced },
    };
  });
  return { positions, colors, cap, turns };
}

// Pure request boundary, also callable without a worker. Valid correlation IDs
// survive every error; invalid/missing IDs become null, never reflected objects.
export async function answerRequest(message) {
  const envelope = { requestId: null, generation: null };
  try {
    const requestId = ownValue(message, 'requestId'), generation = ownValue(message, 'generation');
    envelope.requestId = validId(requestId) ? requestId : null;
    envelope.generation = validId(generation) ? generation : null;
    const input = record(message, FIELDS);
    if (input.type !== 'choose') throw new TypeError('Unknown opponent request type');
    if (!validId(requestId) || !validId(generation)) throw new TypeError('Invalid opponent correlation IDs');
    const seed = integer(input.seed, 0, 0xffffffff);
    // Validate and detach before awaiting module loading. Later caller edits
    // cannot change the request associated with these correlation IDs.
    const view = publicView(input.view);
    const { chooseGuess } = await opponent;
    const result = chooseGuess(view, { seed });
    return { type: 'choice', ...envelope, result };
  } catch (error) {
    return { type: 'error', ...envelope, message: error instanceof Error ? error.message : 'Opponent request failed' };
  }
}

if (typeof self !== 'undefined' && typeof document === 'undefined' && typeof self.postMessage === 'function') {
  // Register before the import resolves, so an immediate first request is not
  // lost during module loading. Generation checks and cancellation belong to UI.
  self.onmessage = async event => { self.postMessage(await answerRequest(event.data)); };
}
