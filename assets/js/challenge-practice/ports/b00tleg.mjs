// Browser port of zh3r0 CTF 2021 b00tleg, organizer-practice.py.
// The archived source has no license header. Keep its eight tutorial stages,
// RNG split, cached substitutions/primes, and intentional encryption flaws.
import {fromHex, integer, gcd} from '../lib/bytes.mjs';
import {PythonRandom} from '../lib/python-random.mjs';
import {
  inc_by_one, bytes_to_int, mono_sub, poly_sub, substitution, rand_subt,
  xor_key_appended, pow_mod_prime, rand_pow_mod_prime, getPrime, primeSieve,
} from './b00tleg-helpers.mjs';

// Dependencies are explicit for reference tests; run() always creates fresh
// state from IO entropy. There are no option-based keys or reduced parameters.
export class B00tleg {
  constructor(rng, randomBytes, status = () => {}) {
    this.rng = rng;
    this.randomBytes = randomBytes;
    this.status = status;
    this.constants = {};
  }

  encrypt(level, bytes) {
    const c = this.constants;
    switch (level) {
      case 0: return inc_by_one(bytes);
      case 1: return bytes_to_int(bytes);
      case 2:
        c.mono_trans ??= substitution(this.rng);
        return mono_sub(bytes, c.mono_trans);
      case 3:
        c.poly_trans ??= Array.from({length: 15}, () => substitution(this.rng));
        return poly_sub(bytes, c.poly_trans);
      case 4: return rand_subt(bytes, this.rng);
      case 5: return xor_key_appended(bytes, this.rng);
      case 6:
        if (c.pow_mod_prime_p === undefined) {
          this.status('Generating the level 7 prime (1024 bits).');
          this.sieve ??= primeSieve();
          let p;
          do { p = getPrime(1024, this.randomBytes, this.sieve); } while (gcd(p - 1n, 3n) !== 1n);
          c.pow_mod_prime_p = p;
        }
        return pow_mod_prime(bytes, c.pow_mod_prime_p);
      case 7:
        if (c.RPMP_p === undefined) {
          this.status('Generating the level 8 prime (1024 bits) and exponent (7 bits).');
          this.sieve ??= primeSieve();
          let p = getPrime(1024, this.randomBytes, this.sieve);
          const e = getPrime(7, this.randomBytes, this.sieve);
          // The original resamples only p when the exponent is not coprime.
          while (gcd(p - 1n, e) !== 1n) p = getPrime(1024, this.randomBytes, this.sieve);
          c.RPMP_p = p;
          c.RPMP_e = e;
        }
        return rand_pow_mod_prime(bytes, c.RPMP_p, c.RPMP_e);
      default: throw Error('invalid level');
    }
  }
}

export async function run(io, options = {}) {
  const encode = text => new TextEncoder().encode(text);
  const secrets = [
    'hello world! Lets get going',
    'Nothing fancy, just standard bytes_to_int',
    'mono substitutions arent that creative',
    'creating different substitutions for each char',
    'Glad that you figured out the invariant',
    'Here we append the key with your shit, please dont tell anyone',
    'Cube modulo prime, any guesses what might be coming next?',
    io.reward,
  ].map(encode);
  const cipher = new B00tleg(PythonRandom.fresh(n => io.randomBytes(n)),
    n => io.randomBytes(n), text => io.status?.(text));
  let level = 0;
  io.write('Welcome to your basic cryptanalysis tutorial\n' +
    'There would be 8 levels, each level bringing something new on \n' +
    'the plate. I would be generous enough to let you encrypt any \n' +
    'string of your choice. Once you figure out the encryption, \n' +
    'submit the flag to proceed to the next level.\n');
  io.write(`Level: 1, encrypted flag: ${cipher.encrypt(level, secrets[level])}`);
  for (;;) {
    io.write('\n[1] Encrypt\n[2] Submit level flag');
    try {
      const option = integer(await io.read('>>> '));
      if (option === 1n) {
        io.write(cipher.encrypt(level, fromHex(await io.read('message in hex:'))));
      } else if (option === 2n) {
        const message = fromHex(await io.read('flag in hex:'));
        if (message.length !== secrets[level].length ||
            !message.every((value, i) => value === secrets[level][i])) {
          io.write('Incorrect, exiting');
          return;
        }
        io.write('Correct');
        level++;
        if (level === 8) {
          // final_flag() exits before Python can print another "Level:" line.
          io.win('Shh, you got the flag already');
          return;
        }
        // Preserve the original off-by-one display after each accepted flag.
        io.write(`Level: ${level}, encrypted flag: ${cipher.encrypt(level, secrets[level])}`);
      } else {
        io.write('Unexpected option, exiting');
        return;
      }
    } catch {
      io.write('Error, Exiting');
      return;
    }
  }
}
