// Browser practice port of Cyber Apocalypse 2023's Blokechain challenge.
// Derived from the archived crypto_blokechain.zip source, blokechain.py:
// SHA-256 c4974c9b2a81981b399f1e1217af58dfbe4461c89f02d92c00fe51d15edce363.
// The inspected source contains no license header. Intentional leaks and repeat
// payouts are preserved; only the final reward comes from the practice IO.
import { PythonRandom } from '../lib/python-random.mjs';
import { integer } from '../lib/bytes.mjs';

export const PARAMETERS = Object.freeze({
  inputs: 50, outputs: 100, clauses: 10, trials: 500,
  blocks: 60, miningRate: 1, deadline: 2000, payoutThreshold: 100_000_000n,
});

export const PROMPT = 'Choose an option\n1. Get unmined blocks\n2. Submit mined blocks\n3. Destroy vessels\n';

// CPython's small-integer set iteration is table order, not insertion order or
// sorted order. Collisions matter even for literals 1..50 while the table is
// still 8 or 32 slots wide. There are no deletions in random_formula.
export function pythonPositiveIntSet(values) {
  let table = new Array(8).fill(0), used = 0;
  function insert(value, target) {
    const mask = target.length - 1;
    let i = value & mask, perturb = value;
    for (;;) {
      const probes = i + 9 <= mask ? 9 : 0;
      for (let j = 0; j <= probes; j++) {
        if (target[i + j] === value) return false;
        if (target[i + j] === 0) {
          target[i + j] = value;
          return true;
        }
      }
      perturb = Math.floor(perturb / 32);
      i = (i * 5 + 1 + perturb) & mask;
    }
  }
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 0x7fffffff) {
      throw Error('positive small integers required');
    }
    if (!insert(value, table)) continue;
    used++;
    if (used * 5 >= (table.length - 1) * 3) {
      let size = 8;
      while (size <= used * (used > 50_000 ? 2 : 4)) size *= 2;
      const grown = new Array(size).fill(0);
      for (const old of table) if (old) insert(old, grown);
      table = grown;
    }
  }
  return table.filter(value => value !== 0);
}

// Same rejection sampling and MT word consumption as PythonRandom.randbelow.
// Avoid BigInt allocation for the millions of <=50-way setup selections.
function smallRandbelow(rng, n) {
  if (!Number.isSafeInteger(n) || n <= 0 || n > 0xffffffff) return rng.randbelow(n);
  const bits = 32 - Math.clz32(n);
  let value;
  do { value = rng.uint32() >>> (32 - bits); } while (value >= n);
  return value;
}

export function randomFormula(rng, numVars, numClauses) {
  const formula = [];
  for (let i = 0; i < numClauses; i++) {
    const count = 1 + smallRandbelow(rng, numVars), draws = [];
    for (let j = 0; j < count; j++) draws.push(1 + smallRandbelow(rng, numVars));
    formula.push(pythonPositiveIntSet(draws).map(j => (smallRandbelow(rng, 2) ? 1 : -1) * j));
  }
  return formula;
}

// The public evaluator retains reduce's empty-input errors and visits every
// literal. On the challenge's bit inputs, Python's bool/int result is 0 or 1.
export function evalFormula(formula, vars) {
  if (!formula.length) throw Error('reduce() of empty iterable with no initial value');
  let result = 0;
  for (const clause of formula) {
    if (!clause.length) throw Error('reduce() of empty iterable with no initial value');
    let conjunction = 1;
    for (const literal of clause) {
      let index = literal > 0 ? literal - 1 : -literal - 1;
      if (index < 0) index += vars.length;
      if (index < 0 || index >= vars.length) throw Error('list index out of range');
      conjunction &= literal > 0 ? vars[index] : Number(!vars[index]);
    }
    result |= conjunction;
  }
  return result;
}

// Only called with generated, nonempty clauses and a full 0/1 assignment.
// Short-circuiting this evaluation does not skip any random draws.
function evalGeneratedFormula(formula, vars) {
  for (const clause of formula) {
    let matches = true;
    for (const c of clause) {
      if (c > 0 ? !vars[c - 1] : vars[-c - 1]) { matches = false; break; }
    }
    if (matches) return 1;
  }
  return 0;
}

