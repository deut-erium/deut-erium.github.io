export const PIECE_TYPES = Object.freeze(["I", "J", "L", "O", "S", "T", "Z"]);

// Cartridge states use offsets from the piece's logical anchor. They are not
// normalized to a bounding box because the changing anchor is part of rotation.
export const PIECES = Object.freeze({
  I: [
    [[-1, 0], [0, 0], [1, 0], [2, 0]],
    [[0, -2], [0, -1], [0, 0], [0, 1]],
    [[-1, 0], [0, 0], [1, 0], [2, 0]],
    [[0, -2], [0, -1], [0, 0], [0, 1]],
  ],
  J: [
    [[0, -1], [1, -1], [0, 0], [0, 1]],
    [[-1, -1], [0, -1], [1, -1], [1, 0]],
    [[1, -1], [1, 0], [0, 1], [1, 1]],
    [[-1, -1], [-1, 0], [0, 0], [1, 0]],
  ],
  L: [
    [[-1, -1], [0, -1], [0, 0], [0, 1]],
    [[1, -1], [-1, 0], [0, 0], [1, 0]],
    [[-1, -1], [-1, 0], [-1, 1], [0, 1]],
    [[-1, -1], [0, -1], [1, -1], [-1, 0]],
  ],
  O: [
    [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[0, 0], [1, 0], [0, 1], [1, 1]],
  ],
  S: [
    [[0, -1], [1, -1], [-1, 0], [0, 0]],
    [[0, -1], [0, 0], [1, 0], [1, 1]],
    [[0, -1], [1, -1], [-1, 0], [0, 0]],
    [[0, -1], [0, 0], [1, 0], [1, 1]],
  ],
  T: [
    [[-1, 0], [0, 0], [1, 0], [0, 1]],
    [[0, -1], [-1, 0], [0, 0], [0, 1]],
    [[0, -1], [-1, 0], [0, 0], [1, 0]],
    [[0, -1], [0, 0], [1, 0], [0, 1]],
  ],
  Z: [
    [[-1, -1], [0, -1], [0, 0], [1, 0]],
    [[0, -1], [-1, 0], [0, 0], [-1, 1]],
    [[-1, -1], [0, -1], [0, 0], [1, 0]],
    [[0, -1], [-1, 0], [0, 0], [-1, 1]],
  ],
});

export const STARTING_ROTATIONS = Object.freeze({
  I: 0,
  J: 1,
  L: 3,
  O: 0,
  S: 0,
  T: 2,
  Z: 0,
});

const CLOCKWISE_KICKS = Object.freeze([
  [0, 0],
  [0, 1],
  [1, 0],
  [-1, 0],
  [0, -1],
]);

const COUNTERCLOCKWISE_KICKS = Object.freeze([
  [0, 0],
  [0, 1],
  [-1, 0],
  [1, 0],
  [0, -1],
]);

export function cellsFor(piece) {
  const shape = PIECES[piece.type]?.[piece.rotation];
  if (!shape) throw new Error(`Invalid piece: ${JSON.stringify(piece)}`);
  return shape.map(([x, y]) => ({ x: piece.x + x, y: piece.y + y }));
}

export function kicksFor(_type, from, to) {
  if (to === rotatedState(from, 1)) return CLOCKWISE_KICKS;
  if (to === rotatedState(from, -1)) return COUNTERCLOCKWISE_KICKS;
  return [[0, 0]];
}

export function rotatedState(rotation, direction) {
  return (rotation + (direction > 0 ? 1 : 3)) % 4;
}

export function spawnPiece(type, boardWidth = 10, hiddenRows = 2) {
  const hasLeftSpawnOffset = type === "I" || type === "O";
  return {
    type,
    rotation: STARTING_ROTATIONS[type],
    x: Math.floor(boardWidth / 2) - (hasLeftSpawnOffset ? 1 : 0),
    y: hiddenRows - 1 - (type === "O" ? 1 : 0),
  };
}
