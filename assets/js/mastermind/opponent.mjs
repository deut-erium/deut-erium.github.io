// Public-transcript opponent for a per-TURN, per-POSITION Hamming cap.
// No game engine, secret, DOM, storage, or network dependency.
const MAX_CODES = 32768;
const MAX_PROBES = 64;

function integer(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function record(value, allowed, name) {
  if (!value || typeof value !== 'object'
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${name} must be a plain object`);
  }
  const copy = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!allowed.includes(key) || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${name} contains a private, unknown, or accessor field`);
    }
    copy[key] = descriptor.value;
  }
  return copy;
}

function array(value, min, max, name, read) {
  if (!Array.isArray(value) || value.length < min || value.length > max
    || Reflect.ownKeys(value).length !== value.length + 1) {
    throw new TypeError(`${name} must be a dense array of length ${min} to ${max}`);
  }
  const result = new Array(value.length);
  for (let i = 0; i < result.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${name} must contain values`);
    result[i] = read(descriptor.value);
  }
  return result;
}

function dimensions(positions, colors) {
  integer(positions, 'positions', 3, 8);
  integer(colors, 'colors', 2, 6);
  if (colors ** positions > MAX_CODES) throw new RangeError('Opponent supports at most 32,768 possible codes');
  return { positions, colors };
}

const readCode = (value, n, m) => array(value, n, n, 'Code', peg => integer(peg, 'color', 1, m));
function readReply(value, n) {
  const input = record(value, ['exact', 'misplaced'], 'Reply');
  const exact = integer(input.exact, 'exact matches', 0, n);
  const misplaced = integer(input.misplaced, 'misplaced matches', 0, n);
  if (exact + misplaced > n) throw new RangeError('A peg can only count once');
  return { exact, misplaced };
}

function readView(value) {
  const input = record(value, ['positions', 'colors', 'cap', 'turns'], 'Solver view');
  const { positions, colors } = dimensions(input.positions, input.colors);
  const cap = integer(input.cap, 'position cap', 0, positions);
  const turns = array(input.turns, 0, 60, 'Turns', value => {
    const turn = record(value, ['guess', 'reply'], 'Turn');
    return { guess: readCode(turn.guess, positions, colors), reply: readReply(turn.reply, positions) };
  });
  return { positions, colors, cap, turns };
}

function domain(n, m) {
  const size = m ** n;
  const pegs = new Uint8Array(size * n), counts = new Uint8Array(size * m);
  for (let index = 0; index < size; index++) {
    let rest = index;
    for (let p = n - 1; p >= 0; p--) {
      const color = rest % m;
      pegs[index * n + p] = color + 1;
      counts[index * m + color]++;
      rest = Math.floor(rest / m);
    }
  }
  return { n, m, size, pegs, counts };
}

const codeIndex = (code, m) => code.reduce((index, peg) => index * m + peg - 1, 0);
const codeAt = (space, index) => Array.from(space.pegs.subarray(index * space.n, (index + 1) * space.n));
const replyKey = (reply, n) => reply.exact * (n + 1) + reply.misplaced;

function scores(space, guess) {
  const { n, m, size, pegs, counts } = space;
  const guessCounts = new Uint8Array(m);
  for (const peg of guess) guessCounts[peg - 1]++;
  const result = new Uint8Array(size);
  for (let index = 0; index < size; index++) {
    let exact = 0, overlap = 0;
    for (let p = 0; p < n; p++) exact += Number(pegs[index * n + p] === guess[p]);
    for (let c = 0; c < m; c++) overlap += Math.min(counts[index * m + c], guessCounts[c]);
    result[index] = exact * (n + 1) + overlap - exact;
  }
  return result;
}

// Each coordinate is a complete graph with unit cost between distinct colors.
// On each coordinate line replace f(c) with min(f(c), 1 + min_a f(a)).
// Compose these separable min-plus transforms to get distance to the fiber in
// O(n * m^n) time and O(m^n) space, rather than enumerating Hamming balls.
function fiberDistances(labels, key, n, m) {
  const distance = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i++) distance[i] = labels[i] === key ? 0 : n + 1;
  for (let stride = 1; stride < distance.length; stride *= m) {
    const block = stride * m;
    for (let base = 0; base < distance.length; base += block) {
      for (let offset = 0; offset < stride; offset++) {
        let minimum = n + 1;
        for (let color = 0; color < m; color++) minimum = Math.min(minimum, distance[base + offset + color * stride]);
        const viaOtherColor = minimum + 1;
        for (let color = 0; color < m; color++) {
          const index = base + offset + color * stride;
          if (distance[index] > viaOtherColor) distance[index] = viaOtherColor;
        }
      }
    }
  }
  return distance;
}

// Small pure geometry API for independent verification. Entries follow
// lexicographic code order (colors 1..m); n+1 denotes an empty reply fiber.
export function distanceToReplyFiber(guess, reply, options) {
  const input = record(options, ['positions', 'colors'], 'Dimensions');
  const { positions: n, colors: m } = dimensions(input.positions, input.colors);
  const g = readCode(guess, n, m), r = readReply(reply, n);
  const space = domain(n, m);
  return fiberDistances(scores(space, g), replyKey(r, n), n, m);
}

function compatible(space, view) {
  let candidates = Array.from({ length: space.size }, (_, i) => i);
  // Repeated observations are allowed. Costs are never accumulated across
  // turns: each secret must be within cap of EACH observed reply fiber.
  for (const { guess, reply } of view.turns) {
    const labels = scores(space, guess);
    const distances = fiberDistances(labels, replyKey(reply, space.n), space.n, space.m);
    const failed = codeIndex(guess, space.m);
    candidates = candidates.filter(index => index !== failed && distances[index] <= view.cap);
    if (!candidates.length) throw new Error('No secret is compatible with these replies and confirmed misses');
  }
  return candidates;
}

function randomSource(seed) {
  if (seed === undefined) {
    seed = globalThis.crypto?.getRandomValues
      ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 0x100000000);
  }
  let state = integer(seed, 'opponent seed', 0, 0xffffffff);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = Math.imul(state ^ (state >>> 15), state | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 0x100000000;
  };
}

function sample(pool, count, random) {
  const copy = pool.slice();
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

function worstGroup(space, candidates, probe, cap, best) {
  // Actual equality terminates before any reply, so the hit is in no miss
  // group, even if that secret could also manufacture the observed score.
  const remaining = candidates.filter(index => index !== probe);
  if (cap === space.n || !remaining.length) return remaining.length;
  const labels = scores(space, codeAt(space, probe));
  if (cap === 0) {
    const sizes = new Uint32Array((space.n + 1) ** 2);
    let worst = 0;
    for (const index of remaining) worst = Math.max(worst, ++sizes[labels[index]]);
    return worst;
  }
  let worst = 0;
  for (const key of new Set(labels)) {
    const distances = fiberDistances(labels, key, space.n, space.m);
    let size = 0;
    for (const index of remaining) size += Number(distances[index] <= cap);
    worst = Math.max(worst, size);
    // This probe cannot tie or beat the incumbent. Groups can overlap;
    // summing them or treating these counts as probabilities would be wrong.
    if (worst > best || worst === remaining.length) break;
  }
  return worst;
}

// Minimize the worst legal remaining group within a bounded sampled shortlist.
// This is a heuristic, with no global optimality or move-limit guarantee.
export function chooseGuess(value, options = {}) {
  const view = readView(value);
  const input = record(options, ['seed', 'probeLimit'], 'Opponent options');
  const probeLimit = integer(input.probeLimit === undefined ? 16 : input.probeLimit, 'probe limit', 1, MAX_PROBES);
  const random = randomSource(input.seed);
  const space = domain(view.positions, view.colors);
  const candidates = compatible(space, view);
  if (candidates.length === 1) {
    return Object.freeze({ guess: Object.freeze(codeAt(space, candidates[0])), candidates: 1, probes: 1 });
  }
  const failed = new Set(view.turns.map(turn => codeIndex(turn.guess, space.m)));
  const available = Array.from({ length: space.size }, (_, i) => i).filter(index => !failed.has(index));
  let probes;
  if (available.length <= probeLimit) probes = available;
  else {
    // Reserve half the shortlist for possible hits; also allow noncandidate
    // questions that may separate the surviving codes better.
    probes = sample(candidates, Math.min(candidates.length, Math.ceil(probeLimit / 2)), random);
    const chosen = new Set(probes);
    probes.push(...sample(available.filter(index => !chosen.has(index)), probeLimit - probes.length, random));
  }
  let best = Infinity, choice, ties = 0;
  for (const probe of probes) {
    const worst = worstGroup(space, candidates, probe, view.cap, best);
    if (worst < best) { best = worst; choice = probe; ties = 1; }
    else if (worst === best && random() < 1 / ++ties) choice = probe;
  }
  return Object.freeze({ guess: Object.freeze(codeAt(space, choice)), candidates: candidates.length, probes: probes.length });
}
