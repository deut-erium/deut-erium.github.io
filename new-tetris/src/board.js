import { cellsFor } from "./pieces.js?v=20260911";

function makeRows(width, height) {
  return Array.from({ length: height }, () => Array(width).fill(null));
}

function emptySquareAward() {
  return { points: 0, rows: 0, silver: 0, gold: 0, details: [] };
}

export class Board {
  constructor({ width = 10, visibleRows = 20, hiddenRows = 2 } = {}) {
    this.width = width;
    this.visibleRows = visibleRows;
    this.hiddenRows = hiddenRows;
    this.height = visibleRows + hiddenRows;
    this.grid = makeRows(this.width, this.height);
    this.nextSquareId = 1;
    this.nextFragmentId = -1;
  }

  reset() {
    this.grid = makeRows(this.width, this.height);
    this.nextSquareId = 1;
    this.nextFragmentId = -1;
  }

  get(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
    return this.grid[y][x];
  }

  occupied(x, y) {
    if (x < 0 || x >= this.width || y >= this.height) return true;
    if (y < 0) return false;
    return this.grid[y][x] !== null;
  }

  collides(piece) {
    return cellsFor(piece).some(({ x, y }) => this.occupied(x, y));
  }

  lock(piece, pieceId) {
    const cells = cellsFor(piece);
    if (cells.some(({ x, y }) => this.occupied(x, y))) {
      throw new Error("Cannot lock a colliding piece");
    }
    for (const { x, y } of cells) {
      this.grid[y][x] = {
        type: piece.type,
        pieceId,
        sourcePieceId: pieceId,
        squareId: null,
        squareKind: null,
        pendingAwards: [],
      };
    }
    return cells;
  }

  completedRows() {
    const rows = [];
    for (let y = 0; y < this.height; y += 1) {
      if (this.grid[y].every(Boolean)) rows.push(y);
    }
    return rows;
  }

  clearRows(rows) {
    if (rows.length === 0) return {
      count: 0,
      squareCells: { silver: 0, gold: 0 },
      squareAward: emptySquareAward(),
    };
    const unique = [...new Set(rows)].sort((a, b) => a - b);
    const squareCells = { silver: 0, gold: 0 };
    const awardRows = new Map();
    const brokenPieceIds = new Set();

    for (const y of unique) {
      for (const cell of this.grid[y]) {
        if (!cell) continue;
        brokenPieceIds.add(cell.pieceId);
        if (cell.squareKind) squareCells[cell.squareKind] += 1;
        for (const award of cell.pendingAwards ?? []) {
          const key = `${award.squareId}:${award.row}`;
          if (!awardRows.has(key)) awardRows.set(key, award);
        }
      }
    }

    const removed = new Set(unique);
    const survivors = this.grid.filter((_, y) => !removed.has(y));
    const empty = makeRows(this.width, unique.length);
    this.grid = [...empty, ...survivors];
    for (const row of this.grid) {
      for (const cell of row) {
        if (cell && brokenPieceIds.has(cell.pieceId)) cell.fragmented = true;
      }
    }

    const details = [...awardRows.values()];
    const squareAward = details.reduce((result, award) => {
      result.points += award.points;
      result.rows += 1;
      result[award.kind] += award.points;
      return result;
    }, emptySquareAward());
    squareAward.details = details;
    return { count: unique.length, squareCells, squareAward };
  }

  addPendingSquareAward(square, points) {
    if (!square || !Number.isInteger(square.id) || ![4, 6, 8].includes(square.size)) {
      throw new TypeError("Invalid square award target");
    }
    if (!Number.isInteger(points) || points < 0) throw new RangeError(`Invalid square award: ${points}`);
    const base = Math.floor(points / square.size);
    const extraRows = points % square.size;
    const shares = [];
    for (let row = 0; row < square.size; row += 1) {
      const share = base + (row < extraRows ? 1 : 0);
      shares.push(share);
      const award = Object.freeze({
        squareId: square.id,
        row,
        points: share,
        kind: square.kind,
        size: square.size,
      });
      const y = square.top + row;
      for (let x = square.left; x < square.left + square.size; x += 1) {
        const cell = this.grid[y][x];
        if (!cell) throw new Error("Square award target is not full");
        cell.pendingAwards = [...(cell.pendingAwards ?? []), award];
      }
    }
    return shares;
  }

