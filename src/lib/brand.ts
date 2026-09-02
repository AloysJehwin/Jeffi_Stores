/**
 * Brand identity and mail senders, resolved from configuration rather than hardcoded.
 *
 * The store name and sender address were written literally in ~70 files ("Jeffi Stores",
 * `"Jeffi Store's" <${SES_FROM_EMAIL}>`), which is wrong twice over: the platform's own name
 * cannot be changed without a code edit, and a tenant store sends mail signed with the
 * platform's name from the platform's address.
 *
 * `getCurrentTenant()` returns the tenant for the request when one is in scope (middleware sets
 * it per host), so these helpers give the tenant's identity on a tenant host and the platform's
 * everywhere else, without callers having to know which they are in.
 */

import { getCurrentTenant } from './tenant-context'

const PLATFORM_DOMAIN = process.env.PLATFORM_DOMAIN || 'jeffistores.in'

/** The platform's own name. Configurable so a rebrand is not a code change. */
export function platformBrandName(): string {
  return process.env.PLATFORM_BRAND_NAME || 'Jeffi Stores'
}

/** Administrative mailbox — notifications for the operator, never a personal address. */
export function platformAdminEmail(): string {
  return process.env.ADMIN_EMAIL || `admin@${PLATFORM_DOMAIN}`
}

/** Sending address for a tenant's own customer mail. Domain identity covers every address. */
export function tenantNoReplyAddress(slug: string): string {
  return `noreply-${slug}@${PLATFORM_DOMAIN}`
}

export function tenantCampaignAddress(slug: string): string {
  return `campaigns-${slug}@${PLATFORM_DOMAIN}`
}

/**
 * Display name for whichever store the current request belongs to: the tenant's own name on a
 * tenant host, the platform's otherwise.
 */
export function currentBrandName(): string {
  const t = getCurrentTenant()
  if (t?.displayName?.trim()) return t.displayName.trim()
  return t?.slug ? `${t.slug} Store` : platformBrandName()
}

/**
 * Admin URL for whichever store the current request belongs to. A tenant's mail linked to
 * admin.jeffistores.in — the platform's own panel, which their certificate cannot open.
 */
export function currentAdminBaseUrl(): string {
  const t = getCurrentTenant()
  if (t?.slug) return `https://admin-${t.slug}.${PLATFORM_DOMAIN}`
  return process.env.ADMIN_BASE_URL || `https://admin.${PLATFORM_DOMAIN}`
}

/** Storefront URL for the current store. */
export function currentStoreUrl(): string {
  const t = getCurrentTenant()
  if (t?.slug) return `https://${t.slug}.${PLATFORM_DOMAIN}`
  return process.env.APP_URL || `https://${PLATFORM_DOMAIN}`
}

/**
 * Storefront base URL, resolved even before the first DB query (via the x-tenant-slug header) —
 * the one to prefer in mail/notification builders, which run before any tenant-scoped query and
 * would otherwise capture the platform host. Falls back to the platform APP_URL off-tenant.
 */
export async function storeBaseUrlAsync(): Promise<string> {
  const t = await resolveCurrentTenant()
  if (t?.slug) return `https://${t.slug}.${PLATFORM_DOMAIN}`
  return process.env.APP_URL || `https://${PLATFORM_DOMAIN}`
}

/**
 * `From` header for customer-facing mail.
 *
 * On a tenant host this is the tenant's name and its own noreply- address, so a buyer sees the
 * store they bought from rather than the platform they have never heard of. Falls back to the
 * platform sender off-tenant, or when a tenant somehow has no slug.
 */
export function customerMailFrom(): string {
  const t = getCurrentTenant()
  if (t?.slug) {
    // A bare slug ("acme") reads like a mistake in an inbox, so fall back to "{slug} Store".
    const name = t.displayName?.trim() || `${t.slug} Store`
    return `"${name}" <${tenantNoReplyAddress(t.slug)}>`
  }
  return `"${platformBrandName()}" <${process.env.SES_FROM_EMAIL || `noreply@${PLATFORM_DOMAIN}`}>`
}

/**
 * Async form of the sender, and the one to prefer. currentBrandName/customerMailFrom read the
 * tenant from AsyncLocalStorage, which db.ts establishes lazily on the first query — so on a
 * path that has not queried yet they silently return the platform's name and noreply address.
 * This falls back to the x-tenant-slug header middleware sets, the same fix identityDefaults
 * needed.
 */
export async function resolveCurrentTenant(): Promise<{ slug: string; displayName: string | null } | null> {
  const t = getCurrentTenant()
  if (t?.slug) return { slug: t.slug, displayName: t.displayName ?? null }
  try {
    const { headers } = await import('next/headers')
    const slug = (await headers()).get('x-tenant-slug')
    if (!slug) return null
    const { lookupTenantContextBySlug } = await import('./tenant-registry')
    const ctx = await lookupTenantContextBySlug(slug)
    return ctx ? { slug: ctx.slug, displayName: ctx.displayName ?? null } : { slug, displayName: null }
  } catch {
    return null
  }
}

