/**
 * On business.jeffistores.in the app is served at the root, so pages live at
 * /signin, /signup, /products, etc. — not at /business/signin etc.
 * This helper strips the /business prefix when running on the subdomain.
 *
 * In server components, pass the host header explicitly:
 *   import { headers } from 'next/headers'
 *   const host = (await headers()).get('host') ?? ''
 *   bp('/business/products', host)
 */
export function bp(path: string, host?: string): string {
  const h = host ?? (typeof window !== 'undefined' ? window.location.hostname : '')
  if (h.startsWith('business.')) {
    return path.replace(/^\/business/, '') || '/'
  }
  return path
}
