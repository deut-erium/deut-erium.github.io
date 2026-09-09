// Python numeric/text semantics used by the archived zh3r0 practice ports.
import { gcd, integer } from '../lib/bytes.mjs';

// str.split() without a separator uses Python's Unicode whitespace set.
const SPACE = '[\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const EDGE_SPACE = new RegExp(`^${SPACE}+|${SPACE}+$`, 'g');
const SPLIT_SPACE = new RegExp(`${SPACE}+`);
export function parseGuess(text) {
  const stripped = text.replace(EDGE_SPACE, '');
  return stripped === '' ? [] : stripped.split(SPLIT_SPACE).map(s => {
    // Check before the shared parser's JS trim(), which also strips a BOM.
    if (!/^[+-]?[0-9](?:_?[0-9])*$/.test(s)) throw Error('invalid literal for int()');
    return integer(s);
  });
}

export function parseFloatGuess(text) {
  // Like Python float(), but numeric digits are ASCII under the port contract.
  // Unlike str.split(), float() rejects the four ASCII information separators.
  const space = '[\\u0009-\\u000d\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
  const s = text.replace(new RegExp(`^${space}+|${space}+$`, 'g'), '');
  if (/^[+-]?nan$/i.test(s)) return NaN;
  if (/^[+-]?inf(?:inity)?$/i.test(s)) return s[0] === '-' ? -Infinity : Infinity;
  const digits = '[0-9](?:_?[0-9])*';
  if (!new RegExp(`^[+-]?(?:${digits}(?:\\.(?:${digits})?)?|\\.${digits})(?:[eE][+-]?${digits})?$`).test(s)) {
    throw Error('could not convert string to float');
  }
  return Number(s.replaceAll('_', ''));
}

export function fraction(numerator, denominator = 1n) {
  if (denominator === 0n) throw Error('Fraction denominator is zero');
  if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
  const common = gcd(numerator, denominator);
  return { numerator: numerator / common, denominator: denominator / common };
}

export function fractionString({ numerator, denominator }) {
  return denominator === 1n ? String(numerator) : `${numerator}/${denominator}`;
}

function roundRatio(n, d) {
  const q = n / d, twiceRemainder = 2n * (n % d);
  return q + (twiceRemainder > d || (twiceRemainder === d && (q & 1n)) ? 1n : 0n);
}

// Integer division rounded once to binary64, as float(Fraction) in CPython.
// Converting both integers to Number before division would round twice.
export function fractionFloat({ numerator, denominator }) {
  const negative = numerator < 0n;
  const n = negative ? -numerator : numerator, d = denominator;
  if (n === 0n) return 0;
  let exponent = n.toString(2).length - d.toString(2).length;
  if (exponent >= 0 ? n < (d << BigInt(exponent)) : (n << BigInt(-exponent)) < d) exponent--;
  if (exponent > 1023) throw Error('integer division result too large for a float');
  const shift = exponent < -1022 ? 1074 : 52 - exponent;
  const significand = shift >= 0 ? roundRatio(n << BigInt(shift), d) : roundRatio(n, d << BigInt(-shift));
  const result = Number(significand) * 2 ** (-shift);
  if (!Number.isFinite(result)) throw Error('integer division result too large for a float');
  return negative ? -result : result;
}

// Python's fixed-point display uses round-to-nearest, ties-to-even, including
// negative zero and values for which JS toFixed() switches to exponent form.
export function pythonFixed(value, places = 2) {
  if (Number.isNaN(value)) return 'nan';
  if (!Number.isFinite(value)) return value < 0 ? '-inf' : 'inf';
  if (!Number.isSafeInteger(places) || places < 0) throw Error('invalid precision');
  const negative = value < 0 || Object.is(value, -0);
  const buffer = new ArrayBuffer(8), view = new DataView(buffer);
  view.setFloat64(0, Math.abs(value), false);
  const bits = view.getBigUint64(0, false), encodedExponent = Number((bits >> 52n) & 2047n);
  const mantissa = (bits & ((1n << 52n) - 1n)) | (encodedExponent ? 1n << 52n : 0n);
  const exponent = encodedExponent ? encodedExponent - 1023 - 52 : -1074;
  let scaled = mantissa * 10n ** BigInt(places);
  scaled = exponent >= 0 ? scaled << BigInt(exponent) : roundRatio(scaled, 1n << BigInt(-exponent));
  const digits = String(scaled).padStart(places + 1, '0');
  return (negative ? '-' : '') + (places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits);
}
