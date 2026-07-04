import { Global, Module } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';
import { TenantGuard } from './tenant.guard';
import { TenantSubscriber } from './tenant.subscriber';

/**
 * Global so any module can inject TenantContextService without importing this
 * module explicitly. TenantSubscriber registers itself on the DataSource to
 * auto-stamp operatorId on inserts. TenantGuard is provided here but not
 * registered as an APP_GUARD yet (see TenantGuard docs — Phase 2).
 */
@Global()
@Module({
  providers: [TenantContextService, TenantGuard, TenantSubscriber],
  exports: [TenantContextService, TenantGuard],
})
export class TenantModule {}
