import { Game } from "./game.js?v=20260911";
import { Board } from "./board.js?v=20260911";
import { PIECES, cellsFor, spawnPiece } from "./pieces.js?v=20260911";
import { isReachableLockPlacement } from "./placement-search.js?v=20260911";

const DATA = Object.freeze({
  4: () => import("./catalog/data-4.js?v=20260911"),
  6: () => import("./catalog/data-6.js?v=20260911"),
});

const geometryKey = (cells) => cells.map(({ x, y }) => `${x},${y}`).sort().join(";");

/** Resolve only illustrated examples from our local catalog. */
export async function loadConstruction(search) {
  const params = new URLSearchParams(search);
  const size = params.get("practice");
  const id = params.get("family");
  if (params.has("challenge")) throw new Error("Practice and daily play cannot be combined.");
  if (params.getAll("practice").length !== 1 || params.getAll("family").length !== 1
      || !["4", "6"].includes(size) || !id || id.length > 64) {
    throw new Error("Choose an illustrated 4x4 or 6x6 construction from the catalog. The 8x8 catalog has counts only.");
  }
  const { default: families } = await DATA[size]();
  const family = families.find((entry) => entry.id === id);
  if (!family) throw new Error("That construction is not in the catalog.");
  return createConstruction(family, Number(size));
}

/** Match catalog cells to real piece rotations and validate the illustrated order. */
export function createConstruction(family, size) {
  if (![4, 6].includes(size) || !family || typeof family.id !== "string"
      || !Array.isArray(family.pieces) || !Array.isArray(family.order)
      || family.pieces.length !== size * size / 4 || family.order.length !== family.pieces.length) {
    throw new Error("This catalog entry has no supported construction.");
  }
  const board = new Board();
  const left = Math.floor((board.width - size) / 2);
  const top = board.height - size;
  const owners = new Set();
  const pieces = new Map();
  for (const piece of family.pieces) {
    if (!piece || typeof piece.id !== "string" || pieces.has(piece.id)
        || !Object.hasOwn(PIECES, piece.type) || !Array.isArray(piece.cells) || piece.cells.length !== 4) {
      throw new Error("Invalid construction piece.");
    }
    const target = piece.cells.map((cell) => {
      if (!Array.isArray(cell) || cell.length !== 2 || !cell.every(Number.isInteger)) {
        throw new Error("Invalid construction cell.");
      }
      const [x, y] = cell;
      const key = `${x},${y}`;
      if (x < 0 || x >= size || y < 0 || y >= size || owners.has(key)) {
        throw new Error("Construction cells overlap or leave the target square.");
      }
      owners.add(key);
      return Object.freeze({ x: x + left, y: y + top });
    });
    const minX = Math.min(...target.map((cell) => cell.x));
    const minY = Math.min(...target.map((cell) => cell.y));
    let placement = null;
    for (let rotation = 0; rotation < 4; rotation += 1) {
      const shape = PIECES[piece.type][rotation];
      const candidate = {
        type: piece.type, rotation,
        x: minX - Math.min(...shape.map(([x]) => x)),
        y: minY - Math.min(...shape.map(([, y]) => y)),
      };
      if (geometryKey(cellsFor(candidate)) === geometryKey(target)) {
        placement = candidate;
        break;
      }
    }
    if (!placement) throw new Error("A catalog piece does not match the game's rotations.");
    pieces.set(piece.id, Object.freeze({ ...placement, id: piece.id, cells: Object.freeze(target) }));
  }
  if (new Set(family.order).size !== family.pieces.length) throw new Error("Invalid construction order.");
  const steps = family.order.map((id, index) => {
    const step = pieces.get(id);
    if (!step || !isReachableLockPlacement(board, spawnPiece(step.type), step)) {
      throw new Error("The illustrated construction order is not reachable in this game.");
    }
    board.lock(step, index + 1);
    return step;
  });
  return Object.freeze({ id: family.id, size, left, top, steps: Object.freeze(steps) });
}

/** Untimed, exact-construction practice. Daily rules and replay code stay in Game. */
export class PracticeGame extends Game {
  constructor(construction) {
    super();
    this.practice = { construction, placed: 0, misses: 0, showHint: false };
    this.sequenceIndex = 0;
  }

  start() {
    this.sequenceIndex = 0;
    this.practice.placed = 0;
    this.practice.misses = 0;
    super.start();
  }

  startChallenge() {
    throw new Error("Leave practice to start a daily game.");
  }

  fillQueue() {
    const steps = this.practice.construction.steps;
    while (this.queue.length < this.rules.previewCount + 1 && this.sequenceIndex < steps.length) {
      this.queue.push(steps[this.sequenceIndex++].type);
    }
  }

  spawnNext(options) {
    if (this.practice.placed === this.practice.construction.steps.length) {
      this.active = null;
      this.status = "complete";
      this.emit("practicecomplete", { id: this.practice.construction.id, misses: this.practice.misses });
      return false;
    }
    return super.spawnNext(options);
  }

  // A fixed teaching sequence has neither Hold nor automatic gravity/locking.
  hold() { return false; }
  tick() {}

  matchesStep(piece) {
    const target = this.practice.construction.steps[this.practice.placed];
    return Boolean(target && piece && piece.type === target.type
      && geometryKey(cellsFor(piece)) === geometryKey(target.cells));
  }

  miss() {
    this.practice.misses += 1;
    this.emit("practicemiss", { step: this.practice.placed + 1 });
  }

  hardDrop() {
    if (this.status !== "playing" || !this.active) return 0;
    if (!this.matchesStep(this.ghostPiece())) {
      this.miss();
      return 0;
    }
    return super.hardDrop();
  }

  lockActive() {
    if (this.status !== "playing" || !this.active) return;
    if (!this.matchesStep(this.active)) {
      this.miss();
      return;
    }
    this.practice.placed += 1;
    super.lockActive();
    this.emit("practicestep", { placed: this.practice.placed });
  }
}
