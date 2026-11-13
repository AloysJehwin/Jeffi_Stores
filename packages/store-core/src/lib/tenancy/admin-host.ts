// Which app a store's host addresses, for hosts on a domain bought through the platform. Pure (no DB), so the
// routing table and the k8s renderer use it too.
//   admin-{slug}.<root>, invoice-{slug}.<root>, …   every store, under the platform root
//   admin.<bought domain>, invoice.<bought domain>, … the same apps on a store's own domain. Owners can't add a
//                             host with one of these first labels themselves (addCustomDomain reserves them), so
//                             only the purchase job creates one, and an unknown one resolves to no store (404).

export const CUSTOM_HOST_APPS = ['admin', 'invoice', 'quotation', 'purchaseorder', 'forms', 'business', 'vault'] as const
export type CustomHostApp = (typeof CUSTOM_HOST_APPS)[number]

const ROOT = () => process.env.PLATFORM_ROOT_DOMAIN || 'jeffistores.in'
const norm = (h: string) => h.toLowerCase().split(':')[0].trim()
const rootFor = (host: string) => (host === 'localhost' || host.endsWith('.localhost') ? 'localhost' : ROOT())
const isLocal = (h: string) => h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '127.0.0.1' || h === '::1' || h === '[::1]'

/** The app of <app>.<a store's own domain>; null for the platform's hosts and for any other host. */
export function customHostApp(hostname: string): CustomHostApp | null {
  const host = norm(hostname)
  const root = rootFor(host)
  if (!host || isLocal(host) || host === root || host.endsWith('.' + root)) return null
  const parts = host.split('.')
  if (parts.length < 3 || parts.some(p => !p)) return null
  return (CUSTOM_HOST_APPS as readonly string[]).includes(parts[0]) ? (parts[0] as CustomHostApp) : null
}

/** admin.<a store's own domain>, never a platform host. */
export const isCustomAdminHost = (hostname: string) => customHostApp(hostname) === 'admin'

/** A store's admin host (as opposed to the platform's admin.<root>). */
export function isTenantAdminHost(hostname: string): boolean {
  const host = norm(hostname)
  const root = rootFor(host)
  if (host.endsWith('.' + root)) return /^admin-[^.]+\./.test(host)
  return isCustomAdminHost(host)
}
