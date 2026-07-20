import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type { WerkBotPersonality } from './werk-config.entity';

/**
 * A persistent, admin-managed house bot for Werk Flega. The roster for any given
 * game is drawn (deterministically, from the audited game seed) out of the pool
 * of `enabled` rows here — so bot identities live in the DB, not in code, and an
 * admin can add / edit / disable bots without a redeploy.
 *
 * Identity (name/nameEn/color/personality) is intrinsic to the bot. Speed/skill
 * are optional per-bot overrides; when null the bot uses the global config base
 * (`WerkConfig.botSpeedPct` / `botSkillPct`) plus a small deterministic jitter.
 */
@Entity({ name: 'werk_bot', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index(['enabled', 'sortOrder'])
export class WerkBot {
  @PrimaryGeneratedColumn()
  id: number;

  /** Amharic display name. */
  @Column({ type: 'varchar', length: 64 })
  name: string;

  /** Latin transliteration / English name. */
  @Column({ type: 'varchar', length: 64 })
  nameEn: string;

  /** Render colour (hex, e.g. #e6b422). */
  @Column({ type: 'varchar', length: 16, default: '#e6b422' })
  color: string;

  @Column({ type: 'enum', enum: ['gatherer', 'sniper', 'strategist', 'explorer', 'chaotic'], default: 'gatherer' })
  personality: WerkBotPersonality;

  /** Optional speed override (% of human). Null → use config base + jitter. */
  @Column({ type: 'int', nullable: true })
  speedPct: number | null;

  /** Optional skill override (0–100). Null → use config base + jitter. */
  @Column({ type: 'int', nullable: true })
  skillPct: number | null;

  /** Only enabled bots are eligible to be drawn into a game's roster. */
  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  /** Lower sorts first in the admin list (cosmetic; selection is seed-shuffled). */
  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  /** Admin user id who created the bot. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
