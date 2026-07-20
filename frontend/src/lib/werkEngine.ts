/**
 * ወርቅ ፍለጋ (Werk Flega — Gold Rush) game engine.
 *
 * A self-contained, real-time maze runner: one human vs. house AI bots collecting
 * coins on a procedurally generated maze. Everything that must be reproducible —
 * the maze, coin/power-up layout, and bot roster — is derived deterministically
 * from a single integer `seed` (drawn + audited server-side, see werk.service).
 * Live bot *decisions* run in real time and don't need to be reproducible; the
 * wagered outcome is the human's final rank, which the server prices.
 *
 * The engine owns all simulation state and exposes `update(dt, input)` plus a
 * `draw(ctx)` world renderer. The React page renders the HUD on top.
 */

// ── Deterministic PRNG (mulberry32) ─────────────────────────────────────────
export function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Config / tuning ─────────────────────────────────────────────────────────
export const CELL = 40; // logical px per maze cell
const HUMAN_SPEED = 150; // px/sec
const PLAYER_RADIUS = CELL * 0.3;
const COLLECT_RADIUS = CELL * 0.42;
const SPRINT_MULT = 1.6;
const STAMINA_MAX = 100;
const STAMINA_DRAIN = 30; // per sec sprinting
const STAMINA_REGEN = 20; // per sec resting
const SPEED_BOOST_MULT = 1.5;
const SPEED_BOOST_SEC = 5;
const MAGNET_SEC = 8;
const MAGNET_RADIUS = CELL * 2.6;
const SHIELD_SEC = 10;

export type WinMode = 'A' | 'B';
export type MazeTheme = 'adwa' | 'highland' | 'desert';

export type CoinType = 'bronze' | 'silver' | 'gold';
export const COIN_VALUE: Record<CoinType, number> = { bronze: 1, silver: 5, gold: 25 };
export const COIN_COLOR: Record<CoinType, string> = { bronze: '#cd7f32', silver: '#c0c0c0', gold: '#FFD700' };
export const COIN_AM: Record<CoinType, string> = { bronze: 'ነሃስ ሳንቲም', silver: 'ብር ሳንቲም', gold: 'ወርቅ ሳንቲም' };

export type PowerKind = 'speed' | 'magnet' | 'shield';

export type BotPersonality = 'gatherer' | 'sniper' | 'strategist' | 'explorer' | 'chaotic';

export type PlayerState = 'playing' | 'running_to_center' | 'eliminated' | 'finished';

export interface Coin {
  x: number;
  y: number;
  cx: number;
  cy: number;
  type: CoinType;
  value: number;
  collected: boolean;
}

export interface Powerup {
  x: number;
  y: number;
  cx: number;
  cy: number;
  kind: PowerKind;
  taken: boolean;
}

export interface Player {
  id: number;
  name: string; // Amharic
  nameEn: string;
  color: string;
  isHuman: boolean;
  personality: BotPersonality | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  coins: number;
  coinValue: number;
  bronze: number;
  silver: number;
  gold: number;
  state: PlayerState;
  speed: number; // base px/sec
  // Bot pathing:
  path: Array<[number, number]>;
  pathIndex: number;
  targetCoin: Coin | null;
  thinkAt: number;
  stuckTimer: number;
  lastX: number;
  lastY: number;
  // Human sprint:
  stamina: number;
  // Active power-ups (seconds remaining, 0 = inactive):
  boost: number;
  magnet: number;
  shield: number;
  // Collected-but-unused power-ups awaiting a Space press:
  _pendingSpeed?: boolean;
  _pendingMagnet?: boolean;
  _pendingShield?: boolean;
}

