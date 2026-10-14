import 'server-only'
import { randomUUID } from 'crypto'
import { query, queryOne } from '@/lib/shared/db'
import { getStoreIdentity } from '@/lib/catalog/site-controls'
import { controlPlanePool } from '@/lib/tenant-registry'
import { INTERVAL_SPEC } from './intervals'
import { deriveSubscriptionOffer, snapshotAddress, type OfferInput } from './offer'
import { getOrCreatePlan } from './plans'
import { NIL_TENANT_ID } from './cycle'
import { SubscriptionError } from './types'

export const CONSENT_VERSION = 'v1'

export interface CreateSubscriptionResult {
  localId: string
  razorpaySubscriptionId: string
  keyId: string
  amount: number
  name: string
  description: string
  prefill: { name: string; email: string; contact: string }
}

async function linkedAccountFor(tenantId: string): Promise<string | null> {
  const r = await controlPlanePool().query(
    `SELECT COALESCE(
            (SELECT b.linked_account_id FROM tenant_bank_accounts b
               JOIN owner_tenants ot ON ot.owner_id = b.owner_id
              WHERE ot.tenant_id = t.id AND b.linked_account_id IS NOT NULL
              ORDER BY b.created_at DESC LIMIT 1),
            t.razorpay_linked_account_id
          ) AS linked_account_id
       FROM tenants t WHERE t.id = $1`,
    [tenantId]
  )
  return r.rows[0]?.linked_account_id ?? null
}

export async function createCustomerSubscription(
  input: OfferInput & { addressId: string }
): Promise<CreateSubscriptionResult> {
  const offer = await deriveSubscriptionOffer(input)
  if (!offer.address) throw new SubscriptionError('Address is required')

  const user = await queryOne<{ email: string; phone: string | null; first_name: string | null; last_name: string | null }>(
    `SELECT email, phone, first_name, last_name FROM users WHERE id = $1`,
    [input.userId]
  )
  if (!user) throw new SubscriptionError('User not found', 404)

  const spec = INTERVAL_SPEC[offer.interval]
  const { instance, creds } = offer.rzp
  const tenantId = offer.tenantId
  const isPlatform = offer.collectingAccount === 'platform'

  const planId = await getOrCreatePlan(instance, {
    productId: offer.product.id,
    productName: offer.product.name,
    period: spec.period,
    interval: spec.interval,
    amountPaise: offer.amountPaise,
    collectingAccount: offer.collectingAccount,
  })

  const linkedAccountId = isPlatform && tenantId ? await linkedAccountFor(tenantId).catch(() => null) : null
  const localId = randomUUID()

  const rzpSub = await (instance as any).subscriptions.create({
    plan_id: planId,
    total_count: offer.totalCount,
    quantity: 1,
    customer_notify: 1,
    notes: {
      tenant_id: tenantId ?? NIL_TENANT_ID,
      local_subscription_id: localId,
      product_id: offer.product.id,
    },
  })
  const rzpId = String(rzpSub.id)

  const abandon = async () => {
    await (instance as any).subscriptions.cancel(rzpId, false).catch(() => {})
  }

  try {
    await query(
      `INSERT INTO subscriptions (
         id, user_id, product_id, status, interval_minutes, next_renewal_at, source,
         razorpay_subscription_id, razorpay_plan_id, variant_id, sub_variant_id, quantity,
         interval, interval_count, period, unit_price_paise, unit_price_ex_gst, shipping_paise,
         gst_rate, hsn_code, is_digital, address_id, address_snapshot, collecting_account,
         linked_account_id, current_cycle, total_count, min_cycles, term_cycles, consent_version, consent_at, locked_price_at
       ) VALUES (
         $1, $2, $3, 'created', $4, NOW() + make_interval(mins => $4), 'razorpay',
         $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb, $21,
         $22, 0, $23, $25, $26, $24, NOW(), NOW()
       )`,
      [
        localId,
        input.userId,
        offer.product.id,
        spec.minutes,
        rzpId,
        planId,
        offer.variantId,
        offer.subVariantId,
        offer.quantity,
        offer.interval,
        spec.interval,
        spec.period,
        Math.round(offer.unitPrice * 100),
        offer.unitPriceExGst,
        Math.round(offer.shipping * 100),
        offer.gstRate,
        offer.product.hsn_code,
        offer.isDigital,
        offer.address.id,
        JSON.stringify(snapshotAddress(offer.address)),
        offer.collectingAccount,
        linkedAccountId,
        offer.totalCount,
        CONSENT_VERSION,
        offer.minCycles,
        offer.totalCycles,
      ]
    )
  } catch (err) {
    await abandon()
    throw err
  }

  // Platform-collect events arrive on the shared endpoint and route via this index; own-key
  // tenants use their per-tenant endpoint and need no index row.
  if (isPlatform) {
    try {
      await controlPlanePool().query(
        `INSERT INTO razorpay_subscription_index
           (razorpay_subscription_id, tenant_id, collecting_account, product_id, local_subscription_id)
         VALUES ($1, $2, 'platform', $3, $4)
         ON CONFLICT (razorpay_subscription_id) DO NOTHING`,
        [rzpId, tenantId ?? NIL_TENANT_ID, offer.product.id, localId]
      )
    } catch (err) {
      await abandon()
      await query(`UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1`, [
        localId,
      ]).catch(() => {})
      throw err
    }
  }

  const name = `${user.first_name || ''} ${user.last_name || ''}`.trim()
  return {
    localId,
    razorpaySubscriptionId: rzpId,
    keyId: creds.key_id,
    amount: offer.amount,
    name: (await getStoreIdentity()).name,
    description: `${offer.product.name} · ${offer.intervalLabel}`,
    prefill: { name, email: user.email, contact: user.phone ?? '' },
  }
}
