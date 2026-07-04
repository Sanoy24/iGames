import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToOne,
} from 'typeorm';
import { OperatorConfig } from './operator-config.entity';

export type OperatorPlan = 'trial' | 'starter' | 'growth' | 'enterprise';
export type OperatorStatus = 'trial' | 'active' | 'suspended' | 'closed';

/**
 * Per-operator visual identity consumed by the white-label frontend
 * (see the SaaS blueprint, Part Two). Stored as JSON so branding can evolve
 * without a schema change; the frontend reads it from `GET /operator/context`.
 */
export interface OperatorBranding {
  brandName?: string;
  logoUrl?: string;
  faviconUrl?: string;
  /** Primary accent colour as a hex string, e.g. "#0B8577". */
  primaryColor?: string;
  /** Secondary/support colour. */
  accentColor?: string;
  supportUrl?: string;
}

/**
 * The tenant. Every player, wallet, ledger entry, game and config row in the
 * system belongs to exactly one Operator once Phase 1 lands. This entity is the
 * root of the multi-tenant tree — see the SaaS transformation blueprint.
 */
@Entity({ name: 'operators', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
export class Operator {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** URL-safe tenant key; drives the default subdomain (e.g. "acme" → acme.host). */
  @Column({ type: 'varchar', length: 63 })
  @Index({ unique: true })
  slug: string;

  @Column({ type: 'varchar', length: 255 })
  displayName: string;

  /** Optional vanity domain (e.g. play.acme.com) resolved via the Host header. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  @Index({ unique: true })
  customDomain?: string | null;

  @Column({ type: 'enum', enum: ['trial', 'starter', 'growth', 'enterprise'], default: 'trial' })
  plan: OperatorPlan;

  @Column({ type: 'enum', enum: ['trial', 'active', 'suspended', 'closed'], default: 'trial' })
  status: OperatorStatus;

  @Column({ type: 'json', nullable: true })
  branding?: OperatorBranding | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  @OneToOne(() => OperatorConfig, (config) => config.operator)
  config: OperatorConfig;
}
