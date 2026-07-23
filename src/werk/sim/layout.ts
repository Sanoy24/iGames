import { makeRng } from './rng';

// ── Shared constants (client renders + server simulates against these) ───────
export const CELL = 40;
export const HUMAN_SPEED = 150; // px/sec
export const PLAYER_RADIUS = CELL * 0.3;
export const COLLECT_RADIUS = CELL * 0.42;
/** Fixed simulation timestep. Bots step at this rate on both client and server. */
export const SIM_DT = 1 / 30;

export type WinMode = 'A' | 'B';
export type CoinType = 'bronze' | 'silver' | 'gold';
export const COIN_VALUE: Record<CoinType, number> = { bronze: 1, silver: 5, gold: 25 };

export type PowerKind = 'speed' | 'magnet' | 'shield';

/** One maze cell; a `true` side means a wall is present there. */
export interface Cell {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

export interface CoinLite {
  index: number;
  x: number;
  y: number;
  cx: number;
  cy: number;
  type: CoinType;
  value: number;
}

export interface PowerupLite {
  x: number;
  y: number;
  cx: number;
  cy: number;
  kind: PowerKind;
}

export interface LayoutParams {
  totalPlayers: number;
  coinDensityX100: number;
  powerupsEnabled: boolean;
  botCount: number;
}

/** Fully-deterministic maze + coin + spawn layout, reproducible from `seed`. */
export interface Layout {
  seed: number;
  size: number;
  worldPx: number;
  center: [number, number];
  grid: Cell[][];
  coins: CoinLite[];
  powerups: PowerupLite[];
  humanSpawn: [number, number]; // pixel
  botSpawns: Array<[number, number]>; // pixel, one per bot
}

export function mazeSizeFor(totalPlayers: number): { size: number; extraOpenPct: number } {
  if (totalPlayers <= 10) return { size: 16, extraOpenPct: 12 };
  if (totalPlayers <= 25) return { size: 24, extraOpenPct: 15 };
  if (totalPlayers <= 50) return { size: 32, extraOpenPct: 18 };
  if (totalPlayers <= 75) return { size: 40, extraOpenPct: 20 };
  return { size: 48, extraOpenPct: 22 };
}

const cellCenter = (cx: number, cy: number): [number, number] => [cx * CELL + CELL / 2, cy * CELL + CELL / 2];

export function toCell(x: number, y: number): [number, number] {
  return [Math.floor(x / CELL), Math.floor(y / CELL)];
}

function generateMaze(n: number, extraOpenPct: number, rng: () => number): Cell[][] {
  const grid: Cell[][] = [];
  for (let y = 0; y < n; y++) {
    grid[y] = [];
    for (let x = 0; x < n; x++) grid[y][x] = { top: true, right: true, bottom: true, left: true };
  }
  const visited = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const stack: Array<[number, number]> = [[0, 0]];
  visited[0][0] = true;

  const carve = (ax: number, ay: number, bx: number, by: number) => {
    if (bx === ax + 1) { grid[ay][ax].right = false; grid[by][bx].left = false; }
    else if (bx === ax - 1) { grid[ay][ax].left = false; grid[by][bx].right = false; }
    else if (by === ay + 1) { grid[ay][ax].bottom = false; grid[by][bx].top = false; }
    else if (by === ay - 1) { grid[ay][ax].top = false; grid[by][bx].bottom = false; }
  };

  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const neighbors: Array<[number, number]> = [];
    if (y > 0 && !visited[y - 1][x]) neighbors.push([x, y - 1]);
    if (x < n - 1 && !visited[y][x + 1]) neighbors.push([x + 1, y]);
    if (y < n - 1 && !visited[y + 1][x]) neighbors.push([x, y + 1]);
    if (x > 0 && !visited[y][x - 1]) neighbors.push([x - 1, y]);
    if (!neighbors.length) { stack.pop(); continue; }
    const [nx, ny] = neighbors[Math.floor(rng() * neighbors.length)];
    carve(x, y, nx, ny);
    visited[ny][nx] = true;
    stack.push([nx, ny]);
  }

  const interiorWalls = n * (n - 1) * 2;
  const toRemove = Math.floor((interiorWalls * extraOpenPct) / 100);
  for (let i = 0; i < toRemove; i++) {
    const x = Math.floor(rng() * n);
    const y = Math.floor(rng() * n);
    if (rng() < 0.5 && x < n - 1) { grid[y][x].right = false; grid[y][x + 1].left = false; }
    else if (y < n - 1) { grid[y][x].bottom = false; grid[y + 1][x].top = false; }
  }
  return grid;
}

/** Breadth-first shortest cell path from (sx,sy) to (tx,ty); [] if same or unreachable. */
export function bfs(grid: Cell[][], n: number, sx: number, sy: number, tx: number, ty: number): Array<[number, number]> {
  if (sx === tx && sy === ty) return [];
  const prev = new Int32Array(n * n).fill(-1);
  const seen = new Uint8Array(n * n);
  const q: number[] = [sy * n + sx];
  seen[sy * n + sx] = 1;
  const goal = ty * n + tx;
  let head = 0;
  while (head < q.length) {
    const cur = q[head++];
    if (cur === goal) break;
    const cx = cur % n, cy = Math.floor(cur / n);
    const cell = grid[cy][cx];
    const nbrs: Array<[number, number]> = [];
    if (!cell.top) nbrs.push([cx, cy - 1]);
    if (!cell.right) nbrs.push([cx + 1, cy]);
    if (!cell.bottom) nbrs.push([cx, cy + 1]);
    if (!cell.left) nbrs.push([cx - 1, cy]);
    for (const [nx, ny] of nbrs) {
      const id = ny * n + nx;
      if (seen[id]) continue;
      seen[id] = 1;
      prev[id] = cur;
      q.push(id);
    }
  }
  if (!seen[goal]) return [];
  const path: Array<[number, number]> = [];
  let cur = goal;
  const start = sy * n + sx;
  while (cur !== -1 && cur !== start) {
    path.push([cur % n, Math.floor(cur / n)]);
    cur = prev[cur];
  }
  path.reverse();
  return path;
}

