import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Operator } from './operator.entity';

export type GameKey = 'keno' | 'bingo' | 'crash';

/**
 * Per-operator configuration — the multi-tenant successor to the global
 * `SystemConfig` singleton. One row per operator (enforced by the unique index
 * on operatorId). In Phase 3 the game modules read their money/config values
 * from here instead of the singleton; for now this establishes the shape.
 */
@Entity({ name: 'operator_configs', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
export class OperatorConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  @Index({ unique: true })
  operatorId: string;

  @OneToOne(() => Operator, (operator) => operator.config, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'operatorId' })
  operator: Operator;

  /** Which games this operator has enabled — drives frontend tabs & route guards. */
  @Column({ type: 'json', default: '["keno","bingo","crash"]' })
  enabledGames: GameKey[];

  /** Display label for the credit unit shown to players (e.g. "ETB", "Credits"). */
  @Column({ type: 'varchar', length: 10, default: 'CREDIT' })
  currencyCode: string;

  // ── Wallet / deposit economics (mirrors the former SystemConfig singleton) ──
  @Column({ type: 'int', default: 1 })
  telebirrCreditMinorPerBirr: number;

  @Column({ type: 'int', default: 0 })
  welcomeBonusMinor: number;

  @Column({ type: 'int', default: 0 })
  withdrawalServiceChargePct: number;

  @Column({ type: 'int', default: 0 })
  withdrawalMinAmountMinor: number;

  @Column({ type: 'int', default: 0 })
  withdrawalMaxAmountMinor: number;

  @Column({ type: 'int', default: 1 })
  maxPendingWithdrawalsPerUser: number;

  // ── Per-operator Telegram identity ─────────────────────────────────────────
  /** Each operator runs their own bot; token validates their Mini App initData.
   *  select:false so it never leaks through a default entity read. */
  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  telegramBotToken?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  telegramBotUsername?: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
