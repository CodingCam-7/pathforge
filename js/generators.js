// Map generators. Each one emits a list of ops (split, room, corridor, snapshot, rubble)
// so the UI can replay construction step by step. Replaying every op onto a blank grid
// always reproduces the final map exactly.

import { Grid, WALL, FLOOR, RUBBLE } from './grid.js';

export const GENERATORS = {
  bsp: { name: 'BSP Rooms', build: buildBsp },
  caves: { name: 'Cellular Caves', build: buildCaves },
};

export function generate(kind, width, height, rng) {
  const grid = new Grid(width, height);
  const ops = [];
  const emit = (op) => {
    ops.push(op);
    applyOp(grid, op);
  };
  GENERATORS[kind].build(grid, rng, emit);
  return { grid, ops };
}

export function applyOp(grid, op) {
  const { cells, width } = grid;
  switch (op.type) {
    case 'room':
      for (let y = op.y; y < op.y + op.h; y++) {
        for (let x = op.x; x < op.x + op.w; x++) cells[y * width + x] = FLOOR;
      }
      break;
    case 'corridor':
      for (const i of op.cells) if (cells[i] === WALL) cells[i] = FLOOR;
      break;
    case 'rubble':
      for (const i of op.cells) if (cells[i] === FLOOR) cells[i] = RUBBLE;
      break;
    case 'snapshot':
      cells.set(op.cells);
      break;
    case 'split':
      break; // visual only
    default:
      throw new Error(`Unknown op: ${op.type}`);
  }
}

// --- Binary space partitioning -------------------------------------------------------

const MIN_LEAF = 9;

function buildBsp(grid, rng, emit) {
  const root = { x: 1, y: 1, w: grid.width - 2, h: grid.height - 2 };

  (function split(node) {
    const canH = node.h >= MIN_LEAF * 2;
    const canV = node.w >= MIN_LEAF * 2;
    if (!canH && !canV) return;
    // Occasionally keep a mid-sized leaf whole so room sizes vary.
    if (node.w < MIN_LEAF * 3 && node.h < MIN_LEAF * 3 && rng.chance(0.2)) return;

    let horizontal = canH;
    if (canH && canV) {
      horizontal = node.h > node.w * 1.25 ? true : node.w > node.h * 1.25 ? false : rng.chance(0.5);
    }
    const at = rng.int(MIN_LEAF, (horizontal ? node.h : node.w) - MIN_LEAF);
    if (horizontal) {
      node.children = [
        { x: node.x, y: node.y, w: node.w, h: at },
        { x: node.x, y: node.y + at, w: node.w, h: node.h - at },
      ];
      emit({ type: 'split', x1: node.x, y1: node.y + at, x2: node.x + node.w, y2: node.y + at });
    } else {
      node.children = [
        { x: node.x, y: node.y, w: at, h: node.h },
        { x: node.x + at, y: node.y, w: node.w - at, h: node.h },
      ];
      emit({ type: 'split', x1: node.x + at, y1: node.y, x2: node.x + at, y2: node.y + node.h });
    }
    node.children.forEach(split);
  })(root);

  const leaves = [];
  (function collect(node) {
    if (node.children) node.children.forEach(collect);
    else leaves.push(node);
  })(root);

  for (const leaf of leaves) {
    const w = rng.int(Math.max(4, Math.floor(leaf.w * 0.45)), leaf.w - 2);
    const h = rng.int(Math.max(4, Math.floor(leaf.h * 0.45)), leaf.h - 2);
    const x = rng.int(leaf.x + 1, leaf.x + leaf.w - w - 1);
    const y = rng.int(leaf.y + 1, leaf.y + leaf.h - h - 1);
    leaf.room = { x, y, w, h };
    emit({ type: 'room', x, y, w, h });
  }

  // Join sibling subtrees bottom-up; a tree of corridors guarantees full connectivity.
  const roomOf = (node) => node.room ?? roomOf(rng.pick(node.children));
  const center = (r) => ({ x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) });
  (function connect(node) {
    if (!node.children) return;
    node.children.forEach(connect);
    const a = center(roomOf(node.children[0]));
    const b = center(roomOf(node.children[1]));
    emit({ type: 'corridor', cells: elbow(grid, a, b, rng.chance(0.5)) });
  })(root);

  sprinkleRubble(grid, rng, emit, 90);
}

