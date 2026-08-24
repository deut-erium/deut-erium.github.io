import { cellsFor, PIECES, STARTING_ROTATIONS } from "./pieces.js?v=20260911";

export const PIECE_COLORS = Object.freeze({
  I: "#35c9d0",
  J: "#4267d5",
  L: "#ee8d2d",
  O: "#e2c832",
  S: "#52ae57",
  T: "#9956b9",
  Z: "#d94b47",
});

const DEFAULT_RENDERER_THEME = Object.freeze({
  boardBackground: "#100d10",
  gridColor: "#2d2022",
  spawnAreaColor: "rgb(255 255 255 / 4%)",
  spawnBoundaryColor: "#594044",
  previewBackground: "#171216",
  squareEdgeColor: "#ffffff",
  cellStyle: "bevel",
  cellHighlightColor: "rgb(255 255 255 / 18%)",
  cellShadowColor: "rgb(0 0 0 / 22%)",
  cellOutlineColor: "rgb(0 0 0 / 35%)",
  cellDotColor: "rgb(0 0 0 / 18%)",
  previewOutlineColor: "rgb(0 0 0 / 35%)",
  ghostAlpha: 0.4,
  pieceColors: PIECE_COLORS,
  squareColors: Object.freeze({
    silver: "#b8c0c8",
    gold: "#e5b93f",
  }),
});

function rendererTheme(theme = {}) {
  return Object.freeze({
    ...DEFAULT_RENDERER_THEME,
    ...theme,
    pieceColors: Object.freeze({ ...PIECE_COLORS, ...theme.pieceColors }),
    squareColors: Object.freeze({ ...DEFAULT_RENDERER_THEME.squareColors, ...theme.squareColors }),
  });
}

export class Renderer {
  constructor(boardCanvas, nextCanvas, holdCanvas = null, { theme } = {}) {
    this.canvas = boardCanvas;
    this.context = boardCanvas.getContext("2d", { alpha: false });
    this.nextCanvas = nextCanvas;
    this.nextContext = nextCanvas.getContext("2d", { alpha: false });
    this.holdCanvas = holdCanvas;
    this.holdContext = holdCanvas?.getContext("2d", { alpha: false }) ?? null;
    this.theme = rendererTheme(theme);
    this.cellSize = this.canvas.width / 10;
  }

  draw(game) {
    const ctx = this.context;
    const board = game.board;
    const size = this.canvas.width / board.width;
    this.cellSize = size;

    ctx.fillStyle = this.theme.boardBackground;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = this.theme.spawnAreaColor;
    ctx.fillRect(0, 0, this.canvas.width, board.hiddenRows * size);
    this.drawGrid(board, size);

    for (let y = 0; y < board.height; y += 1) {
      for (let x = 0; x < board.width; x += 1) {
        const cell = board.get(x, y);
        if (!cell) continue;
        const color = cell.squareKind ? this.theme.squareColors[cell.squareKind] : this.theme.pieceColors[cell.type];
        this.drawCell(ctx, x, y, size, color);
        if (cell.squareId !== null) this.drawSquareEdge(ctx, board, x, y, y, size, cell.squareId);
      }
    }

    const ghost = game.ghostPiece();
    if (ghost && game.active) {
      ctx.save();
      ctx.globalAlpha = this.theme.ghostAlpha;
      for (const { x, y } of cellsFor(ghost)) {
        if (y >= 0) this.drawCell(ctx, x, y, size, this.theme.pieceColors[ghost.type], true);
      }
      ctx.restore();
    }

    if (game.active) {
      for (const { x, y } of game.activeCells()) {
        if (y >= 0) this.drawCell(ctx, x, y, size, this.theme.pieceColors[game.active.type]);
      }
    }

    this.drawNext(game.queue.slice(0, game.rules.previewCount));
    this.drawHold(game.heldType);
  }

