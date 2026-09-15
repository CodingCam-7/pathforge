# PATHFORGE

**▶ [Live demo](https://codingcam-7.github.io/pathforge/)**

**Procedural dungeon generation × pathfinding lab.** Watch a map get built step by step, then race four search algorithms across it and compare them in a live benchmark table. Paint walls, scatter rubble or drag the endpoints, and every search re-plans instantly.

Built from scratch in vanilla JavaScript with Canvas 2D. No framework, no build step, no dependencies.

## Features

- **Two generators, fully animated**
  - *BSP Rooms*: recursive binary space partitioning, rooms carved per leaf, and sibling subtrees joined with L-shaped corridors (so the map is always connected).
  - *Cellular Caves*: random noise smoothed with the 4-5 automaton rule, then flood-filled to keep only the largest cave.
- **Four search algorithms on one shared core**: BFS, Dijkstra, A* (Manhattan heuristic with goal-directed tie-breaking) and Greedy Best-First.
- **Weighted terrain**: rubble costs 5 to cross, which shows exactly where BFS and Greedy stop being optimal.
- **Scrubbable playback**: each search records when every cell was opened and closed, so the animation replays from data instead of re-running the algorithm. Explored cells are heat-mapped by expansion order.
- **Live benchmark**: cells expanded, path cost (with an optimality check), steps and best-of-3 timings for all four algorithms on the same map.
- **Deterministic, shareable seeds**: FNV-1a hashing plus a Mulberry32 PRNG. The generator, seed and algorithm are kept in the URL hash.
- **Interactive editing**: tools for start, goal, wall, rubble and floor, with drag-to-paint and instant re-planning.

## Run it

ES modules need to be served over HTTP:

```bash
cd pathforge && python3 -m http.server 8090
```

Then open http://localhost:8090.

## Test it

```bash
cd pathforge && npm test
```

Uses the built-in `node:test` runner (Node 18+). The suite checks:

- The PRNG is deterministic.
- Weighted searches detour around rubble while BFS does not.
- An unreachable goal and a start equal to the goal are handled correctly.
- A* expands fewer cells than Dijkstra.
- Across 40 seeds for each generator: output is deterministic, replaying the recorded ops rebuilds the exact map, every open cell is reachable, and A*'s path cost always matches Dijkstra's.

## Architecture

```
js/
  rng.js          Seed hashing (FNV-1a) + Mulberry32 PRNG
  grid.js         Flat Uint8Array tile grid, tile costs, allocation-free neighbour lookup
  generators.js   BSP + cellular automata; emit replayable ops; endpoint picking via double BFS sweep
  pathfinding.js  Binary min-heap, FIFO queue, one search loop parameterised by priority function
  render.js       Canvas renderer: heat-mapped exploration, glowing path trace, markers
  main.js         State machine (generating → searching → tracing → done), input, UI binding
tests/
  core.test.js    node:test suite
```

Design notes:

- **Generators emit ops instead of frames.** The same op list builds the final grid and drives the animation. A test proves that replaying the ops reproduces the map exactly.
- **Searches record open and close order.** Rendering any moment of the search is then a pure function of `(result, step)`, which makes speed changes, replays and switching algorithms free.
- **Lazy deletion in the heap.** Stale entries are skipped when popped instead of using decrease-key, which keeps the heap simple and fast.
- **Typed arrays throughout.** The grid, g-scores, parents and step records all use typed arrays, so a full four-algorithm re-plan takes well under a millisecond per search on an 80×50 map.

## Controls

| Input | Action |
| --- | --- |
| `Space` | Replay the selected search |
| `←` / `→` | Switch algorithm |
| `N` | New random map |
| `1`–`5` | Start / Goal / Wall / Rubble / Floor tool |
| Click during generation | Skip to the finished map |
