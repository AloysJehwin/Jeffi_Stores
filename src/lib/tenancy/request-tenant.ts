import { headers } from 'next/headers'

/**
 * Reads the tenant id for the current request from the x-tenant-id header that
 * middleware sets after resolving the Host (see src/lib/tenant-registry.ts).
 * Returns null for the platform's own store / unknown hosts. Used by the session
 * issuers so a login mints a session snapshotted to the right tenant, without
 * every login route having to thread the tenant through explicitly.
 *
 * Safe in server components / route handlers (uses next/headers). Fails to null
 * if headers() is unavailable (e.g. outside a request scope).
 */
export async function resolveRequestTenantId(): Promise<string | null> {
  try {
    const h = await headers()
    return h.get('x-tenant-id') || null
  } catch {
    return null
  }
}
