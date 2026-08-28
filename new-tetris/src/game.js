import { Board } from "./board.js?v=20260911";
import { Bag63Randomizer, SeededBag63Randomizer } from "./randomizer.js?v=20260911";
import { cellsFor, kicksFor, rotatedState, spawnPiece } from "./pieces.js?v=20260911";
import { scoreSquare } from "./square-scoring.js?v=20260911";
import {
  CHALLENGE_RULESET,
  CHALLENGE_SPIN_POINTS,
  DAILY_PIECE_LIMIT,
  challengeLineScore,
} from "./challenge.js?v=20260911";

export const SQUARE_SIZES = Object.freeze([4, 6, 8]);

export const GAME_RULES = Object.freeze({
  previewCount: 3,
  lockDelayMs: 500,
  maxLockResets: 15,
  squareSize: 4,
  squareSizes: Object.freeze([8, 6, 4]),
  linesPerLevel: 10,
});

const GRAVITY_MS = Object.freeze([
  1000, 850, 700, 580, 480, 400, 330, 280, 230, 190,
  160, 135, 115, 95, 80, 70, 60, 50, 45, 40,
]);

const LINE_SCORE = Object.freeze([0, 100, 300, 500, 800]);

export class Game {
  constructor({ board = new Board(), randomizer = new Bag63Randomizer(), rules = {} } = {}) {
    this.board = board;
    this.casualRandomizer = randomizer;
    this.randomizer = randomizer;
    this.rules = { ...GAME_RULES, ...rules };
    this.events = [];
    this.eventListeners = new Set();
    this.challenge = null;
    this.resetState();
  }

  resetState() {
    this.status = "idle";
    this.active = null;
    this.queue = [];
    this.heldType = null;
    this.canHold = true;
    this.nextPieceId = 1;
    this.gravityElapsed = 0;
    this.lockElapsed = 0;
    this.lockResets = 0;
    this.lastAction = null;
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.combo = -1;
    this.stats = {
      silver: 0,
      gold: 0,
      spinMoves: 0,
      pieces: 0,
      squares: {
        silver: { 4: 0, 6: 0, 8: 0 },
        gold: { 4: 0, 6: 0, 8: 0 },
      },
    };
    this.challengeScore = 0;
    this.challengePieces = 0;
    this.challengePlacements = [];
    this.challengeTerminal = null;
    this.placementUsedHold = false;
  }

  initializeRun() {
    this.board.reset();
    this.resetState();
    this.events.length = 0;
    this.status = "playing";
    this.fillQueue();
    this.spawnNext();
    this.emit("start", { challenge: this.challenge ? { ...this.challenge } : null });
  }

  start() {
    this.challenge = null;
    this.randomizer = this.casualRandomizer;
    this.initializeRun();
  }

  startChallenge(seed, { pieceLimit = DAILY_PIECE_LIMIT } = {}) {
    if (typeof seed !== "string" || seed.length === 0) throw new RangeError("Challenge seed cannot be empty");
    if (!Number.isInteger(pieceLimit) || pieceLimit <= 0) throw new RangeError(`Invalid challenge piece limit: ${pieceLimit}`);
    this.challenge = {
      ruleset: CHALLENGE_RULESET,
      seed,
      pieceLimit,
    };
    this.randomizer = new SeededBag63Randomizer(seed);
    this.initializeRun();
  }

  restart() {
    if (this.challenge) {
      this.startChallenge(this.challenge.seed, { pieceLimit: this.challenge.pieceLimit });
    } else {
      this.start();
    }
  }

  fillQueue() {
    while (this.queue.length < this.rules.previewCount + 1) {
      this.queue.push(this.randomizer.next());
    }
  }

  spawnNext({ enableHold = true, blockoutReason = "blockout" } = {}) {
    this.fillQueue();
    const type = this.queue.shift();
    this.fillQueue();
    return this.spawnType(type, { enableHold, blockoutReason });
  }

  spawnType(type, { enableHold = true, blockoutReason = "blockout" } = {}) {
    this.active = spawnPiece(type, this.board.width, this.board.hiddenRows);
    this.canHold = enableHold;
    this.gravityElapsed = 0;
    this.lockElapsed = 0;
    this.lockResets = 0;
    this.lastAction = { kind: "spawn" };
    this.placementUsedHold = false;

    if (this.board.collides(this.active)) {
      this.active = null;
      this.status = "gameover";
      this.emit("gameover", { reason: blockoutReason });
      return false;
    }
    this.emit("spawn", { type });
    return true;
  }

