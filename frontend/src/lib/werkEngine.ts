/**
 * ወርቅ ፍለጋ (Werk Flega — Gold Rush) — client renderer for the shared, server-
 * authoritative round.
 *
 * The server owns the round: the clock, every player's position, the shared coin
 * pool, and the final standings. This class no longer simulates bots or decides
 * outcomes. It:
 *   - builds the maze/coins from the round seed (so it can draw them);
 *   - renders all other players + bots from the authoritative snapshots (with
 *     light interpolation for smoothness);
 *   - predicts ONLY the local avatar from live input for responsiveness, softly
 *     reconciling it toward the server position on each snapshot.
 * Nothing here is trusted for money — coin ownership shown for the local player is
 * optimistic display only; the authoritative result arrives on round completion.
 */
import {
  buildLayout, moveWithSlide,
  CELL, HUMAN_SPEED, COLLECT_RADIUS, PLAYER_RADIUS,
  type Layout, type CoinLite, type PowerupLite, type CoinType, type WinMode,
} from '@werk-sim';
import type { WerkRoundView, WerkSnapshot, WerkInputMsg } from './werkApi';

export { CELL };
export type { WinMode };
export type MazeTheme = 'adwa' | 'highland' | 'desert';

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
const MAGNET_RADIUS = CELL * 1.6;
const SHIELD_SEC = 10;
/** How fast the predicted local avatar is pulled toward the server position. */
const RECONCILE_RATE = 6;
/** How fast remote avatars interpolate toward their latest snapshot position. */
const INTERP_RATE = 12;

export type PlayerState = 'playing' | 'eliminated' | 'finished';

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
  moveX?: number;
  moveY?: number;
}

interface RemotePlayer {
  id: number;
  seat?: number;
  name: string;
  color: string;
  isBot: boolean;
  x: number;
  y: number;
  tx: number; // interpolation target
  ty: number;
  coinValue: number;
  magnet: boolean;
}

export interface WerkRoundOpts {
  seed: number;
  mode: WinMode;
  durationSec: number;
  maxPlayers: number;
  botCount: number;
  coinDensityX100: number;
  finalSprintWarningSec: number;
  powerupsEnabled: boolean;
  theme: MazeTheme;
  /** Your seat in the round, or null if spectating. */
  yourSeat: number | null;
  yourName: string;
}

export class WerkGame {
  readonly opts: WerkRoundOpts;
  readonly layout: Layout;
  /** Own predicted avatar, or null when spectating. */
  human: Player | null = null;
  private remotes = new Map<number, RemotePlayer>();
  private taken = new Set<number>();       // coins taken by anyone (server truth)
  private myCollected = new Set<number>(); // optimistic local pickups (own display)
  private takenPowerups = new Set<number>();
  private serverX = 0;
  private serverY = 0;
  private ownArbId: number | null = null;

  timeLeft: number;
  finished = false;
  status: WerkRoundView['status'] = 'running';

  onCollect?: (type: CoinType) => void;
  onPower?: () => void;
  onSprintWarn?: () => void;
  private warnedSprint = false;

  constructor(opts: WerkRoundOpts) {
    this.opts = opts;
    this.timeLeft = opts.durationSec;
    this.layout = buildLayout(opts.seed, {
      totalPlayers: opts.maxPlayers,
      coinDensityX100: opts.coinDensityX100,
      powerupsEnabled: opts.powerupsEnabled,
      botCount: opts.botCount,
    });
    // setOwnSeat both creates the avatar AND records ownArbId, so snapshots can
    // match our own player (otherwise the server's copy of us renders as a second
    // "ghost" ball and our prediction never reconciles to the real position).
    if (opts.yourSeat != null) this.setOwnSeat(opts.yourSeat, opts.yourName);
    if (this.human) { this.serverX = this.human.x; this.serverY = this.human.y; }
  }

  private makeHuman(seat: number, name: string): Player {
    const [sx, sy] = this.layout.humanSpawn;
    const ox = ((seat % 3) - 1) * 8, oy = (Math.floor(seat / 3) - 1) * 8;
    return {
      id: 1_000_000 + seat, name, color: HUMAN_COLOR, isHuman: true, x: sx + ox, y: sy + oy,
      coins: 0, coinValue: 0, bronze: 0, silver: 0, gold: 0, state: 'playing',
      stamina: STAMINA_MAX, boost: 0, magnet: 0, shield: 0,
    };
  }

