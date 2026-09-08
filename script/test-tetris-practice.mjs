import test from "node:test";
import assert from "node:assert/strict";
import { createConstruction, loadConstruction, PracticeGame } from "../tetrasquares/src/practice.js";
import { Game } from "../tetrasquares/src/game.js?v=20260911";
import { cellsFor, kicksFor, rotatedState } from "../tetrasquares/src/pieces.js?v=20260911";
import four from "../tetrasquares/src/catalog/data-4.js";
import six from "../tetrasquares/src/catalog/data-6.js";

const key = (piece) => `${piece.x},${piece.y},${piece.rotation}`;
const geometry = (piece) => cellsFor(piece).map(({ x, y }) => `${x},${y}`).sort().join(";");

// Find a route, then execute it through the real public movement methods.
// No test injects a board, placement, score, or active-piece position.
function inputPath(game, target) {
  const queue = [{ piece: game.active, parent: -1, action: null }];
  const seen = new Set([key(game.active)]);
  for (let i = 0; i < queue.length; i += 1) {
    const { piece } = queue[i];
    if (geometry(piece) === geometry(target)) {
      const path = [];
      for (let j = i; queue[j].parent !== -1; j = queue[j].parent) path.push(queue[j].action);
      return path.reverse();
    }
    const choices = [
      ["left", { ...piece, x: piece.x - 1 }],
      ["right", { ...piece, x: piece.x + 1 }],
      ["down", { ...piece, y: piece.y + 1 }],
    ];
    for (const direction of [-1, 1]) {
      const rotation = rotatedState(piece.rotation, direction);
      const candidate = kicksFor(piece.type, piece.rotation, rotation)
        .map(([x, y]) => ({ ...piece, rotation, x: piece.x + x, y: piece.y + y }))
        .find((p) => !game.board.collides(p));
      if (candidate) choices.push([direction === -1 ? "ccw" : "cw", candidate]);
    }
    for (const [action, candidate] of choices) {
      if (candidate.y < -4 || seen.has(key(candidate)) || game.board.collides(candidate)) continue;
      seen.add(key(candidate));
      queue.push({ piece: candidate, parent: i, action });
    }
  }
  throw new Error(`No input path for ${game.practice.construction.id}`);
}

export function playStep(game) {
  const target = game.practice.construction.steps[game.practice.placed];
  for (const action of inputPath(game, target)) {
    const result = action === "left" ? game.move(-1, 0)
      : action === "right" ? game.move(1, 0)
        : action === "down" ? game.softDrop()
          : game.rotate(action === "cw" ? 1 : -1);
    assert.equal(result, true);
  }
  const placed = game.practice.placed;
  game.hardDrop();
  assert.equal(game.practice.placed, placed + 1);
}

function make(size = 4, id = "O4") {
  const family = (size === 4 ? four : six).find((f) => f.id === id);
  const game = new PracticeGame(createConstruction(family, size));
  game.start();
  return game;
}

test("every illustrated catalog order is geometrically valid and reachable", () => {
  for (const [size, families] of [[4, four], [6, six]]) {
    for (const family of families) {
      const construction = createConstruction(family, size);
      assert.equal(construction.steps.length, size * size / 4, family.id);
      assert.ok(Object.isFrozen(construction));
    }
  }
});

test("representative constructions complete using movement, rotation, and drop only", () => {
  const samples = [[4, "O4"], [4, "T4"], [4, "J2-S2"],
    [6, six[0].id], [6, six.at(-1).id], [6, six.find((f) => f.diversity === 7).id]];
  for (const [size, id] of samples) {
    const game = make(size, id);
    const events = [];
    game.onEvent((event) => events.push(event.type));
    while (game.status === "playing") playStep(game);
    assert.equal(game.status, "complete", id);
    assert.equal(game.stats.pieces, size * size / 4);
    assert.equal(game.active, null);
    assert.deepEqual(game.queue, []);
    assert.equal(game.challenge, null);
    assert.equal(game.challengeScore, 0); // Building stores value; it does not collect it.
    assert.equal(events.filter((e) => e === "practicecomplete").length, 1);
    assert.equal(events.includes("challengecomplete"), false);
    assert.equal(game.stats.squares[(size === 4 ? four : six).find((f) => f.id === id).kind][size], 1);
    assert.throws(() => game.getChallengeReplay(), /No challenge/);
    game.hardDrop();
    game.lockActive();
    assert.equal(game.stats.pieces, size * size / 4);
  }
});

