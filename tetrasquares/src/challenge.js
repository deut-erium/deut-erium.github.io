export const CHALLENGE_RULESET = "daily-v5";
export const DAILY_BAGS = 16;
export const DAILY_PIECE_LIMIT = 63 * DAILY_BAGS;
// Three visible previews plus a possible unreturned first hold can expose four
// source pieces beyond the successful-lock limit.
export const DAILY_SEQUENCE_LENGTH = DAILY_PIECE_LIMIT + 4;
export const CHALLENGE_LINE_SCORES = Object.freeze([0, 100, 300, 500, 800]);
export const CHALLENGE_SPIN_POINTS = 500;

export function challengeLineScore(rows) {
  if (!Number.isInteger(rows) || rows < 0) throw new RangeError(`Invalid cleared row count: ${rows}`);
  return CHALLENGE_LINE_SCORES[Math.min(rows, CHALLENGE_LINE_SCORES.length - 1)];
}

export function normalizeChallengeDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError(`Invalid challenge date: ${value}`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new RangeError(`Invalid challenge date: ${value}`);
  }
  return value;
}

export function dailySeed(value) {
  return `new-tetris:${CHALLENGE_RULESET}:${normalizeChallengeDate(value)}`;
}

export function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}
