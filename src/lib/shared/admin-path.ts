/**
 * On an admin host (admin. and the per-tenant admin-{slug}.) the app is served at the
 * root, so pages live at /dashboard, /products, etc. — not /admin/dashboard.
 *
 * In server components use getHost() to read the correct public hostname:
 *   import { getHost } from '@/lib/tenancy/get-host'
 *   const host = await getHost()
 *   ap('/admin/products', host)
 */

export function ap(path: string, host?: string): string {
  const h = host ?? (typeof window !== 'undefined' ? window.location.hostname : '')
  if (h.startsWith('admin.') || h.startsWith('admin-')) {
    return path.replace(/^\/admin/, '') || '/'
  }
  return path
}
