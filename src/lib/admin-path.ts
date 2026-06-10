/**
 * On admin.jeffistores.in the app is served at the root, so pages live at
 * /dashboard, /products, /orders, etc. — not at /admin/dashboard etc.
 * This helper strips the /admin prefix when running on the subdomain.
 *
 * In server components, pass the host header explicitly:
 *   import { headers } from 'next/headers'
 *   const host = (await headers()).get('host') ?? ''
 *   ap('/admin/products', host)
 */
export function ap(path: string, host?: string): string {
  const h = host ?? (typeof window !== 'undefined' ? window.location.hostname : '')
  if (h.startsWith('admin.')) {
    return path.replace(/^\/admin/, '') || '/'
  }
  return path
}
