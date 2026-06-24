/**
 * On admin.jeffistores.in the app is served at the root, so pages live at
 * /dashboard, /products, /orders, etc. — not at /admin/dashboard etc.
 * This helper strips the /admin prefix when running on the subdomain.
 *
 * In server components use getHost() to read the correct public hostname:
 *   import { getHost } from '@/lib/get-host'
 *   const host = await getHost()
 *   ap('/admin/products', host)
 */

export function ap(path: string, host?: string): string {
  const h = host ?? (typeof window !== 'undefined' ? window.location.hostname : '')
  if (h.startsWith('admin.')) {
    return path.replace(/^\/admin/, '') || '/'
  }
  return path
}
