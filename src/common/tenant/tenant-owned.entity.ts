import { Column, Index } from 'typeorm';

/**
 * Base class for every tenant-scoped entity. Adds a denormalized `operatorId`
 * scalar (not a FK relation — we don't want a foreign key from every business
 * table into `operators`; the scalar + index is the standard row-level
 * multi-tenant pattern) so all reads/writes can be filtered by operator.
 *
 * Entities that also carry a uniqueness constraint must prefix it with
 * `operatorId` at the class level (e.g. `@Index(['operatorId', 'email'], { unique: true })`)
 * so identifiers are unique *per operator*, not globally.
 */
export abstract class TenantOwnedEntity {
  // Nullable during the Phase 1 rollout (add column → backfill to operator-zero →
  // wire resolution → tighten to NOT NULL). Phase 2's scoping/guard layer plus a
  // follow-up migration make this non-null and enforced.
  @Index()
  @Column({ type: 'varchar', length: 36, nullable: true })
  operatorId?: string | null;
}