/** Grid cell walls; true = wall present on that side. */
interface Cell {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

export interface Standing {
  player: Player;
  rank: number;
  eligible: boolean;
}

const AMHARIC_NAMES: Array<[string, string]> = [
  ['አበበ', 'Abebe'], ['ከበደ', 'Kebede'], ['ጫላ', 'Chala'], ['ሳምሶን', 'Samson'],
  ['ብርሃኑ', 'Birhanu'], ['ተስፋዬ', 'Tesfaye'], ['ዳዊት', 'Dawit'], ['ሰለሞን', 'Solomon'],
  ['ፍቅሬ', 'Fikru'], ['ሙሉ', 'Mulu'], ['አልማዝ', 'Almaz'], ['ሰናይት', 'Senait'],
  ['ሄለን', 'Helen'], ['ሳራ', 'Sara'], ['ማርታ', 'Marta'], ['ሮዛ', 'Roza'],
  ['ዮሐንስ', 'Yohannes'], ['ግርማ', 'Girma'], ['ታደሰ', 'Tadesse'], ['በቀለ', 'Bekele'],
  ['ሀና', 'Hana'], ['ናርዶስ', 'Nardos'], ['ኤፍሬም', 'Efrem'], ['ሚካኤል', 'Mikael'],
  ['ዘነበ', 'Zenebe'], ['ጌታቸው', 'Getachew'], ['ወርቁ', 'Werku'], ['ደሳለኝ', 'Desalegn'],
];

const PLAYER_COLORS = [
  '#e6b422', '#4ade80', '#60a5fa', '#f87171', '#c084fc', '#fb923c', '#34d399',
  '#f472b6', '#a3e635', '#22d3ee', '#facc15', '#818cf8', '#fb7185', '#2dd4bf',
];

const PERSONALITIES: BotPersonality[] = ['gatherer', 'sniper', 'strategist', 'explorer', 'chaotic'];

function mazeSizeFor(totalPlayers: number): { size: number; extraOpenPct: number } {
  if (totalPlayers <= 10) return { size: 16, extraOpenPct: 12 };
  if (totalPlayers <= 25) return { size: 24, extraOpenPct: 15 };
  if (totalPlayers <= 50) return { size: 32, extraOpenPct: 18 };
  if (totalPlayers <= 75) return { size: 40, extraOpenPct: 20 };
  return { size: 48, extraOpenPct: 22 };
}

export interface WerkGameOptions {
  seed: number;
  mode: WinMode;
  durationSec: number;
  totalPlayers: number;
  botCount: number;
  coinDensityX100: number;
  finalSprintWarningSec: number;
  powerupsEnabled: boolean;
  theme: MazeTheme;
  humanName: string;
}

export interface HumanInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  usePower: boolean;
}

export class WerkGame {
  readonly opts: WerkGameOptions;
  readonly size: number;
  readonly extraOpenPct: number;
  readonly worldPx: number;
  readonly center: [number, number];
  readonly players: Player[];
  readonly human: Player;
  coins: Coin[];
  powerups: Powerup[];
  grid: Cell[][];
  timeLeft: number;
  elapsed: number;
  running = true;
  finished = false;
  private rng: () => number;
  private t = 0; // total sim time for animations

  constructor(opts: WerkGameOptions) {
    this.opts = opts;
    const { size, extraOpenPct } = mazeSizeFor(opts.totalPlayers);
    this.size = size;
    this.extraOpenPct = extraOpenPct;
    this.worldPx = size * CELL;
    const c = Math.floor(size / 2);
    this.center = [c, c];
    this.timeLeft = opts.durationSec;
    this.elapsed = 0;
    this.rng = makeRng(opts.seed);

    this.grid = this.generateMaze();
    this.coins = this.placeCoins();
    this.powerups = opts.powerupsEnabled ? this.placePowerups() : [];
    this.players = this.spawnPlayers();
    this.human = this.players[0];
  }

  private cellCenter(cx: number, cy: number): [number, number] {
    return [cx * CELL + CELL / 2, cy * CELL + CELL / 2];
  }

  private toCell(x: number, y: number): [number, number] {
    return [Math.floor(x / CELL), Math.floor(y / CELL)];
  }

  // ── Maze generation (recursive backtracking + extra openings) ─────────────
  private generateMaze(): Cell[][] {
    const n = this.size;
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
      const [nx, ny] = neighbors[Math.floor(this.rng() * neighbors.length)];
      carve(x, y, nx, ny);
      visited[ny][nx] = true;
      stack.push([nx, ny]);
    }

