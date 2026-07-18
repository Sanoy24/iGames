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
