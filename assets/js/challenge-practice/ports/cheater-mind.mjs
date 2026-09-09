// Browser port of the archived "cheater-mind" challenge.
// Derived from the inspected archive member cheater-challenge.py.
import { PythonRandom } from '../lib/python-random.mjs';
import { parseGuess } from './simple-helpers.mjs';

export const LEVELS = Object.freeze([
  Object.freeze([6, 6, 0, 7]),
  Object.freeze([8, 6, 0, 8]),
  Object.freeze([8, 8, 0, 9]),
  Object.freeze([6, 6, 0.05, 10]),
  Object.freeze([8, 6, 0.05, 11]),
  Object.freeze([6, 6, 0.1, 12]),
]);

export function feedback(secret, guess) {
  let bulls = 0, common = 0;
  const remaining = new Map();
  for (const value of secret) remaining.set(value, (remaining.get(value) || 0) + 1);
  for (let i = 0; i < guess.length; i++) {
    const value = guess[i];
    if (i < secret.length && value === secret[i]) bulls++;
    const count = remaining.get(value) || 0;
    if (count) { common++; remaining.set(value, count - 1); }
  }
  return [bulls, common - bulls];
}

export class Agent {
  constructor(N, K, mutation, guessLimit, rng) {
    this.N = N;
    this.K = K;
    this.mutation = mutation;
    this.guessLimit = guessLimit;
    this.rng = rng;
    this.secret = Array.from({ length: K }, () => BigInt(rng.randint(1, N)));
  }

  play(guess) {
    if (guess.length === this.K && guess.every((v, i) => v === this.secret[i])) return [this.K, 0];
    // Even mutation=0 consumes a random double for each position. Exactly zero
    // still takes the randint branch because the original comparison is >.
    const mutated = this.secret.map(v => this.rng.random() > this.mutation ? v : BigInt(this.rng.randint(1, this.N)));
    // No guess-length/range restriction: zip stops at K, Counter sees the tail.
    return feedback(mutated, guess);
  }

  async game(io) {
    for (let guessNo = 0; guessNo < this.guessLimit; guessNo++) {
      const guess = parseGuess(await io.read('enter your guess as space separated integers:\n'));
      const [bulls, cows] = this.play(guess);
      io.write(`${bulls} ${cows}`);
      if (bulls === this.K) return true;
    }
    return false;
  }
}

export async function run(io, options = {}) {
  const rng = PythonRandom.fresh(n => io.randomBytes(n));
  io.write('Can you beat me at mastermind when I am not so honest?\n      https://en.wikipedia.org/wiki/Mastermind_(board_game)');
  for (let index = 0; index < LEVELS.length; index++) {
    const [N, K, mutation, guessLimit] = LEVELS[index];
    io.write(`Level ${index + 1}, N=${N}, K=${K}, mutation=${mutation}, guess limit=${guessLimit}`);
    const agent = new Agent(N, K, mutation, guessLimit, rng);
    let passed;
    try { passed = await agent.game(io); }
    catch { io.write('Error, exiting'); return; }
    if (passed) io.write('level passed, good job');
    else { io.write('You noob, try again'); return; }
  }
  io.win(`you earned it : ${io.reward}`);
}
