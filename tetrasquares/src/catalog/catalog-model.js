import { PIECES, PIECE_TYPES } from "../pieces.js?v=20260911";

export const EIGHT_LIST_PAGE = 250;

export function expandEightFamily([id, values, fixed, example]) {
  if (!Array.isArray(values) || values.length !== 7
      || values.some((count) => !Number.isInteger(count) || count < 0 || count > 16)) {
    throw new Error("Invalid 8x8 piece mix");
  }
  const counts = Object.fromEntries(PIECE_TYPES
    .map((type, index) => [type, values[index]])
    .filter(([, count]) => count > 0));
  const pieceTotal = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (pieceTotal !== 16 || !Number.isInteger(fixed) || fixed <= 0
      || typeof example !== "string") throw new Error("Invalid 8x8 piece mix");
  const diversity = Object.keys(counts).length;
  const kind = diversity === 1 ? "gold" : "silver";
  return {
    id,
    counts,
    kind,
    spectrum: diversity === 7,
    diversity,
    signature: Object.values(counts).sort((a, b) => b - a),
    fixed,
    example,
    scoring: { points: kind === "gold" ? 20000 : 10000 },
  };
}

/** One byte per piece: two rotation bits and a six-bit bounding-box origin.
 * Piece types follow counts in IJLOSTZ order. This encodes a tiling, not a drop order.
 */
export function eightExamplePieces(family) {
  if (!/^[A-Za-z0-9+/]{22}==$/.test(family.example)) throw new Error("Invalid 8x8 example");
  const bytes = atob(family.example);
  const occupied = new Set();
  const pieces = [];
  for (const type of PIECE_TYPES) {
    for (let index = 0; index < (family.counts[type] ?? 0); index += 1) {
      const code = bytes.charCodeAt(pieces.length);
      const shape = PIECES[type][code >> 6];
      const minX = Math.min(...shape.map(([x]) => x));
      const minY = Math.min(...shape.map(([, y]) => y));
      const left = code & 7;
      const top = (code >> 3) & 7;
      const cells = shape.map(([x, y]) => [left + x - minX, top + y - minY]);
      for (const [x, y] of cells) {
        const cell = y * 8 + x;
        if (x < 0 || x >= 8 || y < 0 || y >= 8 || occupied.has(cell)) {
          throw new Error("8x8 example pieces overlap or leave the square");
        }
        occupied.add(cell);
      }
      pieces.push({ id: String.fromCharCode(65 + pieces.length), type, cells });
    }
  }
  if (pieces.length !== 16 || occupied.size !== 64) throw new Error("Incomplete 8x8 example");
  return pieces;
}

export function familyPage(families, selectedId, size) {
  if (families.length === 0) return { start: 0, end: 0, families: [] };
  const selected = families.findIndex((family) => family.id === selectedId);
  const selectedIndex = selected < 0 ? 0 : selected;
  const start = size === 8 ? Math.floor(selectedIndex / EIGHT_LIST_PAGE) * EIGHT_LIST_PAGE : 0;
  const end = size === 8 ? Math.min(start + EIGHT_LIST_PAGE, families.length) : families.length;
  return { start, end, families: families.slice(start, end) };
}
