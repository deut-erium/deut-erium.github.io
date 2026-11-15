import { EIGHT_LIST_PAGE, expandEightFamily, eightExamplePieces, familyPage } from "./catalog-model.js?v=20261115-examples1";

const DATA_URLS = Object.freeze({
  4: "./data-4.js?v=20260911",
  6: "./data-6.js?v=20260911",
  8: "./data-8.js?v=20261115-examples1",
});

const COLORS = Object.freeze({
  I: "#35a9d6",
  J: "#a8b5ff",
  L: "#ef8b31",
  O: "#f7d33b",
  S: "#53b965",
  T: "#e28df0",
  Z: "#ff9299",
});

const TOTAL_LAYOUTS = Object.freeze({ 4: 117, 6: 178939, 8: 19077209438 });
const SHAPE_BLOCKS = "<i></i><i></i><i></i><i></i>";
const cache = new Map();
const loadAttempts = new Map();
const params = new URLSearchParams(location.search);
const requestedSize = Number(params.get("size"));
const initialSize = [4, 6, 8].includes(requestedSize) ? requestedSize : 4;
let size = initialSize;
let families = [];
let visibleFamilies = [];
let currentFamily = null;
let playback = null;
let loadGeneration = 0;
let listStart = 0;

const ui = Object.freeze({
  machine: document.querySelector("#catalog-machine"),
  loading: document.querySelector("#catalog-loading"),
  error: document.querySelector("#catalog-error"),
  sizeButtons: [...document.querySelectorAll("[data-size]")],
  familyTotal: document.querySelector("#family-total"),
  layoutTotal: document.querySelector("#layout-total"),
  layoutLabel: document.querySelector("#layout-label"),
  visibleTotal: document.querySelector("#visible-total"),
  search: document.querySelector("#search"),
  kind: document.querySelector("#kind"),
  typeCount: document.querySelector("#type-count"),
  pieceCounts: document.querySelector("#piece-counts"),
  familyList: document.querySelector("#family-list"),
  noResults: document.querySelector("#no-results"),
  listPages: document.querySelector("#list-pages"),
  listPrevious: document.querySelector("#list-previous"),
  listNext: document.querySelector("#list-next"),
  listRange: document.querySelector("#list-range"),
  detail: document.querySelector("#family-detail"),
  drawing: document.querySelector("#drawing"),
  board: document.querySelector("#family-board"),
  gridCaption: document.querySelector("#family-grid-caption"),
  gridColumns: document.querySelector("#family-grid-columns"),
  gridBody: document.querySelector("#family-grid-body"),
  pieceKey: document.querySelector("#piece-key"),
  step: document.querySelector("#step"),
  stepControls: document.querySelector("#step-controls"),
  stepLabel: document.querySelector("#step-label"),
  title: document.querySelector("#family-title"),
  status: document.querySelector("#catalog-status"),
  material: document.querySelector("#material"),
  constructionScore: document.querySelector("#construction-score"),
  scoreLabel: document.querySelector("#score-label"),
  scoreBreakdown: document.querySelector("#score-breakdown"),
  valueNote: document.querySelector("#value-note"),
  exampleScoreNote: document.querySelector("#example-score-note"),
  badges: document.querySelector("#badges"),
  recipe: document.querySelector("#recipe"),
  stats: document.querySelector("#family-stats"),
  order: document.querySelector("#order"),
  orderSection: document.querySelector("#order-section"),
  play: document.querySelector("#play"),
  practice: document.querySelector("#practice-construction"),
});
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let animationChoice = null;

function stopPlayback() {
  clearTimeout(playback);
  playback = null;
  ui.play.textContent = "Play";
  ui.play.setAttribute("aria-label", "Play animation");
  ui.play.setAttribute("aria-pressed", "false");
}

