import { Injectable } from '@nestjs/common';
import {
  DataSource,
  EntitySubscriberInterface,
  InsertEvent,
} from 'typeorm';
import { TenantContextService } from './tenant-context.service';
import { OPERATOR_ZERO_ID } from '../../operator/operator.constants';

/**
 * Write-side tenancy enforcement. Before every insert, if the target table has
 * an `operatorId` column and the row hasn't set one, it is stamped from the
 * current TenantContext. This means individual services never have to remember
 * to set operatorId — it is applied structurally, the same principle as the
 * read-side scoping that lands in Phase 2.
 *
 * Fallback: when no tenant is resolved (background jobs / schedulers that don't
 * yet run per-operator), we stamp OPERATOR_ZERO_ID so single-operator dev keeps
 * working. Per-operator background execution in a later phase removes the need
 * for this fallback.
 */
@Injectable()
export class TenantSubscriber implements EntitySubscriberInterface {
  constructor(
    dataSource: DataSource,
    private readonly tenantContext: TenantContextService,
  ) {
    dataSource.subscribers.push(this);
  }

  beforeInsert(event: InsertEvent<unknown>): void {
    const hasOperatorId = event.metadata.columns.some(
      (column) => column.propertyName === 'operatorId',
    );
    if (!hasOperatorId) {
      return;
    }

    const entity = event.entity as { operatorId?: string | null } | undefined;
    if (entity && (entity.operatorId === undefined || entity.operatorId === null)) {
      entity.operatorId = this.tenantContext.operatorId ?? OPERATOR_ZERO_ID;
    }
  }
}
