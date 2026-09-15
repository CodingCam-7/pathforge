import { randomSeed, createRng } from './rng.js';
import { Grid, WALL, FLOOR, RUBBLE } from './grid.js';
import { GENERATORS, generate, applyOp, pickEndpoints } from './generators.js';
import { ALGORITHMS, findPath } from './pathfinding.js';
import { Renderer, HEAT_STOPS } from './render.js';

const COLS = 80;
const ROWS = 50;
const TOOLS = ['start', 'goal', 'wall', 'rubble', 'floor'];
const ALGO_KEYS = Object.keys(ALGORITHMS);

// Seconds each generation op stays on screen at 1x speed.
const OP_DURATION = { split: 0.06, room: 0.045, corridor: 0.035, snapshot: 0.4, rubble: 0.3 };

const $ = (sel) => document.querySelector(sel);
const canvas = $('#board');
const renderer = new Renderer(canvas);

const state = {
  generator: 'bsp',
  seed: '',
  algorithm: 'astar',
  tool: 'wall',
  speed: 0.55,
  // idle | generating | searching | tracing | done
  phase: 'idle',
  grid: new Grid(COLS, ROWS),
  pending: null,
  opIndex: 0,
  opTimer: 0,
  splits: [],
  splitAlpha: 0,
  start: -1,
  goal: -1,
  results: null,
  searchStep: 0,
  pathProgress: 0,
  hover: -1,
  drag: null,
};

const speedFactor = () => 0.25 * Math.pow(16, state.speed); // 0.25x .. 4x
const cellsPerSecond = () => 60 * Math.pow(100, state.speed); // 60 .. 6000

// --- Generation ------------------------------------------------------------------------

function startGeneration(seed = state.seed) {
  state.seed = seed;
  const rng = createRng(`${state.generator}:${seed}`);
  const { grid, ops } = generate(state.generator, COLS, ROWS, rng);
  const { start, goal } = pickEndpoints(grid, rng);
  Object.assign(state, {
    phase: 'generating',
    pending: { ops, start, goal },
    grid: new Grid(COLS, ROWS),
    opIndex: 0,
    opTimer: 0,
    splits: [],
    splitAlpha: 1,
    start: -1,
    goal: -1,
    results: null,
  });
  syncControls();
  renderStats();
}

function revealOp(op) {
  applyOp(state.grid, op);
  if (op.type === 'split') state.splits.push(op);
  state.opIndex++;
}

function finishGeneration() {
  const { ops, start, goal } = state.pending;
  while (state.opIndex < ops.length) revealOp(ops[state.opIndex]);
  Object.assign(state, { pending: null, start, goal, phase: 'idle' });
  runSearch();
}

// --- Search ----------------------------------------------------------------------------

function runSearch({ animate = true } = {}) {
  if (state.phase === 'generating' || state.start < 0) return;
  state.results = {};
  for (const key of ALGO_KEYS) {
    // Take the best of a few runs for steadier timings; live re-plans run once.
    let best = null;
    for (let r = animate ? 3 : 1; r > 0; r--) {
      const result = findPath(state.grid, state.start, state.goal, key);
      if (!best || result.ms < best.ms) best = result;
    }
    state.results[key] = best;
  }
  if (animate) replay();
  else Object.assign(state, { searchStep: Infinity, pathProgress: 1, phase: 'done' });
  renderStats();
}

function replay() {
  if (state.phase === 'generating') return;
  if (!state.results) return runSearch();
  Object.assign(state, { searchStep: 0, pathProgress: 0, phase: 'searching' });
}

function setAlgorithm(key) {
  state.algorithm = key;
  syncControls();
  renderStats();
  replay();
}

// --- Frame loop ------------------------------------------------------------------------

function tick(dt) {
  const current = state.results?.[state.algorithm];
  switch (state.phase) {
    case 'generating': {
      state.opTimer += dt * speedFactor();
      const { ops } = state.pending;
      while (state.opIndex < ops.length && state.opTimer >= OP_DURATION[ops[state.opIndex].type]) {
        state.opTimer -= OP_DURATION[ops[state.opIndex].type];
        revealOp(ops[state.opIndex]);
      }
      if (state.opIndex >= ops.length) finishGeneration();
      break;
    }
    case 'searching':
      state.searchStep += dt * cellsPerSecond();
      if (state.searchStep >= current.expanded) {
        state.searchStep = current.expanded;
        state.phase = current.found ? 'tracing' : 'done';
      }
      break;
    case 'tracing':
      state.pathProgress = Math.min(1, state.pathProgress + dt * 1.2 * Math.max(1, speedFactor()));
      if (state.pathProgress >= 1) state.phase = 'done';
      break;
  }
  if (state.phase !== 'generating') state.splitAlpha = Math.max(0, state.splitAlpha - dt * 1.2);
}

