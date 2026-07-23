import { makeRng } from './rng';
import {
  cellCenter, COLLECT_RADIUS, HUMAN_SPEED, type Layout, moveWithSlide, PLAYER_RADIUS, toCell, type WinMode,
} from './layout';

export type BotPersonality = 'gatherer' | 'sniper' | 'strategist' | 'explorer' | 'chaotic';

/** Identity + behaviour of one bot (structurally matches WerkBotDescriptor). */
export interface BotConfig {
  name: string;
  nameEn: string;
  color: string;
  personality: BotPersonality;
  speedPct: number;
  skill: number;
}

export interface SimConfig {
  mode: WinMode;
  durationSec: number;
  finalSprintWarningSec: number;
}

/**
 * Optional shared coin-ownership view. When the server runs a multiplayer round,
 * bots and real players compete for ONE coin pool: the manager passes this so a
 * coin claimed by a human is invisible to bots and vice-versa. When omitted (the
 * client display path), BotSim uses its own private `botTaken` and behaves
 * byte-identically to the single-player original.
 */
export interface SharedCoinPool {
  /** True if some participant (human or bot) already owns this coin. */
  has(index: number): boolean;
  /** Attempt to claim the coin for `byId`; returns true only if it was still free. */
  take(index: number, byId: number): boolean;
}

export interface BotRuntime {
  id: number;
  name: string;
  nameEn: string;
  color: string;
  personality: BotPersonality;
  skill: number;
  speed: number;
  x: number;
  y: number;
  coinValue: number;
  reachedCenter: boolean;
  // internal pathing
  path: Array<[number, number]>;
  pathIndex: number;
  thinkAt: number;
  stuckTimer: number;
  lastX: number;
  lastY: number;
  headingHome: boolean;
}

/**
 * Deterministic, fixed-timestep simulation of the bot field. Bots compete for
 * coins **among themselves** (a coin taken by one bot is gone for the others);
 * the human is scored independently against the coin layout, so the human's
 * real-time play never perturbs this — which is exactly what lets the server run
 * it authoritatively and the client mirror it for a matching live leaderboard.
 */
export class BotSim {
  readonly layout: Layout;
  readonly cfg: SimConfig;
  readonly bots: BotRuntime[];
  /** Coin index → taken by some bot. */
  readonly botTaken: Uint8Array;
  /** cellIndex (cy*size+cx) → coin index. Coins are one-per-cell. */
  private readonly coinAtCell: Map<number, number>;
  // Reusable BFS scratch (generation-tagged `seen` avoids clearing each call).
  private readonly bfsSeen: Int32Array;
  private readonly bfsPrev: Int32Array;
  private readonly bfsQueue: Int32Array;
  private bfsGen = 0;
  private rng: () => number;
  /** When set, coin ownership is arbitrated against a pool shared with humans. */
  private readonly shared?: SharedCoinPool;
  t = 0;
  finished = false;

  constructor(layout: Layout, roster: BotConfig[], cfg: SimConfig, shared?: SharedCoinPool) {
    this.layout = layout;
    this.cfg = cfg;
    this.shared = shared;
    this.rng = makeRng((layout.seed ^ 0x5f356495) >>> 0);
    this.botTaken = new Uint8Array(layout.coins.length);
    this.coinAtCell = new Map();
    for (const c of layout.coins) this.coinAtCell.set(c.cy * layout.size + c.cx, c.index);
    const cells = layout.size * layout.size;
    this.bfsSeen = new Int32Array(cells);
    this.bfsPrev = new Int32Array(cells);
    this.bfsQueue = new Int32Array(cells);
    this.bots = roster.map((r, i) => {
      const [x, y] = layout.botSpawns[i] ?? layout.humanSpawn;
      return {
        id: i + 1, name: r.name, nameEn: r.nameEn, color: r.color, personality: r.personality,
        skill: r.skill, speed: HUMAN_SPEED * (r.speedPct / 100), x, y,
        coinValue: 0, reachedCenter: false,
        path: [], pathIndex: 0, thinkAt: 0, stuckTimer: 0, lastX: x, lastY: y, headingHome: false,
      };
    });
  }

  private get timeLeft(): number {
    return Math.max(0, this.cfg.durationSec - this.t);
  }

  /** Coin taken by anyone — consults the shared pool when present, else local. */
  private isTaken(index: number): boolean {
    return this.shared ? this.shared.has(index) : this.botTaken[index] === 1;
  }

