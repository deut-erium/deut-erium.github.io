import { Game } from "./game.js?v=20260911";
import {
  INPUT_ACTIONS,
  INPUT_ACTION_LABELS,
  InputController,
  keyBindingLabel,
  keyBindingsLabel,
} from "./input.js?v=20260911";
import { Renderer } from "./renderer.js?v=20260911";
import { cellsFor } from "./pieces.js?v=20260911";
import { dailySeed, todayUtc } from "./challenge.js?v=20260911";
import { verifyDailyChallengeReplay } from "./replay.js?v=20260911";
import { selectUILayout, writeUILayoutToUrl } from "./ui-layout.js?v=20260911";

const SAVED_REPLAY_KEY = "new-tetris:daily-v5:last-replay";
const SAVED_KEY_BINDINGS_KEY = "new-tetris:controls-v1";

function requiredElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Page is missing required element #${id}`);
  return element;
}

const uiLayout = selectUILayout({
  search: window.location.search,
  roots: [document.documentElement, document.body],
});
const gameMachine = requiredElement("game-machine");
const gameLoading = requiredElement("game-loading");
const boardCanvas = requiredElement("board");
const nextCanvas = requiredElement("next");
const holdCanvas = requiredElement("hold");
const boardState = requiredElement("board-state");
const boardGrid = requiredElement("board-grid");
const gameAnnouncement = requiredElement("game-announcement");
const overlay = requiredElement("overlay-message");
const squareFlash = requiredElement("square-flash");
const challengeDate = requiredElement("challenge-date");
const startChallengeButton = requiredElement("start-challenge");
const startCasualButton = requiredElement("start-casual");
const copyChallengeLinkButton = requiredElement("copy-challenge-link");
const copyResultButton = requiredElement("copy-result");
const challengeMessage = requiredElement("challenge-message");
const resetKeyBindingsButton = requiredElement("reset-key-bindings");
const keyBindingStatus = requiredElement("key-binding-status");
const keyBindingButtons = Object.fromEntries(INPUT_ACTIONS.map((action) => [
  action,
  requiredElement(`bind-${action}`),
]));
const fields = {
  runMode: requiredElement("run-mode"),
  scoreLabel: requiredElement("score-label"),
  score: requiredElement("score"),
  lines: requiredElement("lines"),
  level: requiredElement("level"),
  pieces: requiredElement("pieces"),
  gold: requiredElement("gold"),
  silver: requiredElement("silver"),
  squares: {
    gold: {
      4: requiredElement("gold-4"),
      6: requiredElement("gold-6"),
      8: requiredElement("gold-8"),
    },
    silver: {
      4: requiredElement("silver-4"),
      6: requiredElement("silver-6"),
      8: requiredElement("silver-8"),
    },
  },
  lastSquare: requiredElement("last-square"),
  lastSquareMeta: requiredElement("last-square-meta"),
  squareAward: requiredElement("square-award"),
  challengeStatus: requiredElement("challenge-status"),
  challengePieces: requiredElement("challenge-pieces"),
};

