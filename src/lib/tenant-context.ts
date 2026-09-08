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
  /** Store's own name, for anything customer-facing (mail senders, page titles). */
  displayName: string | null
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

/**
 * Request-scoped tenant resolver. Use this instead of getCurrentTenant() anywhere the ALS
 * context may not be populated yet — RSC renders and any request path that reads the tenant
 * before its first db.ts query(). ALS is empty at the start of a request: middleware forwards
 * the tenant to the render only via the x-tenant-id / x-tenant-slug headers, and ALS is filled
 * in as a side effect of the first db.ts query (ensureTenantContext). This mirrors that bridge:
 * ALS first, else read the header, resolve the full context, cache it into ALS, return it.
 *
 * Edge-safe: next/headers and tenant-registry are dynamically imported so the middleware bundle
 * (which imports only runWithTenantContext) never pulls them into the Edge runtime.
 */
export async function resolveTenant(): Promise<TenantContext | null> {
  const existing = getCurrentTenant()
  if (existing) return existing
  try {
    const { headers } = await import('next/headers')
    const h = await headers()
    const slug = h.get('x-tenant-slug')
    const id = h.get('x-tenant-id')
    const registry = await import('./tenant-registry')
    const ctx = slug
      ? await registry.lookupTenantContextBySlug(slug)
      : id
        ? await registry.lookupTenantContextById(id)
        : null
    if (ctx) setTenantContext(ctx)
    return ctx
  } catch {
    return null
  }
}

export async function resolveTenantId(): Promise<string | null> {
  return (await resolveTenant())?.tenantId ?? null
}