    // Extra openings: knock out a share of interior walls to create loops.
    const interiorWalls = n * (n - 1) * 2;
    const toRemove = Math.floor((interiorWalls * this.extraOpenPct) / 100);
    for (let i = 0; i < toRemove; i++) {
      const x = Math.floor(this.rng() * n);
      const y = Math.floor(this.rng() * n);
      if (this.rng() < 0.5 && x < n - 1) { grid[y][x].right = false; grid[y][x + 1].left = false; }
      else if (y < n - 1) { grid[y][x].bottom = false; grid[y + 1][x].top = false; }
    }
    return grid;
  }

  private weightedCoinType(): CoinType {
    const r = this.rng();
    if (r < 0.6) return 'bronze';
    if (r < 0.9) return 'silver';
    return 'gold';
  }

  private placeCoins(): Coin[] {
    const n = this.size;
    const density = this.opts.coinDensityX100 / 100;
    const target = Math.floor(n * n * density);
    const coins: Coin[] = [];
    const used = new Set<string>();
    const [ccx, ccy] = this.center;
    let guard = 0;
    while (coins.length < target && guard < target * 20) {
      guard++;
      const cx = Math.floor(this.rng() * n);
      const cy = Math.floor(this.rng() * n);
      const key = `${cx},${cy}`;
      if (used.has(key)) continue;
      if (cx === ccx && cy === ccy) continue; // keep the hub clear
      used.add(key);
      const type = this.weightedCoinType();
      const [px, py] = this.cellCenter(cx, cy);
      coins.push({ x: px, y: py, cx, cy, type, value: COIN_VALUE[type], collected: false });
    }
    return coins;
  }

  private placePowerups(): Powerup[] {
    // ~5% of the coin count, biased rare. Placed on empty (non-coin) cells.
    const count = Math.max(1, Math.floor(this.coins.length * 0.05));
    const coinCells = new Set(this.coins.map((c) => `${c.cx},${c.cy}`));
    const [ccx, ccy] = this.center;
    const out: Powerup[] = [];
    let guard = 0;
    while (out.length < count && guard < count * 40) {
      guard++;
      const cx = Math.floor(this.rng() * this.size);
      const cy = Math.floor(this.rng() * this.size);
      const key = `${cx},${cy}`;
      if (coinCells.has(key) || (cx === ccx && cy === ccy)) continue;
      coinCells.add(key);
      const r = this.rng();
      const kind: PowerKind = r < 0.45 ? 'speed' : r < 0.85 ? 'magnet' : 'shield';
      const [px, py] = this.cellCenter(cx, cy);
      out.push({ x: px, y: py, cx, cy, kind, taken: false });
    }
    return out;
  }

  private spawnPlayers(): Player[] {
    const players: Player[] = [];
    const n = this.size;
    const names = [...AMHARIC_NAMES];
    // Deterministic shuffle of the name pool.
    for (let i = names.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [names[i], names[j]] = [names[j], names[i]];
    }
    const spawnCells = new Set<string>();
    const pickSpawn = (): [number, number] => {
      for (let tries = 0; tries < 200; tries++) {
        const cx = Math.floor(this.rng() * n);
        const cy = Math.floor(this.rng() * n);
        const key = `${cx},${cy}`;
        if (!spawnCells.has(key)) { spawnCells.add(key); return [cx, cy]; }
      }
      return [Math.floor(this.rng() * n), Math.floor(this.rng() * n)];
    };

    const mkPlayer = (id: number, isHuman: boolean): Player => {
      const [cx, cy] = pickSpawn();
      const [px, py] = this.cellCenter(cx, cy);
      const [am, en] = isHuman ? [this.opts.humanName, this.opts.humanName] : names[id % names.length];
      const personality = isHuman ? null : PERSONALITIES[Math.floor(this.rng() * PERSONALITIES.length)];
      const speed = isHuman ? HUMAN_SPEED : HUMAN_SPEED * (0.8 + this.rng() * 0.1);
      return {
        id, name: am, nameEn: en, color: PLAYER_COLORS[id % PLAYER_COLORS.length],
        isHuman, personality, x: px, y: py, vx: 0, vy: 0,
        coins: 0, coinValue: 0, bronze: 0, silver: 0, gold: 0,
        state: 'playing', speed,
        path: [], pathIndex: 0, targetCoin: null, thinkAt: 0, stuckTimer: 0, lastX: px, lastY: py,
        stamina: STAMINA_MAX, boost: 0, magnet: 0, shield: 0,
      };
    };

    players.push(mkPlayer(0, true));
    for (let i = 1; i <= this.opts.botCount; i++) players.push(mkPlayer(i, false));
    return players;
  }

  // ── Collision: circle vs maze walls (segment distance + sliding) ──────────
  private collides(x: number, y: number, r: number): boolean {
    // World bounds.
    if (x - r < 0 || y - r < 0 || x + r > this.worldPx || y + r > this.worldPx) return true;
    const [cx, cy] = this.toCell(x, y);
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        if (gx < 0 || gy < 0 || gx >= this.size || gy >= this.size) continue;
        const cell = this.grid[gy][gx];
        const x0 = gx * CELL, y0 = gy * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
        if (cell.top && this.segCircle(x0, y0, x1, y0, x, y, r)) return true;
        if (cell.bottom && this.segCircle(x0, y1, x1, y1, x, y, r)) return true;
        if (cell.left && this.segCircle(x0, y0, x0, y1, x, y, r)) return true;
        if (cell.right && this.segCircle(x1, y0, x1, y1, x, y, r)) return true;
      }
    }
    return false;
  }

  private segCircle(ax: number, ay: number, bx: number, by: number, px: number, py: number, r: number): boolean {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx, qy = ay + t * dy;
    const ddx = px - qx, ddy = py - qy;
    return ddx * ddx + ddy * ddy < r * r;
  }

  /** Move a player by (dx,dy) with axis-separated sliding. */
  private moveWithSlide(p: Player, dx: number, dy: number) {
    const r = PLAYER_RADIUS;
    if (!this.collides(p.x + dx, p.y + dy, r)) { p.x += dx; p.y += dy; return; }
    if (dx !== 0 && !this.collides(p.x + dx, p.y, r)) { p.x += dx; return; }
    if (dy !== 0 && !this.collides(p.x, p.y + dy, r)) { p.y += dy; return; }
    // else blocked
  }

  // ── BFS shortest path between cells ───────────────────────────────────────
  private bfs(sx: number, sy: number, tx: number, ty: number): Array<[number, number]> {
    if (sx === tx && sy === ty) return [];
    const n = this.size;
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
      const cell = this.grid[cy][cx];
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
    while (cur !== -1 && cur !== sy * n + sx) {
      path.push([cur % n, Math.floor(cur / n)]);
      cur = prev[cur];
    }
    path.reverse();
    return path;
  }

  // ── Bot AI decision ───────────────────────────────────────────────────────
  private botDecide(p: Player) {
    const [bcx, bcy] = this.toCell(p.x, p.y);
    const [ccx, ccy] = this.center;

    // Mode B end-game: strategists (and everyone as time runs very low) head home.
    const headHome =
      this.opts.mode === 'B' &&
      ((p.personality === 'strategist' && this.timeLeft < 30) || this.timeLeft <= this.opts.finalSprintWarningSec + 3);
    if (headHome) {
      p.state = 'running_to_center';
      p.path = this.bfs(bcx, bcy, ccx, ccy);
      p.pathIndex = 0;
      p.targetCoin = null;
      return;
    }

    const available = this.coins.filter((c) => !c.collected);
    if (!available.length) { p.path = []; p.targetCoin = null; return; }

    // Score a bounded set of nearby candidates (Manhattan pre-filter for speed).
    const candidates = available
      .map((c) => ({ c, md: Math.abs(c.cx - bcx) + Math.abs(c.cy - bcy) }))
      .sort((a, b) => a.md - b.md)
      .slice(0, 14);

    let best: Coin | null = null;
    let bestScore = -Infinity;
    for (const { c, md } of candidates) {
      let score = c.value - md * 0.5;
      if (p.personality === 'sniper') score += c.value * 0.5;
      if (p.personality === 'strategist' && this.timeLeft < 30) {
        score -= (Math.abs(c.cx - ccx) + Math.abs(c.cy - ccy)) * 0.3;
      }
      if (p.personality === 'explorer') score += md * 0.2; // prefers farther cells
      if (p.personality === 'chaotic') score += (this.rng() - 0.5) * 20;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!best) return;
    p.targetCoin = best;
    p.path = this.bfs(bcx, bcy, best.cx, best.cy);
    p.pathIndex = 0;
  }

  private updateBot(p: Player, dt: number) {
    if (p.state === 'eliminated' || p.state === 'finished') return;
    if (this.t >= p.thinkAt || (!p.path.length && p.state !== 'running_to_center')) {
      this.botDecide(p);
      p.thinkAt = this.t + 1 + this.rng(); // 1–2s
    }
    // Follow path toward next cell centre.
    if (p.pathIndex < p.path.length) {
      const [nx, ny] = p.path[p.pathIndex];
      const [tx, ty] = this.cellCenter(nx, ny);
      const dx = tx - p.x, dy = ty - p.y;
      const dist = Math.hypot(dx, dy);
      const spd = p.speed * (p.boost > 0 ? SPEED_BOOST_MULT : 1);
      if (dist < 3) { p.pathIndex++; }
      else {
        const step = Math.min(dist, spd * dt);
        this.moveWithSlide(p, (dx / dist) * step, (dy / dist) * step);
      }
    }
    // Stuck detection: no progress for 1.5s → force a re-think.
    if (Math.hypot(p.x - p.lastX, p.y - p.lastY) < 1) {
      p.stuckTimer += dt;
      if (p.stuckTimer > 1.5) { p.thinkAt = 0; p.stuckTimer = 0; p.path = []; }
    } else {
      p.stuckTimer = 0;
    }
    p.lastX = p.x; p.lastY = p.y;
  }

  private updateHuman(p: Player, dt: number, input: HumanInput) {
    if (p.state === 'eliminated' || p.state === 'finished') return;
    let dxi = 0, dyi = 0;
    if (input.up) dyi -= 1;
    if (input.down) dyi += 1;
    if (input.left) dxi -= 1;
    if (input.right) dxi += 1;

    const wantSprint = input.sprint && p.stamina > 0 && (dxi !== 0 || dyi !== 0);
    if (wantSprint) p.stamina = Math.max(0, p.stamina - STAMINA_DRAIN * dt);
    else p.stamina = Math.min(STAMINA_MAX, p.stamina + STAMINA_REGEN * dt);

    let spd = p.speed;
    if (wantSprint) spd *= SPRINT_MULT;
    if (p.boost > 0) spd *= SPEED_BOOST_MULT;

    if (dxi !== 0 || dyi !== 0) {
      const inv = 1 / Math.hypot(dxi, dyi);
      this.moveWithSlide(p, dxi * inv * spd * dt, dyi * inv * spd * dt);
    }

    if (input.usePower) this.consumePower(p);
  }

  private consumePower(p: Player) {
    // Use whichever collected power-up isn't active yet; simplest: activate speed.
    if (p.boost <= 0 && p._pendingSpeed) { p.boost = SPEED_BOOST_SEC; p._pendingSpeed = false; }
    else if (p.magnet <= 0 && p._pendingMagnet) { p.magnet = MAGNET_SEC; p._pendingMagnet = false; }
    else if (p.shield <= 0 && p._pendingShield) { p.shield = SHIELD_SEC; p._pendingShield = false; }
  }

  private collect(p: Player) {
    if (p.state === 'eliminated') return;
    // Magnet pulls nearby coins toward the player.
    if (p.magnet > 0) {
      for (const c of this.coins) {
        if (c.collected) continue;
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d < MAGNET_RADIUS && d > 1) {
          c.x += ((p.x - c.x) / d) * Math.min(d, 220) * 0.02;
          c.y += ((p.y - c.y) / d) * Math.min(d, 220) * 0.02;
        }
      }
    }
    for (const c of this.coins) {
      if (c.collected) continue;
      if (Math.hypot(c.x - p.x, c.y - p.y) < COLLECT_RADIUS) {
        c.collected = true;
        p.coins++;
        p.coinValue += c.value;
        p[c.type]++;
        this.onCollect?.(p, c);
      }
    }
    if (this.opts.powerupsEnabled) {
      for (const pu of this.powerups) {
        if (pu.taken) continue;
        if (Math.hypot(pu.x - p.x, pu.y - p.y) < COLLECT_RADIUS) {
          pu.taken = true;
          if (pu.kind === 'speed') p._pendingSpeed = true;
          else if (pu.kind === 'magnet') p._pendingMagnet = true;
          else p._pendingShield = true;
          this.onPower?.(p, pu);
        }
      }
    }
  }

  // Optional callbacks the page wires for SFX / particles.
  onCollect?: (p: Player, c: Coin) => void;
  onPower?: (p: Player, pu: Powerup) => void;
  onSprintWarn?: () => void;
  private warnedSprint = false;

  private inCenter(p: Player): boolean {
    const [cx, cy] = this.toCell(p.x, p.y);
    return cx === this.center[0] && cy === this.center[1];
  }

  /** Advance the simulation by `dt` seconds. */
  update(dt: number, input: HumanInput) {
    if (!this.running || this.finished) return;
    dt = Math.min(dt, 0.05); // clamp big frame gaps
    this.t += dt;
    this.elapsed += dt;
    this.timeLeft = Math.max(0, this.opts.durationSec - this.elapsed);

    // Mode B final-sprint horn (once).
    if (this.opts.mode === 'B' && !this.warnedSprint && this.timeLeft <= this.opts.finalSprintWarningSec) {
      this.warnedSprint = true;
      this.onSprintWarn?.();
    }

    for (const p of this.players) {
      // decay power-ups
      p.boost = Math.max(0, p.boost - dt);
      p.magnet = Math.max(0, p.magnet - dt);
      p.shield = Math.max(0, p.shield - dt);
      if (p.isHuman) this.updateHuman(p, dt, input);
      else this.updateBot(p, dt);
      this.collect(p);
    }

    if (this.timeLeft <= 0) this.finish();
  }

  /** End the game: resolve eligibility (mode B) and rank survivors. */
  finish() {
    if (this.finished) return;
    this.finished = true;
    this.running = false;
    if (this.opts.mode === 'B') {
      for (const p of this.players) {
        if (!this.inCenter(p)) p.state = 'eliminated';
        else p.state = 'finished';
      }
    } else {
      for (const p of this.players) p.state = 'finished';
    }
  }

  /** Full ranking; eligible players sorted by coin value, ties share a rank. */
  standings(): Standing[] {
    const eligible = (p: Player) => this.opts.mode === 'B' ? p.state !== 'eliminated' : true;
    const sorted = [...this.players].sort((a, b) => {
      const ea = eligible(a), eb = eligible(b);
      if (ea !== eb) return ea ? -1 : 1;
      return b.coinValue - a.coinValue;
    });
    const out: Standing[] = [];
    let rank = 0, seen = 0, lastVal = Infinity, lastElig = true;
    for (const p of sorted) {
      const e = eligible(p);
      seen++;
      if (p.coinValue !== lastVal || e !== lastElig) { rank = seen; lastVal = p.coinValue; lastElig = e; }
      out.push({ player: p, rank: e ? rank : this.players.length, eligible: e });
    }
    return out;
  }

  /** The human's settlement claim for the server. */
  humanResult(): { rank: number; tieCount: number; coinValue: number; eliminated: boolean } {
    const st = this.standings();
    const mine = st.find((s) => s.player.isHuman)!;
    const eliminated = this.opts.mode === 'B' && !mine.eligible;
    const tieCount = eliminated ? 1 : st.filter((s) => s.eligible && s.rank === mine.rank).length;
    return { rank: mine.rank, tieCount, coinValue: this.human.coinValue, eliminated };
  }

  get isFinalSprint(): boolean {
    return this.opts.mode === 'B' && this.timeLeft <= this.opts.finalSprintWarningSec;
  }

  get coinsLeft(): number {
    return this.coins.reduce((a, c) => a + (c.collected ? 0 : 1), 0);
  }
}