  hold() {
    if (this.status !== "playing" || !this.active || !this.canHold) return false;
    const outgoing = this.active.type;
    const incoming = this.heldType;
    this.heldType = outgoing;
    this.active = null;
    if (this.challenge) this.challengeTerminal = { kind: "hold-blockout" };

    const spawned = incoming === null
      ? this.spawnNext({ enableHold: false, blockoutReason: "hold-blockout" })
      : this.spawnType(incoming, { enableHold: false, blockoutReason: "hold-blockout" });
    if (spawned) {
      if (this.challenge) this.challengeTerminal = null;
      this.placementUsedHold = true;
      this.emit("hold", { held: this.heldType, active: this.active.type });
    }
    return spawned;
  }

  togglePause() {
    if (this.status === "playing") {
      this.status = "paused";
      this.emit("pause");
    } else if (this.status === "paused") {
      this.status = "playing";
      this.emit("resume");
    }
  }

  gravityInterval() {
    return GRAVITY_MS[Math.min(this.level - 1, GRAVITY_MS.length - 1)];
  }

  tick(deltaMs) {
    if (this.status !== "playing" || !this.active || deltaMs <= 0) return;
    let remaining = Math.min(deltaMs, 100);

    while (remaining > 0 && this.status === "playing" && this.active) {
      if (this.isGrounded()) {
        const untilLock = Math.max(0, this.rules.lockDelayMs - this.lockElapsed);
        const elapsed = Math.min(remaining, untilLock);
        this.lockElapsed += elapsed;
        remaining -= elapsed;
        if (this.lockElapsed >= this.rules.lockDelayMs) this.lockActive();
        continue;
      }

      const untilGravity = Math.max(0, this.gravityInterval() - this.gravityElapsed);
      const elapsed = Math.min(remaining, untilGravity);
      this.gravityElapsed += elapsed;
      remaining -= elapsed;
      if (this.gravityElapsed >= this.gravityInterval()) {
        this.gravityElapsed = 0;
        this.move(0, 1, { gravity: true });
      }
    }
  }

  isGrounded(piece = this.active) {
    if (!piece) return false;
    return this.board.collides({ ...piece, y: piece.y + 1 });
  }

  move(dx, dy, { softDrop = false, gravity = false } = {}) {
    if (this.status !== "playing" || !this.active) return false;
    const wasGrounded = this.isGrounded();
    const candidate = { ...this.active, x: this.active.x + dx, y: this.active.y + dy };
    if (this.board.collides(candidate)) return false;

    this.active = candidate;
    if (softDrop && dy > 0) this.score += dy;
    if (dx !== 0) {
      this.lastAction = { kind: "move" };
    } else if (dy > 0) {
      this.lastAction = { kind: gravity ? "gravity" : (softDrop ? "softDrop" : "drop") };
    }
    this.updateLockAfterManipulation(wasGrounded);
    return true;
  }

  rotate(direction) {
    if (this.status !== "playing" || !this.active) return false;
    const from = this.active.rotation;
    const to = rotatedState(from, direction);
    const wasGrounded = this.isGrounded();

    for (const [kickX, kickY] of kicksFor(this.active.type, from, to)) {
      const candidate = {
        ...this.active,
        rotation: to,
        x: this.active.x + kickX,
        y: this.active.y + kickY,
      };
      if (this.board.collides(candidate)) continue;
      this.active = candidate;
      this.lastAction = { kind: "rotate", direction, kickX, kickY };
      this.updateLockAfterManipulation(wasGrounded);
      this.emit("rotate", this.lastAction);
      return true;
    }
    return false;
  }

  updateLockAfterManipulation(wasGrounded) {
    if (!wasGrounded) return;
    if (this.lockResets < this.rules.maxLockResets) {
      this.lockElapsed = 0;
      this.lockResets += 1;
    }
  }

  softDrop() {
    return this.move(0, 1, { softDrop: true });
  }

  hardDrop() {
    if (this.status !== "playing" || !this.active) return 0;
    let distance = 0;
    while (this.move(0, 1)) distance += 1;
    this.score += distance * 2;
    this.emit("harddrop", { distance });
    this.lockActive();
    return distance;
  }