let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  tick(dt);
  renderer.draw({ ...state, search: state.results?.[state.algorithm] ?? null, time: now / 1000 });
  updateHud();
  requestAnimationFrame(frame);
}

// --- Editing ---------------------------------------------------------------------------

function paint(i) {
  const { cells } = state.grid;
  let changed = false;
  if (state.drag === 'start' || state.drag === 'goal') {
    const other = state.drag === 'start' ? state.goal : state.start;
    if (cells[i] !== WALL && i !== other && state[state.drag] !== i) {
      state[state.drag] = i;
      changed = true;
    }
  } else if (i !== state.start && i !== state.goal) {
    const tile = { wall: WALL, rubble: RUBBLE, floor: FLOOR }[state.drag];
    if (cells[i] !== tile) {
      cells[i] = tile;
      changed = true;
    }
  }
  // Live re-plan: every edit recomputes all four searches instantly.
  if (changed && state.results) runSearch({ animate: false });
}

canvas.addEventListener('pointerdown', (e) => {
  if (state.phase === 'generating') return finishGeneration();
  const i = renderer.cellAt(e.clientX, e.clientY);
  if (i < 0) return;
  canvas.setPointerCapture(e.pointerId);
  state.drag = i === state.start ? 'start' : i === state.goal ? 'goal' : state.tool;
  paint(i);
});
canvas.addEventListener('pointermove', (e) => {
  const i = renderer.cellAt(e.clientX, e.clientY);
  state.hover = i;
  canvas.style.cursor = i >= 0 && (i === state.start || i === state.goal) ? 'grab' : 'crosshair';
  if (state.drag && i >= 0) paint(i);
});
const endDrag = () => (state.drag = null);
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', () => (state.hover = -1));

// --- UI --------------------------------------------------------------------------------

function buildSegmented(container, entries, onSelect) {
  container.innerHTML = '';
  for (const [key, label, hint] of entries) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.key = key;
    btn.innerHTML = hint ? `${label}<kbd>${hint}</kbd>` : label;
    btn.addEventListener('click', () => onSelect(key));
    container.append(btn);
  }
}

buildSegmented($('#generators'), Object.entries(GENERATORS).map(([k, g]) => [k, g.name]), (key) => {
  state.generator = key;
  startGeneration();
});
buildSegmented($('#algorithms'), ALGO_KEYS.map((k) => [k, ALGORITHMS[k].label]), setAlgorithm);
buildSegmented(
  $('#tools'),
  TOOLS.map((t, n) => [t, t[0].toUpperCase() + t.slice(1), n + 1]),
  (tool) => {
    state.tool = tool;
    syncControls();
  },
);

function syncControls() {
  const mark = (container, active) =>
    container.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.key === active)));
  mark($('#generators'), state.generator);
  mark($('#algorithms'), state.algorithm);
  mark($('#tools'), state.tool);

  const algo = ALGORITHMS[state.algorithm];
  $('#algo-name').textContent = algo.name;
  $('#algo-blurb').textContent = algo.blurb;
  $('#algo-guarantee').textContent = algo.guarantee;
  $('#algo-structure').textContent = algo.structure;
  if (document.activeElement !== $('#seed')) $('#seed').value = state.seed;

  const params = new URLSearchParams({ gen: state.generator, seed: state.seed, algo: state.algorithm });
  history.replaceState(null, '', `#${params}`);
}

