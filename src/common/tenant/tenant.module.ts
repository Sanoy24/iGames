import { Global, Module } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';
import { TenantGuard } from './tenant.guard';
import { TenantSubscriber } from './tenant.subscriber';
import { TenantScopedRepositoryFactory } from './tenant-scoped.repository';

/**
 * Global so any module can inject TenantContextService / the scoped-repository
 * factory without importing this module explicitly. TenantSubscriber registers
 * itself on the DataSource to auto-stamp operatorId on inserts (write side);
 * TenantScopedRepositoryFactory folds operatorId into reads (read side).
 * TenantGuard is provided for non-JWT entry points (host / api-key) resolved in
 * middleware; JwtAuthGuard already resolves the tenant for token-authed routes.
 */
@Global()
@Module({
  providers: [
    TenantContextService,
    TenantGuard,
    TenantSubscriber,
    TenantScopedRepositoryFactory,
  ],
  exports: [TenantContextService, TenantGuard, TenantScopedRepositoryFactory],
})
export class TenantModule {}
