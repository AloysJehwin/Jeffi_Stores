import { CRON_JOBS } from '@/lib/shared/cron-jobs'
import { storeHostForSlug } from '@/lib/tenancy/forms-host'
import { appFromHost } from '@/lib/tenant-registry/host-resolution'

// Which Next app answers a request. One ordered table (ROUTES) is the request gate (each app 404s what
// isn't its own), the local dev router (scripts/dev-router.ts) and, through lib/k8s/traefik-routes.ts,
// the ingress: the platform's routes and the ones the tenant renderer writes.
//   controller  control plane: ecom console, certificate portal, platform admin pages, provisioning, platform crons
//   storefront  the store's site, every store /api route (admin and business UIs call them on their own host),
//               public/ files and the image optimizer
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

/**
 * Where each app other than the storefront loads its build output (next.config assetPrefix), so any app's
 * pages can share any host: /_next/ is always the storefront's. The ingress and the dev router strip it.
 */
export const ASSET_PREFIX: Record<Exclude<AppName, 'storefront'>, string> = {
  controller: '/_controller',
  admin: '/_admin',
  business: '/_business',
}

// Host classes a rule applies to. `store` is every host that isn't one of the others: the store's own,
// www, vault-, forms-, custom domains.
export type HostClass = 'any' | 'console' | 'platform-admin' | 'admin' | 'business' | 'store'

export type PathMatch =
  | { prefix: string } // path.startsWith
  | { under: string } // the path or below it
  | { exact: string }
  | { pattern: RegExp } // anchored, no lookaround: the ingress uses it as-is (Go RE2)

export interface RouteRule {
  hosts: HostClass
  paths?: PathMatch[] // any of them; none = every path
  app: AppName
  strip?: string // prefix the ingress removes before the app sees the path
}

const STORE_CRON_PATHS = CRON_JOBS.filter(j => j.tenantScope !== null && j.path.startsWith('/api/cron/')).map(j => j.path)
const PLATFORM_WEBHOOKS = ['/api/webhooks/ses-inbound', '/api/webhooks/aws-messaging', '/api/webhooks/twilio']
// Platform admin pages, served at the admin host's root (admin.x/ecom → /admin/ecom).
const PLATFORM_ADMIN_PAGES = ['/ecom', '/settings/ai-pricing', '/settings/compute-pricing']
// public/ files (images, fonts, the on-device model, the PWA manifest) live in the storefront only.
const STATIC_FILE_RE = /\.(?:png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|pdf|mjs|wasm|onnx)$/i
const STATIC_PREFIXES = ['/images', '/screenshots', '/icon', '/ort', '/models']

const under = (...ps: string[]): PathMatch[] => ps.map(p => ({ under: p }))

/** First match wins; the ingress turns the order into router priorities. */
export const ROUTES: readonly RouteRule[] = [
  ...(['controller', 'admin', 'business'] as const).map(app => ({ hosts: 'any' as const, paths: under(ASSET_PREFIX[app]), app, strip: ASSET_PREFIX[app] })),
  { hosts: 'any', paths: [{ prefix: '/_next/' }], app: 'storefront' },
  { hosts: 'any', paths: [{ prefix: '/api/admin/ecom' }], app: 'controller' },
  { hosts: 'any', paths: [{ prefix: '/api/admin' }], app: 'admin' },
  { hosts: 'any', paths: [...under('/api/ecom', '/api/internal', '/api/certportal', ...PLATFORM_WEBHOOKS), { exact: '/api/webhooks/razorpay' }], app: 'controller' },
  { hosts: 'any', paths: STORE_CRON_PATHS.map(exact => ({ exact })), app: 'admin' },
  { hosts: 'any', paths: under('/api/cron'), app: 'controller' },
  { hosts: 'any', paths: [{ prefix: '/api/' }], app: 'storefront' },
  { hosts: 'any', paths: [{ exact: '/manifest.webmanifest' }, ...under(...STATIC_PREFIXES), { pattern: STATIC_FILE_RE }], app: 'storefront' },
  { hosts: 'console', paths: under('/legal'), app: 'storefront' },
  { hosts: 'console', app: 'controller' },
  { hosts: 'platform-admin', paths: under(...PLATFORM_ADMIN_PAGES), app: 'controller' },
  { hosts: 'admin', app: 'admin' },
  { hosts: 'business', app: 'business' },
  { hosts: 'store', paths: under('/admin/ecom', ...PLATFORM_ADMIN_PAGES.slice(1).map(p => '/admin' + p)), app: 'controller' },
  { hosts: 'store', paths: under('/admin'), app: 'admin' },
  { hosts: 'store', paths: under('/business'), app: 'business' },
  { hosts: 'store', paths: under('/ecom', '/certportal'), app: 'controller' },
  { hosts: 'store', app: 'storefront' },
]

const firstLabel = (host: string) => host.toLowerCase().split(':')[0].split('.')[0]

/** The classes a host belongs to (besides `any`). */
export function hostClasses(host: string): HostClass[] {
  const label = firstLabel(host)
  if (label === 'ecom' || label === 'certificate') return ['console']
  const app = appFromHost(host)
  if (app === 'admin') return label === 'admin' ? ['platform-admin', 'admin'] : ['admin']
  if (app === 'business') return ['business']
  return ['store']
}

export function pathMatches(m: PathMatch, path: string): boolean {
  if ('prefix' in m) return path.startsWith(m.prefix)
  if ('under' in m) return path === m.under || path.startsWith(m.under + '/')
  if ('exact' in m) return path === m.exact
  return m.pattern.test(path)
}

export function routeFor(host: string, path: string): AppName {
  const classes = hostClasses(host)
  const rule = ROUTES.find(r => (r.hosts === 'any' || classes.includes(r.hosts)) && (!r.paths || r.paths.some(m => pathMatches(m, path))))
  return rule!.app
}

const PROBES = new Set(['/healthz', '/api/health', '/api/ready'])

/** Whether this process answers the request: everything when it isn't one of the apps (tests, scripts). */
export function servesRequest(app: AppName | null, req: { host: string; path: string; tenantSlug: string | null }): boolean {
  if (!app || PROBES.has(req.path)) return true
  const pinned = pinnedTenantSlug()
  if (pinned && req.tenantSlug !== pinned) return false
  return routeFor(req.host, req.path) === app
}
