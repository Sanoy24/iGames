import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route as not requiring a resolved operator, exempting it from
 * TenantGuard. Use for platform-level endpoints (super-admin, health,
 * operator provisioning) that legitimately run without a tenant.
 */
export const ALLOW_NO_TENANT_KEY = 'allowNoTenant';
export const AllowNoTenant = () => SetMetadata(ALLOW_NO_TENANT_KEY, true);
