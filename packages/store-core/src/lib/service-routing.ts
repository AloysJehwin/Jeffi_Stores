import { CRON_JOBS } from '@/lib/shared/cron-jobs'
import { storeHostForSlug } from '@/lib/tenancy/forms-host'
import { appFromHost } from '@/lib/tenant-registry/host-resolution'

// Which Next app answers a request. One table for the request gate (each app 404s what isn't its own),
// the local dev router (scripts/dev-router.ts) and the Traefik routes the tenant renderer writes.
//   controller  control plane: ecom console, certificate portal, platform admin pages, provisioning, platform crons
//   storefront  the store's site and every store /api route (admin and business UIs call them on their own host)
//   admin       the admin panel, /api/admin and the store's crons
//   business    the B2B portal's pages

export type AppName = 'controller' | 'storefront' | 'admin' | 'business'
export type ServiceRole = Exclude<AppName, 'controller'>
export const STORE_ROLES: readonly ServiceRole[] = ['storefront', 'admin', 'business']

/** The app this process is, baked in by its next.config (env JEFFI_APP); null in tests and scripts. */
export function currentApp(): AppName | null {
  const a = process.env.JEFFI_APP
  return a === 'controller' || a === 'storefront' || a === 'admin' || a === 'business' ? a : null
}

/** A store's pods are pinned to it (SERVICE_TENANT_SLUG); the platform's pods are not. */
export const pinnedTenantSlug = (): string | null => process.env.SERVICE_TENANT_SLUG || null

/** Calls inside the cluster (cron fan-out to {slug}-admin-service.…svc) address the pod's own store. */
export function pinnedHost(host: string): string {
  const slug = pinnedTenantSlug()
  return slug && /\.svc(\.cluster\.local)?(:\d+)?$/.test(host) ? storeHostForSlug(slug) : host
}

/** Prefix the controller's pages load their assets under, so they share a host with admin's. */
export const CONTROLLER_ASSET_PREFIX = '/_controller'

const STORE_CRON_PATHS = new Set(CRON_JOBS.filter(j => j.tenantScope !== null).map(j => j.path))
const PLATFORM_WEBHOOKS = ['/api/webhooks/ses-inbound', '/api/webhooks/aws-messaging', '/api/webhooks/twilio']
// Platform admin pages, served at the admin host's root (admin.x/ecom → /admin/ecom).
const PLATFORM_ADMIN_PAGES = ['/ecom', '/settings/ai-pricing', '/settings/compute-pricing']

// public/ files (images, fonts, the on-device model, the PWA manifest) live in the storefront only;
// every host's pages load them from there.
const STATIC_FILE_RE = /\.(?:png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|pdf|mjs|wasm|onnx)$/i
const STATIC_PREFIXES = ['/images', '/screenshots', '/icon', '/ort', '/models']

const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + '/')
const firstLabel = (host: string) => host.toLowerCase().split(':')[0].split('.')[0]

export function routeFor(host: string, path: string): AppName {
  if (under(path, CONTROLLER_ASSET_PREFIX)) return 'controller'

  if (path.startsWith('/api/')) {
    if (path.startsWith('/api/admin/ecom')) return 'controller'
    if (path.startsWith('/api/admin')) return 'admin'
    if (['/api/ecom', '/api/internal', '/api/certportal'].some(p => under(path, p))) return 'controller'
    if (path === '/api/webhooks/razorpay' || PLATFORM_WEBHOOKS.some(p => under(path, p))) return 'controller'
    if (under(path, '/api/cron')) return STORE_CRON_PATHS.has(path) ? 'admin' : 'controller'
    return 'storefront'
  }
  // /_next/ is each app's own build output; it stays with the app serving the host's pages.
  const isPublicFile = path === '/manifest.webmanifest' || STATIC_PREFIXES.some(p => under(path, p)) || STATIC_FILE_RE.test(path)
  if (isPublicFile && !path.startsWith('/_next/')) return 'storefront'

  const label = firstLabel(host)
  if (label === 'ecom' || label === 'certificate') return under(path, '/legal') ? 'storefront' : 'controller'
  const app = appFromHost(host)
  if (app === 'admin') return label === 'admin' && PLATFORM_ADMIN_PAGES.some(p => under(path, p)) ? 'controller' : 'admin'
  if (app === 'business') return 'business'

  if (under(path, '/admin/ecom') || PLATFORM_ADMIN_PAGES.slice(1).some(p => under(path, '/admin' + p))) return 'controller'
  if (under(path, '/admin')) return 'admin'
  if (under(path, '/business')) return 'business'
  if (under(path, '/ecom') || under(path, '/certportal')) return 'controller'
  return 'storefront'
}

const PROBES = new Set(['/healthz', '/api/health', '/api/ready'])

/** Whether this process answers the request: everything when it isn't one of the apps (tests, scripts). */
export function servesRequest(app: AppName | null, req: { host: string; path: string; tenantSlug: string | null }): boolean {
  if (!app || PROBES.has(req.path)) return true
  const pinned = pinnedTenantSlug()
  if (pinned && req.tenantSlug !== pinned) return false
  return routeFor(req.host, req.path) === app
}