  drawGrid(board, size) {
    const ctx = this.context;
    ctx.strokeStyle = this.theme.gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < board.width; x += 1) {
      const px = x * size + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, this.canvas.height);
    }
    for (let y = 1; y < board.height; y += 1) {
      const py = y * size + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(this.canvas.width, py);
    }
    ctx.stroke();

    const boundary = board.hiddenRows * size + 0.5;
    ctx.strokeStyle = this.theme.spawnBoundaryColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, boundary);
    ctx.lineTo(this.canvas.width, boundary);
    ctx.stroke();
  }

  drawCell(ctx, x, y, size, color, outlineOnly = false) {
    const left = x * size;
    const top = y * size;
    if (outlineOnly) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(left + 3, top + 3, size - 6, size - 6);
      return;
    }

    ctx.fillStyle = color;
    ctx.fillRect(left + 1, top + 1, size - 2, size - 2);
    if (this.theme.cellStyle === "print") {
      this.drawPrintTexture(ctx, left, top, size);
      return;
    }
    ctx.fillStyle = this.theme.cellHighlightColor;
    ctx.fillRect(left + 3, top + 3, size - 6, 3);
    ctx.fillRect(left + 3, top + 3, 3, size - 6);
    ctx.fillStyle = this.theme.cellShadowColor;
    ctx.fillRect(left + 3, top + size - 6, size - 6, 3);
    ctx.fillRect(left + size - 6, top + 3, 3, size - 6);
  }

  drawPrintTexture(ctx, left, top, size) {
    ctx.strokeStyle = this.theme.cellOutlineColor;
    ctx.lineWidth = Math.max(2, size / 15);
    ctx.strokeRect(left + 2, top + 2, size - 4, size - 4);
    if (size < 10) return;
    const dot = Math.max(1, Math.floor(size / 12));
    ctx.fillStyle = this.theme.cellDotColor;
    for (const [dx, dy] of [[0.28, 0.28], [0.68, 0.32], [0.48, 0.68]]) {
      ctx.fillRect(left + size * dx, top + size * dy, dot, dot);
    }
  }

  drawSquareEdge(ctx, board, x, boardY, visibleY, size, squareId) {
    const left = x * size;
    const top = visibleY * size;
    ctx.strokeStyle = this.theme.squareEdgeColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (board.get(x, boardY - 1)?.squareId !== squareId) {
      ctx.moveTo(left + 1, top + 1);
      ctx.lineTo(left + size - 1, top + 1);
    }
    if (board.get(x + 1, boardY)?.squareId !== squareId) {
      ctx.moveTo(left + size - 1, top + 1);
      ctx.lineTo(left + size - 1, top + size - 1);
    }
    if (board.get(x, boardY + 1)?.squareId !== squareId) {
      ctx.moveTo(left + size - 1, top + size - 1);
      ctx.lineTo(left + 1, top + size - 1);
    }
    if (board.get(x - 1, boardY)?.squareId !== squareId) {
      ctx.moveTo(left + 1, top + size - 1);
      ctx.lineTo(left + 1, top + 1);
    }
    ctx.stroke();
  }

  drawNext(queue) {
    const ctx = this.nextContext;
    ctx.fillStyle = this.theme.previewBackground;
    ctx.fillRect(0, 0, this.nextCanvas.width, this.nextCanvas.height);

    const previewHeight = this.nextCanvas.height / Math.max(queue.length, 1);
    queue.forEach((type, index) => {
      this.drawPreviewPiece(ctx, this.nextCanvas, type, index * previewHeight, previewHeight);
    });
  }

  drawHold(type) {
    if (!this.holdCanvas || !this.holdContext) return;
    this.holdContext.fillStyle = this.theme.previewBackground;
    this.holdContext.fillRect(0, 0, this.holdCanvas.width, this.holdCanvas.height);
    if (type) this.drawPreviewPiece(this.holdContext, this.holdCanvas, type, 0, this.holdCanvas.height);
  }

  drawPreviewPiece(ctx, canvas, type, areaTop, areaHeight) {
    const shape = PIECES[type][STARTING_ROTATIONS[type]];
    const xs = shape.map(([x]) => x);
    const ys = shape.map(([, y]) => y);
    const blocksWide = Math.max(...xs) - Math.min(...xs) + 1;
    const blocksHigh = Math.max(...ys) - Math.min(...ys) + 1;
    const size = Math.max(1, Math.min(
      20,
      (canvas.width - 8) / blocksWide,
      (areaHeight - 6) / blocksHigh,
    ));
    const width = blocksWide * size;
    const height = blocksHigh * size;
    const originX = (canvas.width - width) / 2 - Math.min(...xs) * size;
    const originY = areaTop + (areaHeight - height) / 2 - Math.min(...ys) * size;
    for (const [x, y] of shape) {
      this.drawCellAtPixels(ctx, originX + x * size, originY + y * size, size, this.theme.pieceColors[type]);
    }
  }

  drawCellAtPixels(ctx, left, top, size, color) {
    ctx.fillStyle = color;
    ctx.fillRect(left + 1, top + 1, size - 2, size - 2);
    if (this.theme.cellStyle === "print") {
      this.drawPrintTexture(ctx, left, top, size);
      return;
    }
    ctx.strokeStyle = this.theme.previewOutlineColor;
    ctx.strokeRect(left + 1.5, top + 1.5, size - 3, size - 3);
  }
}