  findSquares(lastPieceId, sizes = [8, 6, 4]) {
    const requested = (Array.isArray(sizes) ? sizes : [sizes])
      .map(Number)
      .filter((size) => [4, 6, 8].includes(size))
      .sort((a, b) => b - a);
    const lastCells = this.findSourcePieceCells(lastPieceId);
    if (lastCells.length !== 4) return [];

    for (const size of requested) {
      const candidates = new Map();
      for (const cell of lastCells) {
        for (let top = cell.y - size + 1; top <= cell.y; top += 1) {
          for (let left = cell.x - size + 1; left <= cell.x; left += 1) {
            if (left < 0 || top < this.hiddenRows || left + size > this.width || top + size > this.height) continue;
            candidates.set(`${left},${top}`, { left, top });
          }
        }
      }

      const ordered = [...candidates.values()].sort((a, b) => b.top - a.top || a.left - b.left);
      for (const candidate of ordered) {
        const square = this.inspectSquare(candidate.left, candidate.top, size);
        if (!square) continue;

        const squareId = this.nextSquareId;
        const mergedPieceId = this.grid[candidate.top][candidate.left].pieceId;
        this.nextSquareId += 1;
        for (let y = candidate.top; y < candidate.top + size; y += 1) {
          for (let x = candidate.left; x < candidate.left + size; x += 1) {
            this.grid[y][x].pieceId = mergedPieceId;
            this.grid[y][x].squareId = squareId;
            this.grid[y][x].squareKind = square.kind;
          }
        }
        return [{ id: squareId, ...candidate, size, ...square }];
      }
    }
    return [];
  }

  inspectSquare(left, top, size = 4) {
    const expectedPieces = (size * size) / 4;
    const ids = new Map();
    const existingSquareIds = new Set();
    for (let y = top; y < top + size; y += 1) {
      for (let x = left; x < left + size; x += 1) {
        const cell = this.get(x, y);
        if (!cell || cell.fragmented) return null;
        if (cell.squareId !== null) existingSquareIds.add(cell.squareId);
        const sourcePieceId = cell.sourcePieceId ?? cell.pieceId;
        if (!ids.has(sourcePieceId)) ids.set(sourcePieceId, { type: cell.type, cells: [] });
        const piece = ids.get(sourcePieceId);
        if (piece.type !== cell.type) return null;
        piece.cells.push({ x: x - left, y: y - top });
      }
    }
    if (ids.size !== expectedPieces) return null;

    for (const [pieceId, piece] of ids) {
      if (piece.cells.length !== 4 || this.findSourcePieceCells(pieceId).length !== 4) return null;
    }
    for (const squareId of existingSquareIds) {
      for (let y = 0; y < this.height; y += 1) {
        for (let x = 0; x < this.width; x += 1) {
          if (this.grid[y][x]?.squareId !== squareId) continue;
          if (x < left || x >= left + size || y < top || y >= top + size) return null;
        }
      }
    }

    const pieces = [...ids].map(([id, piece]) => ({ id, type: piece.type, cells: piece.cells }));
    const types = new Set(pieces.map((piece) => piece.type));
    return {
      kind: types.size === 1 ? "gold" : "silver",
      pieceIds: [...ids.keys()],
      pieces,
      types: [...types],
      upgradedSquareIds: [...existingSquareIds],
    };
  }

