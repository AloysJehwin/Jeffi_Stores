import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'
import { lookupTenantContextById } from '@/lib/tenant-registry/host-resolution'
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

async function toWebhookTenant(tenantId: string): Promise<WebhookTenant | null> {
  // The flagship (platform) store has no dedicated infra row, so lookupTenantContextById returns
  // null for it — that's correct, it runs on the default pool with no tenant context.
  const NIL = '00000000-0000-0000-0000-000000000000'
  if (tenantId === NIL) return { tenantId, slug: 'platform', ctx: null }
  const ctx = await lookupTenantContextById(tenantId).catch(() => null)
  if (!ctx) return null
  return { tenantId, slug: ctx.slug, ctx }
}

/** Run a handler body inside the tenant's DB context (or the default pool for the flagship). */
export function runInTenant<T>(t: WebhookTenant, fn: () => Promise<T>): Promise<T> {
  return t.ctx ? runWithTenantContext(t.ctx, fn) : fn()
}
