import 'server-only'
import { queryOne } from '@/lib/shared/db'
import { getRazorpayInstance, getRazorpayInstanceFor } from '@/lib/payments/razorpay'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { loadAddress } from '@/lib/orders/order-commit'
import { applySubscriptionState } from './cycle'
import { assertIndianAddress, snapshotAddress } from './offer'
import { SubscriptionError, type SubscriptionRow } from './types'

export { SubscriptionError }
export type { SubscriptionRow }

const TERMINAL = new Set(['cancelled', 'completed', 'expired'])

async function loadSub(localId: string): Promise<SubscriptionRow> {
  const row = await queryOne<SubscriptionRow>(`SELECT * FROM subscriptions WHERE id = $1`, [localId])
  if (!row) throw new SubscriptionError('Subscription not found', 404)
  if (!row.razorpay_subscription_id || row.source === 'legacy') {
    throw new SubscriptionError('This subscription cannot be managed here')
  }
  return row
}

/** The sub lives on the account that created it: platform env keys, or the tenant's own keys. */
export async function razorpayForSubscription(
  sub: Pick<SubscriptionRow, 'collecting_account'>
): Promise<{ instance: any; keySecret: string }> {
  if (sub.collecting_account === 'own') {
    const tenantId = await resolveTenantId()
    const { instance, creds } = await getRazorpayInstanceFor(tenantId ?? undefined)
    if (!creds.isOwn) throw new SubscriptionError('Store payment account is not connected', 409)
    return { instance, keySecret: creds.key_secret }
  }
  return { instance: getRazorpayInstance(), keySecret: process.env.RAZORPAY_KEY_SECRET || '' }
}

async function rzpFor(sub: SubscriptionRow): Promise<any> {
  return (await razorpayForSubscription(sub)).instance
}

/** Customers can't cancel or pause before the minimum number of charges; admins can. */
export function assertCommitmentMet(
  sub: Pick<SubscriptionRow, 'min_cycles' | 'current_cycle'>,
  actor: 'customer' | 'admin'
) {
  if (actor === 'admin') return
  const min = Number(sub.min_cycles ?? 0)
  const paid = Number(sub.current_cycle ?? 0)
  if (min > 0 && paid < min) {
    throw new SubscriptionError(
      `This subscription has a minimum of ${min} charges; you can cancel after charge ${min} (${paid} paid so far).`,
      409
    )
  }
}

async function reload(localId: string): Promise<SubscriptionRow> {
  return (await queryOne<SubscriptionRow>(`SELECT * FROM subscriptions WHERE id = $1`, [localId]))!
}

export async function cancelSubscription(
  localId: string,
  opts: { atCycleEnd: boolean; actor: 'customer' | 'admin' }
): Promise<SubscriptionRow> {
  const sub = await loadSub(localId)
  if (TERMINAL.has(sub.status)) throw new SubscriptionError('Subscription is already ended')
  assertCommitmentMet(sub, opts.actor)
  const rzp = await rzpFor(sub)
  // Razorpay only supports cycle-end cancellation on an active sub; anything else ends now.
  const atEnd = opts.atCycleEnd && sub.status === 'active'
  const entity = await rzp.subscriptions.cancel(sub.razorpay_subscription_id, atEnd)

  await queryOne(
    `UPDATE subscriptions SET cancel_at_cycle_end = $2, cancel_requested_at = COALESCE(cancel_requested_at, NOW()), updated_at = NOW()
      WHERE id = $1`,
    [localId, atEnd]
  )
  await applySubscriptionState(localId, atEnd ? null : 'cancelled', entity)
  return reload(localId)
}

export async function pauseSubscription(
  localId: string,
  actor: 'customer' | 'admin' = 'customer'
): Promise<SubscriptionRow> {
  const sub = await loadSub(localId)
  if (sub.status !== 'active') throw new SubscriptionError('Only an active subscription can be paused')
  assertCommitmentMet(sub, actor)
  const entity = await (await rzpFor(sub)).subscriptions.pause(sub.razorpay_subscription_id, { pause_at: 'now' })
  return (await applySubscriptionState(localId, 'paused', entity)).row
}

export async function resumeSubscription(localId: string): Promise<SubscriptionRow> {
  const sub = await loadSub(localId)
  if (sub.status !== 'paused') throw new SubscriptionError('Only a paused subscription can be resumed')
  const entity = await (await rzpFor(sub)).subscriptions.resume(sub.razorpay_subscription_id, { resume_at: 'now' })
  return (await applySubscriptionState(localId, 'active', entity)).row
}

/** Re-snapshot an address the user owns; applies to future cycles only. */
export async function changeSubscriptionAddress(
  localId: string,
  userId: string,
  addressId: string
): Promise<SubscriptionRow> {
  const sub = await loadSub(localId)
  if (sub.user_id !== userId) throw new SubscriptionError('Subscription not found', 404)
  if (sub.is_digital) throw new SubscriptionError('Digital subscriptions have no delivery address')
  if (TERMINAL.has(sub.status)) throw new SubscriptionError('Subscription is already ended')
  const address = await loadAddress(userId, addressId)
  if (!address) throw new SubscriptionError('Address not found', 404)
  assertIndianAddress(address)
  const row = await queryOne<SubscriptionRow>(
    `UPDATE subscriptions SET address_id = $2, address_snapshot = $3::jsonb, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [localId, addressId, JSON.stringify(snapshotAddress(address))]
  )
  return row!
}

export async function syncSubscription(localId: string): Promise<SubscriptionRow> {
  const sub = await loadSub(localId)
  const entity = await (await rzpFor(sub)).subscriptions.fetch(sub.razorpay_subscription_id)
  return (await applySubscriptionState(localId, entity?.status ?? null, entity)).row
}
