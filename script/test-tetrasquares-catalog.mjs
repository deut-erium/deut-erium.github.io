import { test } from 'node:test';
import assert from 'node:assert/strict';
import data from '../tetrasquares/src/catalog/data-8.js';
import { PIECES, PIECE_TYPES } from '../tetrasquares/src/pieces.js';
import { EIGHT_LIST_PAGE, expandEightFamily, eightExamplePieces, familyPage } from '../tetrasquares/src/catalog/catalog-model.js';

function geometry(cells) {
  const left = Math.min(...cells.map(([x]) => x));
  const top = Math.min(...cells.map(([, y]) => y));
  return cells.map(([x, y]) => `${x - left},${y - top}`).sort().join(';');
}
const rotations = Object.fromEntries(PIECE_TYPES.map((type) => [type, new Set(PIECES[type].map(geometry))]));

test('every 8x8 piece mix has a complete example using real game shapes', () => {
  assert.equal(data.length, 30434);
  assert.equal(new Set(data.map(([id]) => id)).size, data.length);
  assert.equal(data.reduce((sum, [, , fixed]) => sum + fixed, 0), 19077209438);
  for (const row of data) {
    const family = expandEightFamily(row);
    assert.equal(family.id, PIECE_TYPES.filter((type) => family.counts[type])
      .map((type) => `${type}${family.counts[type]}`).join('-'));
    const pieces = eightExamplePieces(family);
    assert.equal(pieces.length, 16, family.id);
    assert.equal(new Set(pieces.map(({ id }) => id)).size, 16, family.id);
    const cells = new Set(), counts = {};
    for (const piece of pieces) {
      assert.equal(piece.cells.length, 4, family.id);
      assert.ok(rotations[piece.type].has(geometry(piece.cells)), `${family.id}: ${piece.type}`);
      counts[piece.type] = (counts[piece.type] ?? 0) + 1;
      for (const [x, y] of piece.cells) {
        assert.ok(Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < 8 && y >= 0 && y < 8, family.id);
        const cell = `${x},${y}`;
        assert.ok(!cells.has(cell), family.id);
        cells.add(cell);
      }
    }
    assert.equal(cells.size, 64, family.id);
    assert.deepEqual(counts, family.counts, family.id);
    assert.equal(family.scoring.points, family.kind === 'gold' ? 20000 : 10000);
    assert.equal(Object.hasOwn(family, 'order'), false, 'A geometric tiling is not a verified drop order');
  }
});

test('invalid, missing, overlapping and out-of-bounds examples are rejected', () => {
  const row = data.find(([id]) => id === 'O16');
  for (const example of [undefined, '', 'not an example', Buffer.alloc(16).toString('base64'), Buffer.alloc(16, 63).toString('base64')]) {
    assert.throws(() => eightExamplePieces(expandEightFamily([...row.slice(0, 3), example])));
  }
  for (const quota of [[-1, 0, 0, 17, 0, 0, 0], [0, 0, 0, 15, 0, 0, 0], [0, 0, 0, 16.5, 0, 0, 0]]) {
    assert.throws(() => expandEightFamily([row[0], quota, row[2], row[3]]));
  }
});

test('8x8 examples remain available after paging and filtering', () => {
  const families = data.map(expandEightFamily);
  for (const index of [0, EIGHT_LIST_PAGE - 1, EIGHT_LIST_PAGE, 15000, families.length - 1]) {
    const chosen = families[index];
    const page = familyPage(families, chosen.id, 8);
    assert.ok(page.families.includes(chosen));
    assert.ok(page.families.length <= EIGHT_LIST_PAGE);
    assert.equal(eightExamplePieces(chosen).length, 16);
  }
  for (const filtered of [families.filter(({ kind }) => kind === 'gold'), families.filter(({ spectrum }) => spectrum)]) {
    assert.ok(filtered.length > 0);
    const chosen = filtered.at(-1);
    assert.ok(familyPage(filtered, chosen.id, 8).families.includes(chosen));
    assert.equal(eightExamplePieces(chosen).length, 16);
  }
});