function loadStoredKeyBindings() {
  try {
    const saved = localStorage.getItem(SAVED_KEY_BINDINGS_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

function saveKeyBindings(bindings) {
  try {
    localStorage.setItem(SAVED_KEY_BINDINGS_KEY, JSON.stringify(bindings));
    return true;
  } catch {
    return false;
  }
}

let pendingBindingAction = null;

function renderKeyBindings(bindings) {
  for (const action of INPUT_ACTIONS) {
    const button = keyBindingButtons[action];
    const waiting = action === pendingBindingAction;
    const label = keyBindingsLabel(bindings[action]);
    button.textContent = waiting ? "PRESS KEY" : label;
    button.classList.toggle("listening", waiting);
    button.setAttribute("aria-label", waiting
      ? `Waiting for a new key for ${INPUT_ACTION_LABELS[action]}`
      : `Change the key for ${INPUT_ACTION_LABELS[action]}. Current: ${label}`);
  }
}

function handleBindingEvent(event) {
  pendingBindingAction = event.type === "waiting" || event.type === "rejected" ? event.action : null;
  renderKeyBindings(event.bindings);
  const actionLabel = event.action ? INPUT_ACTION_LABELS[event.action] : null;

  if (event.type === "waiting") {
    keyBindingStatus.textContent = `${actionLabel}: press a key. Esc cancels.`;
    return;
  }
  if (event.type === "rejected") {
    keyBindingStatus.textContent = "Choose one key without Ctrl, Alt, Command, or Tab.";
    return;
  }
  if (event.type === "canceled") {
    keyBindingStatus.textContent = `${actionLabel} was not changed.`;
    return;
  }
  if (event.type === "reset") {
    const saved = saveKeyBindings(event.bindings);
    keyBindingStatus.textContent = saved ? "Default keys restored." : "Default keys restored for this session.";
    return;
  }
  if (event.type !== "changed") return;

  const saved = saveKeyBindings(event.bindings);
  let message = `${actionLabel} is now ${keyBindingLabel(event.key)}.`;
  if (event.conflictAction) {
    const conflictLabel = INPUT_ACTION_LABELS[event.conflictAction];
    message += ` ${conflictLabel} moved to ${keyBindingLabel(event.conflictReplacement)}.`;
  }
  if (!saved) message += " The change lasts for this session only.";
  keyBindingStatus.textContent = message;
}

export const game = new Game();
const renderer = new Renderer(boardCanvas, nextCanvas, holdCanvas, { theme: uiLayout.rendererTheme });
const input = new InputController(game, document, {
  bindings: loadStoredKeyBindings(),
  onBindingEvent: handleBindingEvent,
});
for (const action of INPUT_ACTIONS) {
  keyBindingButtons[action].addEventListener("click", () => input.beginRebind(action));
}
resetKeyBindingsButton.addEventListener("click", () => input.resetBindings());
renderKeyBindings(input.getBindings());
let lastTime = performance.now();
let replayVerificationGeneration = 0;
let accessibleBoardSignature = "";
const accessibleCells = [];

for (let row = 0; row < game.board.visibleRows; row += 1) {
  const tr = document.createElement("tr");
  const heading = document.createElement("th");
  heading.scope = "row";
  heading.textContent = `Row ${row + 1}`;
  tr.append(heading);
  const cells = [];
  for (let column = 0; column < game.board.width; column += 1) {
    const cell = document.createElement("td");
    cell.textContent = "empty";
    tr.append(cell);
    cells.push(cell);
  }
  boardGrid.append(tr);
  accessibleCells.push(cells);
}

function resetSquareResult() {
  fields.lastSquare.textContent = "NONE";
  fields.lastSquareMeta.textContent = "Build a complete 4x4, 6x6, or 8x8 area.";
  fields.squareAward.textContent = "-";
  squareFlash.textContent = "";
  squareFlash.classList.remove("fire");
}

function dateFromSeed(seed) {
  return seed.match(/\d{4}-\d{2}-\d{2}$/)?.[0] ?? null;
}

function saveTerminalReplay() {
  if (!game.challenge || (game.status !== "complete" && game.status !== "gameover")) return;
  const replay = game.getChallengeReplay();
  const date = dateFromSeed(game.challenge.seed);
  if (!date) {
    challengeMessage.textContent = "This custom seed is not an official daily replay.";
    return;
  }
  const generation = replayVerificationGeneration;
  challengeMessage.textContent = "Checking the final score...";
  setTimeout(() => {
    const result = verifyDailyChallengeReplay(replay, { date });
    const isCurrentRun = generation === replayVerificationGeneration;
    if (!result.valid) {
      if (isCurrentRun) challengeMessage.textContent = `Replay check failed: ${result.error}`;
      return;
    }
    try {
      localStorage.setItem(SAVED_REPLAY_KEY, JSON.stringify(replay));
      if (isCurrentRun) challengeMessage.textContent = "Final score checked and saved in this browser.";
    } catch {
      if (isCurrentRun) challengeMessage.textContent = "Final score checked. Browser storage is unavailable.";
    }
  }, 0);
}

function observeGameEvent(event) {
  if (event.type === "start") {
    challengeMessage.textContent = "";
    replayVerificationGeneration += 1;
  }
  if ((event.type === "challengecomplete" || event.type === "gameover") && game.challenge) {
    saveTerminalReplay();
  }
}

function fireSquareFlash(message) {
  squareFlash.textContent = message;
  squareFlash.classList.remove("fire");
  void squareFlash.offsetWidth;
  squareFlash.classList.add("fire");
}

export function handleEvents(events) {
  const announcements = [];
  for (const event of events) {
    if (event.type === "start") {
      resetSquareResult();
      announcements.push("Game started.");
    } else if (event.type === "spawn") {
      announcements.push(`New ${event.detail.type} piece.`);
    } else if (event.type === "hold") {
      announcements.push(`Held ${event.detail.held}. Active piece is ${event.detail.active}.`);
    } else if (event.type === "pause") {
      announcements.push("Game paused.");
    } else if (event.type === "resume") {
      announcements.push("Game resumed.");
    } else if (event.type === "gameover") {
      announcements.push("Game over.");
    } else if (event.type === "challengecomplete") {
      announcements.push("Daily game complete.");
    } else if (event.type === "lineclear") {
      const count = event.detail.count;
      announcements.push(`${count} ${count === 1 ? "line" : "lines"} cleared.`);
    }
    if (event.type === "lineclear" && event.detail.squareAward.points > 0) {
      const award = event.detail.squareAward;
      const material = award.gold > 0 && award.silver > 0
        ? "SQUARE"
        : (award.gold > 0 ? "GOLD" : "SILVER");
      const rows = award.rows === 1 ? "ROW" : "ROWS";
      fields.squareAward.textContent = `+${award.points.toLocaleString("en-US")} collected`;
      fireSquareFlash(`${material} ${rows} / +${award.points.toLocaleString("en-US")}`);
      continue;
    }
    if (event.type !== "square") continue;
    const scoring = event.detail.scoring;
    const kind = event.detail.kind[0].toUpperCase() + event.detail.kind.slice(1);
    fields.lastSquare.textContent = scoring.familyId;
    const typeCount = `${scoring.diversity} piece ${scoring.diversity === 1 ? "type" : "types"}`;
    fields.lastSquareMeta.textContent = `${event.detail.size}x${event.detail.size} / ${kind} / ${typeCount} / ${scoring.structureLabel}`;
    const lowShare = Math.min(...scoring.rowShares);
    const highShare = Math.max(...scoring.rowShares);
    const share = lowShare === highShare
      ? lowShare.toLocaleString("en-US")
      : `${lowShare.toLocaleString("en-US")}-${highShare.toLocaleString("en-US")}`;
    fields.squareAward.textContent = `${scoring.points.toLocaleString("en-US")} pending / ${share} per row`;
    fireSquareFlash(`${kind.toUpperCase()} ${event.detail.size}x${event.detail.size} / ${scoring.points.toLocaleString("en-US")} PENDING`);
    announcements.push(`${kind} ${event.detail.size} by ${event.detail.size} square completed.`);
  }
  if (announcements.length > 0) gameAnnouncement.textContent = announcements.join(" ");
}

function setOverlay(message) {
  if (overlay.textContent !== message) overlay.textContent = message;
  overlay.classList.toggle("visible", message.length > 0);
}

function renderAccessibleState() {
  const active = new Map();
  if (game.active) {
    for (const cell of cellsFor(game.active)) {
      if (cell.y < game.board.hiddenRows || cell.y >= game.board.height) continue;
      active.set(`${cell.x},${cell.y}`, game.active.type);
    }
  }

  const labels = [];
  let lockedCount = 0;
  for (let row = 0; row < game.board.visibleRows; row += 1) {
    const y = row + game.board.hiddenRows;
    for (let column = 0; column < game.board.width; column += 1) {
      const activeType = active.get(`${column},${y}`);
      const locked = game.board.get(column, y);
      if (locked) lockedCount += 1;
      labels.push(activeType ? `${activeType} active` : (locked ? `${locked.type} locked` : "empty"));
    }
  }
  const held = game.heldType ?? "none";
  const next = game.queue.slice(0, game.rules.previewCount);
  let activeSummary = "none";
  if (game.active) {
    const visibleRow = game.active.y - game.board.hiddenRows + 1;
    const rowLabel = visibleRow > 0 ? `row ${visibleRow}` : `spawn row ${visibleRow + game.board.hiddenRows}`;
    activeSummary = `${game.active.type}, rotation ${game.active.rotation}, origin column ${game.active.x + 1}, ${rowLabel}`;
  }
  const signature = [game.status, held, ...next, ...labels].join("|");
  if (signature === accessibleBoardSignature) return;
  accessibleBoardSignature = signature;

  let index = 0;
  for (const row of accessibleCells) {
    for (const cell of row) {
      cell.textContent = labels[index];
      index += 1;
    }
  }
  const queueSummary = next.length > 0 ? next.join(", ") : "none";
  boardState.textContent = `Status ${game.status}. Active piece ${activeSummary}. Held piece ${held}. Next pieces ${queueSummary}. ${lockedCount} locked cells.`;
  boardCanvas.setAttribute("aria-label", `10 by 20 Tetris board. Active piece ${activeSummary}. ${lockedCount} locked cells.`);
  holdCanvas.setAttribute("aria-label", `Held piece: ${held}.`);
  nextCanvas.setAttribute("aria-label", `Next pieces: ${queueSummary}.`);
}

export function updateHud() {
  renderAccessibleState();
  const isDaily = Boolean(game.challenge);
  fields.runMode.textContent = isDaily ? `DAILY / ${dateFromSeed(game.challenge.seed) ?? "CUSTOM"}` : "ENDLESS";
  fields.scoreLabel.textContent = "SCORE";
  fields.score.textContent = game.challengeScore.toLocaleString("en-US");
  fields.lines.textContent = game.lines.toLocaleString("en-US");
  fields.level.textContent = game.level.toLocaleString("en-US");
  fields.pieces.textContent = game.stats.pieces.toLocaleString("en-US");
  fields.gold.textContent = game.stats.gold.toLocaleString("en-US");
  fields.silver.textContent = game.stats.silver.toLocaleString("en-US");
  for (const kind of ["gold", "silver"]) {
    for (const size of [4, 6, 8]) {
      fields.squares[kind][size].textContent = game.stats.squares[kind][size].toLocaleString("en-US");
    }
  }

  if (isDaily) {
    const status = game.status === "complete"
      ? "COMPLETE"
      : (game.status === "gameover" ? "TOP OUT" : (game.status === "paused" ? "PAUSED" : "RUNNING"));
    fields.challengeStatus.textContent = status;
    fields.challengePieces.textContent = `${game.challengePieces.toLocaleString("en-US")} / ${game.challenge.pieceLimit.toLocaleString("en-US")}`;
    copyResultButton.disabled = game.status !== "complete" && game.status !== "gameover";
  } else {
    fields.challengeStatus.textContent = game.status === "paused" ? "ENDLESS / PAUSED" : "ENDLESS";
    fields.challengePieces.textContent = "NO LIMIT";
    copyResultButton.disabled = true;
  }

  document.body.dataset.run = isDaily ? "daily" : "free";
  if (game.status === "paused") {
    setOverlay("Paused");
  } else if (game.status === "gameover") {
    setOverlay("Game over - press R to restart");
  } else if (game.status === "complete") {
    setOverlay(`Daily game complete - ${game.challengeScore.toLocaleString("en-US")} points`);
  } else {
    setOverlay("");
  }
}

function frame(now) {
  const delta = Math.min(now - lastTime, 100);
  lastTime = now;
  input.update(delta);
  game.tick(delta);
  handleEvents(game.drainEvents());
  renderer.draw(game);
  updateHud();
  requestAnimationFrame(frame);
}

function challengeUrl(date) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  writeUILayoutToUrl(url, uiLayout.id);
  url.searchParams.set("challenge", date);
  return url;
}

function replaceChallengeUrl(date) {
  history.replaceState(null, "", challengeUrl(date));
}

function clearChallengeUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("challenge");
  history.replaceState(null, "", url);
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through to the local selection-based copy path.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard access is unavailable");
}

function refreshImmediately() {
  handleEvents(game.drainEvents());
  renderer.draw(game);
  updateHud();
  boardCanvas.focus();
}

function startDatedChallenge(date, { updateUrl = true } = {}) {
  const seed = dailySeed(date);
  challengeDate.value = date;
  game.startChallenge(seed);
  if (updateUrl) replaceChallengeUrl(date);
  refreshImmediately();
}

function showControlError(error) {
  challengeMessage.textContent = error instanceof Error ? error.message : String(error);
}

game.onEvent(observeGameEvent);

document.addEventListener("visibilitychange", () => {
  if (document.hidden && game.status === "playing") game.togglePause();
});

challengeDate.value = todayUtc();
startChallengeButton.addEventListener("click", () => {
  if (!challengeDate.reportValidity()) return;
  try {
    const date = challengeDate.value;
    startDatedChallenge(date);
    challengeMessage.textContent = `Daily game started for ${date}.`;
  } catch (error) {
    showControlError(error);
  }
});
startCasualButton.addEventListener("click", () => {
  try {
    game.start();
    clearChallengeUrl();
    refreshImmediately();
    challengeMessage.textContent = "Endless game started. There is no piece limit.";
  } catch (error) {
    showControlError(error);
  }
});
copyChallengeLinkButton.addEventListener("click", async () => {
  if (!challengeDate.reportValidity()) return;
  try {
    const url = challengeUrl(challengeDate.value);
    await copyText(url.href);
    challengeMessage.textContent = "Daily link copied.";
  } catch (error) {
    showControlError(error);
  } finally {
    boardCanvas.focus();
  }
});
copyResultButton.addEventListener("click", async () => {
  if (!game.challenge || (game.status !== "complete" && game.status !== "gameover")) return;
  const date = dateFromSeed(game.challenge.seed) ?? "custom";
  const result = `${game.challenge.ruleset} ${date}: ${game.challengeScore.toLocaleString("en-US")} points, ${game.challengePieces.toLocaleString("en-US")} / ${game.challenge.pieceLimit.toLocaleString("en-US")} pieces`;
  try {
    await copyText(result);
    challengeMessage.textContent = "Finished result copied.";
  } catch (error) {
    showControlError(error);
  } finally {
    boardCanvas.focus();
  }
});

let initialError = "";
const initialParams = new URLSearchParams(window.location.search);
const linkedDate = initialParams.get("challenge");
if (linkedDate !== null) {
  try {
    startDatedChallenge(linkedDate, { updateUrl: false });
    challengeMessage.textContent = `Daily game started for ${linkedDate}.`;
  } catch (error) {
    initialError = `Invalid daily link: ${error instanceof Error ? error.message : String(error)}`;
    game.start();
  }
} else {
  game.start();
}
handleEvents(game.drainEvents());
renderer.draw(game);
updateHud();
if (initialError) challengeMessage.textContent = initialError;
gameMachine.hidden = false;
gameLoading.hidden = true;
requestAnimationFrame(frame);