test("wrong drops do not alter the locked board, active piece, queue, or score", () => {
  const game = make();
  const before = JSON.stringify({ board: game.board, active: game.active, queue: game.queue, score: game.score });
  game.hardDrop();
  assert.equal(game.practice.misses, 1);
  assert.equal(game.practice.placed, 0);
  assert.equal(JSON.stringify({ board: game.board, active: game.active, queue: game.queue, score: game.score }), before);
  playStep(game);
  assert.equal(game.practice.placed, 1);
});

test("practice is untimed, fixed-order, pausable, and replay-isolated", () => {
  const game = make();
  const before = JSON.stringify({ active: game.active, queue: game.queue });
  for (let i = 0; i < 1000; i += 1) game.tick(100);
  assert.equal(game.hold(), false);
  assert.equal(JSON.stringify({ active: game.active, queue: game.queue }), before);
  game.togglePause();
  game.hardDrop();
  assert.equal(game.practice.misses, 0);
  assert.equal(game.move(1, 0), false);
  game.togglePause();
  playStep(game);
  game.practice.showHint = true;
  game.restart();
  assert.equal(game.practice.placed, 0);
  assert.equal(game.practice.misses, 0);
  assert.equal(game.practice.showHint, true);
  assert.equal(game.status, "playing");
  assert.equal(JSON.stringify({ active: game.active, queue: game.queue }), before);
  assert.throws(() => game.startChallenge("test"), /Leave practice/);
  assert.equal(game.challenge, null);
});

test("completed practice retries the same construction", () => {
  const game = make(4, "T4");
  while (game.status === "playing") playStep(game);
  game.restart();
  assert.equal(game.practice.construction.id, "T4");
  assert.equal(game.practice.placed, 0);
  assert.equal(game.active.type, "T");
});

test("only known illustrated examples can be selected by URL", async () => {
  assert.equal((await loadConstruction("?practice=4&family=O4")).id, "O4");
  assert.equal((await loadConstruction(`?practice=6&family=${encodeURIComponent(six[0].id)}`)).size, 6);
  for (const query of ["", "?practice=8&family=O16", "?practice=04&family=O4",
    "?practice=4&family=unknown", "?practice=4&family=O4&challenge=2026-09-07",
    "?practice=4&practice=6&family=O4", "?practice=4&family=O4&family=T4",
    "?practice=constructor&family=O4", "?practice=4&family=%3Cscript%3E"]) {
    await assert.rejects(loadConstruction(query));
  }
});

test("malformed geometry, order, and unreachable placements are rejected", () => {
  const original = four.find((f) => f.id === "O4");
  for (const mutate of [
    (f) => { f.pieces[0].cells[0] = [-1, 0]; },
    (f) => { f.pieces[0].cells[0] = [0.5, 0]; },
    (f) => { f.pieces[0].cells[0] = f.pieces[0].cells[1]; },
    (f) => { f.pieces[0].type = "T"; },
    (f) => { f.order[0] = f.order[1]; },
    (f) => { f.order[0] = "unknown"; },
    (f) => { f.order.reverse(); },
  ]) {
    const changed = structuredClone(original);
    mutate(changed);
    assert.throws(() => createConstruction(changed, 4));
  }
  assert.throws(() => createConstruction(original, 8));
});

test("normal daily and endless games retain their existing behavior", () => {
  const game = new Game();
  game.startChallenge("new-tetris:daily-v5:2026-09-07", { pieceLimit: 1 });
  game.hardDrop();
  assert.equal(game.status, "complete");
  assert.equal(game.getChallengeReplay().placements.length, 1);
  game.start();
  assert.equal(game.challenge, null);
  assert.equal(game.practice, undefined);
  assert.equal(game.hold(), true);
  const y = game.active.y;
  for (let i = 0; i < 10; i += 1) game.tick(100);
  assert.equal(game.active.y, y + 1);
});
