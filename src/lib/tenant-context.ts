import { AsyncLocalStorage } from 'async_hooks'

/**
 * Per-request tenant context. Mirrors src/lib/audit-context.ts (a separate ALS
 * instance so tenant and audit contexts nest independently).
 *
 * The host->tenant resolver (middleware) resolves the tenant from the request
 * Host header and runs the request inside runWithTenantContext(...). Downstream,
 * getPool() (db.ts), the S3 key/bucket resolver, and Redis key namespacing read
 * getCurrentTenant() to scope to the right tenant. When no tenant is set (e.g.
 * the platform's own flagship store, or background jobs), getCurrentTenant()
 * returns null and callers fall back to the DEFAULT (env-configured) resources —
 * so existing single-tenant behavior is preserved.
 */

export interface TenantInfra {
  rdsEndpoint: string | null
  rdsDb: string
  rdsPort: number
  dbSecretRef: string | null
  iamAuth: boolean
  s3Bucket: string | null
  region: string
}

export interface TenantContext {
  tenantId: string
  slug: string
  plan: string | null
  infra: TenantInfra | null
}

const tenantStore = new AsyncLocalStorage<TenantContext>()

export function getCurrentTenant(): TenantContext | null {
  return tenantStore.getStore() ?? null
}

export function getCurrentTenantId(): string | null {
  return tenantStore.getStore()?.tenantId ?? null
}

export function runWithTenantContext<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  return tenantStore.run(ctx, fn)
}

/** Escape hatch for middleware/edge code that can't wrap a callback. */
export function setTenantContext(ctx: TenantContext): void {
  const existing = tenantStore.getStore()
  if (existing) {
    Object.assign(existing, ctx)
  } else {
    tenantStore.enterWith(ctx)
  }
}
