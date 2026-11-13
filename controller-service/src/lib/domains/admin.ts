import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'

// The platform admin's view of every bought domain: status, dates, AWS cost vs what the store paid.

export interface AdminDomainRow {
  id: string
  domain: string
  status: string
  step: string | null
  tenantId: string
  slug: string
  storeName: string | null
  source: string
  autoRenew: boolean
  contactVerified: boolean
  registeredAt: string | null
  expiresAt: string | null
  costUsd: number
  usdInr: number
  margin: number
  priceInr: number
  refundedInr: number | null
  lastError: string | null
  createdAt: string
  renewal: { status: string; termExpiresAt: string; priceInr: number | null; costUsd: number | null; attempts: number; lastError: string | null } | null
  renewedInr: number
  renewedCostUsd: number
}

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null)

export async function listAdminDomains(): Promise<AdminDomainRow[]> {
  const r = await controlPlanePool().query(
    `SELECT o.*, t.slug, t.display_name,
            lr.status AS r_status, lr.term_expires_at AS r_term, lr.price_inr AS r_price, lr.cost_usd AS r_cost, lr.attempts AS r_attempts, lr.last_error AS r_error,
            COALESCE(done.inr, 0) AS renewed_inr, COALESCE(done.usd, 0) AS renewed_usd
       FROM tenant_domain_orders o
       JOIN tenants t ON t.id = o.tenant_id
       LEFT JOIN LATERAL (SELECT * FROM tenant_domain_renewals r WHERE r.order_id = o.id ORDER BY r.term_expires_at DESC LIMIT 1) lr ON true
       LEFT JOIN LATERAL (SELECT SUM(price_inr) AS inr, SUM(cost_usd) AS usd FROM tenant_domain_renewals r WHERE r.order_id = o.id AND r.status = 'done') done ON true
      ORDER BY o.created_at DESC
      LIMIT 2000`
  )
  return r.rows.map(x => ({
    id: x.id,
    domain: x.domain,
    status: x.status,
    step: x.step,
    tenantId: x.tenant_id,
    slug: x.slug,
    storeName: x.display_name,
    source: x.source,
    autoRenew: x.auto_renew,
    contactVerified: x.contact_verified,
    registeredAt: iso(x.registered_at),
    expiresAt: iso(x.expires_at),
    costUsd: Number(x.cost_usd),
    usdInr: Number(x.usd_inr),
    margin: Number(x.margin),
    priceInr: x.price_inr,
    refundedInr: x.refunded_inr,
    lastError: x.last_error,
    createdAt: iso(x.created_at)!,
    renewal: x.r_status
      ? { status: x.r_status, termExpiresAt: iso(x.r_term)!, priceInr: x.r_price, costUsd: x.r_cost == null ? null : Number(x.r_cost), attempts: x.r_attempts, lastError: x.r_error }
      : null,
    renewedInr: Number(x.renewed_inr),
    renewedCostUsd: Number(x.renewed_usd),
  }))
}
