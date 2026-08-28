import { cellsFor, kicksFor, rotatedState } from "./pieces.js?v=20260911";

function firstRotation(board, piece, direction) {
  const to = rotatedState(piece.rotation, direction);
  for (const [kickX, kickY] of kicksFor(piece.type, piece.rotation, to)) {
    const candidate = {
      ...piece,
      rotation: to,
      x: piece.x + kickX,
      y: piece.y + kickY,
    };
    if (!board.collides(candidate)) return candidate;
  }
  return null;
}

function stateKey(piece) {
  return `${piece.x},${piece.y},${piece.rotation}`;
}

function geometricKey(piece) {
  return cellsFor(piece)
    .map(({ x, y }) => `${x},${y}`)
    .sort()
    .join(";");
}

function searchReachableStates(board, start, visit) {
  if (!start || board.collides(start)) return;
  const queue = [{ ...start }];
  const visited = new Set([stateKey(start)]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const piece = queue[cursor];
    if (visit(piece) === false) return;

    const candidates = [
      { ...piece, x: piece.x - 1 },
      { ...piece, x: piece.x + 1 },
      { ...piece, y: piece.y + 1 },
      firstRotation(board, piece, -1),
      firstRotation(board, piece, 1),
    ];
    for (const candidate of candidates) {
      if (!candidate || candidate.y < -4 || board.collides(candidate)) continue;
      const key = stateKey(candidate);
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push(candidate);
    }
  }
}

export function reachableLockPlacements(board, start, { allowHidden = false } = {}) {
  const placements = [];
  const geometries = new Set();
  searchReachableStates(board, start, (piece) => {
    if (!board.collides({ ...piece, y: piece.y + 1 })) return;
    if (!allowHidden && cellsFor(piece).some(({ y }) => y < board.hiddenRows)) return;
    const key = geometricKey(piece);
    if (geometries.has(key)) return;
    geometries.add(key);
    placements.push({ ...piece });
  });
  return placements;
}

export function isReachableLockPlacement(board, start, target, { allowHidden = false } = {}) {
  if (!start || !target || start.type !== target.type) return false;
  if (![target.x, target.y, target.rotation].every(Number.isInteger)) return false;
  if (target.rotation < 0 || target.rotation > 3 || board.collides(target)) return false;
  if (!allowHidden && cellsFor(target).some(({ y }) => y < board.hiddenRows)) return false;
  if (!board.collides({ ...target, y: target.y + 1 })) return false;

  let found = false;
  searchReachableStates(board, start, (piece) => {
    if (piece.x === target.x && piece.y === target.y && piece.rotation === target.rotation) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}
