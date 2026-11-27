import { queryOne } from '@/lib/shared/db'

// Whether the admin panel also wears the store's published Site Builder theme. Off unless set.
// Read on every admin render, uncached: the API route and the root layout don't share module state, so a cache there
// showed the old look right after the switch.
const KEY = 'admin_uses_site_theme'

export async function adminUsesSiteTheme(): Promise<boolean> {
  const row = await queryOne<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = $1`, [KEY]).catch(() => null)
  return row?.value === 'true'
}

export async function setAdminUsesSiteTheme(on: boolean): Promise<void> {
  await queryOne(
    `INSERT INTO site_settings (key, value, data_type, description, updated_at)
     VALUES ($1, $2, 'boolean', 'Admin panel uses the published Site Builder theme', now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [KEY, on ? 'true' : 'false']
  )
}
