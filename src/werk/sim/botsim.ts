import { makeRng } from './rng';
import {
  bfs, cellCenter, COLLECT_RADIUS, HUMAN_SPEED, Layout, moveWithSlide, PLAYER_RADIUS, toCell, WinMode,
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
  private rng: () => number;
  t = 0;
  finished = false;

  constructor(layout: Layout, roster: BotConfig[], cfg: SimConfig) {
    this.layout = layout;
    this.cfg = cfg;
    this.rng = makeRng((layout.seed ^ 0x5f356495) >>> 0);
    this.botTaken = new Uint8Array(layout.coins.length);
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

  private decide(b: BotRuntime) {
    const [bcx, bcy] = toCell(b.x, b.y);
    const [ccx, ccy] = this.layout.center;

    const headHome =
      this.cfg.mode === 'B' &&
      ((b.personality === 'strategist' && this.timeLeft < 30) || this.timeLeft <= this.cfg.finalSprintWarningSec + 3);
    if (headHome) {
      b.headingHome = true;
      b.path = bfs(this.layout.grid, this.layout.size, bcx, bcy, ccx, ccy);
      b.pathIndex = 0;
      return;
    }

    const coins = this.layout.coins;
    const candidates: Array<{ idx: number; md: number }> = [];
    for (const c of coins) {
      if (this.botTaken[c.index]) continue;
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
    b.path = bfs(this.layout.grid, this.layout.size, bcx, bcy, target.cx, target.cy);
    b.pathIndex = 0;
  }

  private collect(b: BotRuntime) {
    for (const c of this.layout.coins) {
      if (this.botTaken[c.index]) continue;
      if (Math.hypot(c.x - b.x, c.y - b.y) < COLLECT_RADIUS) {
        this.botTaken[c.index] = 1;
        b.coinValue += c.value;
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
