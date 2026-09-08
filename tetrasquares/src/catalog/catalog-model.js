export const EIGHT_LIST_PAGE = 250;

export function expandEightFamily([id, values, fixed]) {
  if (!Array.isArray(values) || values.length !== 7) throw new Error("Invalid 8x8 piece mix");
  const counts = Object.fromEntries("IJLOSTZ".split("")
    .map((type, index) => [type, values[index]])
    .filter(([, count]) => count > 0));
  const pieceTotal = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (pieceTotal !== 16 || !Number.isInteger(fixed) || fixed <= 0) throw new Error("Invalid 8x8 piece mix");
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
    scoring: { points: kind === "gold" ? 20000 : 10000 },
  };
}

export function familyPage(families, selectedId, size) {
  if (families.length === 0) return { start: 0, end: 0, families: [] };
  const selected = families.findIndex((family) => family.id === selectedId);
  const selectedIndex = selected < 0 ? 0 : selected;
  const start = size === 8 ? Math.floor(selectedIndex / EIGHT_LIST_PAGE) * EIGHT_LIST_PAGE : 0;
  const end = size === 8 ? Math.min(start + EIGHT_LIST_PAGE, families.length) : families.length;
  return { start, end, families: families.slice(start, end) };
}
