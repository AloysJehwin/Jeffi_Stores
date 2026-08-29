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
  return t?.displayName || t?.slug || platformBrandName()
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

/** `From` for operator-facing mail (admin alerts). Always the platform, never a tenant. */
export function adminMailFrom(): string {
  const addr = process.env.SES_ADMIN_FROM_EMAIL || process.env.SES_FROM_EMAIL || `noreply@${PLATFORM_DOMAIN}`
  return `"${platformBrandName()}" <${addr}>`
}