  get size() { return this.layout.size; }
  get worldPx() { return this.layout.worldPx; }
  get center() { return this.layout.center; }
  get grid() { return this.layout.grid; }

  get coins(): RenderCoin[] {
    return this.layout.coins.map((c) => ({ ...c, collected: this.taken.has(c.index) || this.myCollected.has(c.index) }));
  }

  get powerups(): RenderPowerup[] {
    return this.layout.powerups.map((p, i) => ({ ...p, taken: this.takenPowerups.has(i) }));
  }

  /** Own avatar (if any) + every remote player/bot, as render players. */
  get players(): Player[] {
    const out: Player[] = [];
    if (this.human) out.push(this.human);
    for (const r of this.remotes.values()) {
      out.push({
        id: r.id, name: r.name, color: r.color, isHuman: !r.isBot, x: r.x, y: r.y,
        coins: 0, coinValue: r.coinValue, bronze: 0, silver: 0, gold: 0, state: 'playing',
        stamina: 0, boost: 0, magnet: r.magnet ? MAGNET_SEC : 0, shield: 0,
      });
    }
    return out;
  }

  /** The seat's own arbitration id, so snapshots can be matched to the local avatar. */
  setOwnSeat(seat: number | null, name?: string) {
    if (seat == null) { this.human = null; this.ownArbId = null; return; }
    this.ownArbId = 1_000_000 + seat;
    if (!this.human) this.human = this.makeHuman(seat, name ?? this.opts.yourName);
  }

  applyRoundState(view: WerkRoundView) {
    this.status = view.status;
    if (typeof view.timeLeft === 'number') this.timeLeft = view.timeLeft;
    if (view.yourSeat != null && !this.human) this.setOwnSeat(view.yourSeat);
    if (view.status === 'completed' || view.status === 'cancelled') this.finished = true;
  }

  applySnapshot(snap: WerkSnapshot) {
    this.status = snap.status as WerkRoundView['status'];
    this.timeLeft = snap.timeLeft;
    for (const i of snap.taken) this.taken.add(i);
    for (const i of snap.powerupsTaken) this.takenPowerups.add(i);
    if (this.opts.mode === 'B' && !this.warnedSprint && this.timeLeft <= this.opts.finalSprintWarningSec) {
      this.warnedSprint = true;
      this.onSprintWarn?.();
    }

    const seen = new Set<number>();
    for (const p of snap.players) {
      if (this.ownArbId != null && p.id === this.ownArbId) {
        // Authoritative own position — reconcile the local prediction toward it.
        this.serverX = p.x; this.serverY = p.y;
        continue;
      }
      seen.add(p.id);
      const r = this.remotes.get(p.id);
      if (r) { r.tx = p.x; r.ty = p.y; r.coinValue = p.coinValue; r.magnet = !!p.magnet; r.name = p.name; r.color = p.color; }
      else this.remotes.set(p.id, { id: p.id, seat: p.seat, name: p.name, color: p.color, isBot: p.isBot, x: p.x, y: p.y, tx: p.x, ty: p.y, coinValue: p.coinValue, magnet: !!p.magnet });
    }
    for (const id of [...this.remotes.keys()]) if (!seen.has(id)) this.remotes.delete(id);
  }

  markCompleted() { this.finished = true; this.status = 'completed'; }

  /** Advance prediction + interpolation by real elapsed time. Returns input to send. */
  update(dt: number, input: HumanInput): WerkInputMsg {
    const clamped = Math.min(dt, 0.1);
    // Local clock ticks smoothly between snapshots; snapshots correct it.
    if (this.status === 'running') this.timeLeft = Math.max(0, this.timeLeft - clamped);

    // Interpolate remote players toward their latest snapshot position.
    const k = Math.min(1, INTERP_RATE * clamped);
    for (const r of this.remotes.values()) { r.x += (r.tx - r.x) * k; r.y += (r.ty - r.y) * k; }

    const msg = this.buildInput(input);
    if (this.human && this.status === 'running') {
      this.stepHuman(clamped, input, msg);
      this.collectHuman();
      // Soft-reconcile toward the authoritative position.
      const rc = Math.min(1, RECONCILE_RATE * clamped);
      this.human.x += (this.serverX - this.human.x) * rc;
      this.human.y += (this.serverY - this.human.y) * rc;
    }
    return msg;
  }

