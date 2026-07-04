import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { TenantContextService } from './tenant-context.service';
import { ALLOW_NO_TENANT_KEY } from './allow-no-tenant.decorator';

/**
 * Defence-in-depth: rejects any request that reached a protected handler
 * without a resolved operator, so a missing/failed tenant resolution can never
 * fall through to unscoped data access.
 *
 * NOT registered globally in Phase 0 — resolvers that populate the tenant do
 * not exist yet (Phase 1). It is wired as an APP_GUARD (after JwtAuthGuard) in
 * Phase 2 once every entry point resolves an operator. `@Public()` and
 * `@AllowNoTenant()` handlers are exempt.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantContext: TenantContextService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    const allowNoTenant = this.reflector.getAllAndOverride<boolean>(ALLOW_NO_TENANT_KEY, targets);
    if (isPublic || allowNoTenant) {
      return true;
    }

    if (!this.tenantContext.operatorId) {
      throw new ForbiddenException('No operator context resolved for this request');
    }
    return true;
  }
}
