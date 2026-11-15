#!/usr/bin/env node
// Generate one geometric tiling per 8x8 piece mix; no full tiling enumeration.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PIECES, PIECE_TYPES } from '../tetrasquares/src/pieces.js';
import { expandEightFamily, eightExamplePieces } from '../tetrasquares/src/catalog/catalog-model.js';

const target = new URL('../tetrasquares/src/catalog/data-8.js', import.meta.url);
const source = fs.readFileSync(target, 'utf8');
const rows = JSON.parse(source.replace(/^export default /, '').replace(/;\s*$/, ''));
const write = process.argv.slice(2).join(' ') === '--write';
if (!write && process.argv.slice(2).join(' ') !== '--check') {
  console.error('Usage: node script/render-tetrasquares-examples.mjs --write | --check');
  process.exit(2);
}
const byFirst = Array.from({ length: 64 }, () => []);
PIECE_TYPES.forEach((type, typeIndex) => {
  const seen = new Set();
  PIECES[type].forEach((shape, rotation) => {
    const minX = Math.min(...shape.map(([x]) => x));
    const minY = Math.min(...shape.map(([, y]) => y));
    const cells = shape.map(([x, y]) => [x - minX, y - minY]);
    const key = JSON.stringify([...cells].sort((a, b) => a[1] - b[1] || a[0] - b[0]));
    if (seen.has(key)) return;
    seen.add(key);
    const width = Math.max(...cells.map(([x]) => x)) + 1;
    const height = Math.max(...cells.map(([, y]) => y)) + 1;
    for (let top = 0; top <= 8 - height; top += 1) {
      for (let left = 0; left <= 8 - width; left += 1) {
        const indexes = cells.map(([x, y]) => (top + y) * 8 + left + x);
        let low = 0, high = 0;
        for (const cell of indexes) {
          if (cell < 32) low |= 1 << cell;
          else high |= 1 << (cell - 32);
        }
        byFirst[Math.min(...indexes)].push({ typeIndex, low, high, code: rotation * 64 + top * 8 + left });
      }
    }
  });
});
const weights = PIECE_TYPES.map((_, index) => 17 ** index);
const started = performance.now();
let generated = 0, totalNodes = 0, maxNodes = 0;

function exampleFor([id, quota]) {
  const counts = [...quota];
  const path = [], failed = new Set();
  let nodes = 0;
  function search(low, high, remaining) {
    nodes += 1;
    if (nodes > 250000 || performance.now() - started > 30000) {
      throw new Error(`Search budget reached for ${id}; data file was not changed`);
    }
    if (low === -1 && high === -1) return true;
    const free = low === -1 ? ~high : ~low;
    const first = (low === -1 ? 32 : 0) + 31 - Math.clz32(free & -free);
    const state = `${low}/${high}/${remaining}`;
    if (failed.has(state)) return false;
    for (const placement of byFirst[first]) {
      const { typeIndex, low: maskLow, high: maskHigh } = placement;
      if (!counts[typeIndex] || (low & maskLow) || (high & maskHigh)) continue;
      counts[typeIndex] -= 1;
      path.push(placement);
      if (search(low | maskLow, high | maskHigh, remaining - weights[typeIndex])) return true;
      path.pop();
      counts[typeIndex] += 1;
    }
    failed.add(state);
    return false;
  }
  if (!search(0, 0, counts.reduce((sum, count, index) => sum + count * weights[index], 0))) {
    throw new Error(`No example found for ${id}; data file was not changed`);
  }
  totalNodes += nodes;
  maxNodes = Math.max(maxNodes, nodes);
  path.sort((a, b) => a.typeIndex - b.typeIndex || a.code - b.code);
  return Buffer.from(path.map(({ code }) => code)).toString('base64');
}

for (const row of rows) {
  if (!row[3]) {
    if (!write) throw new Error(`Missing example: ${row[0]}`);
    row[3] = exampleFor(row);
    generated += 1;
  }
  eightExamplePieces(expandEightFamily(row));
}
if (write) fs.writeFileSync(target, `export default ${JSON.stringify(rows)};\n`);
console.log(JSON.stringify({ families: rows.length, generated, totalNodes, maxNodes,
  milliseconds: Math.round(performance.now() - started), path: fileURLToPath(target) }));