  ghostPiece() {
    if (!this.active) return null;
    const ghost = { ...this.active };
    while (!this.board.collides({ ...ghost, y: ghost.y + 1 })) ghost.y += 1;
    return ghost;
  }

  lockActive() {
    if (this.status !== "playing" || !this.active) return;
    const piece = this.active;
    if (cellsFor(piece).some(({ y }) => y < this.board.hiddenRows)) {
      if (this.challenge) {
        this.challengeTerminal = {
          kind: "lockout",
          hold: this.placementUsedHold,
          type: piece.type,
          rotation: piece.rotation,
          x: piece.x,
          y: piece.y,
        };
      }
      this.active = null;
      this.status = "gameover";
      this.emit("gameover", { reason: "lockout" });
      return;
    }
    const pieceId = this.nextPieceId;
    this.nextPieceId += 1;

    this.board.lock(piece, pieceId);
    if (this.challenge) {
      this.challengePlacements.push({
        hold: this.placementUsedHold,
        type: piece.type,
        rotation: piece.rotation,
        x: piece.x,
        y: piece.y,
      });
      this.challengePieces += 1;
    }
    this.stats.pieces += 1;
    const squares = this.board.findSquares(pieceId, this.rules.squareSizes);
    for (const square of squares) {
      const scoring = scoreSquare(square);
      this.stats[square.kind] += 1;
      this.stats.squares[square.kind][square.size] += 1;
      const rowShares = this.board.addPendingSquareAward(square, scoring.points);
      this.emit("square", { ...square, scoring: { ...scoring, rowShares, pending: true } });
    }

    const spinMove = squares.length === 0 ? this.board.applySpinAvalanche(pieceId) : null;
    if (spinMove) {
      this.stats.spinMoves += 1;
      this.challengeScore += CHALLENGE_SPIN_POINTS;
      this.emit("spinmove", spinMove);
    }

    const fullRows = this.board.completedRows();
    const clear = this.board.clearRows(fullRows);
    if (clear.count > 0) {
      this.combo += 1;
      const base = LINE_SCORE[Math.min(clear.count, LINE_SCORE.length - 1)] ?? 0;
      const comboBonus = this.combo > 0 ? this.combo * 50 : 0;
      const squareBonus = clear.squareCells.silver * 25 + clear.squareCells.gold * 50;
      this.score += (base + comboBonus + squareBonus) * this.level + clear.squareAward.points;
      this.lines += clear.count;
      this.level = Math.floor(this.lines / this.rules.linesPerLevel) + 1;
      this.challengeScore += challengeLineScore(clear.count) + clear.squareAward.points;
      this.emit("lineclear", { ...clear, spinMove: Boolean(spinMove), combo: this.combo });
    } else {
      this.combo = -1;
    }

    this.active = null;
    if (this.board.hasBlocksInHiddenRows()) {
      this.status = "gameover";
      this.emit("gameover", { reason: "lockout" });
      return;
    }
    if (this.challenge && this.challengePieces >= this.challenge.pieceLimit) {
      this.status = "complete";
      this.emit("challengecomplete", {
        score: this.challengeScore,
        pieces: this.challengePieces,
        pieceLimit: this.challenge.pieceLimit,
      });
      return;
    }
    this.spawnNext();
  }

  getChallengeReplay() {
    if (!this.challenge) throw new Error("No challenge run is active");
    return {
      format: "new-tetris-challenge-replay",
      version: 2,
      challenge: { ...this.challenge },
      placements: this.challengePlacements.map((placement) => ({ ...placement })),
      terminal: this.challengeTerminal ? { ...this.challengeTerminal } : null,
      result: {
        status: this.status,
        challengeScore: this.challengeScore,
        pieces: this.challengePieces,
        lines: this.lines,
        gold: this.stats.gold,
        silver: this.stats.silver,
        spinMoves: this.stats.spinMoves,
      },
    };
  }

  activeCells() {
    return this.active ? cellsFor(this.active) : [];
  }

  emit(type, detail = {}) {
    const event = { type, detail };
    this.events.push(event);
    for (const listener of this.eventListeners) listener(event);
  }

  onEvent(listener) {
    if (typeof listener !== "function") throw new TypeError("Event listener must be a function");
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  drainEvents() {
    return this.events.splice(0);
  }
}
