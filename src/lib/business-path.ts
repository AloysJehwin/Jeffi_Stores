/**
 * On business.jeffistores.in the app is served at the root, so pages live at
 * /signin, /signup, /products, etc. — not at /business/signin etc.
 * This helper strips the /business prefix when running on the subdomain.
 *
 * In server components use getHost() to read the correct public hostname:
 *   import { getHost } from '@/lib/get-host'
 *   const host = await getHost()
 *   bp('/business/products', host)
 */

export function bp(path: string, host?: string): string {
  const h = host ?? (typeof window !== 'undefined' ? window.location.hostname : '')
  if (h.startsWith('business.')) {
    return path.replace(/^\/business/, '') || '/'
  }
  return path
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
