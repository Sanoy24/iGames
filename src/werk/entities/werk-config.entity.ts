import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/** Winning scheme for a Werk Flega game. See CLAUDE domain notes / werk spec §3. */
export type WerkWinningMode = 'A' | 'B';

/** Visual theme applied to the maze on the client. */
export type WerkMazeTheme = 'adwa' | 'highland' | 'desert';

/** How the bot roster fills the non-human slots (spec §5.2). */
export type WerkBotSeedMode = 'auto' | 'zero' | 'custom';

/** Bot AI archetypes (spec §5.2). */
export type WerkBotPersonality = 'gatherer' | 'sniper' | 'strategist' | 'explorer' | 'chaotic';

export const ALL_WERK_PERSONALITIES: WerkBotPersonality[] = [
  'gatherer', 'sniper', 'strategist', 'explorer', 'chaotic',
];

/**
 * DB-backed configuration for the ወርቅ ፍለጋ (Werk Flega — "Gold Rush") maze game.
 * Single row keyed `default`, mirroring PoolConfig / CrashConfig.
 *
 * Money model: the game is one human vs. house bots, played in real time, so it
 * cannot be draw-authoritative. Instead the server draws an RNG-audited seed the
 * client uses to build the identical maze, debits `entryStake` on start, and on
 * settle pays `stake × payoutRank{N}MultX100 / 100` for the human's final rank
 * (with tie-splitting). All money-like values are integer minor units; percentages
 * and multipliers are whole-number ints (×100 where noted). Nothing here is a
 * hardcoded game value — admins tune every rule/prize without a redeploy.
 */
@Entity({ name: 'werk_config', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
export class WerkConfig {
  @PrimaryColumn({ type: 'varchar', length: 64, default: 'default' })
  key: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  // ── Stake ──────────────────────────────────────────────────────────────────
  /** Default entry stake used when a client does not send one. */
  @Column({ type: 'int', default: 10 })
  entryStakeMinor: number;

  @Column({ type: 'int', default: 1 })
  minStakeMinor: number;

  @Column({ type: 'int', default: 1_000 })
  maxStakeMinor: number;

  // ── Round shape ──────────────────────────────────────────────────────────────
  /** Total participants in a game (human + bots). 1–100. */
  @Column({ type: 'int', default: 10 })
  totalPlayers: number;

  /** How many of the total are AI bots. Clamped to `totalPlayers - 1`. */
  @Column({ type: 'int', default: 9 })
  botCount: number;

  // ── Bots (server-generated roster; spec §5.2) ───────────────────────────────
  /** auto = varied personalities; zero = no bots; custom = cycle `botPersonalities`. */
  @Column({ type: 'enum', enum: ['auto', 'zero', 'custom'], default: 'auto' })
  botSeedMode: WerkBotSeedMode;

  /** Base bot speed as a % of the human's speed (± small deterministic jitter). */
  @Column({ type: 'int', default: 88 })
  botSpeedPct: number;

  /** Bot decision quality 0–100 (± small jitter): target choice + reaction time. */
  @Column({ type: 'int', default: 60 })
  botSkillPct: number;

  /**
   * Personality pool the roster draws from. In `auto` mode bots are picked
   * randomly (deterministically, from the seed) among these; in `custom` mode the
   * slots cycle through this list in order. Stored as a CSV text array.
   */
  @Column({ type: 'simple-array', nullable: true })
  botPersonalities: WerkBotPersonality[] | null;

  /** Game clock, seconds. 30–600. */
  @Column({ type: 'int', default: 120 })
  gameDurationSec: number;

  @Column({ type: 'enum', enum: ['A', 'B'], default: 'A' })
  winningMode: WerkWinningMode;

  /** Mode B only: seconds before time-up when the final-sprint horn fires. 3–15. */
  @Column({ type: 'int', default: 7 })
  finalSprintWarningSec: number;

  /** Coins per cell ×100 (0.15 → 15). Range 5–30. */
  @Column({ type: 'int', default: 15 })
  coinDensityX100: number;

  @Column({ type: 'boolean', default: true })
  powerupsEnabled: boolean;

  @Column({ type: 'enum', enum: ['adwa', 'highland', 'desert'], default: 'adwa' })
  mazeTheme: WerkMazeTheme;

  // ── Prize table ──────────────────────────────────────────────────────────────
  // Payout for finishing at rank N, as a multiplier of the entry stake ×100
  // (300 → 3.0× stake). Weights beyond the field count pay nothing. On a tie for a
  // rank, that rank's prize is split equally among the tied finishers (spec §4).
  @Column({ type: 'int', default: 500 })
  payoutRank1MultX100: number;

  @Column({ type: 'int', default: 250 })
  payoutRank2MultX100: number;

  @Column({ type: 'int', default: 120 })
  payoutRank3MultX100: number;

  @Column({ type: 'int', default: 0 })
  payoutRank4MultX100: number;

  @Column({ type: 'int', default: 0 })
  payoutRank5MultX100: number;

  // ── House-edge win control (server-authoritative outcome shaping) ────────────
  /** Master switch for the win controller below. */
  @Column({ type: 'boolean', default: true })
  winControlEnabled: boolean;

  /**
   * When the total participant count (human + bots) is BELOW this, the house
   * always wins: the human is forced strictly below every bot (no top prize).
   */
  @Column({ type: 'int', default: 10 })
  houseGuaranteedBelowPlayers: number;

  /**
   * For larger games, force a (randomly chosen, RNG-audited) bot to beat the
   * human every Nth settled round. 0 disables the periodic forced win.
   */
  @Column({ type: 'int', default: 4 })
  botForcedWinEveryNRounds: number;

  /** Internal rolling counter of large-game settlements since the last forced win. */
  @Column({ type: 'int', default: 0 })
  winControlCounter: number;

  /** Admin user id who last changed this config. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
