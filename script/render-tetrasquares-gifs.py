#!/usr/bin/env python3
"""Render the article's five additional construction GIFs using local game geometry.

Requires installed Pillow and Node. No downloads. The existing SVGs supply cells,
colors, and placement numbers; the game's collision and rotation rules validate
paths before rendering. Run from any directory; output goes beside those SVGs.
"""

import argparse
import io
import json
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets/images/tetrasquares'
CASES = {
    'l2-o2': 'l2-o2-cut.svg',
    't4': 't4-cut.svg',
    'o5-t4': 'o5-t4-cuts.svg',
    'l5-t4': 'l5-t4-cut.svg',
    't16': 't16.svg',
}
NS = {'svg': 'http://www.w3.org/2000/svg'}
CELL = 32

# Use the game's actual piece definitions, collision detection, kicks and lock
# predicate. The small breadth-first search also records parents for drawing.
PATHS = r'''
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {Board} from './tetrasquares/src/board.js';
import {PIECES, cellsFor, spawnPiece, kicksFor, rotatedState} from './tetrasquares/src/pieces.js';
import {isReachableLockPlacement} from './tetrasquares/src/placement-search.js';
const cases = JSON.parse(fs.readFileSync(0, 'utf8'));
const key = p => `${p.x},${p.y},${p.rotation}`;
const geometry = cells => cells.map(({x,y}) => `${x},${y}`).sort().join(';');
function rotate(board, piece, direction) {
  const rotation = rotatedState(piece.rotation, direction);
  for (const [dx, dy] of kicksFor(piece.type, piece.rotation, rotation)) {
    const candidate = {...piece, x:piece.x + dx, y:piece.y + dy, rotation};
    if (!board.collides(candidate)) return candidate;
  }
  return null;
}
for (const entry of cases) {
  const board = new Board();
  const left = Math.floor((board.width - entry.size) / 2);
  const top = board.height - entry.size;
  entry.viewport = {left:left - 1, top:top - 2, width:entry.size + 2, height:entry.size + 2};
  for (const piece of entry.pieces) {
    const targetCells = piece.cells.map(([x,y]) => ({x:x + left, y:y + top}));
    const minX = Math.min(...targetCells.map(p => p.x));
    const minY = Math.min(...targetCells.map(p => p.y));
    let target;
    for (let rotation = 0; rotation < 4; rotation++) {
      const shape = PIECES[piece.type][rotation];
      const candidate = {type:piece.type, rotation,
        x:minX - Math.min(...shape.map(([x]) => x)),
        y:minY - Math.min(...shape.map(([,y]) => y))};
      if (geometry(cellsFor(candidate)) === geometry(targetCells)) {target = candidate; break;}
    }
    assert.ok(target, `Invalid tetromino ${entry.name}/${piece.id}`);
    const start = spawnPiece(piece.type);
    assert.ok(isReachableLockPlacement(board, start, target), `Unreachable ${entry.name}/${piece.id}`);
    const queue = [start], parents = new Map([[key(start), null]]), states = new Map([[key(start), start]]);
    let found;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor];
      if (key(current) === key(target)) {found = current; break;}
      const candidates = [{...current, x:current.x - 1}, {...current, x:current.x + 1},
        {...current, y:current.y + 1}, rotate(board, current, -1), rotate(board, current, 1)];
      for (const next of candidates) {
        if (!next || next.y < -4 || board.collides(next) || parents.has(key(next))) continue;
        parents.set(key(next), key(current)); states.set(key(next), next); queue.push(next);
      }
    }
    assert.ok(found, `No path ${entry.name}/${piece.id}`);
    const route = [];
    for (let at = key(found); at !== null; at = parents.get(at)) route.push(states.get(at));
    route.reverse();
    assert.ok(route.every(state => !board.collides(state)));
    piece.path = route.map(state => cellsFor(state).map(({x,y}) => [x,y]));
    assert.equal(geometry(cellsFor(found)), geometry(targetCells));
    board.lock(found, piece.order);
    piece.squares = board.findSquares(piece.order);
    assert.deepEqual(board.completedRows(), []);
  }
}
process.stdout.write(JSON.stringify(cases));
'''


