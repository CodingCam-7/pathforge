import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Grid, WALL, FLOOR, RUBBLE } from '../js/grid.js';
import { findPath, ALGORITHMS } from '../js/pathfinding.js';
import { generate, applyOp, pickEndpoints, GENERATORS } from '../js/generators.js';
import { createRng } from '../js/rng.js';

/** '#' wall, '~' rubble, 'S' start, 'G' goal, anything else floor. */
function fromAscii(rows) {
  const grid = new Grid(rows[0].length, rows.length);
  let start = -1;
  let goal = -1;
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const i = grid.index(x, y);
      grid.cells[i] = ch === '#' ? WALL : ch === '~' ? RUBBLE : FLOOR;
      if (ch === 'S') start = i;
      if (ch === 'G') goal = i;
    }),
  );
  return { grid, start, goal };
}

function reachableCount(grid, source) {
  const seen = new Set([source]);
  const stack = [source];
  const nbrs = new Int32Array(4);
  while (stack.length) {
    const count = grid.neighbors(stack.pop(), nbrs);
    for (let k = 0; k < count; k++) {
      if (!seen.has(nbrs[k])) {
        seen.add(nbrs[k]);
        stack.push(nbrs[k]);
      }
    }
  }
  return seen.size;
}

test('rng is deterministic per seed', () => {
  const a = createRng('rusted-foundry-42');
  const b = createRng('rusted-foundry-42');
  const c = createRng('rusted-foundry-43');
  const seqA = Array.from({ length: 20 }, a.next);
  assert.deepEqual(seqA, Array.from({ length: 20 }, b.next));
  assert.notDeepEqual(seqA, Array.from({ length: 20 }, c.next));
});

test('weighted searches detour around rubble, BFS does not', () => {
  const { grid, start, goal } = fromAscii([
    'S~~~G',
    '.....',
  ]);
  const bfs = findPath(grid, start, goal, 'bfs');
  assert.equal(bfs.steps, 4);
  assert.equal(bfs.cost, 16);

  for (const algo of ['dijkstra', 'astar']) {
    const r = findPath(grid, start, goal, algo);
    assert.equal(r.cost, 6, algo);
    assert.equal(r.steps, 6, algo);
  }
});

test('reports no path when the goal is sealed off', () => {
  const { grid, start, goal } = fromAscii(['S.#G']);
  for (const algo of Object.keys(ALGORITHMS)) {
    const r = findPath(grid, start, goal, algo);
    assert.equal(r.found, false, algo);
    assert.deepEqual(r.path, [], algo);
  }
});

test('start equal to goal is a zero-cost path', () => {
  const { grid, start } = fromAscii(['S..']);
  const r = findPath(grid, start, start, 'astar');
  assert.deepEqual(r.path, [start]);
  assert.equal(r.cost, 0);
});

test('A* expands no more cells than Dijkstra on an open grid', () => {
  const grid = new Grid(40, 40);
  grid.cells.fill(FLOOR);
  const start = grid.index(2, 2);
  const goal = grid.index(37, 30);
  const astar = findPath(grid, start, goal, 'astar');
  const dijkstra = findPath(grid, start, goal, 'dijkstra');
  assert.equal(astar.cost, dijkstra.cost);
  assert.ok(astar.expanded < dijkstra.expanded, `${astar.expanded} vs ${dijkstra.expanded}`);
});

for (const kind of Object.keys(GENERATORS)) {
  test(`${kind}: deterministic, replayable, fully connected, A* optimal`, () => {
    for (let s = 0; s < 40; s++) {
      const seed = `${kind}:test-${s}`;
      const { grid, ops } = generate(kind, 80, 50, createRng(seed));
      const again = generate(kind, 80, 50, createRng(seed));
      assert.deepEqual(again.grid.cells, grid.cells, 'same seed, same map');

      const replay = new Grid(80, 50);
      for (const op of ops) applyOp(replay, op);
      assert.deepEqual(replay.cells, grid.cells, 'replaying ops rebuilds the map');

      const passable = grid.cells.reduce((sum, t) => sum + (t !== WALL), 0);
      assert.ok(passable > 400, `map too small (${passable})`);

      const rng = createRng(seed);
      const { start, goal } = pickEndpoints(grid, rng);
      assert.equal(reachableCount(grid, start), passable, 'every open cell is reachable');

      const astar = findPath(grid, start, goal, 'astar');
      const dijkstra = findPath(grid, start, goal, 'dijkstra');
      assert.ok(astar.found);
      assert.equal(astar.cost, dijkstra.cost, 'A* matches Dijkstra cost');
      assert.ok(astar.expanded <= dijkstra.expanded);
    }
  });
}