  /**
   * BFS shortest cell path using reusable, generation-tagged buffers (no per-call
   * allocation or O(n²) clear). Outer maze walls are always intact, so a missing
   * wall guarantees the neighbour is in-bounds. Equivalent to `layout.bfs`.
   */
  private pathTo(sx: number, sy: number, tx: number, ty: number): Array<[number, number]> {
    if (sx === tx && sy === ty) return [];
    const n = this.layout.size, grid = this.layout.grid;
    const gen = ++this.bfsGen;
    const seen = this.bfsSeen, prev = this.bfsPrev, q = this.bfsQueue;
    const start = sy * n + sx, goal = ty * n + tx;
    let head = 0, tail = 0, found = false;
    q[tail++] = start; seen[start] = gen; prev[start] = -1;
    while (head < tail) {
      const cur = q[head++];
      if (cur === goal) { found = true; break; }
      const cx = cur % n, cy = (cur / n) | 0;
      const cell = grid[cy][cx];
      if (!cell.top) { const id = cur - n; if (seen[id] !== gen) { seen[id] = gen; prev[id] = cur; q[tail++] = id; } }
      if (!cell.right) { const id = cur + 1; if (seen[id] !== gen) { seen[id] = gen; prev[id] = cur; q[tail++] = id; } }
      if (!cell.bottom) { const id = cur + n; if (seen[id] !== gen) { seen[id] = gen; prev[id] = cur; q[tail++] = id; } }
      if (!cell.left) { const id = cur - 1; if (seen[id] !== gen) { seen[id] = gen; prev[id] = cur; q[tail++] = id; } }
    }
    if (!found) return [];
    const path: Array<[number, number]> = [];
    let cur = goal;
    while (cur !== start) { path.push([cur % n, (cur / n) | 0]); cur = prev[cur]; }
    path.reverse();
    return path;
  }

  private decide(b: BotRuntime) {
    const [bcx, bcy] = toCell(b.x, b.y);
    const [ccx, ccy] = this.layout.center;

    const headHome =
      this.cfg.mode === 'B' &&
      ((b.personality === 'strategist' && this.timeLeft < 30) || this.timeLeft <= this.cfg.finalSprintWarningSec + 3);
    if (headHome) {
      b.headingHome = true;
      b.path = this.pathTo(bcx, bcy, ccx, ccy);
      b.pathIndex = 0;
      return;
    }

    const coins = this.layout.coins;
    const candidates: Array<{ idx: number; md: number }> = [];
    for (const c of coins) {
      if (this.isTaken(c.index)) continue;
      candidates.push({ idx: c.index, md: Math.abs(c.cx - bcx) + Math.abs(c.cy - bcy) });
    }
    if (!candidates.length) { b.path = []; return; }
    candidates.sort((a, z) => a.md - z.md);
    const window = Math.round(6 + b.skill * 12);
    const pool = candidates.slice(0, window);

    let best = -1;
    let bestScore = -Infinity;
    for (const { idx, md } of pool) {
      const c = coins[idx];
      let score = c.value - md * 0.5;
      if (b.personality === 'sniper') score += c.value * 0.5;
      if (b.personality === 'strategist' && this.timeLeft < 30) {
        score -= (Math.abs(c.cx - ccx) + Math.abs(c.cy - ccy)) * 0.3;
      }
      if (b.personality === 'explorer') score += md * 0.2;
      if (b.personality === 'chaotic') score += (this.rng() - 0.5) * 20 * (1.3 - b.skill);
      if (score > bestScore) { bestScore = score; best = idx; }
    }
    // Low-skill bots sometimes fumble and chase a worse coin.
    if (pool.length && this.rng() > 0.35 + b.skill * 0.6) best = pool[Math.floor(this.rng() * pool.length)].idx;
    if (best < 0) return;
    const target = coins[best];
    b.path = this.pathTo(bcx, bcy, target.cx, target.cy);
    b.pathIndex = 0;
  }