  private buildInput(input: HumanInput): WerkInputMsg {
    let mx = input.moveX ?? 0, my = input.moveY ?? 0;
    if (Math.hypot(mx, my) <= 0.001) {
      let dxi = 0, dyi = 0;
      if (input.up) dyi -= 1;
      if (input.down) dyi += 1;
      if (input.left) dxi -= 1;
      if (input.right) dxi += 1;
      if (dxi !== 0 || dyi !== 0) { const inv = 1 / Math.hypot(dxi, dyi); mx = dxi * inv; my = dyi * inv; }
    }
    return { moveX: mx, moveY: my, sprint: !!input.sprint, usePower: !!input.usePower };
  }

  private consumePower() {
    const h = this.human!;
    if (h.boost <= 0 && h._pendingSpeed) { h.boost = SPEED_BOOST_SEC; h._pendingSpeed = false; }
    else if (h.magnet <= 0 && h._pendingMagnet) { h.magnet = MAGNET_SEC; h._pendingMagnet = false; }
    else if (h.shield <= 0 && h._pendingShield) { h.shield = SHIELD_SEC; h._pendingShield = false; }
  }

  private stepHuman(dt: number, input: HumanInput, msg: WerkInputMsg) {
    const h = this.human!;
    if (input.usePower) this.consumePower();
    h.boost = Math.max(0, h.boost - dt);
    h.magnet = Math.max(0, h.magnet - dt);
    h.shield = Math.max(0, h.shield - dt);

    const mag = Math.min(1, Math.hypot(msg.moveX, msg.moveY));
    if (mag <= 0.001) { h.stamina = Math.min(STAMINA_MAX, h.stamina + STAMINA_REGEN * dt); return; }
    const dirX = msg.moveX / (Math.hypot(msg.moveX, msg.moveY) || 1);
    const dirY = msg.moveY / (Math.hypot(msg.moveX, msg.moveY) || 1);
    const wantSprint = msg.sprint && h.stamina > 0;
    if (wantSprint) h.stamina = Math.max(0, h.stamina - STAMINA_DRAIN * dt);
    else h.stamina = Math.min(STAMINA_MAX, h.stamina + STAMINA_REGEN * dt);

    let spd = HUMAN_SPEED * (0.45 + 0.55 * mag);
    if (wantSprint) spd *= SPRINT_MULT;
    if (h.boost > 0) spd *= SPEED_BOOST_MULT;
    const [nx, ny] = moveWithSlide(this.layout, h.x, h.y, dirX * spd * dt, dirY * spd * dt, PLAYER_RADIUS);
    h.x = nx; h.y = ny;
  }

  /** Optimistic local pickup for the own avatar — display + SFX only. */
  private collectHuman() {
    const h = this.human!;
    const radius = h.magnet > 0 ? MAGNET_RADIUS : COLLECT_RADIUS;
    for (const c of this.layout.coins) {
      if (this.myCollected.has(c.index) || this.taken.has(c.index)) continue;
      if (Math.hypot(c.x - h.x, c.y - h.y) < radius) {
        this.myCollected.add(c.index);
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

  /** Live leaderboard from current coin values (final result is server-computed). */
  standings(): Standing[] {
    const players = this.players;
    const sorted = [...players].sort((a, b) => b.coinValue - a.coinValue);
    let rank = 0, seen = 0, lastVal = Infinity;
    const rankById = new Map<number, number>();
    for (const p of sorted) {
      seen++;
      if (p.coinValue !== lastVal) { rank = seen; lastVal = p.coinValue; }
      rankById.set(p.id, rank);
    }
    return sorted.map((p) => ({ player: p, rank: rankById.get(p.id)!, eligible: true }));
  }

  get isFinalSprint(): boolean {
    return this.opts.mode === 'B' && this.timeLeft <= this.opts.finalSprintWarningSec;
  }
}
