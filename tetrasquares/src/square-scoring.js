import { PIECES } from "./pieces.js?v=20260911";

const TYPE_ORDER = Object.freeze(["I", "J", "L", "O", "S", "T", "Z"]);
const SUPPORTED_SIZES = Object.freeze([4, 6, 8]);

function normalizedShape(cells) {
  const minX = Math.min(...cells.map(({ x }) => x));
  const minY = Math.min(...cells.map(({ y }) => y));
  return cells
    .map(({ x, y }) => `${x - minX},${y - minY}`)
    .sort()
    .join(";");
}

const VALID_SHAPES = Object.freeze(Object.fromEntries(TYPE_ORDER.map((type) => [
  type,
  new Set(PIECES[type].map((shape) => normalizedShape(shape.map(([x, y]) => ({ x, y }))))),
])));

const SIX_STRUCTURE = Object.freeze([
  Object.freeze({ maxPrime: 2, tier: "separable-core-1-2", label: "Breaks into groups of 1-2", bonus: 0 }),
  Object.freeze({ maxPrime: 4, tier: "separable-core-3-4", label: "Breaks into groups of 3-4", bonus: 500 }),
  Object.freeze({ maxPrime: 6, tier: "separable-core-5-6", label: "Breaks into groups of 5-6", bonus: 1000 }),
]);

export const EIGHT_SQUARE_POINTS = Object.freeze({ silver: 10000, gold: 20000 });

function pieceCrossesVertical(piece, cut, top, bottom) {
  let left = false;
  let right = false;
  for (const { x, y } of piece.cells) {
    if (y < top || y >= bottom) continue;
    if (x < cut) left = true;
    else right = true;
  }
  return left && right;
}

function pieceCrossesHorizontal(piece, cut, left, right) {
  let above = false;
  let below = false;
  for (const { x, y } of piece.cells) {
    if (x < left || x >= right) continue;
    if (y < cut) above = true;
    else below = true;
  }
  return above && below;
}

function piecesInside(pieces, left, top, right, bottom) {
  return pieces.filter((piece) => piece.cells.every(({ x, y }) => (
    x >= left && x < right && y >= top && y < bottom
  )));
}

function primeDecomposition(pieces, left, top, right, bottom, cache) {
  const key = `${left},${top},${right},${bottom}`;
  if (cache.has(key)) return cache.get(key);

  const regionPieces = piecesInside(pieces, left, top, right, bottom);
  const candidates = [];
  for (let cut = left + 1; cut < right; cut += 1) {
    if (regionPieces.some((piece) => pieceCrossesVertical(piece, cut, top, bottom))) continue;
    const first = primeDecomposition(regionPieces, left, top, cut, bottom, cache);
    const second = primeDecomposition(regionPieces, cut, top, right, bottom, cache);
    candidates.push({
      largestPrimeComponent: Math.max(first.largestPrimeComponent, second.largestPrimeComponent),
      primeComponents: first.primeComponents + second.primeComponents,
    });
  }
  for (let cut = top + 1; cut < bottom; cut += 1) {
    if (regionPieces.some((piece) => pieceCrossesHorizontal(piece, cut, left, right))) continue;
    const first = primeDecomposition(regionPieces, left, top, right, cut, cache);
    const second = primeDecomposition(regionPieces, left, cut, right, bottom, cache);
    candidates.push({
      largestPrimeComponent: Math.max(first.largestPrimeComponent, second.largestPrimeComponent),
      primeComponents: first.primeComponents + second.primeComponents,
    });
  }

  const result = candidates.length === 0
    ? { largestPrimeComponent: regionPieces.length, primeComponents: 1 }
    : candidates.reduce((best, candidate) => {
      if (candidate.largestPrimeComponent < best.largestPrimeComponent) return candidate;
      if (candidate.largestPrimeComponent > best.largestPrimeComponent) return best;
      return candidate.primeComponents > best.primeComponents ? candidate : best;
    });
  cache.set(key, result);
  return result;
}

