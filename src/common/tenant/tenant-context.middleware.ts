import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { TenantContextService } from './tenant-context.service';

/**
 * Opens an AsyncLocalStorage tenant store for every request so that later
 * resolvers (JWT guard, Telegram adapter, host resolver) have somewhere to
 * record the operator, and scoped services can read it.
 *
 * Must run before the auth guards. It only *establishes* the (empty) store —
 * it does not resolve the operator; that is the job of the resolvers wired in
 * Phase 1. The rest of the request pipeline executes inside `run`, so the ALS
 * context propagates through guards, interceptors and controllers.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly tenantContext: TenantContextService) {}

  use(_req: Request, _res: Response, next: NextFunction): void {
    this.tenantContext.run(() => next());
  }
}
