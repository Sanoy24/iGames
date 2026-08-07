import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type BotActionGame = 'keno' | 'bingo' | 'crash' | 'admin';

@Entity({ name: 'bot_action_logs', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index('IDX_bot_action_logs_bot_created', ['botId', 'createdAt'])
@Index('IDX_bot_action_logs_game_created', ['game', 'createdAt'])
export class BotActionLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  botId: string | null;

  @Column({ type: 'varchar', length: 20 })
  game: BotActionGame;

  @Column({ type: 'varchar', length: 80 })
  action: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  sourceId: string | null;

  @Column({ type: 'bigint', nullable: true })
  amountMinor: number | null;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamp', precision: 3 })
  createdAt: Date;
}