function validateLayout(square) {
  if (!square || !SUPPORTED_SIZES.includes(square.size)) {
    throw new Error("Square scoring supports only numeric 4x4, 6x6, and 8x8 snapshots");
  }
  const expectedPieces = (square.size * square.size) / 4;
  if (!Array.isArray(square.pieces) || square.pieces.length !== expectedPieces) {
    throw new Error("Square scoring requires one complete piece snapshot per tetromino");
  }
  const occupied = new Set();
  const pieceIds = new Set();
  for (const piece of square.pieces) {
    if (!piece || !TYPE_ORDER.includes(piece.type) || !Array.isArray(piece.cells) || piece.cells.length !== 4) {
      throw new Error("Square scoring received an invalid tetromino snapshot");
    }
    if (pieceIds.has(piece.id)) throw new Error("Square scoring received a duplicate piece ID");
    pieceIds.add(piece.id);
    for (const cell of piece.cells) {
      const { x, y } = cell ?? {};
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= square.size || y >= square.size) {
        throw new Error("Square scoring received an out-of-bounds cell");
      }
      const key = `${x},${y}`;
      if (occupied.has(key)) throw new Error("Square scoring received overlapping cells");
      occupied.add(key);
    }
    if (!VALID_SHAPES[piece.type].has(normalizedShape(piece.cells))) {
      throw new Error("Square scoring received cells that do not match the declared tetromino");
    }
  }
  if (occupied.size !== square.size * square.size) {
    throw new Error("Square scoring requires a completely tiled square");
  }
}

export function analyzeSquare(square) {
  validateLayout(square);
  const counts = Object.fromEntries(TYPE_ORDER.map((type) => [type, 0]));
  for (const piece of square.pieces) counts[piece.type] += 1;
  const diversity = TYPE_ORDER.filter((type) => counts[type] > 0).length;
  const familyId = TYPE_ORDER
    .filter((type) => counts[type] > 0)
    .map((type) => `${type}${counts[type]}`)
    .join("-");
  const expectedKind = diversity === 1 ? "gold" : "silver";
  if (square.kind !== expectedKind) throw new Error("Square material does not match its composition");

  const crossings = [];
  for (let cut = 1; cut < square.size; cut += 1) {
    crossings.push(square.pieces.filter((piece) => pieceCrossesVertical(piece, cut, 0, square.size)).length);
    crossings.push(square.pieces.filter((piece) => pieceCrossesHorizontal(piece, cut, 0, square.size)).length);
  }
  const minimumFullCutCrossers = Math.min(...crossings);
  const cleanFullCuts = crossings.filter((count) => count === 0).length;
  const decomposition = primeDecomposition(
    square.pieces,
    0,
    0,
    square.size,
    square.size,
    new Map(),
  );

  return {
    familyId,
    typeCounts: counts,
    diversity,
    minimumFullCutCrossers,
    cleanFullCuts,
    ...decomposition,
  };
}

function scoreFour(analysis) {
  const interlocked = analysis.minimumFullCutCrossers > 0;
  const structureBonus = interlocked ? 1000 : 0;
  return {
    model: "4x4-composition-v1",
    points: 1000 + (analysis.diversity === 1 ? 1500 : 0) + 250 * (analysis.diversity - 1) + structureBonus,
    structureTier: interlocked ? "interlocked" : "separable",
    structureLabel: interlocked ? "No clean split" : "Has a clean split",
    structureBonus,
  };
}

function scoreSix(analysis) {
  let structure;
  if (analysis.largestPrimeComponent < 9) {
    structure = SIX_STRUCTURE.find(({ maxPrime }) => analysis.largestPrimeComponent <= maxPrime);
    if (!structure) throw new Error("Unexpected 6x6 prime-component size");
  } else if (analysis.minimumFullCutCrossers === 1) {
    structure = { tier: "interlocked-min-1", label: "No clean split / 1 piece crosses", bonus: 1500 };
  } else {
    structure = { tier: "interlocked-min-2", label: "No clean split / 2+ pieces cross", bonus: 2500 };
  }

  return {
    model: "6x6-composition-v1",
    points: 2500 + (analysis.diversity === 1 ? 3500 : 0) + 500 * (analysis.diversity - 1) + structure.bonus,
    structureTier: structure.tier,
    structureLabel: structure.label,
    structureBonus: structure.bonus,
  };
}

export function scoreSquare(square) {
  const analysis = analyzeSquare(square);
  let scoring;
  if (square.size === 4) scoring = scoreFour(analysis);
  else if (square.size === 6) scoring = scoreSix(analysis);
  else {
    scoring = {
      model: "8x8-size-v2",
      points: EIGHT_SQUARE_POINTS[analysis.diversity === 1 ? "gold" : "silver"],
      structureTier: "size-award",
      structureLabel: "8x8 size award",
      structureBonus: 0,
    };
  }
  return { ...analysis, ...scoring };
}
