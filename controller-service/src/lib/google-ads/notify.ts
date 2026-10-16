import { query, queryMany, queryOne } from '@/lib/shared/db'
import { SUPER_ROLES, hasScope } from '@/lib/auth/scopes'

// Who hears about Google Ads (alerts, weekly digest), where the console lives, and the per-store
// on/off switches kept in site_settings.

export const SETTING = {
  alertRules: 'google_ads_alert_rules',
  alertEmails: 'google_ads_alert_emails',
  digest: 'google_ads_digest_enabled',
  digestPeriod: 'google_ads_digest_last_period',
} as const

/** Active admins who can see Google Ads: owners (their plan carries it, or the job would not run) and staff granted the scope. */
export async function adsRecipients(scope = 'google_ads:read'): Promise<string[]> {
  const rows = await queryMany<{ role: string | null; scopes: unknown; email: string | null }>(
    `SELECT a.role, a.scopes, u.email FROM admins a JOIN users u ON u.id = a.user_id
     WHERE a.is_active = TRUE AND u.is_active IS NOT FALSE AND u.email IS NOT NULL`
  ).catch(() => [])
  const out = new Set<string>()
  for (const r of rows) {
    const role = r.role || ''
    const scopes = Array.isArray(r.scopes) ? (r.scopes as string[]) : []
    const ok = (SUPER_ROLES as readonly string[]).includes(role) || hasScope(role, scopes, scope)
    if (ok && r.email && r.email.includes('@')) out.add(r.email.toLowerCase())
  }
  return [...out]
}

/** The store's admin console link for the Google Ads page (admin hosts serve pages at the root). */
export async function adsConsoleUrl(tab?: string): Promise<string> {
  const { currentAdminBaseUrlAsync } = await import('@/lib/catalog/brand')
  const base = (await currentAdminBaseUrlAsync()).replace(/\/admin\/?$/, '').replace(/\/$/, '')
  return `${base}/google-ads${tab ? `?tab=${tab}` : ''}`
}

export async function readSetting(key: string): Promise<string | null> {
  const row = await queryOne<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = $1`, [key]).catch(() => null)
  return row?.value ?? null
}

export async function writeSettings(values: Record<string, string>): Promise<void> {
  await query(
    `INSERT INTO site_settings (key, value, updated_at)
     SELECT k, v, NOW() FROM UNNEST($1::text[], $2::text[]) AS t(k, v)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [Object.keys(values), Object.values(values)]
  )
}

export const flag = (v: string | null, fallback: boolean) => (v == null ? fallback : v === 'true')
