// Browser port of the zh3r0 CTF 2021 "real_mersenne" challenge.
// Derived from assets/challenges/zh3r0-2021-real-mersenne/challenge.py.
import { PythonRandom } from '../lib/python-random.mjs';
import { fraction, fractionFloat, fractionString, parseFloatGuess, pythonFixed } from './simple-helpers.mjs';

export function score(a, b) {
  if (Math.abs(a - b) < 1 / 2 ** 10) return fraction(1024n);
  // int(float) truncates toward zero. BigInt also rejects NaN and infinity.
  return fraction(2n ** 53n, BigInt(Math.trunc(2 ** 53 * a)) - BigInt(Math.trunc(2 ** 53 * b)));
}

export async function run(io, options = {}) {
  const rng = PythonRandom.fresh(n => io.randomBytes(n));
  let totalScore = 0;
  for (let round = 0; round < 2000; round++) {
    try {
      const x = rng.random();
      const y = parseFloatGuess(await io.read('enter your guess:\n'));
      const roundScore = score(x, y);
      totalScore += fractionFloat(roundScore);
      io.write(`total score: ${pythonFixed(totalScore)}, round score: ${fractionString(roundScore)}`);
      if (totalScore > 10 ** 6) {
        io.win();
        // The Python bare except catches its own exit(0) after printing flag.
        io.write('Error, exiting');
        return;
      }
    } catch {
      io.write('Error, exiting');
      return;
    }
  }
  io.write('Maybe better luck next time');
}
