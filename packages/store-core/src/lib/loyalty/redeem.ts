import { queryOne, withTransaction } from '@/lib/shared/db'
import { round2 } from '@/lib/catalog/gst'
import { getLoyaltySettings } from './settings'
import { insertUserCoupon } from './coupons'
import { eligibleCustomerSql, ensureLoyaltyAccount, lockLoyaltyUser, refreshLoyaltyAccount } from './reconcile'

export const REWARD_COUPON_CAMPAIGN = 'loyalty_reward'

const MAX_POINTS = 1_000_000
const MAX_NOTE_LENGTH = 500

export async function isLoyaltyEligible(userId: string): Promise<boolean> {
  const row = await queryOne(`SELECT 1 FROM users u WHERE u.id = $1 AND ${eligibleCustomerSql('u')}`, [userId])
  return row !== null
}

export type RedeemFailure = 'disabled' | 'not_eligible' | 'invalid_points' | 'below_minimum' | 'insufficient_points'

export type RedeemResult =
  | { ok: true; code: string; value: number; points: number; balance: number }
  | { ok: false; reason: RedeemFailure; minimum?: number }

export async function redeemPoints(userId: string, points: number): Promise<RedeemResult> {
  const settings = await getLoyaltySettings()
  if (!settings.enabled) return { ok: false, reason: 'disabled' }
  if (!Number.isInteger(points) || points <= 0 || points > MAX_POINTS) return { ok: false, reason: 'invalid_points' }
  if (points < settings.minRedeemPoints) {
    return { ok: false, reason: 'below_minimum', minimum: settings.minRedeemPoints }
  }
  if (!(await isLoyaltyEligible(userId))) return { ok: false, reason: 'not_eligible' }

  const value = round2(points * settings.pointValue)
  return withTransaction<RedeemResult>(async client => {
    await lockLoyaltyUser(client, userId)
    const balance = (
      await client.query<{ points: number }>(
        `SELECT COALESCE(SUM(delta), 0)::int AS points FROM loyalty_ledger WHERE user_id = $1`,
        [userId]
      )
    ).rows[0].points
    if (balance < points) return { ok: false, reason: 'insufficient_points' }

    const coupon = await insertUserCoupon(client, {
      prefix: 'RWD',
      description: 'Rewards coupon',
      discountType: 'fixed',
      value,
      minPurchase: value,
      maxDiscount: null,
      validUntil: null,
      campaign: REWARD_COUPON_CAMPAIGN,
      userId,
    })

    await ensureLoyaltyAccount(client, userId)
    await client.query(
      `INSERT INTO loyalty_ledger (user_id, delta, reason, coupon_id, base_amount) VALUES ($1, $2, 'redeem', $3, $4)`,
      [userId, -points, coupon.id, value]
    )
    const account = await refreshLoyaltyAccount(client, userId, settings)
    return { ok: true, code: coupon.code, value, points, balance: account.points }
  })
}

export type AdjustFailure = 'disabled' | 'not_eligible' | 'invalid_delta' | 'note_required'

export type AdjustResult =
  | { ok: true; points: number; lifetimePoints: number; tier: string }
  | { ok: false; reason: AdjustFailure }

export async function adjustPoints(input: {
  userId: string
  delta: number
  note: string
  adminId: string
}): Promise<AdjustResult> {
  const settings = await getLoyaltySettings()
  if (!settings.enabled) return { ok: false, reason: 'disabled' }
  if (!Number.isInteger(input.delta) || input.delta === 0 || Math.abs(input.delta) > MAX_POINTS) {
    return { ok: false, reason: 'invalid_delta' }
  }
  const note = input.note.trim().slice(0, MAX_NOTE_LENGTH)
  if (!note) return { ok: false, reason: 'note_required' }
  if (!(await isLoyaltyEligible(input.userId))) return { ok: false, reason: 'not_eligible' }

  return withTransaction<AdjustResult>(async client => {
    await lockLoyaltyUser(client, input.userId)
    await ensureLoyaltyAccount(client, input.userId)
    await client.query(
      `INSERT INTO loyalty_ledger (user_id, delta, reason, note, created_by) VALUES ($1, $2, 'adjustment', $3, $4)`,
      [input.userId, input.delta, note, input.adminId]
    )
    const account = await refreshLoyaltyAccount(client, input.userId, settings)
    return { ok: true, points: account.points, lifetimePoints: account.lifetimePoints, tier: account.tier }
  })
}
