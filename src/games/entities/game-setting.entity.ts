import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type GameCode = 'keno' | 'bingo' | 'crash' | 'pool';

/**
 * Player-facing availability of a game.
 *  - `enabled`     — visible and playable.
 *  - `maintenance` — visible but not playable; the client shows it greyed out
 *                    with `maintenanceMessage`. New plays are rejected server-side.
 *  - `hidden`      — not shown to players at all, and not playable.
 */
export type GameState = 'enabled' | 'maintenance' | 'hidden';

/**
 * DB-backed availability control for each game, editable by admins. Consulted by
 * game purchase endpoints (to block plays) and schedulers (to stop spinning up
 * new rounds) — see GamesService.assertPlayable / isPlayable.
 */
@Entity({ name: 'game_settings', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
export class GameSetting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // `unique: true` already creates an index — no separate @Index needed.
  @Column({ type: 'varchar', length: 20, unique: true })
  gameCode: GameCode;

  @Column({ type: 'enum', enum: ['enabled', 'maintenance', 'hidden'], default: 'enabled' })
  state: GameState;

  @Column({ type: 'varchar', length: 300, nullable: true, charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' })
  maintenanceMessage: string | null;

  /** Ascending sort order for the player game list. */
  @Column({ type: 'int', default: 0 })
  displayOrder: number;

  /** Admin user id who last changed this setting. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
