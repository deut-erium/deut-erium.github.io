import { Game } from "./game.js?v=20260911";
import { cellsFor } from "./pieces.js?v=20260911";
import { isReachableLockPlacement } from "./placement-search.js?v=20260911";
import { CHALLENGE_RULESET, DAILY_PIECE_LIMIT, dailySeed } from "./challenge.js?v=20260911";

const MAX_SEED_LENGTH = 256;

function requireReplay(condition, message) {
  if (!condition) throw new Error(message);
}

function verifyReplayObject(replay) {
  requireReplay(replay?.format === "new-tetris-challenge-replay", "Unknown replay format");
  requireReplay(replay.version === 2, "Unsupported replay version");
  requireReplay(replay.challenge?.ruleset === CHALLENGE_RULESET, "Unsupported challenge ruleset");
  requireReplay(
    typeof replay.challenge.seed === "string"
      && replay.challenge.seed.length > 0
      && replay.challenge.seed.length <= MAX_SEED_LENGTH,
    "Invalid replay seed",
  );
  requireReplay(
    Number.isInteger(replay.challenge.pieceLimit)
      && replay.challenge.pieceLimit > 0
      && replay.challenge.pieceLimit <= DAILY_PIECE_LIMIT,
    "Invalid replay piece limit",
  );
  requireReplay(Array.isArray(replay.placements), "Replay placements must be an array");
  requireReplay(replay.placements.length <= replay.challenge.pieceLimit, "Replay exceeds its piece limit");
  requireReplay(replay.terminal === null || typeof replay.terminal === "object", "Invalid terminal action");
  requireReplay(replay.result && typeof replay.result === "object", "Replay result is missing");
}

function verifyExpectedChallenge(replay, expectedChallenge, allowCustom) {
  if (!expectedChallenge) {
    requireReplay(allowCustom, "Expected challenge metadata is required");
    return;
  }
  for (const field of ["ruleset", "seed", "pieceLimit"]) {
    requireReplay(replay.challenge[field] === expectedChallenge[field], `Challenge ${field} does not match`);
  }
}

function applyHold(game, hold, index) {
  requireReplay(typeof hold === "boolean", `Invalid hold flag at placement ${index}`);
  if (hold) requireReplay(game.hold(), `Illegal hold at placement ${index}`);
}

function targetFrom(record) {
  return {
    type: record.type,
    rotation: record.rotation,
    x: record.x,
    y: record.y,
  };
}

function applyTerminal(game, terminal) {
  if (!terminal) return;
  requireReplay(game.status === "playing" && game.active, "Terminal action occurs after the run ended");
  if (terminal.kind === "hold-blockout") {
    requireReplay(game.hold() === false && game.status === "gameover", "Terminal hold does not block out");
    return;
  }
  requireReplay(terminal.kind === "lockout", "Unknown terminal action");
  applyHold(game, terminal.hold, "terminal action");
  requireReplay(game.active?.type === terminal.type, "Terminal piece type mismatch");
  const target = targetFrom(terminal);
  requireReplay(cellsFor(target).some(({ y }) => y < game.board.hiddenRows), "Terminal lock does not occupy a hidden row");
  requireReplay(
    isReachableLockPlacement(game.board, game.active, target, { allowHidden: true }),
    "Unreachable terminal lock placement",
  );
  game.active = target;
  game.lockActive();
  requireReplay(game.status === "gameover", "Terminal lock does not end the run");
}

export function verifyChallengeReplay(
  replay,
  { allowPartial = false, allowCustom = false, expectedChallenge = null } = {},
) {
  try {
    verifyReplayObject(replay);
    verifyExpectedChallenge(replay, expectedChallenge, allowCustom);
    const game = new Game();
    game.startChallenge(replay.challenge.seed, { pieceLimit: replay.challenge.pieceLimit });
    game.drainEvents();

    for (const [index, placement] of replay.placements.entries()) {
      requireReplay(game.status === "playing" && game.active, `Run ended before placement ${index + 1}`);
      applyHold(game, placement?.hold, index + 1);
      requireReplay(game.active?.type === placement.type, `Piece type mismatch at placement ${index + 1}`);

      const target = targetFrom(placement);
      requireReplay(
        isReachableLockPlacement(game.board, game.active, target),
        `Unreachable lock placement ${index + 1}`,
      );
      game.active = target;
      game.lockActive();
    }

    applyTerminal(game, replay.terminal);
    requireReplay(game.challengePlacements.length === replay.placements.length, "Recorded placement count does not match replay");
    if (!allowPartial) {
      requireReplay(game.status === "complete" || game.status === "gameover", "Replay ends before the challenge is terminal");
    }
    requireReplay(game.status === replay.result.status, "Claimed status does not match replay");
    requireReplay(game.challengeScore === replay.result.challengeScore, "Claimed challenge score does not match replay");
    requireReplay(game.challengePieces === replay.result.pieces, "Claimed piece count does not match replay");
    requireReplay(game.lines === replay.result.lines, "Claimed line count does not match replay");
    requireReplay(game.stats.gold === replay.result.gold, "Claimed gold count does not match replay");
    requireReplay(game.stats.silver === replay.result.silver, "Claimed silver count does not match replay");
    requireReplay(game.stats.spinMoves === replay.result.spinMoves, "Claimed Spin Move count does not match replay");

    return {
      valid: true,
      status: game.status,
      challengeScore: game.challengeScore,
      pieces: game.challengePieces,
      lines: game.lines,
      gold: game.stats.gold,
      silver: game.stats.silver,
      spinMoves: game.stats.spinMoves,
    };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function verifyDailyChallengeReplay(replay, { date }) {
  return verifyChallengeReplay(replay, {
    expectedChallenge: {
      ruleset: CHALLENGE_RULESET,
      seed: dailySeed(date),
      pieceLimit: DAILY_PIECE_LIMIT,
    },
  });
}
