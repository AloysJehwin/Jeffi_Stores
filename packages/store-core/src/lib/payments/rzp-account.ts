import 'server-only'
import { resolveRequestTenant } from '@/lib/shared/db'
import { resolveRazorpayCreds } from '@/lib/integrations/resolve'
import { controlPlanePool } from '@/lib/tenant-registry'
import { isFlagship } from '@/lib/payments/webhook-tenant'

/**
 * Which Razorpay account collects this store's payments:
 *  - platform: the flagship, on the platform account (its settlements include other stores' sales)
 *  - own: a store with its own account and keys (its own settlements)
 *  - route: a store paid through the platform account; it gets Route payouts, not settlements
 */
export type RazorpayAccountKind = 'platform' | 'own' | 'route'

export interface RazorpayAccount {
  kind: RazorpayAccountKind
  tenantId: string | null
  slug: string | null
  /** Marked to collect on its own account; kind is 'own' only once its keys are set too. */
  ownFlag: boolean
}

/** What the account card shows (GET /api/admin/integrations/razorpay). */
export interface RazorpayAccountInfo {
  kind: 'platform' | 'own' | 'route'
  ownFlag: boolean
  editable: boolean
  keyId: string | null
  mode: 'live' | 'test' | null
  webhookSecretSet: boolean
  webhookUrl: string | null
  events: string[]
  lastWebhookAt: string | null
}

export async function razorpayAccountFor(): Promise<RazorpayAccount> {
  const t = await resolveRequestTenant()
  if (!t || isFlagship({ tenantId: t.tenantId })) return { kind: 'platform', tenantId: null, slug: null, ownFlag: false }
  const row = await controlPlanePool()
    .query(`SELECT own_razorpay FROM tenants WHERE id = $1`, [t.tenantId])
    .catch(() => null)
  const ownFlag = row?.rows[0]?.own_razorpay === true
  const { isOwn } = await resolveRazorpayCreds(t.tenantId).catch(() => ({ isOwn: false }))
  return { kind: ownFlag && isOwn ? 'own' : 'route', tenantId: t.tenantId, slug: t.slug ?? null, ownFlag }
}
