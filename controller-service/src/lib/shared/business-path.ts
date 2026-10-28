/**
 * On a business host (business.<root>, and a tenant's {slug}.business.<root>) the app is served
 * at the root, so pages live at /signin, /products, etc. — not at /business/signin.
 * This helper strips the /business prefix there.
 *
 * In server components pass the request host (client components read window.location):
 *   import { getHost } from '@/lib/tenancy/get-host'
 *   bp('/business/products', await getHost())
 */

/** Same hosts appFromHost() calls 'business'; also matches *.localhost in dev. */
export function isBusinessHost(host: string): boolean {
  return /^business[.-]|\.business\./.test(host.toLowerCase())
}

export function bp(path: string, host?: string): string {
  const h = host ?? (typeof window !== 'undefined' ? window.location.hostname : '')
  if (isBusinessHost(h)) {
    const rest = path.replace(/^\/business(?=\/|\?|$)/, '')
    return rest.startsWith('/') ? rest : `/${rest}`
  }
  return path
}

/**
 * Where to go after signing in: a path on this site from ?callbackUrl= / ?redirect=, mapped to
 * this host's portal paths. Anything else (absolute or protocol-relative URLs) falls back.
 */
export function businessReturnPath(target: string | null | undefined, fallback = '/business'): string {
  const safe = target && target.startsWith('/') && !target.startsWith('//') && !target.startsWith('/\\')
  return bp(safe ? target : fallback)
}

/**
 * Returns the absolute base URL for the business portal, for use in emails
 * and server-side contexts where there is no request host available.
 *
 * Prod:  https://business.jeffistores.in  (paths are /products, /orders etc.)
 * Local: http://localhost:3000/business   (paths are /business/products etc.)
 *
 * Usage: `${businessBaseUrl()}/products/some-slug`
 */
export function businessBaseUrl(): string {
  const explicit = process.env.BUSINESS_APP_URL
  if (explicit) return explicit.replace(/\/$/, '')
  const isProd = process.env.NODE_ENV === 'production'
  return isProd ? 'https://business.jeffistores.in' : 'http://localhost:3000/business'
}
