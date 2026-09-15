import { WALL, RUBBLE } from './grid.js';

const COLORS = {
  background: '#05070d',
  wallEdge: '#141c31',
  floor: '#1a2237',
  rubble: '#33291f',
  rubbleMark: '#a57b45',
  frontier: '#ffd166',
  path: '#ff3d81',
  start: '#3dffa8',
  goal: '#ff3d81',
  split: '#5b8cff',
};

// Explored cells are tinted by *when* they were closed: early = violet, late = cyan.
export const HEAT_STOPS = ['#2a1b5e', '#5b2bd1', '#1f9fd6', '#6ff3de'];
const HEAT = buildRamp(HEAT_STOPS, 128);

function buildRamp(stops, size) {
  const rgb = stops.map((hex) => [1, 3, 5].map((o) => parseInt(hex.slice(o, o + 2), 16)));
  return Array.from({ length: size }, (_, i) => {
    const t = (i / (size - 1)) * (rgb.length - 1);
    const k = Math.min(rgb.length - 2, Math.floor(t));
    const f = t - k;
    const [r, g, b] = rgb[k].map((c, ch) => Math.round(c + (rgb[k + 1][ch] - c) * f));
    return `rgb(${r},${g},${b})`;
  });
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cols = 0;
    this.rows = 0;
    this.cell = 10;
    this.inner = 9;
  }

  fit(cols, rows, maxWidth, maxHeight) {
    const cell = Math.max(3, Math.floor(Math.min(maxWidth / cols, maxHeight / rows)));
    const dpr = window.devicePixelRatio || 1;
    const width = cell * cols;
    const height = cell * rows;
    Object.assign(this, { cols, rows, cell, inner: cell >= 7 ? cell - 1 : cell });
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  cellAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left) / this.cell);
    const y = Math.floor((clientY - rect.top) / this.cell);
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return -1;
    return y * this.cols + x;
  }

  center(i) {
    return [(i % this.cols) * this.cell + this.inner / 2, ((i / this.cols) | 0) * this.cell + this.inner / 2];
  }

  draw(scene) {
    const { ctx } = this;
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, this.cols * this.cell, this.rows * this.cell);
    this.drawTiles(scene);
    this.drawSplits(scene);
    this.drawPath(scene);
    this.drawMarkers(scene);
    this.drawHover(scene);
  }

  drawTiles({ grid, search, searchStep }) {
    const { ctx, cell: s, inner } = this;
    const { width: w, height: h, cells } = grid;
    const span = search ? Math.max(1, search.expanded) : 1;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const tile = cells[i];

        if (tile === WALL) {
          // Only walls touching open space get drawn, which gives rooms a crisp outline.
          const edge =
            (x > 0 && cells[i - 1] !== WALL) || (x < w - 1 && cells[i + 1] !== WALL) ||
            (y > 0 && cells[i - w] !== WALL) || (y < h - 1 && cells[i + w] !== WALL);
          if (edge) {
            ctx.fillStyle = COLORS.wallEdge;
            ctx.fillRect(x * s, y * s, inner, inner);
          }
          continue;
        }

        let color = tile === RUBBLE ? COLORS.rubble : COLORS.floor;
        if (search) {
          const closed = search.closeStep[i];
          const opened = search.openStep[i];
          if (closed !== -1 && closed < searchStep) {
            color = HEAT[Math.min(HEAT.length - 1, ((closed / span) * HEAT.length) | 0)];
          } else if (opened !== -1 && opened <= searchStep) {
            color = COLORS.frontier;
          }
        }
        ctx.fillStyle = color;
        ctx.fillRect(x * s, y * s, inner, inner);

        if (tile === RUBBLE && s >= 6) {
          const m = Math.max(2, Math.round(s * 0.3));
          ctx.fillStyle = COLORS.rubbleMark;
          ctx.fillRect(x * s + (inner - m) / 2, y * s + (inner - m) / 2, m, m);
        }
      }
    }
  }

  drawSplits({ splits, splitAlpha }) {
    if (!splits.length || splitAlpha <= 0) return;
    const { ctx, cell: s } = this;
    ctx.save();
    ctx.globalAlpha = splitAlpha * 0.85;
    ctx.strokeStyle = COLORS.split;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([s * 0.6, s * 0.4]);
    ctx.beginPath();
    for (const { x1, y1, x2, y2 } of splits) {
      ctx.moveTo(x1 * s - 0.5, y1 * s - 0.5);
      ctx.lineTo(x2 * s - 0.5, y2 * s - 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawPath({ search, pathProgress }) {
    if (!search?.found || pathProgress <= 0 || search.path.length < 2) return;
    const { ctx, cell: s } = this;
    const { path } = search;
    const end = pathProgress * (path.length - 1);
    const whole = Math.floor(end);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = COLORS.path;
    ctx.shadowColor = COLORS.path;
    ctx.shadowBlur = s * 1.2;
    ctx.lineWidth = Math.max(2, s * 0.32);
    ctx.beginPath();
    ctx.moveTo(...this.center(path[0]));
    for (let k = 1; k <= whole; k++) ctx.lineTo(...this.center(path[k]));

    let [hx, hy] = this.center(path[whole]);
    if (whole < path.length - 1) {
      const [nx, ny] = this.center(path[whole + 1]);
      hx += (nx - hx) * (end - whole);
      hy += (ny - hy) * (end - whole);
      ctx.lineTo(hx, hy);
    }
    ctx.stroke();

    if (pathProgress < 1) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(hx, hy, Math.max(2.5, s * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawMarkers({ start, goal, time }) {
    const { ctx, cell: s } = this;
    const pulse = (Math.sin(time * 4) + 1) / 2;

    const marker = (i, color, shape) => {
      if (i < 0) return;
      const [x, y] = this.center(i);
      const r = Math.max(4, s * 0.6);
      const trace = (radius) => {
        ctx.beginPath();
        if (shape === 'circle') ctx.arc(x, y, radius, 0, Math.PI * 2);
        else {
          ctx.moveTo(x, y - radius);
          ctx.lineTo(x + radius, y);
          ctx.lineTo(x, y + radius);
          ctx.lineTo(x - radius, y);
          ctx.closePath();
        }
      };
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = s * 1.5;
      ctx.fillStyle = color;
      trace(r);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = COLORS.background;
      trace(r * 0.45);
      ctx.stroke();
      ctx.globalAlpha = 1 - pulse;
      ctx.strokeStyle = color;
      trace(r * (1.2 + pulse * 1.1));
      ctx.stroke();
      ctx.restore();
    };

    marker(start, COLORS.start, 'circle');
    marker(goal, COLORS.goal, 'diamond');
  }

  drawHover({ hover, phase }) {
    if (hover < 0 || phase === 'generating') return;
    const { ctx, cell: s, inner } = this;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect((hover % this.cols) * s + 0.5, ((hover / this.cols) | 0) * s + 0.5, inner - 1, inner - 1);
    ctx.restore();
  }
}