  private collect(b: BotRuntime) {
    // Only the bot's own cell + neighbours can hold a coin within collect range
    // (coins sit at cell centres and COLLECT_RADIUS < CELL), so this is O(9) per
    // bot per step instead of O(coins) — identical result, far cheaper.
    const size = this.layout.size;
    const [bcx, bcy] = toCell(b.x, b.y);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = bcx + dx, cy = bcy + dy;
        if (cx < 0 || cy < 0 || cx >= size || cy >= size) continue;
        const ci = this.coinAtCell.get(cy * size + cx);
        if (ci === undefined || this.isTaken(ci)) continue;
        const c = this.layout.coins[ci];
        if (Math.hypot(c.x - b.x, c.y - b.y) < COLLECT_RADIUS) {
          // In a shared round, only credit the coin if this bot actually won the
          // race for it (take() is atomic against concurrent human/bot claims).
          if (this.shared && !this.shared.take(ci, b.id)) continue;
          this.botTaken[ci] = 1;
          b.coinValue += c.value;
        }
      }
    }
  }

  /** Advance every bot by `dt` (call with a constant SIM_DT for determinism). */
  step(dt: number) {
    if (this.finished) return;
    this.t += dt;
    for (const b of this.bots) {
      if (this.t >= b.thinkAt || (!b.path.length && !b.headingHome)) {
        this.decide(b);
        b.thinkAt = this.t + (2 - b.skill) + this.rng() * 0.4;
      }
      if (b.pathIndex < b.path.length) {
        const [nx, ny] = b.path[b.pathIndex];
        const [tx, ty] = cellCenter(nx, ny);
        const dx = tx - b.x, dy = ty - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 3) b.pathIndex++;
        else {
          const step = Math.min(dist, b.speed * dt);
          const [mx, my] = moveWithSlide(this.layout, b.x, b.y, (dx / dist) * step, (dy / dist) * step, PLAYER_RADIUS);
          b.x = mx; b.y = my;
        }
      }
      if (Math.hypot(b.x - b.lastX, b.y - b.lastY) < 1) {
        b.stuckTimer += dt;
        if (b.stuckTimer > 1.5) { b.thinkAt = 0; b.stuckTimer = 0; b.path = []; }
      } else b.stuckTimer = 0;
      b.lastX = b.x; b.lastY = b.y;
      this.collect(b);
    }
    if (this.t >= this.cfg.durationSec) this.finish();
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    for (const b of this.bots) {
      const [cx, cy] = toCell(b.x, b.y);
      b.reachedCenter = cx === this.layout.center[0] && cy === this.layout.center[1];
    }
  }
}

export interface BotResult {
  id: number;
  name: string;
  nameEn: string;
  color: string;
  coinValue: number;
  reachedCenter: boolean;
}

/** Run a bot field to completion at the fixed timestep; returns final results. */
export function simulateBots(layout: Layout, roster: BotConfig[], cfg: SimConfig, dt: number): BotResult[] {
  const sim = new BotSim(layout, roster, cfg);
  const steps = Math.ceil(cfg.durationSec / dt);
  for (let i = 0; i < steps; i++) sim.step(dt);
  sim.finish();
  return sim.bots.map((b) => ({
    id: b.id, name: b.name, nameEn: b.nameEn, color: b.color, coinValue: b.coinValue, reachedCenter: b.reachedCenter,
  }));
}

// ── Ranking ──────────────────────────────────────────────────────────────────
export interface StandingRow {
  id: number; // 0 = human
  name: string;
  isHuman: boolean;
  color: string;
  coinValue: number;
  eligible: boolean;
  rank: number;
}

/**
 * Rank the human against authoritative bot results. In Mode B a player is only
 * eligible if they reached the center; the ineligible are ranked last. Ties
 * share a rank (spec §4).
 */
export function computeStandings(
  mode: WinMode,
  human: { coinValue: number; reachedCenter: boolean; name: string; color: string },
  bots: BotResult[],
): { rows: StandingRow[]; humanRank: number; humanTieCount: number; humanEligible: boolean } {
  const total = 1 + bots.length;
  const eligibleOf = (reached: boolean) => (mode === 'B' ? reached : true);
  const entries: StandingRow[] = [
    { id: 0, name: human.name, isHuman: true, color: human.color, coinValue: human.coinValue, eligible: eligibleOf(human.reachedCenter), rank: 0 },
    ...bots.map((b): StandingRow => ({ id: b.id, name: b.name, isHuman: false, color: b.color, coinValue: b.coinValue, eligible: eligibleOf(b.reachedCenter), rank: 0 })),
  ];
  entries.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return b.coinValue - a.coinValue;
  });
  let rank = 0, seen = 0, lastVal = Infinity, lastElig = true;
  for (const e of entries) {
    seen++;
    if (e.coinValue !== lastVal || e.eligible !== lastElig) { rank = seen; lastVal = e.coinValue; lastElig = e.eligible; }
    e.rank = e.eligible ? rank : total;
  }
  const mine = entries.find((e) => e.isHuman)!;
  const humanTieCount = mine.eligible ? entries.filter((e) => e.eligible && e.rank === mine.rank).length : 1;
  return { rows: entries, humanRank: mine.rank, humanTieCount, humanEligible: mine.eligible };
}