function weightedCoinType(rng: () => number): CoinType {
  const r = rng();
  if (r < 0.6) return 'bronze';
  if (r < 0.9) return 'silver';
  return 'gold';
}

/** Build the full deterministic layout. Generation order is fixed so the same
 *  seed yields byte-identical maze/coins/spawns on client and server. */
export function buildLayout(seed: number, params: LayoutParams): Layout {
  const rng = makeRng(seed);
  const { size, extraOpenPct } = mazeSizeFor(params.totalPlayers);
  const worldPx = size * CELL;
  const c = Math.floor(size / 2);
  const center: [number, number] = [c, c];

  const grid = generateMaze(size, extraOpenPct, rng);

  // Coins.
  const density = params.coinDensityX100 / 100;
  const target = Math.floor(size * size * density);
  const coins: CoinLite[] = [];
  const used = new Set<string>();
  let guard = 0;
  while (coins.length < target && guard < target * 20) {
    guard++;
    const cx = Math.floor(rng() * size);
    const cy = Math.floor(rng() * size);
    const key = `${cx},${cy}`;
    if (used.has(key) || (cx === center[0] && cy === center[1])) continue;
    used.add(key);
    const type = weightedCoinType(rng);
    const [px, py] = cellCenter(cx, cy);
    coins.push({ index: coins.length, x: px, y: py, cx, cy, type, value: COIN_VALUE[type] });
  }

  // Power-ups (~5% of coins). Always consume the same rng draws so spawn
  // positions stay aligned whether or not power-ups are enabled.
  const puCount = Math.max(1, Math.floor(coins.length * 0.05));
  const coinCells = new Set(coins.map((k) => `${k.cx},${k.cy}`));
  const powerups: PowerupLite[] = [];
  let pg = 0;
  while (powerups.length < puCount && pg < puCount * 40) {
    pg++;
    const cx = Math.floor(rng() * size);
    const cy = Math.floor(rng() * size);
    const key = `${cx},${cy}`;
    if (coinCells.has(key) || (cx === center[0] && cy === center[1])) continue;
    coinCells.add(key);
    const r = rng();
    const kind: PowerKind = r < 0.45 ? 'speed' : r < 0.85 ? 'magnet' : 'shield';
    const [px, py] = cellCenter(cx, cy);
    powerups.push({ x: px, y: py, cx, cy, kind });
  }

  // Spawns: human first, then one per bot.
  const spawnCells = new Set<string>();
  const pickSpawn = (): [number, number] => {
    for (let tries = 0; tries < 200; tries++) {
      const cx = Math.floor(rng() * size);
      const cy = Math.floor(rng() * size);
      const key = `${cx},${cy}`;
      if (!spawnCells.has(key)) { spawnCells.add(key); return cellCenter(cx, cy); }
    }
    return cellCenter(Math.floor(rng() * size), Math.floor(rng() * size));
  };
  const humanSpawn = pickSpawn();
  const botSpawns: Array<[number, number]> = [];
  for (let i = 0; i < params.botCount; i++) botSpawns.push(pickSpawn());

  return {
    seed, size, worldPx, center, grid,
    coins,
    powerups: params.powerupsEnabled ? powerups : [],
    humanSpawn, botSpawns,
  };
}

// ── Circle-vs-wall collision + axis-separated sliding ────────────────────────
function segCircle(ax: number, ay: number, bx: number, by: number, px: number, py: number, r: number): boolean {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx, qy = ay + t * dy;
  const ddx = px - qx, ddy = py - qy;
  return ddx * ddx + ddy * ddy < r * r;
}

export function collides(layout: Pick<Layout, 'grid' | 'size' | 'worldPx'>, x: number, y: number, r: number): boolean {
  if (x - r < 0 || y - r < 0 || x + r > layout.worldPx || y + r > layout.worldPx) return true;
  const [cx, cy] = toCell(x, y);
  for (let gy = cy - 1; gy <= cy + 1; gy++) {
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      if (gx < 0 || gy < 0 || gx >= layout.size || gy >= layout.size) continue;
      const cell = layout.grid[gy][gx];
      const x0 = gx * CELL, y0 = gy * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
      if (cell.top && segCircle(x0, y0, x1, y0, x, y, r)) return true;
      if (cell.bottom && segCircle(x0, y1, x1, y1, x, y, r)) return true;
      if (cell.left && segCircle(x0, y0, x0, y1, x, y, r)) return true;
      if (cell.right && segCircle(x1, y0, x1, y1, x, y, r)) return true;
    }
  }
  return false;
}

/** Move a point (px,py) by (dx,dy) with wall sliding; returns the new position. */
export function moveWithSlide(
  layout: Pick<Layout, 'grid' | 'size' | 'worldPx'>,
  px: number, py: number, dx: number, dy: number, radius = PLAYER_RADIUS,
): [number, number] {
  if (!collides(layout, px + dx, py + dy, radius)) return [px + dx, py + dy];
  if (dx !== 0 && !collides(layout, px + dx, py, radius)) return [px + dx, py];
  if (dy !== 0 && !collides(layout, px, py + dy, radius)) return [px, py + dy];
  return [px, py];
}

export { cellCenter };
