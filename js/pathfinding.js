// Four grid search algorithms sharing one core loop. Each run records *when* every cell
// was opened and closed, so the renderer can scrub through the search without re-running it.

import { TILE_COST } from './grid.js';

export const ALGORITHMS = {
  bfs: {
    label: 'BFS',
    name: 'Breadth-First Search',
    blurb: 'Expands in rings from the start. Finds the fewest steps but is blind to terrain cost, so it wades straight through rubble.',
    guarantee: 'Fewest steps',
    structure: 'FIFO queue',
  },
  dijkstra: {
    label: 'Dijkstra',
    name: "Dijkstra's Algorithm",
    blurb: 'Always expands the cheapest known cell. Guaranteed cheapest path, but it searches in every direction equally.',
    guarantee: 'Cheapest path',
    structure: 'Heap on g',
  },
  astar: {
    label: 'A*',
    name: 'A* Search',
    blurb: 'Dijkstra plus a Manhattan-distance heuristic that pulls the search toward the goal. Same optimal cost, far fewer expansions.',
    guarantee: 'Cheapest path',
    structure: 'Heap on g + h',
  },
  greedy: {
    label: 'Greedy',
    name: 'Greedy Best-First',
    blurb: 'Chases the heuristic and ignores the cost so far. Very fast when the way is clear, with no guarantee on path quality.',
    guarantee: 'None',
    structure: 'Heap on h',
  },
};

class MinHeap {
  items = [];
  keys = [];

  get size() {
    return this.items.length;
  }

  push(item, key) {
    const { items, keys } = this;
    let i = items.length;
    items.push(item);
    keys.push(key);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      items[i] = items[parent];
      keys[i] = keys[parent];
      i = parent;
    }
    items[i] = item;
    keys[i] = key;
  }

  pop() {
    const { items, keys } = this;
    const top = items[0];
    const lastItem = items.pop();
    const lastKey = keys.pop();
    const n = items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && keys[child + 1] < keys[child]) child++;
        if (keys[child] >= lastKey) break;
        items[i] = items[child];
        keys[i] = keys[child];
        i = child;
      }
      items[i] = lastItem;
      keys[i] = lastKey;
    }
    return top;
  }
}

class FifoQueue {
  items = [];
  head = 0;

  get size() {
    return this.items.length - this.head;
  }

  push(item) {
    this.items.push(item);
  }

  pop() {
    return this.items[this.head++];
  }
}

/**
 * @returns {{ algorithm, found, path: number[], cost, steps, expanded, openStep: Int32Array, closeStep: Int32Array, ms }}
 */
export function findPath(grid, start, goal, algorithm) {
  if (!ALGORITHMS[algorithm]) throw new Error(`Unknown algorithm: ${algorithm}`);
  const t0 = performance.now();

  const { width: w, cells } = grid;
  const n = cells.length;
  const g = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const openStep = new Int32Array(n).fill(-1);
  const closeStep = new Int32Array(n).fill(-1);

  const gx = goal % w;
  const gy = (goal / w) | 0;
  const heuristic = (i) => Math.abs((i % w) - gx) + Math.abs(((i / w) | 0) - gy);
  const weighted = algorithm !== 'bfs';
  const priority = {
    bfs: () => 0,
    dijkstra: (_, cost) => cost,
    // Break f-ties toward the goal; the h bonus is < 1 so it never reorders distinct f values.
    astar: (i, cost) => {
      const h = heuristic(i);
      return cost + h + h * 1e-3;
    },
    greedy: (i) => heuristic(i),
  }[algorithm];

  const open = weighted ? new MinHeap() : new FifoQueue();
  const nbrs = new Int32Array(4);
  let step = 0;

  g[start] = 0;
  openStep[start] = 0;
  open.push(start, 0);

  while (open.size > 0) {
    const cur = open.pop();
    if (closeStep[cur] !== -1) continue; // stale heap entry (lazy deletion)
    closeStep[cur] = step++;
    if (cur === goal) break;

    const count = grid.neighbors(cur, nbrs);
    for (let k = 0; k < count; k++) {
      const nb = nbrs[k];
      if (closeStep[nb] !== -1) continue;
      const cost = g[cur] + (weighted ? TILE_COST[cells[nb]] : 1);
      if (cost >= g[nb]) continue;
      g[nb] = cost;
      parent[nb] = cur;
      if (openStep[nb] === -1) openStep[nb] = step;
      open.push(nb, priority(nb, cost));
    }
  }

  const found = closeStep[goal] !== -1;
  const path = [];
  let cost = 0;
  if (found) {
    for (let i = goal; i !== -1; i = parent[i]) path.push(i);
    path.reverse();
    for (let k = 1; k < path.length; k++) cost += TILE_COST[cells[path[k]]];
  }

  return {
    algorithm,
    found,
    path,
    cost,
    steps: Math.max(0, path.length - 1),
    expanded: step,
    openStep,
    closeStep,
    ms: performance.now() - t0,
  };
}
