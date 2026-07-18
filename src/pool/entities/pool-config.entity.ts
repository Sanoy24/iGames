import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * Difficulty of the AI opponent in single-player pool. Consumed later by the
 * physics/bot layer (Phase 1); stored here so it stays DB-backed config rather
 * than a hardcoded game value.
 */
export type PoolBotDifficulty = 'easy' | 'medium' | 'hard';

/**
 * DB-backed configuration for the 8-ball Pool game. Single row keyed `default`,
 * mirroring CrashConfig. Split into three admin-controlled mode groups — single
 * player, two player (PvP), and tournament — plus global engine/ruleset fields.
 *
 * Money-like values are integer minor units (per the ledger rules); percentages
 * are whole-number ints (e.g. `rakePct = 5` means 5%). No gameplay reads this yet
 * in Phase 0 — this is the config/admin surface the later phases build on.
 */
@Entity({ name: 'pool_config', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
export class PoolConfig {
  @PrimaryColumn({ type: 'varchar', length: 64, default: 'default' })
  key: string;

  // ── Single player (vs AI) ─────────────────────────────────────────────────
  @Column({ type: 'boolean', default: true })
  singlePlayerEnabled: boolean;

  /** Stake for a single-player game vs the house. 0 = free play. */
  @Column({ type: 'int', default: 0 })
  singlePlayerStakeMinor: number;

  @Column({ type: 'enum', enum: ['easy', 'medium', 'hard'], default: 'medium' })
  botDifficulty: PoolBotDifficulty;

  // ── Two player (PvP, staked) ──────────────────────────────────────────────
  @Column({ type: 'boolean', default: true })
  twoPlayerEnabled: boolean;

  @Column({ type: 'int', default: 10 })
  minStakeMinor: number;

  @Column({ type: 'int', default: 1_000 })
  maxStakeMinor: number;

  /** House cut on the two-player pot, as a whole-number percentage. */
  @Column({ type: 'int', default: 5 })
  rakePct: number;

  /** Seconds a player has to take a shot before forfeiting the turn. */
  @Column({ type: 'int', default: 30 })
  shotClockSeconds: number;

  /**
   * How many consecutive shot-clock timeouts a player may accrue before losing
   * the match. Each timeout below this is a foul (turn passes, opponent gets ball
   * in hand); reaching it forfeits the match. 1 = a single timeout forfeits (old
   * behaviour); default 3 gives two grace fouls so one clock overrun is not an
   * instant loss, while an abandoned game still ends.
   */
  @Column({ type: 'int', default: 3 })
  maxTimeoutFouls: number;

  // ── Tournament ────────────────────────────────────────────────────────────
  @Column({ type: 'boolean', default: false })
  tournamentEnabled: boolean;

  @Column({ type: 'int', default: 50 })
  tournamentEntryFeeMinor: number;

  /** Number of seats in a tournament bracket (power of two, e.g. 8 / 16). */
  @Column({ type: 'int', default: 8 })
  tournamentSize: number;

  /** House cut on the tournament prize pool, as a whole-number percentage. */
  @Column({ type: 'int', default: 10 })
  tournamentRakePct: number;

  /**
   * Relative prize weights for the top finishers of a tournament, after rake.
   * Like Bingo's tiers these are *weights*, not literal percentages: the
   * after-rake pool is split across the tiers that actually have finishers, each
   * tier taking weight ÷ (sum of active tier weights). Places 3rd–4th share one
   * tier (the two semi-final losers split it equally). Defaults 100/0/0 =
   * winner-take-all. A tier that does not exist for the bracket size (e.g. 3rd
   * in a 2-player event) is ignored and its weight redistributed.
   */
  @Column({ type: 'int', default: 100 })
  tournamentPrize1Weight: number;

  @Column({ type: 'int', default: 0 })
  tournamentPrize2Weight: number;

  /** Combined weight for the 3rd–4th place tier (split equally between the two). */
  @Column({ type: 'int', default: 0 })
  tournamentPrize34Weight: number;

  // ── Physics tuning (snapshotted onto each match at creation) ───────────────
  // Stored as integers so admins can tune felt/cue feel without a redeploy; see
  // pool-physics.ts for how these map to the engine's TableSpec / ShotTuning.
  /** Sliding (skid) friction ×100. 0.20 → 20. */
  @Column({ type: 'int', default: 20 })
  slidingFrictionX100: number;

  /** Rolling resistance ×1000. 0.012 → 12. Higher = balls settle sooner. */
  @Column({ type: 'int', default: 12 })
  rollingFrictionX1000: number;

  /** Cushion rebound (restitution) as a percentage. 0.82 → 82. */
  @Column({ type: 'int', default: 82 })
  cushionReboundPct: number;

  /** Ball-to-ball rebound (restitution) as a percentage. 0.94 → 94. */
  @Column({ type: 'int', default: 94 })
  ballReboundPct: number;

  /** Pocket capture radius as a percentage of ball radius. 1.90× → 190. */
  @Column({ type: 'int', default: 190 })
  pocketSizePct: number;

  /** Cue-ball speed at full power ×100 (m/s). 6.0 → 600. */
  @Column({ type: 'int', default: 600 })
  cueMaxSpeedX100: number;

  /** Vertical-axis english at full side (rad/s). */
  @Column({ type: 'int', default: 60 })
  maxSideSpin: number;

  /** Follow/draw spin at full vertical (rad/s). */
  @Column({ type: 'int', default: 120 })
  maxRollSpin: number;

  // ── Global ────────────────────────────────────────────────────────────────
  /** Rules variant the engine enforces; bumped when the ruleset changes. */
  @Column({ type: 'int', default: 1 })
  rulesetVersion: number;

  /** Physics engine version; part of the replayable-match audit trail. */
  @Column({ type: 'int', default: 1 })
  engineVersion: number;

  /** Admin user id who last changed this config. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