def read_case(name, filename):
    root = ET.parse(ASSETS / filename).getroot()
    size = int(root.attrib['data-size'])
    pieces = {}
    owners = {}
    for node in root.findall('.//svg:rect', NS):
        if 'data-cell' not in node.attrib:
            continue
        cell = tuple(map(int, node.attrib['data-cell'].split(',')))
        piece_id = node.attrib['data-piece']
        piece = pieces.setdefault(piece_id, {
            'id': piece_id, 'type': node.attrib['data-type'],
            'color': node.attrib['fill'], 'cells': [], 'orders': set(),
        })
        assert cell not in owners
        owners[cell] = piece_id
        piece['cells'].append(cell)
    for node in root.findall('.//svg:text', NS):
        if node.text and node.text.isdigit():
            cell = (int(float(node.attrib['x']) // CELL), int(float(node.attrib['y']) // CELL))
            pieces[owners[cell]]['orders'].add(int(node.text))
    assert set(owners) == {(x, y) for y in range(size) for x in range(size)}
    for piece in pieces.values():
        assert len(piece['cells']) == 4 and len(piece['orders']) == 1
        piece['order'] = piece.pop('orders').pop()
    ordered = sorted(pieces.values(), key=lambda piece: piece['order'])
    assert [piece['order'] for piece in ordered] == list(range(1, size * size // 4 + 1))
    return {'name': name, 'size': size, 'pieces': ordered,
            'kind': 'gold' if len({piece['type'] for piece in ordered}) == 1 else 'silver'}


def background(entry):
    side = (entry['size'] + 2) * CELL
    image = Image.new('RGB', (side, side), '#123d73')
    draw = ImageDraw.Draw(image)
    for position in range(CELL, side, CELL):
        draw.line((position, 0, position, side), fill='#5d8ec2')
        draw.line((0, position, side, position), fill='#5d8ec2')
    x0, y0 = CELL + 2, 2 * CELL + 2
    x1, y1 = (entry['size'] + 1) * CELL - 2, side - 2
    for x in range(x0, x1, 8):
        for y in (y0, y1): draw.line((x, y, min(x + 4, x1), y), fill='#9dc5ec')
    for y in range(y0, y1, 8):
        for x in (x0, x1): draw.line((x, y, x, min(y + 4, y1)), fill='#9dc5ec')
    return image


def draw_piece(image, cells, piece, viewport):
    draw = ImageDraw.Draw(image)
    occupied = set(map(tuple, cells))
    for x, y in cells:
        px = (x - viewport['left']) * CELL
        py = (y - viewport['top']) * CELL
        draw.rectangle((px + 1, py + 1, px + CELL - 2, py + CELL - 2), fill=piece['color'])
        for neighbor, edge in [
            ((x - 1, y), (px + 1, py + 1, px + 1, py + CELL - 2)),
            ((x + 1, y), (px + CELL - 2, py + 1, px + CELL - 2, py + CELL - 2)),
            ((x, y - 1), (px + 1, py + 1, px + CELL - 2, py + 1)),
            ((x, y + 1), (px + 1, py + CELL - 2, px + CELL - 2, py + CELL - 2)),
        ]:
            if neighbor not in occupied:
                draw.line(edge, fill='#111111', width=3)
        draw.text((px + CELL / 2, py + CELL / 2), str(piece['order']), fill='#111111', anchor='mm')


def material(entry, size, square=None):
    overlay = Image.new('RGBA', size)
    if square is None:
        x0, y0 = CELL + 2, 2 * CELL + 2
        side, kind = entry['size'], entry['kind']
    else:
        x0 = (square['left'] - entry['viewport']['left']) * CELL + 2
        y0 = (square['top'] - entry['viewport']['top']) * CELL + 2
        side, kind = square['size'], square['kind']
    x1, y1 = x0 + side * CELL - 4, y0 + side * CELL - 4
    colors = [(255, 240, 161), (255, 212, 71), (213, 148, 22)] if kind == 'gold' else [
        (241, 246, 252), (184, 192, 200), (112, 128, 145)]
    pixels = overlay.load()
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            position = ((x - x0) / (x1 - x0) + (y - y0) / (y1 - y0)) / 2
            segment = min(int(position * 2), 1)
            fraction = position * 2 - segment
            pixels[x, y] = tuple(round(a + (b - a) * fraction) for a, b in zip(colors[segment], colors[segment + 1])) + (255,)
    draw = ImageDraw.Draw(overlay)
    draw.rectangle((x0 - 2, y0 - 2, x1 + 1, y1 + 1), outline='#111111', width=4)
    draw.line((x0 + 5, y1 - 6, x0 + 5, y0 + 5, x1 - 7, y0 + 5), fill=tuple(colors[0]), width=4)
    draw.line((x1 - 5, y0 + 6, x1 - 5, y1 - 5, x0 + 6, y1 - 5), fill=tuple(colors[2]), width=4)
    return overlay


def dissolve_material(entry, settled, square, frames, durations):
    overlay = material(entry, settled.size, square)
    for step in range(1, 7):
        translucent = overlay.copy()
        translucent.putalpha(overlay.getchannel('A').point(lambda alpha: round(alpha * step / 6)))
        frame = settled.convert('RGBA')
        frame.alpha_composite(translucent)
        frames.append(frame.convert('RGB'))
        durations.append(80)
    return frames[-1].copy()


def render(entry):
    settled = background(entry)
    frames, durations = [settled.copy()], [160]
    for piece in entry['pieces']:
        route = piece['path']
        first = next(i for i, cells in enumerate(route)
                     if max(y for _, y in cells) >= entry['viewport']['top'] - 1)
        for cells in route[max(first - 1, 0):]:
            frame = settled.copy()
            draw_piece(frame, cells, piece, entry['viewport'])
            frames.append(frame)
            durations.append(60)
        draw_piece(settled, route[-1], piece, entry['viewport'])
        frames.append(settled.copy())
        durations.append(180)
        if entry['name'] == 't16':
            for square in piece['squares']:
                settled = dissolve_material(entry, settled, square, frames, durations)
                if square['size'] == 4:
                    durations[-1] += 240
    if entry['name'] != 't16':
        dissolve_material(entry, settled, None, frames, durations)
    durations[-1] += 1300
    samples = Image.new('RGB', (64 * 16, 64 * ((len(frames) + 15) // 16)))
    for index, frame in enumerate(frames):
        samples.paste(frame.resize((64, 64)), ((index % 16) * 64, (index // 16) * 64))
    palette = samples.quantize(colors=128)
    indexed = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
    output = ASSETS / f"{entry['name']}-forming.gif"
    buffer = io.BytesIO()
    indexed[0].save(buffer, format='GIF', save_all=True, append_images=indexed[1:],
                    duration=durations, loop=0, disposal=2, optimize=True)
    encoded = buffer.getvalue()
    with Image.open(io.BytesIO(encoded)) as gif:
        assert gif.is_animated and gif.info['loop'] == 0 and gif.size == settled.size
        total = 0
        for index in range(gif.n_frames):
            gif.seek(index)
            total += gif.info['duration']
        assert total == sum(durations)
    output.write_bytes(encoded)
    print(f"{output.relative_to(ROOT)}: {len(encoded):,} bytes, {sum(durations)} ms, {entry['kind']}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', choices=CASES, help='Regenerate just this construction.')
    args = parser.parse_args()
    cases = [read_case(name, filename) for name, filename in CASES.items()
             if args.only is None or name == args.only]
    result = subprocess.run(['node', '--input-type=module', '-e', PATHS],
                            cwd=ROOT, input=json.dumps(cases), text=True, capture_output=True)
    if result.returncode:
        raise SystemExit(f'Game-path validation failed:\n{result.stderr}')
    cases = json.loads(result.stdout)
    for entry in cases:
        render(entry)


if __name__ == '__main__':
    main()
