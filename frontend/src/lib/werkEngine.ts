/**
 * ወርቅ ፍለጋ (Werk Flega — Gold Rush) — client game wrapper.
 *
 * The deterministic core (maze, coins, bot field, ranking) lives in the shared
 * `@werk-sim` module that also runs on the authoritative server, so the live
 * board and the official result are produced by the SAME code. This class adds
 * only the real-time human layer + render state on top:
 *   - bots advance via `BotSim` at a fixed timestep (identical to the server);
 *   - the human moves in real time and we record the coin INDICES they collect;
 *   - on settle the client sends those indices (+ Mode-B centre arrival) and the
 *     server re-derives value + rank, so nothing here is trusted for money.
 */
import {
  buildLayout, BotSim, computeStandings, moveWithSlide, toCell,
  CELL, HUMAN_SPEED, COLLECT_RADIUS, SIM_DT, PLAYER_RADIUS,
  type Layout, type CoinLite, type PowerupLite, type CoinType, type WinMode, type BotConfig,
} from '@werk-sim';

export { CELL };
export type { WinMode };
export type MazeTheme = 'adwa' | 'highland' | 'desert';
export type PlayerState = 'playing' | 'running_to_center' | 'eliminated' | 'finished';
export type BotSpec = BotConfig;

export const COIN_COLOR: Record<CoinType, string> = { bronze: '#cd7f32', silver: '#c0c0c0', gold: '#FFD700' };
export const COIN_AM: Record<CoinType, string> = { bronze: 'ነሃስ ሳንቲም', silver: 'ብር ሳንቲም', gold: 'ወርቅ ሳንቲም' };

const HUMAN_COLOR = '#f5f5f5';
const SPRINT_MULT = 1.6;
const STAMINA_MAX = 100;
const STAMINA_DRAIN = 30;
const STAMINA_REGEN = 20;
const SPEED_BOOST_MULT = 1.5;
const SPEED_BOOST_SEC = 5;
const MAGNET_SEC = 8;
const MAGNET_RADIUS = CELL * 1.6; // magnet = enlarged auto-collect range
const SHIELD_SEC = 10;

/** Render/HUD view of a participant (human carries the extra live stats). */
export interface Player {
  id: number;
  name: string;
  color: string;
  isHuman: boolean;
  x: number;
  y: number;
  coins: number;
  coinValue: number;
  bronze: number;
  silver: number;
  gold: number;
  state: PlayerState;
  stamina: number;
  boost: number;
  magnet: number;
  shield: number;
  _pendingSpeed?: boolean;
  _pendingMagnet?: boolean;
  _pendingShield?: boolean;
}

export interface Standing {
  player: Player;
  rank: number;
  eligible: boolean;
}

export type RenderCoin = CoinLite & { collected: boolean };
export type RenderPowerup = PowerupLite & { taken: boolean };

export interface HumanInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  usePower: boolean;
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
  bots: BotSpec[];
}

export class WerkGame {
  readonly opts: WerkGameOptions;
  readonly layout: Layout;
  readonly botSim: BotSim;
  readonly human: Player;
  private humanCollected = new Set<number>();
  private takenPowerups = new Set<number>();
  private acc = 0;
  elapsed = 0;
  timeLeft: number;
  running = true;
  finished = false;

  // Render caches rebuilt lazily each frame.
  onCollect?: (type: CoinType) => void;
  onPower?: () => void;
  onSprintWarn?: () => void;
  private warnedSprint = false;

  constructor(opts: WerkGameOptions) {
    this.opts = opts;
    this.timeLeft = opts.durationSec;
    this.layout = buildLayout(opts.seed, {
      totalPlayers: opts.totalPlayers,
      coinDensityX100: opts.coinDensityX100,
      powerupsEnabled: opts.powerupsEnabled,
      botCount: opts.bots.length,
    });
    this.botSim = new BotSim(this.layout, opts.bots, {
      mode: opts.mode, durationSec: opts.durationSec, finalSprintWarningSec: opts.finalSprintWarningSec,
    });
    const [hx, hy] = this.layout.humanSpawn;
    this.human = {
      id: 0, name: opts.humanName, color: HUMAN_COLOR, isHuman: true, x: hx, y: hy,
      coins: 0, coinValue: 0, bronze: 0, silver: 0, gold: 0, state: 'playing',
      stamina: STAMINA_MAX, boost: 0, magnet: 0, shield: 0,
    };
  }

  get size() { return this.layout.size; }
  get worldPx() { return this.layout.worldPx; }
  get center() { return this.layout.center; }
  get grid() { return this.layout.grid; }

  get coins(): RenderCoin[] {
    return this.layout.coins.map((c) => ({
      ...c, collected: this.humanCollected.has(c.index) || this.botSim.botTaken[c.index] === 1,
    }));
  }

  get powerups(): RenderPowerup[] {
    return this.layout.powerups.map((p, i) => ({ ...p, taken: this.takenPowerups.has(i) }));
  }

  /** Human + bots as render/HUD players (bot live scores come from BotSim). */
  get players(): Player[] {
    const bots: Player[] = this.botSim.bots.map((b) => ({
      id: b.id, name: b.name, color: b.color, isHuman: false, x: b.x, y: b.y,
      coins: 0, coinValue: b.coinValue, bronze: 0, silver: 0, gold: 0,
      state: this.finished && this.opts.mode === 'B' && !b.reachedCenter ? 'eliminated' : 'playing',
      stamina: 0, boost: 0, magnet: 0, shield: 0,
    }));
    return [this.human, ...bots];
  }

