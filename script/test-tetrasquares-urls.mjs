import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { dailySeed } from '../tetrasquares/src/challenge.js';
import { writeUILayoutToUrl } from '../tetrasquares/src/ui-layout.js';

const main = fs.readFileSync('tetrasquares/src/main.js', 'utf8');
const catalog = fs.readFileSync('tetrasquares/src/catalog/catalog.js', 'utf8');

test('storage keys and daily seed namespace remain unchanged', () => {
  assert.match(main, /const SAVED_REPLAY_KEY = "new-tetris:daily-v5:last-replay";/);
  assert.match(main, /const SAVED_KEY_BINDINGS_KEY = "new-tetris:controls-v1";/);
  assert.equal(dailySeed('2026-09-07'), 'new-tetris:daily-v5:2026-09-07');
});

test('the real challenge URL helper keeps the new path and selected layout', () => {
  const source = main.match(/function challengeUrl\(date\) \{[\s\S]*?\n\}/)[0];
  for (const layout of ['pop-schematic', 'warm-cartridge']) {
    const context = { URL, window: { location: { href: 'https://example.invalid/tetrasquares/?practice=4&family=T4#target' } }, uiLayout: { id: layout }, writeUILayoutToUrl };
    vm.runInNewContext(source + '; result = challengeUrl("2026-09-07");', context);
    assert.equal(context.result.pathname, '/tetrasquares/');
    assert.equal(context.result.searchParams.get('challenge'), '2026-09-07');
    assert.equal(context.result.searchParams.has('practice'), false);
    assert.equal(context.result.searchParams.has('family'), false);
    assert.equal(context.result.hash, '');
    if (layout === 'warm-cartridge') assert.equal(context.result.searchParams.get('layout'), layout);
  }
});

test('practice and catalog URL constructors target canonical pages', () => {
  const fromGame = main.match(/const catalogUrl = (new URL\([^;]+);/)[1];
  const fromCatalog = catalog.match(/const practiceUrl = (new URL\([^;]+);/)[1];
  for (const href of ['https://example.invalid/tetrasquares/', 'https://example.invalid/tetrasquares/index.html?practice=6&family=O9']) {
    const target = vm.runInNewContext(fromGame, { URL, location: { href } });
    assert.equal(target.pathname, '/tetrasquares/catalog/');
  }
  for (const href of ['https://example.invalid/tetrasquares/catalog/', 'https://example.invalid/tetrasquares/catalog/index.html?size=6&family=O9']) {
    const target = vm.runInNewContext(fromCatalog, { URL, location: { href } });
    assert.equal(target.pathname, '/tetrasquares/');
  }
});