function startPlayback() {
  stopPlayback();
  if (!currentFamily?.pieces) return;
  ui.step.value = "1";
  ui.play.textContent = "Pause";
  ui.play.setAttribute("aria-label", "Pause animation");
  ui.play.setAttribute("aria-pressed", "true");
  draw();
  const advance = () => {
    if (!currentFamily) { stopPlayback(); return; }
    const total = Number(ui.step.max);
    const step = Number(ui.step.value);
    ui.step.value = String(step === total ? 0 : step + 1);
    draw();
    playback = setTimeout(advance, Number(ui.step.value) === total ? 1200 : 350);
  };
  playback = setTimeout(advance, 350);
}

function scrubTo(step) {
  animationChoice = false;
  stopPlayback();
  ui.step.value = String(step);
  draw();
}

function buildingType(family) {
  return `D${family.diversity}-${family.signature.join("+")}`;
}

function buildingTypeLabel(family) {
  return `${family.diversity} ${family.diversity === 1 ? "type" : "types"} (${family.signature.join(" + ")})`;
}

function clean(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function mixColor(hex, amount) {
  const value = Number.parseInt(hex.slice(1), 16);
  const source = [value >> 16, (value >> 8) & 255, value & 255];
  const target = amount < 0 ? 0 : 255;
  const weight = Math.abs(amount);
  return `#${source.map((channel) => (
    Math.round(channel + (target - channel) * weight).toString(16).padStart(2, "0")
  )).join("")}`;
}

function exampleOrder(family) {
  // Geometric 8x8 examples have no verified drop order. Reveal lower pieces first.
  return family.order ?? [...family.pieces]
    .sort((a, b) => Math.max(...b.cells.map(([, y]) => y)) - Math.max(...a.cells.map(([, y]) => y))
      || Math.min(...a.cells.map(([x]) => x)) - Math.min(...b.cells.map(([x]) => x)))
    .map(({ id }) => id);
}

function pieceStyles(family) {
  const totals = {};
  const seen = {};
  const steps = Object.fromEntries(exampleOrder(family).map((id, index) => [id, index]));
  for (const piece of family.pieces) totals[piece.type] = (totals[piece.type] ?? 0) + 1;
  return Object.fromEntries(family.pieces.map((piece) => {
    const index = seen[piece.type] ?? 0;
    const total = totals[piece.type];
    const shade = total === 1 ? 0 : (index / (total - 1) - 0.5) * 0.38;
    seen[piece.type] = index + 1;
    return [piece.id, {
      color: mixColor(COLORS[piece.type], shade),
      step: steps[piece.id],
      type: piece.type,
    }];
  }));
}

function pieceShape(type, color = COLORS[type]) {
  return `<span class="piece-shape piece-shape--${type}" style="--piece-color:${color}" aria-hidden="true">${SHAPE_BLOCKS}</span>`;
}

function familyMaterial(family) {
  return family.kind === "gold" ? "Gold square" : "Silver square";
}

function updateUrl() {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("size", String(size));
  if (currentFamily) url.searchParams.set("family", currentFamily.id);
  history.replaceState(null, "", url);
}

function populateFilters() {
  const diversities = [...new Set(families.map((family) => family.diversity))].sort((a, b) => a - b);
  ui.typeCount.innerHTML = `<option value="">All</option>${diversities.map((value) => `<option value="${value}">${value}</option>`).join("")}`;
  const examples = new Map(families.map((family) => [buildingType(family), buildingTypeLabel(family)]));
  const types = [...examples].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  ui.pieceCounts.innerHTML = `<option value="">All</option>${types.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}`;
  ui.kind.querySelector('option[value="spectrum"]').hidden = size === 4;
  ui.kind.value = "";
  ui.search.value = "";
}

function familyMatches(family) {
  const needle = clean(ui.search.value);
  const kind = ui.kind.value;
  if (needle && !clean(family.id).includes(needle)) return false;
  if (kind === "spectrum" && !family.spectrum) return false;
  if (kind && kind !== "spectrum" && family.kind !== kind) return false;
  if (ui.typeCount.value && String(family.diversity) !== ui.typeCount.value) return false;
  return !ui.pieceCounts.value || buildingType(family) === ui.pieceCounts.value;
}

function renderFamilyButtons(selectedId = currentFamily?.id) {
  const page = familyPage(visibleFamilies, selectedId, size);
  listStart = page.start;
  const listEnd = page.end;
  const listed = page.families;
  ui.familyList.innerHTML = listed.map((family) => (
    `<button type="button" data-family="${family.id}" aria-pressed="${family.id === selectedId}"><b>${family.id}</b><em>${family.scoring.points.toLocaleString("en-US")} points</em><span>${family.fixed.toLocaleString("en-US")} arrangements / ${buildingTypeLabel(family)}</span></button>`
  )).join("");
  const paged = size === 8 && visibleFamilies.length > EIGHT_LIST_PAGE;
  ui.listPages.hidden = !paged;
  if (paged) {
    ui.listRange.textContent = `${(listStart + 1).toLocaleString("en-US")}-${listEnd.toLocaleString("en-US")} of ${visibleFamilies.length.toLocaleString("en-US")}`;
    ui.listPrevious.disabled = listStart === 0;
    ui.listNext.disabled = listEnd === visibleFamilies.length;
  }
}

function renderFamilyList(preferredId = null) {
  visibleFamilies = families.filter(familyMatches);
  ui.visibleTotal.textContent = visibleFamilies.length.toLocaleString("en-US");
  ui.noResults.hidden = visibleFamilies.length !== 0;
  ui.detail.hidden = visibleFamilies.length === 0;
  ui.listPages.hidden = true;
  if (visibleFamilies.length === 0) {
    ui.familyList.innerHTML = "";
    currentFamily = null;
    stopPlayback();
    return;
  }

  const selected = visibleFamilies.find((family) => family.id === preferredId)
    ?? visibleFamilies.find((family) => family.id === currentFamily?.id)
    ?? visibleFamilies[0];
  renderFamilyButtons(selected.id);
  showFamily(selected.id, { scroll: false, refreshList: false });
}

function draw() {
  if (!currentFamily?.pieces) return;
  const ctx = ui.board.getContext("2d");
  const boardSize = ui.board.width;
  const cell = boardSize / size;
  const limit = Number(ui.step.value);
  const styles = pieceStyles(currentFamily);
  const owner = Array(size * size).fill(null);
  for (const piece of currentFamily.pieces) {
    for (const [x, y] of piece.cells) owner[y * size + x] = piece.id;
  }

  ctx.fillStyle = "#123d73";
  ctx.fillRect(0, 0, boardSize, boardSize);
  ctx.strokeStyle = "#5d8ec2";
  ctx.lineWidth = 1;
  for (let line = 1; line < size; line += 1) {
    const point = line * cell + 0.5;
    ctx.beginPath();
    ctx.moveTo(point, 0);
    ctx.lineTo(point, boardSize);
    ctx.moveTo(0, point);
    ctx.lineTo(boardSize, point);
    ctx.stroke();
  }

  for (const piece of currentFamily.pieces) {
    const style = styles[piece.id];
    if (style.step >= limit) continue;
    for (const [x, y] of piece.cells) {
      const left = x * cell;
      const top = y * cell;
      ctx.fillStyle = style.color;
      ctx.fillRect(left + 1, top + 1, cell - 2, cell - 2);
      ctx.fillStyle = "rgb(17 17 17 / 22%)";
      const dot = Math.max(2, Math.floor(cell / 18));
      for (const [dx, dy] of [[0.28, 0.28], [0.68, 0.32], [0.48, 0.68]]) {
        ctx.fillRect(left + cell * dx, top + cell * dy, dot, dot);
      }
      ctx.fillStyle = "#111";
      ctx.font = `700 ${Math.max(13, cell * 0.22)}px Atkinson`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(style.step + 1), left + cell / 2, top + cell / 2);
    }

    ctx.strokeStyle = "#111";
    ctx.lineWidth = Math.max(4, cell / 15);
    ctx.beginPath();
    for (const [x, y] of piece.cells) {
      const left = x * cell;
      const right = (x + 1) * cell;
      const top = y * cell;
      const bottom = (y + 1) * cell;
      if (x === 0 || owner[y * size + x - 1] !== piece.id) { ctx.moveTo(left + 2, top); ctx.lineTo(left + 2, bottom); }
      if (x === size - 1 || owner[y * size + x + 1] !== piece.id) { ctx.moveTo(right - 2, top); ctx.lineTo(right - 2, bottom); }
      if (y === 0 || owner[(y - 1) * size + x] !== piece.id) { ctx.moveTo(left, top + 2); ctx.lineTo(right, top + 2); }
      if (y === size - 1 || owner[(y + 1) * size + x] !== piece.id) { ctx.moveTo(left, bottom - 2); ctx.lineTo(right, bottom - 2); }
    }
    ctx.stroke();
  }

  ui.gridColumns.innerHTML = `<th scope="col">Row</th>${Array.from({ length: size }, (_, column) => `<th scope="col">${column + 1}</th>`).join("")}`;
  ui.gridBody.innerHTML = Array.from({ length: size }, (_, row) => {
    const cells = Array.from({ length: size }, (_, column) => {
      const pieceId = owner[row * size + column];
      const style = pieceId ? styles[pieceId] : null;
      const label = style && style.step < limit
        ? (size === 8 ? `${style.type} piece ${style.step + 1}` : `${style.type} piece, step ${style.step + 1}`)
        : "Empty";
      return `<td>${label}</td>`;
    }).join("");
    return `<tr><th scope="row">${row + 1}</th>${cells}</tr>`;
  }).join("");
  const stepText = `${limit} of ${currentFamily.pieces.length} pieces`;
  ui.stepLabel.textContent = `${limit} / ${currentFamily.pieces.length}`;
  ui.gridCaption.textContent = `${currentFamily.id}, ${size} by ${size}, ${stepText}.`;
  ui.board.setAttribute("aria-label", size === 8
    ? `${currentFamily.id} 8 by 8 example square`
    : `${currentFamily.id} ${size} by ${size} example square at ${stepText.toLowerCase()}`);
}