  private inCenter(x: number, y: number): boolean {
    const [cx, cy] = toCell(x, y);
    return cx === this.layout.center[0] && cy === this.layout.center[1];
  }

  private consumePower() {
    const h = this.human;
    if (h.boost <= 0 && h._pendingSpeed) { h.boost = SPEED_BOOST_SEC; h._pendingSpeed = false; }
    else if (h.magnet <= 0 && h._pendingMagnet) { h.magnet = MAGNET_SEC; h._pendingMagnet = false; }
    else if (h.shield <= 0 && h._pendingShield) { h.shield = SHIELD_SEC; h._pendingShield = false; }
  }

  private collectHuman() {
    const h = this.human;
    const radius = h.magnet > 0 ? MAGNET_RADIUS : COLLECT_RADIUS;
    for (const c of this.layout.coins) {
      if (this.humanCollected.has(c.index)) continue;
      if (Math.hypot(c.x - h.x, c.y - h.y) < radius) {
        this.humanCollected.add(c.index);
        h.coins++; h.coinValue += c.value; h[c.type]++;
        this.onCollect?.(c.type);
      }
    }
    if (this.opts.powerupsEnabled) {
      this.layout.powerups.forEach((pu, i) => {
        if (this.takenPowerups.has(i)) return;
        if (Math.hypot(pu.x - h.x, pu.y - h.y) < COLLECT_RADIUS) {
          this.takenPowerups.add(i);
          if (pu.kind === 'speed') h._pendingSpeed = true;
          else if (pu.kind === 'magnet') h._pendingMagnet = true;
          else h._pendingShield = true;
          this.onPower?.();
        }
      });
    }
  }

  private stepHuman(dt: number, input: HumanInput) {
    const h = this.human;
    h.boost = Math.max(0, h.boost - dt);
    h.magnet = Math.max(0, h.magnet - dt);
    h.shield = Math.max(0, h.shield - dt);
    let dxi = 0, dyi = 0;
    if (input.up) dyi -= 1;
    if (input.down) dyi += 1;
    if (input.left) dxi -= 1;
    if (input.right) dxi += 1;
    const wantSprint = input.sprint && h.stamina > 0 && (dxi !== 0 || dyi !== 0);
    if (wantSprint) h.stamina = Math.max(0, h.stamina - STAMINA_DRAIN * dt);
    else h.stamina = Math.min(STAMINA_MAX, h.stamina + STAMINA_REGEN * dt);
    let spd = HUMAN_SPEED;
    if (wantSprint) spd *= SPRINT_MULT;
    if (h.boost > 0) spd *= SPEED_BOOST_MULT;
    if (dxi !== 0 || dyi !== 0) {
      const inv = 1 / Math.hypot(dxi, dyi);
      const [nx, ny] = moveWithSlide(this.layout, h.x, h.y, dxi * inv * spd * dt, dyi * inv * spd * dt, PLAYER_RADIUS);
      h.x = nx; h.y = ny;
    }
  }

  /** Advance by real elapsed time, fixed-stepping the deterministic bot field. */
  update(realDt: number, input: HumanInput) {
    if (!this.running || this.finished) return;
    if (input.usePower) this.consumePower();
    this.acc += Math.min(realDt, 0.1);
    while (this.acc >= SIM_DT && !this.finished) {
      this.acc -= SIM_DT;
      this.botSim.step(SIM_DT);
      this.stepHuman(SIM_DT, input);
      this.collectHuman();
      this.elapsed += SIM_DT;
      this.timeLeft = Math.max(0, this.opts.durationSec - this.elapsed);
      if (this.opts.mode === 'B' && !this.warnedSprint && this.timeLeft <= this.opts.finalSprintWarningSec) {
        this.warnedSprint = true;
        this.onSprintWarn?.();
      }
      if (this.timeLeft <= 0) this.finish();
    }
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.running = false;
    this.botSim.finish();
    const reached = this.inCenter(this.human.x, this.human.y);
    this.human.state = this.opts.mode === 'B' && !reached ? 'eliminated' : 'finished';
  }

  /** Live standings for the in-game leaderboard (final official result is server-computed). */
  standings(): Standing[] {
    const players = this.players;
    const { rows } = computeStandings(
      this.opts.mode,
      { coinValue: this.human.coinValue, reachedCenter: this.inCenter(this.human.x, this.human.y), name: this.human.name, color: this.human.color },
      this.botSim.bots.map((b) => ({ id: b.id, name: b.name, nameEn: b.nameEn, color: b.color, coinValue: b.coinValue, reachedCenter: b.reachedCenter })),
    );
    const byId = new Map(players.map((p) => [p.id, p]));
    return rows.map((r) => ({ player: byId.get(r.id)!, rank: r.rank, eligible: r.eligible }));
  }

  /** The client's settlement claim: coin indices collected + Mode-B centre arrival. */
  humanResult(): { collectedCoinIndices: number[]; reachedCenter: boolean; coinValue: number } {
    return {
      collectedCoinIndices: [...this.humanCollected],
      reachedCenter: this.inCenter(this.human.x, this.human.y),
      coinValue: this.human.coinValue,
    };
  }

  get isFinalSprint(): boolean {
    return this.opts.mode === 'B' && this.timeLeft <= this.opts.finalSprintWarningSec;
  }

  get coinsLeft(): number {
    let n = 0;
    for (const c of this.layout.coins) if (!this.humanCollected.has(c.index) && !this.botSim.botTaken[c.index]) n++;
    return n;
  }
}
