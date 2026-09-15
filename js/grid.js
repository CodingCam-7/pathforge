export const WALL = 0;
export const FLOOR = 1;
export const RUBBLE = 2;

/** Cost of stepping onto a tile, indexed by tile type. */
export const TILE_COST = [Infinity, 1, 5];

/** Flat, cache-friendly tile grid. Cells are addressed by index = y * width + x. */
export class Grid {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.cells = new Uint8Array(width * height); // all WALL
  }

  index(x, y) {
    return y * this.width + x;
  }

  isPassable(i) {
    return this.cells[i] !== WALL;
  }

  /** Writes the 4-connected passable neighbours of `i` into `out` and returns how many. */
  neighbors(i, out) {
    const { width: w, cells } = this;
    const x = i % w;
    let n = 0;
    if (i >= w && cells[i - w] !== WALL) out[n++] = i - w;
    if (x < w - 1 && cells[i + 1] !== WALL) out[n++] = i + 1;
    if (i + w < cells.length && cells[i + w] !== WALL) out[n++] = i + w;
    if (x > 0 && cells[i - 1] !== WALL) out[n++] = i - 1;
    return n;
  }
}
