import { queryOne } from '@/lib/shared/db'
import { tenantCacheKey } from '@/lib/catalog/site-controls'

// Whether the admin panel also wears the store's published Site Builder theme. Off unless set.
const KEY = 'admin_uses_site_theme'
const TTL_MS = 15_000
const cache = new Map<string, { at: number; value: boolean }>()

export async function adminUsesSiteTheme(): Promise<boolean> {
  const k = await tenantCacheKey()
  const hit = cache.get(k)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  const row = await queryOne<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = $1`, [KEY]).catch(() => null)
  const value = row?.value === 'true'
  cache.set(k, { at: Date.now(), value })
  return value
}

export async function setAdminUsesSiteTheme(on: boolean): Promise<void> {
  await queryOne(
    `INSERT INTO site_settings (key, value, data_type, description, updated_at)
     VALUES ($1, $2, 'boolean', 'Admin panel uses the published Site Builder theme', now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [KEY, on ? 'true' : 'false']
  )
  cache.clear()
}
