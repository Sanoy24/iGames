import { Injectable } from '@nestjs/common';
import {
  DataSource,
  EntityTarget,
  FindManyOptions,
  FindOneOptions,
  FindOptionsWhere,
  ObjectLiteral,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { TenantContextService } from './tenant-context.service';

/**
 * Read-side counterpart to TenantSubscriber. Wraps a TypeORM repository and
 * folds the current operator (from TenantContext) into every query, so a caller
 * cannot accidentally read across tenants. Use it for queries that are NOT
 * already constrained by a userId (which itself implies one operator) — chiefly
 * cross-user listings: game rooms/draws/rounds, admin user/agent lists,
 * leaderboards.
 *
 * `getOperatorIdOrThrow()` fails closed: if no tenant is resolved, the query
 * throws rather than returning unscoped rows.
 */
export class TenantScopedRepository<T extends ObjectLiteral> {
  constructor(
    private readonly repo: Repository<T>,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** The underlying repository, for writes or intentionally unscoped access. */
  get unscoped(): Repository<T> {
    return this.repo;
  }

  private withOperator(
    where?: FindOptionsWhere<T> | FindOptionsWhere<T>[],
  ): FindOptionsWhere<T> | FindOptionsWhere<T>[] {
    const operatorId = this.tenantContext.getOperatorIdOrThrow();
    if (Array.isArray(where)) {
      return where.map(
        (clause) => ({ ...clause, operatorId }) as unknown as FindOptionsWhere<T>,
      );
    }
    return { ...(where ?? {}), operatorId } as unknown as FindOptionsWhere<T>;
  }

  find(options: FindManyOptions<T> = {}): Promise<T[]> {
    return this.repo.find({ ...options, where: this.withOperator(options.where) });
  }

  findOne(options: FindOneOptions<T>): Promise<T | null> {
    return this.repo.findOne({ ...options, where: this.withOperator(options.where) });
  }

  count(options: FindManyOptions<T> = {}): Promise<number> {
    return this.repo.count({ ...options, where: this.withOperator(options.where) });
  }

  /**
   * A QueryBuilder pre-filtered to the current operator. The operator predicate
   * is added with the reserved parameter name `__operatorId`.
   */
  scopedQueryBuilder(alias: string): SelectQueryBuilder<T> {
    const operatorId = this.tenantContext.getOperatorIdOrThrow();
    return this.repo
      .createQueryBuilder(alias)
      .where(`${alias}.operatorId = :__operatorId`, { __operatorId: operatorId });
  }
}

/**
 * Injectable factory so services can obtain a TenantScopedRepository for any
 * entity without wiring a custom provider per entity.
 */
@Injectable()
export class TenantScopedRepositoryFactory {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContextService,
  ) {}

  forEntity<T extends ObjectLiteral>(entity: EntityTarget<T>): TenantScopedRepository<T> {
    return new TenantScopedRepository<T>(
      this.dataSource.getRepository(entity),
      this.tenantContext,
    );
  }
}
