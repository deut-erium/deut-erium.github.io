const POP_SCHEMATIC_RENDERER_THEME = Object.freeze({
  boardBackground: "#123d73",
  gridColor: "#4778ad",
  previewBackground: "#fff7df",
  squareEdgeColor: "#111111",
  cellStyle: "print",
  cellHighlightColor: "rgb(255 255 255 / 24%)",
  cellShadowColor: "rgb(17 17 17 / 35%)",
  cellOutlineColor: "#111111",
  cellDotColor: "rgb(17 17 17 / 22%)",
  previewOutlineColor: "#111111",
  ghostAlpha: 0.8,
  pieceColors: Object.freeze({
    I: "#35a9d6",
    J: "#a8b5ff",
    L: "#ef8b31",
    O: "#f7d33b",
    S: "#53b965",
    T: "#e28df0",
    Z: "#ff9299",
  }),
  squareColors: Object.freeze({
    silver: "#d7dce2",
    gold: "#f5c72f",
  }),
});

export const DEFAULT_UI_LAYOUT_ID = "pop-schematic";

export const UI_LAYOUTS = Object.freeze({
  "pop-schematic": Object.freeze({
    id: "pop-schematic",
    label: "Pop Schematic",
    rendererTheme: POP_SCHEMATIC_RENDERER_THEME,
  }),
  "warm-cartridge": Object.freeze({
    id: "warm-cartridge",
    label: "Warm Cartridge",
    rendererTheme: Object.freeze({}),
  }),
});

export function resolveUILayout(requestedId) {
  return Object.hasOwn(UI_LAYOUTS, requestedId)
    ? UI_LAYOUTS[requestedId]
    : UI_LAYOUTS[DEFAULT_UI_LAYOUT_ID];
}

export function writeUILayoutToUrl(url, layoutId) {
  const layout = resolveUILayout(layoutId);
  if (layout.id === DEFAULT_UI_LAYOUT_ID) url.searchParams.delete("layout");
  else url.searchParams.set("layout", layout.id);
  return url;
}

export function selectUILayout({ search = "", root = null, roots = [] } = {}) {
  const requestedId = new URLSearchParams(search).get("layout");
  const layout = resolveUILayout(requestedId);
  for (const candidate of [root, ...roots]) {
    if (candidate?.dataset) candidate.dataset.layout = layout.id;
  }
  return layout;
}