/** `From` for customer mail, resolved even when the ALS context is not yet established. */
export async function customerMailFromAsync(): Promise<string> {
  const t = await resolveCurrentTenant()
  if (t?.slug) {
    const name = t.displayName?.trim() || `${t.slug} Store`
    return `"${name}" <${tenantNoReplyAddress(t.slug)}>`
  }
  return `"${platformBrandName()}" <${process.env.SES_FROM_EMAIL || `noreply@${PLATFORM_DOMAIN}`}>`
}

/** Store name for mail bodies, resolved the same way. */
export async function currentBrandNameAsync(): Promise<string> {
  const t = await resolveCurrentTenant()
  if (t?.displayName?.trim()) return t.displayName.trim()
  return t?.slug ? `${t.slug} Store` : platformBrandName()
}

/**
 * `From` for marketing/campaign mail, resolved even before the first query. On a tenant host this
 * is the tenant's name and its own campaigns- address; off-tenant it is the platform's promo
 * sender. Keeps campaign mail from a tenant signed as that tenant, not the platform.
 */
export async function campaignMailFromAsync(): Promise<string> {
  const t = await resolveCurrentTenant()
  if (t?.slug) {
    const name = t.displayName?.trim() || `${t.slug} Store`
    return `"${name}" <${tenantCampaignAddress(t.slug)}>`
  }
  const addr = process.env.SES_PROMO_FROM_EMAIL || process.env.SES_FROM_EMAIL || `noreply@${PLATFORM_DOMAIN}`
  return `"${platformBrandName()}" <${addr}>`
}

/**
 * Contact line for a mail footer. A tenant's customers were shown the platform's phone and
 * mailbox; a tenant that has set neither gets an empty line rather than someone else's, which
 * is the same choice identityDefaults makes.
 */
export async function storeContactLine(): Promise<string> {
  try {
    const { getStoreIdentity } = await import('./site-controls')
    const id = await getStoreIdentity()
    const parts = [id.phone?.trim(), id.email?.trim()].filter(Boolean)
    return parts.join(' | ')
  } catch {
    return ''
  }
}

/**
 * Physical address for a mail footer. A tenant's customers were shown the platform's Raipur
 * address baked into the template; a tenant that has set none gets an empty string rather than
 * the platform's, the same choice storeContactLine makes.
 */
export async function storeAddressLine(): Promise<string> {
  try {
    const { queryMany } = await import('./db')
    const rows = await queryMany<{ value: string }>(
      `SELECT value FROM site_settings WHERE key = 'business_address'`
    )
    return rows[0]?.value?.trim() || ''
  } catch {
    return ''
  }
}

/**
 * A one-line store descriptor for AI system prompts. Replaces the hardcoded
 * "Jeffi Stores, an Indian hardware & tools store" that leaked the flagship's niche into
 * every tenant's AI output. Uses the tenant's own name and, when set, its onboarding
 * tagline/about as the niche. There is no niche field — metaTagline/aboutCopy are the
 * tenant's self-description and are tenantScoped-guarded (empty until the owner sets them).
 * Degrades to a neutral "an online store" when nothing resolves, so no context (cron, empty
 * tenant) ever falls back to the flagship pitch.
 */
export async function storeDescriptorForPrompt(): Promise<string> {
  const brand = await currentBrandNameAsync()
  try {
    const { getStorefrontContent } = await import('./site-controls')
    const c = await getStorefrontContent()
    const tagline = c.metaTagline?.trim()
    const about = c.aboutCopy?.trim()
    if (tagline) {
      const suffix = about ? ` ${about.slice(0, 240)}` : ''
      return `${brand} — ${tagline}.${suffix}`.trim()
    }
    if (about) return `${brand}, an online store. ${about.slice(0, 240)}`.trim()
  } catch {
    // fall through to the neutral descriptor
  }
  return `${brand}, an online store`
}

/** `From` for operator-facing mail (admin alerts). Always the platform, never a tenant. */
export function adminMailFrom(): string {
  const addr = process.env.SES_ADMIN_FROM_EMAIL || process.env.SES_FROM_EMAIL || `noreply@${PLATFORM_DOMAIN}`
  return `"${platformBrandName()}" <${addr}>`
}

/**
 * The store's own name and web address for customer-facing output (SMS, WhatsApp, PDFs).
 * Prefers the store's configured identity, so a tenant that set a business name gets it.
 * Imported lazily to keep this module free of a site-controls → db import cycle.
 */
export async function storeSignature(): Promise<{ name: string; web: string }> {
  try {
    const { getStoreIdentity } = await import('./site-controls')
    const id = await getStoreIdentity()
    return {
      name: id.name?.trim() || currentBrandName(),
      web: id.web?.trim() || PLATFORM_DOMAIN,
    }
  } catch {
    return { name: currentBrandName(), web: PLATFORM_DOMAIN }
  }
}