function showFamily(id, { scroll = true, refreshList = true } = {}) {
  stopPlayback();
  currentFamily = families.find((family) => family.id === id) ?? null;
  if (!currentFamily) return;
  if (size === 8 && !currentFamily.pieces) currentFamily.pieces = eightExamplePieces(currentFamily);
  const hasExample = Array.isArray(currentFamily.pieces);
  const hasDropOrder = hasExample && Array.isArray(currentFamily.order);
  const canPractice = hasDropOrder && [4, 6].includes(size);
  ui.practice.hidden = !canPractice;
  if (canPractice) {
    const practiceUrl = new URL("/tetrasquares/", location.href);
    practiceUrl.searchParams.set("practice", String(size));
    practiceUrl.searchParams.set("family", currentFamily.id);
    ui.practice.href = practiceUrl.href;
  } else {
    ui.practice.removeAttribute("href");
  }
  const pieceTotal = Object.values(currentFamily.counts).reduce((sum, count) => sum + count, 0);
  const styles = hasExample ? pieceStyles(currentFamily) : {};
  ui.detail.classList.toggle("aggregate", !hasExample);
  ui.drawing.hidden = !hasExample;
  ui.orderSection.hidden = !hasDropOrder;
  ui.stepControls.hidden = !hasExample;
  ui.stepLabel.hidden = !hasExample;
  ui.title.textContent = currentFamily.id;
  ui.material.textContent = familyMaterial(currentFamily);
  ui.scoreLabel.textContent = "SQUARE VALUE";
  ui.constructionScore.textContent = currentFamily.scoring.points.toLocaleString("en-US");
  const baseShare = Math.floor(currentFamily.scoring.points / size);
  const extraRows = currentFamily.scoring.points % size;
  const shareLabel = extraRows === 0
    ? baseShare.toLocaleString("en-US")
    : `${baseShare.toLocaleString("en-US")}-${(baseShare + 1).toLocaleString("en-US")}`;
  ui.valueNote.textContent = `Clear a row through this square to collect ${shareLabel} points.`;
  ui.exampleScoreNote.hidden = size === 8;
  if (hasExample && size !== 8) {
    ui.scoreBreakdown.innerHTML = [
      ["Base value", currentFamily.scoring.base, false],
      ["Gold bonus", currentFamily.scoring.material, true],
      ["Extra piece types", currentFamily.scoring.diversity, true],
      ["Shape bonus", currentFamily.scoring.structure, true],
    ].map(([label, points, isBonus]) => `<div><dt>${label}</dt><dd>${isBonus ? "+" : ""}${points.toLocaleString("en-US")}</dd></div>`).join("");
    ui.exampleScoreNote.textContent = "Other arrangements of this mix can have a different shape bonus.";
  } else {
    ui.scoreBreakdown.innerHTML = "";
    ui.exampleScoreNote.textContent = "";
  }
  ui.badges.innerHTML = [
    `${currentFamily.diversity} piece ${currentFamily.diversity === 1 ? "type" : "types"}`,
    `${pieceTotal} pieces total`,
  ].map((value) => `<span>${value}</span>`).join("");
  ui.recipe.innerHTML = Object.entries(currentFamily.counts).map(([type, count]) => (
    `<li>${pieceShape(type)}<span><b>${type} piece</b><small>${count} used</small></span></li>`
  )).join("");
  ui.stats.innerHTML = `<div><dt>Board arrangements with this piece mix</dt><dd>${currentFamily.fixed.toLocaleString("en-US")}</dd></div>`;
  if (hasExample) {
    ui.order.innerHTML = hasDropOrder ? currentFamily.order.map((pieceId) => {
      const style = styles[pieceId];
      return `<li>${pieceShape(style.type, style.color)}<b>${style.type} piece</b></li>`;
    }).join("") : "";
    ui.pieceKey.innerHTML = exampleOrder(currentFamily).map((pieceId) => {
      const style = styles[pieceId];
      return `<span aria-label="Piece ${style.step + 1}: ${style.type}">${pieceShape(style.type, style.color)}<b>${style.step + 1}</b></span>`;
    }).join("");
    ui.step.max = String(currentFamily.pieces.length);
    ui.step.value = String(currentFamily.pieces.length);
  }
  if (refreshList && !ui.familyList.querySelector(`[data-family="${id}"]`)) renderFamilyButtons(id);
  for (const button of ui.familyList.querySelectorAll("[data-family]")) {
    const selected = button.dataset.family === id;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  ui.status.textContent = `Selected ${size} by ${size} piece mix ${currentFamily.id}.`;
  if (scroll) ui.familyList.querySelector(`[data-family="${id}"]`)?.scrollIntoView({ block: "nearest" });
  draw();
  updateUrl();
  if (animationChoice ?? !reducedMotion.matches) startPlayback();
}

function moveFamily(delta) {
  const index = visibleFamilies.findIndex((family) => family.id === currentFamily?.id);
  if (index < 0) return;
  showFamily(visibleFamilies[(index + delta + visibleFamilies.length) % visibleFamilies.length].id);
}

async function loadSize(nextSize, preferredId = null) {
  const generation = ++loadGeneration;
  ui.familyList.setAttribute("aria-busy", "true");
  ui.error.hidden = true;
  ui.error.textContent = "";
  try {
    if (!cache.has(nextSize)) {
      const retry = loadAttempts.get(nextSize) ?? 0;
      const url = `${DATA_URLS[nextSize]}${retry > 0 ? `&retry=${retry}` : ""}`;
      cache.set(nextSize, import(url).then((module) => module.default));
    }
    const request = cache.get(nextSize);
    let loaded;
    try {
      loaded = await request;
    } catch (error) {
      if (cache.get(nextSize) === request) {
        cache.delete(nextSize);
        loadAttempts.set(nextSize, (loadAttempts.get(nextSize) ?? 0) + 1);
      }
      throw error;
    }
    if (generation !== loadGeneration) return false;
    size = nextSize;
    families = size === 8 ? loaded.map(expandEightFamily) : loaded;
    currentFamily = null;
    listStart = 0;
    ui.familyTotal.textContent = families.length.toLocaleString("en-US");
    ui.layoutTotal.textContent = TOTAL_LAYOUTS[size].toLocaleString("en-US");
    ui.layoutLabel.textContent = "BOARD ARRANGEMENTS";
    for (const button of ui.sizeButtons) {
      const selected = Number(button.dataset.size) === size;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
    populateFilters();
    renderFamilyList(preferredId);
    return true;
  } catch (error) {
    if (generation === loadGeneration) {
      const message = `${nextSize}x${nextSize} catalog failed to load. Try again.`;
      ui.status.textContent = message;
      if (!ui.machine.hidden) {
        ui.error.textContent = message;
        ui.error.hidden = false;
      }
    }
    console.error(error);
    return false;
  } finally {
    if (generation === loadGeneration) ui.familyList.removeAttribute("aria-busy");
  }
}

for (const button of ui.sizeButtons) {
  button.addEventListener("click", async () => {
    await loadSize(Number(button.dataset.size));
  });
}
for (const control of [ui.search, ui.kind, ui.typeCount, ui.pieceCounts]) {
  control.addEventListener(control === ui.search ? "input" : "change", () => renderFamilyList());
}
ui.familyList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-family]");
  if (button) showFamily(button.dataset.family);
});
ui.listPrevious.addEventListener("click", () => {
  const target = Math.max(0, listStart - EIGHT_LIST_PAGE);
  renderFamilyButtons(visibleFamilies[target]?.id);
  showFamily(visibleFamilies[target]?.id, { scroll: false, refreshList: false });
});
ui.listNext.addEventListener("click", () => {
  const target = Math.min(visibleFamilies.length - 1, listStart + EIGHT_LIST_PAGE);
  renderFamilyButtons(visibleFamilies[target]?.id);
  showFamily(visibleFamilies[target]?.id, { scroll: false, refreshList: false });
});
ui.step.addEventListener("input", () => scrubTo(Number(ui.step.value)));
document.querySelector("#step-back").addEventListener("click", () => {
  scrubTo(Math.max(0, Number(ui.step.value) - 1));
});
document.querySelector("#step-forward").addEventListener("click", () => {
  scrubTo(Math.min(Number(ui.step.max), Number(ui.step.value) + 1));
});
ui.play.addEventListener("click", () => {
  animationChoice = playback === null;
  if (animationChoice) startPlayback();
  else stopPlayback();
});
reducedMotion.addEventListener("change", (event) => {
  if (animationChoice !== null) return;
  if (event.matches) {
    stopPlayback();
    ui.step.value = ui.step.max;
    draw();
  } else startPlayback();
});
document.querySelector("#previous-family").addEventListener("click", () => moveFamily(-1));
document.querySelector("#next-family").addEventListener("click", () => moveFamily(1));

const initialized = await loadSize(initialSize, params.get("family"));
if (initialized) {
  ui.machine.hidden = false;
  ui.loading.hidden = true;
} else {
  ui.loading.textContent = "Catalog failed to load. Reload the page or open the scoring guide.";
}
