const DATA_LOADERS = Object.freeze({
  4: () => import("./data-4.js?v=20260907"),
  6: () => import("./data-6.js?v=20260907"),
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

const TOTAL_LAYOUTS = Object.freeze({ 4: 117, 6: 178939 });
const cache = new Map();
const params = new URLSearchParams(location.search);
const initialSize = params.get("size") === "6" ? 6 : 4;
let size = initialSize;
let families = [];
let visibleFamilies = [];
let currentFamily = null;
let playback = null;
let loadGeneration = 0;

const ui = Object.freeze({
  sizeButtons: [...document.querySelectorAll("[data-size]")],
  familyTotal: document.querySelector("#family-total"),
  layoutTotal: document.querySelector("#layout-total"),
  visibleTotal: document.querySelector("#visible-total"),
  search: document.querySelector("#search"),
  kind: document.querySelector("#kind"),
  typeCount: document.querySelector("#type-count"),
  pieceCounts: document.querySelector("#piece-counts"),
  familyList: document.querySelector("#family-list"),
  noResults: document.querySelector("#no-results"),
  detail: document.querySelector("#family-detail"),
  board: document.querySelector("#family-board"),
  pieceKey: document.querySelector("#piece-key"),
  step: document.querySelector("#step"),
  stepLabel: document.querySelector("#step-label"),
  title: document.querySelector("#family-title"),
  material: document.querySelector("#material"),
  constructionScore: document.querySelector("#construction-score"),
  scoreBreakdown: document.querySelector("#score-breakdown"),
  badges: document.querySelector("#badges"),
  recipe: document.querySelector("#recipe"),
  stats: document.querySelector("#family-stats"),
  order: document.querySelector("#order"),
});

function buildingType(family) {
  return `D${family.diversity}-${family.signature.join("+")}`;
}

function buildingTypeLabel(family) {
  if (family.diversity === 1) return `1 piece type, used ${family.signature[0]} times`;
  const uses = family.signature.map((count) => `one used ${count} ${count === 1 ? "time" : "times"}`);
  return `${family.diversity} piece types: ${uses.join(", ")}`;
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

function pieceStyles(family) {
  const totals = {};
  const seen = {};
  const steps = Object.fromEntries(family.order.map((id, index) => [id, index]));
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

function familyMaterial(family) {
  if (family.spectrum) return "Silver square / all 7 types";
  if (family.kind === "gold") return "Gold square / one type";
  return "Silver square / mixed types";
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

function renderFamilyList(preferredId = null) {
  visibleFamilies = families.filter(familyMatches);
  ui.visibleTotal.textContent = visibleFamilies.length.toLocaleString("en-US");
  ui.noResults.hidden = visibleFamilies.length !== 0;
  ui.detail.hidden = visibleFamilies.length === 0;
  if (visibleFamilies.length === 0) {
    ui.familyList.innerHTML = "";
    currentFamily = null;
    return;
  }

  const selected = visibleFamilies.find((family) => family.id === preferredId)
    ?? visibleFamilies.find((family) => family.id === currentFamily?.id)
    ?? visibleFamilies[0];
  ui.familyList.innerHTML = visibleFamilies.map((family) => (
    `<button type="button" data-family="${family.id}"><b>${family.id}</b><em>${family.scoring.points.toLocaleString("en-US")} pts</em><span>${family.fixed.toLocaleString("en-US")} ways to build / ${buildingTypeLabel(family)}</span></button>`
  )).join("");
  showFamily(selected.id, { scroll: false });
}

function draw() {
  if (!currentFamily) return;
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
  ui.stepLabel.textContent = `Step ${limit} of ${currentFamily.pieces.length}`;
}

function showFamily(id, { scroll = true } = {}) {
  clearInterval(playback);
  currentFamily = families.find((family) => family.id === id) ?? null;
  if (!currentFamily) return;
  const styles = pieceStyles(currentFamily);
  ui.title.textContent = currentFamily.id;
  ui.material.textContent = familyMaterial(currentFamily);
  ui.constructionScore.textContent = currentFamily.scoring.points.toLocaleString("en-US");
  ui.scoreBreakdown.innerHTML = [
    ["Starting points", currentFamily.scoring.base, false],
    ["Gold bonus", currentFamily.scoring.material, true],
    ["Extra piece types", currentFamily.scoring.diversity, true],
    ["Shape bonus", currentFamily.scoring.structure, true],
  ].map(([label, points, isBonus]) => `<div><dt>${label}</dt><dd>${isBonus ? "+" : ""}${points.toLocaleString("en-US")}</dd></div>`).join("");
  ui.badges.innerHTML = [
    `${currentFamily.diversity} piece ${currentFamily.diversity === 1 ? "type" : "types"}`,
    `${currentFamily.pieces.length} pieces total`,
  ].map((value) => `<span>${value}</span>`).join("");
  ui.recipe.innerHTML = Object.entries(currentFamily.counts).map(([type, count]) => (
    `<li style="background:${COLORS[type]}">${type} x ${count}</li>`
  )).join("");
  ui.stats.innerHTML = `<div><dt>Ways to build this piece mix</dt><dd>${currentFamily.fixed.toLocaleString("en-US")}</dd></div>`;
  ui.order.innerHTML = currentFamily.order.map((pieceId) => {
    const style = styles[pieceId];
    return `<li><b>${pieceId}</b> / ${style.type} piece</li>`;
  }).join("");
  ui.pieceKey.innerHTML = currentFamily.order.map((pieceId) => {
    const style = styles[pieceId];
    return `<span style="background:${style.color}">${style.step + 1}: ${pieceId} / ${style.type}</span>`;
  }).join("");
  ui.step.max = String(currentFamily.pieces.length);
  ui.step.value = String(currentFamily.pieces.length);
  for (const button of ui.familyList.querySelectorAll("[data-family]")) {
    button.classList.toggle("active", button.dataset.family === id);
  }
  if (scroll) ui.familyList.querySelector(`[data-family="${id}"]`)?.scrollIntoView({ block: "nearest" });
  draw();
  updateUrl();
}

function moveFamily(delta) {
  const index = visibleFamilies.findIndex((family) => family.id === currentFamily?.id);
  if (index < 0) return;
  showFamily(visibleFamilies[(index + delta + visibleFamilies.length) % visibleFamilies.length].id);
}

async function loadSize(nextSize, preferredId = null) {
  const generation = ++loadGeneration;
  size = nextSize;
  ui.familyList.innerHTML = "<p>Loading families...</p>";
  if (!cache.has(size)) cache.set(size, DATA_LOADERS[size]().then((module) => module.default));
  const loaded = await cache.get(size);
  if (generation !== loadGeneration) return;
  families = loaded;
  currentFamily = null;
  ui.familyTotal.textContent = families.length.toLocaleString("en-US");
  ui.layoutTotal.textContent = TOTAL_LAYOUTS[size].toLocaleString("en-US");
  for (const button of ui.sizeButtons) button.classList.toggle("active", Number(button.dataset.size) === size);
  populateFilters();
  renderFamilyList(preferredId);
}

for (const button of ui.sizeButtons) {
  button.addEventListener("click", () => loadSize(Number(button.dataset.size)));
}
for (const control of [ui.search, ui.kind, ui.typeCount, ui.pieceCounts]) {
  control.addEventListener(control === ui.search ? "input" : "change", () => renderFamilyList());
}
ui.familyList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-family]");
  if (button) showFamily(button.dataset.family);
});
ui.step.addEventListener("input", draw);
document.querySelector("#step-back").addEventListener("click", () => {
  ui.step.value = String(Math.max(0, Number(ui.step.value) - 1));
  draw();
});
document.querySelector("#step-forward").addEventListener("click", () => {
  ui.step.value = String(Math.min(Number(ui.step.max), Number(ui.step.value) + 1));
  draw();
});
document.querySelector("#play").addEventListener("click", () => {
  clearInterval(playback);
  ui.step.value = "0";
  draw();
  playback = setInterval(() => {
    ui.step.value = String(Number(ui.step.value) + 1);
    draw();
    if (Number(ui.step.value) >= Number(ui.step.max)) clearInterval(playback);
  }, 350);
});
document.querySelector("#previous-family").addEventListener("click", () => moveFamily(-1));
document.querySelector("#next-family").addEventListener("click", () => moveFamily(1));

loadSize(initialSize, params.get("family"));
