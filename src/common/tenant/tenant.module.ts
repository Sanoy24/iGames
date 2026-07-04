import { Global, Module } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';
import { TenantGuard } from './tenant.guard';

/**
 * Global so any module can inject TenantContextService without importing this
 * module explicitly. TenantGuard is provided here but intentionally not
 * registered as an APP_GUARD yet (see TenantGuard docs — Phase 2).
 */
@Global()
@Module({
  providers: [TenantContextService, TenantGuard],
  exports: [TenantContextService, TenantGuard],
})
export class TenantModule {}
