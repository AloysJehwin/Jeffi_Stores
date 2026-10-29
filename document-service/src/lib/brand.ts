import { currentTenant, queryMany } from '@jeffi/tenancy'
import { getStoreIdentity } from './site-controls'

export const PLATFORM_DOMAIN = process.env.PLATFORM_DOMAIN || 'jeffistores.in'
const BUSINESS_HOST_PLANS = ['pro', 'enterprise']

export const platformBrandName = () => process.env.PLATFORM_BRAND_NAME || 'Jeffi Stores'
export const tenantNoReplyAddress = (slug: string) => `noreply-${slug}@${PLATFORM_DOMAIN}`

export async function currentBrandNameAsync(): Promise<string> {
  const t = currentTenant()
  if (t?.displayName?.trim()) return t.displayName.trim()
  const id = await getStoreIdentity().catch(() => null)
  return id?.name || (t ? `${t.slug} Store` : platformBrandName())
}

export async function customerMailFromAsync(): Promise<string> {
  const t = currentTenant()
  if (t?.slug) return `"${t.displayName?.trim() || `${t.slug} Store`}" <${tenantNoReplyAddress(t.slug)}>`
  return `"${platformBrandName()}" <${process.env.SES_FROM_EMAIL || `noreply@${PLATFORM_DOMAIN}`}>`
}

export async function storeBaseUrlAsync(): Promise<string> {
  const t = currentTenant()
  return t?.slug ? `https://${t.slug}.${PLATFORM_DOMAIN}` : process.env.APP_URL || `https://${PLATFORM_DOMAIN}`
}

export async function businessBaseUrlAsync(): Promise<string> {
  const t = currentTenant()
  if (!t?.slug) return `${await storeBaseUrlAsync()}/business`
  if (t.plan && BUSINESS_HOST_PLANS.includes(t.plan)) return `https://${t.slug}.business.${PLATFORM_DOMAIN}`
  return `https://${t.slug}.${PLATFORM_DOMAIN}/business`
}

export async function currentAdminBaseUrlAsync(): Promise<string> {
  const t = currentTenant()
  return t?.slug ? `https://admin-${t.slug}.${PLATFORM_DOMAIN}` : process.env.ADMIN_BASE_URL || `https://admin.${PLATFORM_DOMAIN}`
}

/** The store's email accent colour for outgoing mail. */
export async function storeMailTheme(): Promise<{ accent: string }> {
  try {
    const id = await getStoreIdentity()
    return { accent: id.emailAccent ?? '' }
  } catch {
    return { accent: '' }
  }
}

export async function storeContactLine(): Promise<string> {
  try {
    const id = await getStoreIdentity()
    return [id.phone?.trim(), id.email?.trim()].filter(Boolean).join(' | ')
  } catch {
    return ''
  }
}

export async function storeAddressLine(): Promise<string> {
  const rows = await queryMany<{ value: string }>(`SELECT value FROM site_settings WHERE key = 'business_address'`).catch(() => [])
  return rows[0]?.value?.trim() || ''
}

export async function storeOrigin(): Promise<{ city: string; state: string }> {
  try {
    const rows = await queryMany<{ key: string; value: string }>(`SELECT key, value FROM site_settings WHERE key IN ('business_city', 'business_state')`)
    const m = Object.fromEntries((rows || []).map(r => [r.key, (r.value || '').trim()]))
    return { city: m.business_city || '', state: m.business_state || '' }
  } catch {
    return { city: '', state: '' }
  }
}