  findSourcePieceCells(pieceId) {
    const result = [];
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const cell = this.grid[y][x];
        if (cell && (cell.sourcePieceId ?? cell.pieceId) === pieceId) result.push({ x, y });
      }
    }
    return result;
  }

  findPieceCells(pieceId) {
    const result = [];
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        if (this.grid[y][x]?.pieceId === pieceId) result.push({ x, y });
      }
    }
    return result;
  }

  canTranslatePiece(pieceId, dx, dy) {
    const cells = this.findPieceCells(pieceId);
    if (cells.length === 0) return false;
    return cells.every(({ x, y }) => {
      const nextX = x + dx;
      const nextY = y + dy;
      if (nextX < 0 || nextX >= this.width || nextY >= this.height) return false;
      if (nextY < 0) return true;
      const target = this.grid[nextY][nextX];
      return target === null || target.pieceId === pieceId;
    });
  }

  adjacentCellKeys(pieceId) {
    const cells = new Set();
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const { x, y } of this.findPieceCells(pieceId)) {
      for (const [dx, dy] of directions) {
        const nextX = x + dx;
        const nextY = y + dy;
        const neighbor = this.get(nextX, nextY);
        if (neighbor?.pieceId === pieceId) continue;
        if (nextY < 0) {
          cells.add("above-playfield");
        } else if (nextX < 0 || nextX >= this.width || nextY >= this.height) {
          cells.add("wall-or-floor");
        } else {
          cells.add(`${nextX},${nextY}`);
        }
      }
    }
    return cells;
  }

  isImmobileSpin(pieceId) {
    if (this.adjacentCellKeys(pieceId).size < 4) return false;
    return [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ].every(([dx, dy]) => !this.canTranslatePiece(pieceId, dx, dy));
  }

  applySpinAvalanche(pieceId) {
    const pieceCells = this.findPieceCells(pieceId);
    if (pieceCells.length === 0 || !this.isImmobileSpin(pieceId)) return null;

    const pieceRows = new Set(pieceCells.map(({ y }) => y));
    const qualifyingRows = this.completedRows().filter((y) => pieceRows.has(y));
    if (qualifyingRows.length === 0) return null;

    const pieceTop = Math.min(...pieceCells.map(({ y }) => y));
    const pieceBottom = Math.max(...pieceCells.map(({ y }) => y));
    const pieceHeight = pieceBottom - pieceTop + 1;
    const upperSize = Math.floor(pieceHeight / 2);
    const upperRows = qualifyingRows.filter((y) => y - pieceTop < upperSize);
    const lowerRows = qualifyingRows.filter((y) => y - pieceTop >= upperSize);
    const boardTop = this.highestOccupiedRow();
    const boardBottom = this.lowestOccupiedRow();

    let affectedTop;
    let affectedBottom;
    let side;
    if (upperRows.length > 0 && lowerRows.length > 0) {
      affectedTop = boardTop;
      affectedBottom = boardBottom;
      side = "both";
    } else if (upperRows.length > 0) {
      affectedTop = boardTop;
      affectedBottom = Math.max(...upperRows);
      side = "above";
    } else {
      affectedTop = Math.min(...lowerRows);
      affectedBottom = boardBottom;
      side = "below";
    }

    const fragmented = this.disintegrateRows(affectedTop, affectedBottom);
    const moves = this.settleIndependentCells(affectedTop, affectedBottom);
    return {
      pieceId,
      pieceHeight,
      qualifyingRows,
      side,
      affectedTop,
      affectedBottom,
      ...fragmented,
      moves,
    };
  }

  disintegrateRows(top, bottom) {
    let cells = 0;
    const squareIds = new Set();
    for (let y = top; y <= bottom; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const cell = this.grid[y][x];
        if (!cell) continue;
        if (cell.squareId !== null) squareIds.add(cell.squareId);
        for (const linked of this.findPieceCells(cell.pieceId)) {
          this.grid[linked.y][linked.x].fragmented = true;
          this.grid[linked.y][linked.x].pendingAwards = [];
        }
        cell.pieceId = this.nextFragmentId;
        this.nextFragmentId -= 1;
        cell.squareId = null;
        cell.squareKind = null;
        cells += 1;
      }
    }
    return { fragmentedCells: cells, affectedSquareIds: [...squareIds] };
  }

  settleIndependentCells(top, bottom) {
    const moves = [];
    for (let y = bottom - 1; y >= top; y -= 1) {
      for (let x = 0; x < this.width; x += 1) {
        const cell = this.grid[y][x];
        if (!cell) continue;
        let destination = y;
        while (destination + 1 < this.height && this.grid[destination + 1][x] === null) {
          destination += 1;
        }
        if (destination === y) continue;
        this.grid[destination][x] = cell;
        this.grid[y][x] = null;
        moves.push({ x, fromY: y, toY: destination });
      }
    }
    return moves;
  }

  highestOccupiedRow() {
    for (let y = 0; y < this.height; y += 1) {
      if (this.grid[y].some(Boolean)) return y;
    }
    return -1;
  }

  lowestOccupiedRow() {
    for (let y = this.height - 1; y >= 0; y -= 1) {
      if (this.grid[y].some(Boolean)) return y;
    }
    return -1;
  }

  hasBlocksInHiddenRows() {
    for (let y = 0; y < this.hiddenRows; y += 1) {
      if (this.grid[y].some(Boolean)) return true;
    }
    return false;
  }
}