function renderStats() {
  const body = $('#stats-body');
  const { results } = state;
  if (!results) {
    body.innerHTML = `<tr><td colspan="5" class="empty">Generating map…</td></tr>`;
    return;
  }
  const found = Object.values(results).filter((r) => r.found);
  const bestCost = Math.min(...found.map((r) => r.cost));
  const fewestExpanded = Math.min(...found.map((r) => r.expanded));
  const maxExpanded = Math.max(...Object.values(results).map((r) => r.expanded));

  body.innerHTML = ALGO_KEYS.map((key) => {
    const r = results[key];
    const active = key === state.algorithm ? ' class="active"' : '';
    const pct = ((r.expanded / maxExpanded) * 100).toFixed(1);
    const costCell = r.found
      ? `${r.cost}${r.cost === bestCost ? '<span class="badge ok">optimal</span>' : `<span class="badge warn">+${r.cost - bestCost}</span>`}`
      : '<span class="badge warn">no path</span>';
    return `<tr data-key="${key}"${active}>
      <th scope="row">${ALGORITHMS[key].label}</th>
      <td class="num">
        <span class="${r.found && r.expanded === fewestExpanded ? 'lead' : ''}">${r.expanded.toLocaleString()}</span>
        <div class="bar"><i style="width:${pct}%"></i></div>
      </td>
      <td class="num">${costCell}</td>
      <td class="num">${r.found ? r.steps : '–'}</td>
      <td class="num">${r.ms.toFixed(2)}</td>
    </tr>`;
  }).join('');
}

$('#stats-body').addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-key]');
  if (row) setAlgorithm(row.dataset.key);
});

let hudText = '';
function updateHud() {
  const algo = ALGORITHMS[state.algorithm];
  const r = state.results?.[state.algorithm];
  let text = '';
  switch (state.phase) {
    case 'generating':
      text = `GENERATING · ${GENERATORS[state.generator].name} · op ${state.opIndex}/${state.pending.ops.length} · click to skip`;
      break;
    case 'searching':
      text = `SEARCHING · ${algo.label} · ${Math.floor(state.searchStep).toLocaleString()} expanded`;
      break;
    case 'tracing':
      text = `PATH FOUND · ${algo.label} · tracing`;
      break;
    case 'done':
      text = r.found
        ? `${algo.label} · cost ${r.cost} · ${r.steps} steps · ${r.expanded.toLocaleString()} expanded`
        : `${algo.label} · NO PATH · goal unreachable`;
      break;
  }
  if (text !== hudText) {
    hudText = text;
    $('#hud').textContent = text;
    $('#hud').dataset.phase = state.phase;
  }
}

$('#seed-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('#seed').blur();
  startGeneration($('#seed').value.trim() || randomSeed());
});
$('#dice').addEventListener('click', () => startGeneration(randomSeed()));
$('#run').addEventListener('click', replay);
$('#speed').addEventListener('input', (e) => (state.speed = Number(e.target.value)));
$('#copy-link').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  try {
    await navigator.clipboard.writeText(location.href);
    btn.textContent = 'Copied!';
  } catch {
    btn.textContent = 'Copy failed';
  }
  setTimeout(() => (btn.textContent = 'Copy share link'), 1400);
});

window.addEventListener('keydown', (e) => {
  if (e.target.matches('input[type="text"]') || e.metaKey || e.ctrlKey) return;
  if (e.key === ' ') {
    e.preventDefault();
    replay();
  } else if (e.key === 'n' || e.key === 'N') {
    startGeneration(randomSeed());
  } else if (e.key >= '1' && e.key <= '5') {
    state.tool = TOOLS[Number(e.key) - 1];
    syncControls();
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const step = e.key === 'ArrowRight' ? 1 : ALGO_KEYS.length - 1;
    setAlgorithm(ALGO_KEYS[(ALGO_KEYS.indexOf(state.algorithm) + step) % ALGO_KEYS.length]);
  }
});

function fit() {
  const wrap = $('#board-wrap');
  renderer.fit(COLS, ROWS, wrap.clientWidth, Math.max(240, window.innerHeight * 0.68));
}
window.addEventListener('resize', fit);
new ResizeObserver(fit).observe($('#board-wrap'));

$('#heat-legend').style.background = `linear-gradient(90deg, ${HEAT_STOPS.join(', ')})`;

// --- Boot ------------------------------------------------------------------------------

const params = new URLSearchParams(location.hash.slice(1));
if (GENERATORS[params.get('gen')]) state.generator = params.get('gen');
if (ALGORITHMS[params.get('algo')]) state.algorithm = params.get('algo');
$('#speed').value = state.speed;

fit();
startGeneration(params.get('seed') || randomSeed());
requestAnimationFrame(frame);
