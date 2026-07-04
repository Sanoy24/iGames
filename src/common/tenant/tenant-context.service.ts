import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export type TenantSource = 'jwt' | 'host' | 'telegram' | 'api-key' | 'system';

export interface TenantStore {
  operatorId: string | null;
  source: TenantSource | null;
}

/**
 * Request-scoped tenant context backed by AsyncLocalStorage.
 *
 * A single per-request store object is established by TenantContextMiddleware
 * (via `run`). Downstream resolvers — the JWT guard, the Telegram adapter, a
 * host/subdomain resolver, or an API-key guard — call `set` to record which
 * operator the request belongs to. Scoped services then read `operatorId`
 * without threading it through every method signature.
 *
 * Using ALS (rather than a REQUEST-scoped provider) keeps every provider in the
 * default singleton scope — no per-request instantiation cost on the hot path.
 */
@Injectable()
export class TenantContextService {
  private readonly als = new AsyncLocalStorage<TenantStore>();

  /** Establish a fresh, empty store for the lifetime of `callback`. */
  run<T>(callback: () => T): T {
    return this.als.run({ operatorId: null, source: null }, callback);
  }

  private get store(): TenantStore | undefined {
    return this.als.getStore();
  }

  /** Record the resolved operator for the current request. */
  set(operatorId: string, source: TenantSource): void {
    const store = this.store;
    if (!store) {
      // Called outside an established context (e.g. a background job that did
      // not open one). Fail loud rather than silently dropping tenant scope.
      throw new Error('Cannot set tenant: no TenantContext is active for this execution');
    }
    store.operatorId = operatorId;
    store.source = source;
  }

  get operatorId(): string | null {
    return this.store?.operatorId ?? null;
  }

  get source(): TenantSource | null {
    return this.store?.source ?? null;
  }

  /** Read the operator id or throw — use where a tenant is required to proceed. */
  getOperatorIdOrThrow(): string {
    const id = this.operatorId;
    if (!id) {
      throw new Error('No operator resolved for the current tenant context');
    }
    return id;
  }
}