function elbow(grid, a, b, horizontalFirst) {
  const cells = [];
  const corner = horizontalFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
  const walk = (from, to) => {
    let { x, y } = from;
    cells.push(grid.index(x, y));
    while (x !== to.x || y !== to.y) {
      x += Math.sign(to.x - x);
      y += Math.sign(to.y - y);
      cells.push(grid.index(x, y));
    }
  };
  walk(a, corner);
  walk(corner, b);
  return cells;
}

// --- Cellular automata caves ---------------------------------------------------------

function buildCaves(grid, rng, emit) {
  const { width: w, height: h } = grid;
  const n = w * h;
  const onBorder = (x, y) => x === 0 || y === 0 || x === w - 1 || y === h - 1;

  let cells = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) cells[y * w + x] = onBorder(x, y) || rng.next() < 0.45 ? WALL : FLOOR;
  }
  emit({ type: 'snapshot', cells: cells.slice() });

  // 4-5 rule smoothing.
  for (let iter = 0; iter < 5; iter++) {
    const next = new Uint8Array(n);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let walls = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if ((dx || dy) && cells[(y + dy) * w + x + dx] === WALL) walls++;
          }
        }
        const i = y * w + x;
        next[i] = walls > 4 ? WALL : walls < 4 ? FLOOR : cells[i];
      }
    }
    cells = next;
    emit({ type: 'snapshot', cells: cells.slice() });
  }

  // Keep only the largest 4-connected cave so every floor cell is reachable.
  const region = new Int32Array(n).fill(-1);
  const stack = [];
  let best = -1;
  let bestSize = 0;
  for (let i = 0, id = 0; i < n; i++) {
    if (cells[i] !== FLOOR || region[i] !== -1) continue;
    let size = 0;
    region[i] = id;
    stack.push(i);
    while (stack.length) {
      const c = stack.pop();
      size++;
      for (const nb of [c - w, c + 1, c + w, c - 1]) {
        if (cells[nb] === FLOOR && region[nb] === -1) {
          region[nb] = id;
          stack.push(nb);
        }
      }
    }
    if (size > bestSize) [best, bestSize] = [id, size];
    id++;
  }
  for (let i = 0; i < n; i++) if (cells[i] === FLOOR && region[i] !== best) cells[i] = WALL;
  emit({ type: 'snapshot', cells: cells.slice() });

  sprinkleRubble(grid, rng, emit, 70);
}

// --- Shared --------------------------------------------------------------------------

function sprinkleRubble(grid, rng, emit, floorPerCluster) {
  const { width: w, height: h, cells } = grid;
  const floors = [];
  for (let i = 0; i < cells.length; i++) if (cells[i] === FLOOR) floors.push(i);

  const rubble = new Set();
  const clusters = Math.round(floors.length / floorPerCluster);
  for (let c = 0; c < clusters; c++) {
    const origin = rng.pick(floors);
    const cx = origin % w;
    const cy = (origin / w) | 0;
    const r = rng.int(1, 3);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if (dx * dx + dy * dy <= r * r + 1 && rng.chance(0.75) && cells[y * w + x] === FLOOR) rubble.add(y * w + x);
      }
    }
  }
  emit({ type: 'rubble', cells: [...rubble] });
}

/** Picks two far-apart cells with a double BFS sweep (approximates the map's diameter). */
export function pickEndpoints(grid, rng) {
  const floors = [];
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === FLOOR) floors.push(i);
  if (!floors.length) return { start: -1, goal: -1 };
  const start = farthestFrom(grid, rng.pick(floors));
  return { start, goal: farthestFrom(grid, start) };
}

function farthestFrom(grid, source) {
  const seen = new Uint8Array(grid.cells.length);
  const queue = new Int32Array(grid.cells.length);
  const nbrs = new Int32Array(4);
  let head = 0;
  let tail = 0;
  let last = source;
  queue[tail++] = source;
  seen[source] = 1;
  while (head < tail) {
    const cur = queue[head++];
    if (grid.cells[cur] === FLOOR) last = cur;
    const count = grid.neighbors(cur, nbrs);
    for (let k = 0; k < count; k++) {
      if (!seen[nbrs[k]]) {
        seen[nbrs[k]] = 1;
        queue[tail++] = nbrs[k];
      }
    }
  }
  return last;
}
