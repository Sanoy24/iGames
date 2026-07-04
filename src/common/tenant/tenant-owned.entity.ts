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
  // NOT NULL as of Phase 2: TenantSubscriber stamps operatorId from TenantContext
  // on every insert (fallback operator-zero), so a tenant-owned row can never be
  // written without an owner. Set by the subscriber before insert, hence the
  // definite-assignment assertion.
  @Index()
  @Column({ type: 'varchar', length: 36 })
  operatorId!: string;
}
