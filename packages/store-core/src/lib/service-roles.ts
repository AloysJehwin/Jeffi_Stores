import { CRON_JOBS } from '@/lib/shared/cron-jobs'
import { storeHostForSlug } from '@/lib/tenancy/forms-host'
import type { HostApp } from '@/lib/tenant-registry/host-resolution'

// Which store service a pod runs as (SERVICE_ROLE), and the store it belongs to (SERVICE_TENANT_SLUG).
// Unset role: the platform controller (or local dev), which serves everything. Hosts a role doesn't
// serve, the control plane and other stores answer 404.

export type ServiceRole = 'storefront' | 'admin' | 'business'
export const STORE_ROLES: readonly ServiceRole[] = ['storefront', 'admin', 'business']

export function serviceRole(): ServiceRole | null {
  const r = process.env.SERVICE_ROLE
  return (STORE_ROLES as readonly string[]).includes(r ?? '') ? (r as ServiceRole) : null
}

export const pinnedTenantSlug = (): string | null => process.env.SERVICE_TENANT_SLUG || null

// Host classes (appFromHost) per role; null is the store host and its custom domains.
const ROLE_APPS: Record<ServiceRole, readonly (HostApp | null)[]> = {
  storefront: [null, 'vault', 'forms'],
  admin: ['admin'],
  business: ['business'],
}

const CONTROL_PLANE = /^\/(ecom|api\/ecom|api\/admin\/ecom|api\/internal|api\/cron\/fanout)(\/|$)/
const STORE_CRON_PATHS = new Set(CRON_JOBS.filter(j => j.tenantScope !== null).map(j => j.path))
const PROBES = new Set(['/healthz', '/api/health', '/api/ready'])

export const isControlPlanePath = (path: string) => CONTROL_PLANE.test(path)

/** Calls inside the cluster (cron fan-out to {slug}-admin-service.…svc) address the pod's own store. */
export function pinnedHost(host: string): string {
  const slug = pinnedTenantSlug()
  return slug && /\.svc(\.cluster\.local)?(:\d+)?$/.test(host) ? storeHostForSlug(slug) : host
}

/** Whether this pod answers the request: true everywhere when no role is set. */
export function servesRequest(role: ServiceRole | null, req: { app: HostApp | null; path: string; tenantSlug: string | null }): boolean {
  if (!role) return true
  if (PROBES.has(req.path)) return true
  if (isControlPlanePath(req.path)) return false
  const pinned = pinnedTenantSlug()
  if (pinned && req.tenantSlug !== pinned) return false
  // The store's crons run on its admin service, called with the store host.
  if (role === 'admin' && req.app === null && STORE_CRON_PATHS.has(req.path)) return true
  return ROLE_APPS[role].includes(req.app)
}
