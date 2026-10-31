import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'
import { lookupTenantContextById, lookupTenantContextBySlug } from '@/lib/tenant-registry/host-resolution'
import { runWithTenantContext, type TenantContext } from '@/lib/tenancy/tenant-context'

/**
 * Tenant routing for the customer Razorpay webhook.
 *
 * The webhook hits one fixed platform URL with no host, so getCurrentTenant() is empty and the
 * raw db helpers fall back to the PLATFORM pool. Any handler that reads/writes per-tenant tables
 * (orders, payments, subscriptions, vault_entitlements) must therefore resolve the tenant and run
 * inside runWithTenantContext, or it silently hits the wrong database.
 *
 * For platform-collect subscriptions the event carries notes.tenant_id, but notes are
 * client-influenceable, so we verify the claimed subscription id against the authoritative
 * control-plane razorpay_subscription_index before trusting it.
 */

export interface WebhookTenant {
  tenantId: string
  slug: string
  /** The resolved context to run inside, or null for the flagship store (default pool). */
  ctx: TenantContext | null
}

/**
 * Resolve + verify the tenant for a Razorpay SUBSCRIPTION event. Looks the subscription id up in
 * the control-plane index (authoritative); only if absent there does it fall back to notes, and
 * even then it cross-checks notes.tenant_id against the index when both exist. Returns null when
 * the subscription is unknown (then the caller should ack-and-drop, as today).
 */
export async function resolveSubscriptionTenant(subscriptionEntity: any): Promise<WebhookTenant | null> {
  const subId = (subscriptionEntity?.id ?? '').toString().trim()
  if (!subId) return null

  const pool = controlPlanePool()
  // Do NOT swallow a control-plane error here. If the index is briefly unreachable we must let the
  // caller retry (map to a 5xx), not silently fall back to the client-supplied notes — that would
  // let a forged notes.tenant_id route an event into the wrong tenant DB during an outage.
  const idx = await pool.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM razorpay_subscription_index WHERE razorpay_subscription_id = $1 LIMIT 1`,
    [subId]
  )

  const indexedTenantId = idx.rows[0]?.tenant_id ?? null
  const noteTenantId = (subscriptionEntity?.notes?.tenant_id ?? '').toString().trim() || null

  // This is the PLATFORM endpoint: every legitimate platform-collect subscription has an index row
  // (own-key tenants are verified by their own secret on /webhooks/razorpay/[tenant], not here). An
  // event with no index row is unknown → ack-and-drop. Notes are only ever a disagreement check,
  // never a source of truth.
  if (!indexedTenantId) return null
  if (noteTenantId && indexedTenantId !== noteTenantId) return null // forged/mismatched notes → refuse

  return toWebhookTenant(indexedTenantId)
}

/** A store named by our own server-set notes (payouts, orders we created). Null = unknown store. */
export function scopeForTenantId(tenantId: string | null | undefined): Promise<WebhookTenant | null> {
  const id = (tenantId ?? '').toString().trim()
  return id ? toWebhookTenant(id) : Promise.resolve(null)
}

const NIL = '00000000-0000-0000-0000-000000000000'

/** The platform account's own store: the default pool, no tenant context. */
export function flagshipScope(): WebhookTenant {
  return { tenantId: NIL, slug: 'platform', ctx: null }
}

export const isFlagship = (t: { tenantId: string } | null | undefined) => !t?.tenantId || t.tenantId === NIL

const str = (v: unknown) => (v ?? '').toString().trim()

/** The store notes name: undefined when they name none, null when the store can't be found. */
export async function storeNamedIn(notes: any): Promise<WebhookTenant | null | undefined> {
  const id = str(notes?.tenant_id)
  if (id) return toWebhookTenant(id)
  const slug = str(notes?.tenant_slug)
  if (!slug) return undefined
  const ctx = await lookupTenantContextBySlug(slug).catch(() => null)
  return ctx ? { tenantId: ctx.tenantId, slug: ctx.slug, ctx } : null
}

/** A platform-account read (the webhook has no store context, so never the ALS keys). */
async function platformFetch(fn: (rzp: any) => Promise<any>): Promise<any> {
  try {
    const { getRazorpayInstance } = await import('@/lib/payments/razorpay')
    return await fn(getRazorpayInstance())
  } catch {
    return null
  }
}

/** The store a Razorpay order on the platform account was created for (its notes are ours). */
export async function storeForRazorpayOrder(rzpOrderId: string | null | undefined) {
  if (!rzpOrderId) return undefined
  return storeNamedIn((await platformFetch(rzp => rzp.orders.fetch(rzpOrderId)))?.notes)
}

/**
 * The store a platform-account event belongs to: the entity's notes, then the payment's, then the
 * payment and its order as Razorpay holds them. The flagship when nothing names a store; null when a
 * named store can't be found, so the caller drops the event rather than writing to the flagship DB.
 */
export async function scopeForEntity(entity: any, opts: { paymentId?: string; payment?: any } = {}): Promise<WebhookTenant | null> {
  for (const notes of [entity?.notes, opts.payment?.notes]) {
    const s = await storeNamedIn(notes)
    if (s !== undefined) return s
  }
  if (opts.paymentId) {
    const p = await platformFetch(rzp => rzp.payments.fetch(opts.paymentId))
    let s = await storeNamedIn(p?.notes)
    if (s === undefined) s = await storeForRazorpayOrder(p?.order_id)
    if (s !== undefined) return s
  }
  return flagshipScope()
}

async function toWebhookTenant(tenantId: string): Promise<WebhookTenant | null> {
  // The flagship (platform) store has no dedicated infra row, so lookupTenantContextById returns
  // null for it — that's correct, it runs on the default pool with no tenant context.
  if (tenantId === NIL) return flagshipScope()
  // A control-plane error throws, so the webhook retries instead of dropping the event.
  const ctx = await lookupTenantContextById(tenantId)
  if (!ctx) return null
  return { tenantId, slug: ctx.slug, ctx }
}

/** Run a handler body inside the tenant's DB context (or the default pool for the flagship). */
export function runInTenant<T>(t: WebhookTenant, fn: () => Promise<T>): Promise<T> {
  return t.ctx ? runWithTenantContext(t.ctx, fn) : fn()
}