export function getBalanced(rng, numVars, numClauses, numTrials = 512, threshold = 0.05) {
  for (;;) {
    const dnf = randomFormula(rng, numVars, numClauses);
    const vars = new Uint8Array(numVars);
    let balance = 0;
    for (let trial = 0; trial < numTrials; trial++) {
      for (let i = 0; i < numVars; i++) vars[i] = smallRandbelow(rng, 2);
      balance += evalGeneratedFormula(dnf, vars) ? 1 : -1;
    }
    if (-numTrials * threshold < balance && balance < numTrials * threshold) return dnf;
  }
}

export class PrivateHash {
  constructor(N_in, N_out, rng, n_clauses = 9, verif_lvl = 512, progress = () => {}) {
    this.N_in = N_in;
    this.N_out = N_out;
    this.functions = [];
    progress(0, N_out);
    for (let i = 0; i < N_out; i++) {
      this.functions.push(getBalanced(rng, N_in, n_clauses, verif_lvl));
      progress(i + 1, N_out);
    }
  }

  hash(numb) {
    numb = BigInt(numb);
    const magnitude = numb < 0n ? -numb : numb;
    if (magnitude.toString(2).length > this.N_in && magnitude !== 0n) throw Error('');
    // bin(-n)[2:] contains 'b', which fails in the original map(int, ...).
    if (numb < 0n) throw Error("invalid literal for int() with base 10: 'b'");
    const vars = Array.from(numb.toString(2).padStart(this.N_in, '0'), Number);
    let result = 0n;
    for (let i = 0; i < this.N_out; i++) {
      result = result * 2n + BigInt(evalFormula(this.functions[i], vars));
    }
    return result;
  }
}

// Match hex(n)[2:].zfill(width), including the odd 'x...' for negative n.
export function diagnosticHex(n, width) {
  n = BigInt(n);
  return (n < 0n ? `x${(-n).toString(16)}` : n.toString(16)).padStart(width, '0');
}

export function verifyChain(H, blokes, hashes, elapsedSeconds, miningRate = 1) {
  const firstIndex = Math.floor(Math.trunc(elapsedSeconds) / miningRate);
  const lines = [];
  let payout = 0n;
  for (let i = firstIndex; i < blokes.length; i++) {
    const bloke = blokes[i < 0 ? blokes.length + i : i];
    const submitted = hashes[i < 0 ? hashes.length + i : i];
    if (bloke === undefined || submitted === undefined) throw Error('list index out of range');
    const expected = H.hash(bloke[0]);
    if (expected === submitted) payout += BigInt(bloke[1]);
    lines.push(`expected hash ${diagnosticHex(expected, Math.floor(H.N_out / 4))} for ${bloke[0]} got ${diagnosticHex(submitted, Math.floor(H.N_out / 4))}`);
  }
  return { payout, lines, firstIndex };
}

export function canDestroyVessels(balance) {
  return BigInt(balance) > PARAMETERS.payoutThreshold;
}

export async function run(io, options = {}) {
  const p = PARAMETERS;
  const rng = PythonRandom.fresh(n => io.randomBytes(n));
  const H = new PrivateHash(p.inputs, p.outputs, rng, p.clauses, p.trials,
    (done, total) => io.status?.(`Generating balanced DNFs: ${done}/${total}`));
  // The source installs its alarm only after the expensive PrivateHash setup.
  io.setDeadline(p.deadline);
  let balance = 0n, blokes, startTime;
  for (;;) {
    try {
      const option = integer(await io.read(PROMPT));
      if (option === 1n) {
        io.write('Retriving new blokes in the pool');
        startTime = io.now();
        blokes = Array.from({ length: p.blocks }, () => [
          io.randomBelow(1n << BigInt(p.inputs)), io.randomBelow(100_000n),
        ]);
      } else if (option === 2n) {
        if (!blokes) throw Error("'BlokeChain' object has no attribute 'blokes'");
        const hashes = [];
        for (let i = 0; i < p.blocks; i++) {
          hashes.push(integer(await io.read(`enter hash for ${blokes[i][0]}: `)));
        }
        const result = verifyChain(H, blokes, hashes, io.now() - startTime, p.miningRate);
        for (const line of result.lines) io.write(line);
        balance += result.payout;
        io.write(`Balance: ${balance}`);
      } else if (option === 3n) {
        if (canDestroyVessels(balance)) io.win(io.reward);
        else io.write('Attack blocked!');
        return;
      }
      // Unknown integer options intentionally do nothing and read again.
    } catch (error) {
      io.write(error.message ?? String(error));
      io.write('Enabling self defend system in: 1...');
      return;
    }
  }
}
