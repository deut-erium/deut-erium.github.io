// Pure Mastermind rules. Colors are integers 1..colors; repeats are allowed.
// This module has no DOM, storage, network, or solver dependency.
export const MAX_CODES = 32768;
export const MAX_LIKELIHOOD_CODES = 4096;
export const NOISE_MODELS = Object.freeze(['forced-change', 'redraw']);

export function integer(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

export function configuration(value) {
  if (!value || typeof value !== 'object') throw new TypeError('Configuration required');
  return Object.freeze({
    positions: integer(value.positions, 'positions', 1, 8),
    colors: integer(value.colors, 'colors', 2, 16),
  });
}

export function code(value, config) {
  if (!Array.isArray(value) || value.length !== config.positions) {
    throw new RangeError(`A code needs ${config.positions} positions`);
  }
  // Array.from visits holes too, unlike Array.prototype.map/every.
  return Object.freeze(Array.from(value, peg => integer(peg, 'color', 1, config.colors)));
}

export function reply(value, positions) {
  if (!value || typeof value !== 'object') throw new TypeError('Reply required');
  const exact = integer(value.exact, 'exact matches', 0, positions);
  const misplaced = integer(value.misplaced, 'misplaced matches', 0, positions);
  if (exact + misplaced > positions) throw new RangeError('A peg can only count once');
  return Object.freeze({ exact, misplaced });
}

export const sameReply = (a, b) => a.exact === b.exact && a.misplaced === b.misplaced;
export const sameCode = (a, b) => a.length === b.length && a.every((peg, i) => peg === b[i]);
const replyKey = r => `${r.exact},${r.misplaced}`;
const replyOrder = (a, b) => a.exact - b.exact || a.misplaced - b.misplaced;

function scoreKnownCodes(secret, guess, colors) {
  const secretCounts = new Array(colors + 1).fill(0);
  const guessCounts = new Array(colors + 1).fill(0);
  let exact = 0;
  for (let i = 0; i < secret.length; i++) {
    exact += Number(secret[i] === guess[i]);
    secretCounts[secret[i]]++;
    guessCounts[guess[i]]++;
  }
  let total = 0;
  for (let color = 1; color <= colors; color++) {
    total += Math.min(secretCounts[color], guessCounts[color]);
  }
  return Object.freeze({ exact, misplaced: total - exact });
}

export function score(secret, guess, options) {
  const config = configuration(options);
  return scoreKnownCodes(code(secret, config), code(guess, config), config.colors);
}

export function enumerateCodes(options, limit = MAX_CODES) {
  const config = configuration(options);
  integer(limit, 'enumeration limit', 1, MAX_CODES);
  const count = config.colors ** config.positions;
  if (count > limit) throw new RangeError(`Code space ${count} exceeds enumeration limit ${limit}`);
  const codes = [];
  for (let index = 0; index < count; index++) {
    let rest = index;
    const value = new Array(config.positions);
    for (let i = config.positions - 1; i >= 0; i--) {
      value[i] = (rest % config.colors) + 1;
      rest = Math.floor(rest / config.colors);
    }
    codes.push(Object.freeze(value));
  }
  return Object.freeze(codes);
}

export function attainableReplies(guess, options, limit = MAX_CODES) {
  const config = configuration(options);
  const g = code(guess, config);
  const found = new Map();
  for (const s of enumerateCodes(config, limit)) {
    const r = scoreKnownCodes(s, g, config.colors);
    found.set(replyKey(r), r);
  }
  return Object.freeze([...found.values()].sort(replyOrder));
}

function noiseOptions(options) {
  const { model = 'forced-change', probability } = options || {};
  if (!NOISE_MODELS.includes(model)) throw new RangeError('Unknown noise model');
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError('Error probability must be between 0 and 1');
  }
  return Object.freeze({ model, probability });
}

function draw(random) {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('Random draws must be in [0,1)');
  }
  return value;
}

// Mulberry32 for reproducible experiments, not for security or hidden keys.
// Restoring snapshot() resumes the stream at the next draw.
export function createRandom(seed) {
  let state = integer(seed, 'seed', 0, 0xffffffff);
  return Object.freeze({
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    snapshot: () => state,
  });
}

// Metadata here is for the referee/teaching view, never the solver's input.
// Exactly two draws per position keep stream consumption stable across p.
export function misread(secret, guess, options, noise) {
  const config = configuration(options);
  const s = code(secret, config);
  const g = code(guess, config);
  const { model, probability } = noiseOptions(noise);
  if (typeof noise.random !== 'function') throw new TypeError('An explicit random source is required');
  let attempted = 0;
  let changedPositions = 0;
  const temporary = s.map(peg => {
    const eventDraw = draw(noise.random);
    const colorDraw = draw(noise.random);
    if (eventDraw >= probability) return peg;
    attempted++;
    let replacement;
    if (model === 'redraw') replacement = 1 + Math.floor(colorDraw * config.colors);
    else {
      replacement = 1 + Math.floor(colorDraw * (config.colors - 1));
      if (replacement >= peg) replacement++;
    }
    changedPositions += Number(replacement !== peg);
    return replacement;
  });
  const truth = scoreKnownCodes(s, g, config.colors);
  const reported = scoreKnownCodes(temporary, g, config.colors);
  return Object.freeze({
    truth, reported, temporary: Object.freeze(temporary), attempted,
    changedPositions, changedReply: !sameReply(truth, reported),
  });
}

// Exact small-instance reference, not the browser's query-selection algorithm.
export function replyDistribution(secret, guess, options, noise, limit = MAX_LIKELIHOOD_CODES) {
  const config = configuration(options);
  const s = code(secret, config);
  const g = code(guess, config);
  const { model, probability } = noiseOptions(noise);
  integer(limit, 'likelihood limit', 1, MAX_LIKELIHOOD_CODES);
  const changed = model === 'redraw' ? probability / config.colors : probability / (config.colors - 1);
  const retained = model === 'redraw' ? 1 - probability + probability / config.colors : 1 - probability;
  const distribution = new Map();
  for (const temporary of enumerateCodes(config, limit)) {
    let weight = 1;
    for (let i = 0; i < s.length; i++) weight *= temporary[i] === s[i] ? retained : changed;
    if (weight === 0) continue;
    const r = scoreKnownCodes(temporary, g, config.colors);
    const key = replyKey(r);
    if (!distribution.has(key)) distribution.set(key, { reply: r, probability: 0 });
    distribution.get(key).probability += weight;
  }
  return Object.freeze([...distribution.values()]
    .sort((a, b) => replyOrder(a.reply, b.reply)).map(Object.freeze));
}

// One reported pair costs one unit, even if both counts differ.
export function wholeReplyCost(truth, reported) {
  return Number(!sameReply(truth, reported));
}

// The old objective compares E and T=E+M, not E and M independently.
export function fieldDisagreementCost(truth, reported) {
  return Number(truth.exact !== reported.exact)
    + Number(truth.exact + truth.misplaced !== reported.exact + reported.misplaced);
}
