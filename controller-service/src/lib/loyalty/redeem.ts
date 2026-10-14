import crypto from 'crypto'
import { queryOne, withTransaction } from '@/lib/shared/db'
import { round2 } from '@/lib/catalog/gst'
import { getLoyaltySettings } from './settings'
import { eligibleCustomerSql, ensureLoyaltyAccount, lockLoyaltyUser, refreshLoyaltyAccount } from './reconcile'

export const REWARD_COUPON_CAMPAIGN = 'loyalty_reward'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const MAX_POINTS = 1_000_000
const MAX_NOTE_LENGTH = 500

function rewardCode(): string {
  let code = ''
  for (const byte of crypto.randomBytes(8)) code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
  return `RWD-${code}`
}

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

    let coupon: { id: string; code: string } | undefined
    for (let attempt = 0; attempt < 5 && !coupon; attempt++) {
      coupon = (
        await client.query<{ id: string; code: string }>(
          `INSERT INTO coupons
             (code, description, discount_type, discount_value, min_purchase_amount, usage_limit,
              usage_limit_per_user, valid_from, is_active, auto_generated, generated_for_user_id,
              generated_for_campaign)
           VALUES ($1, 'Rewards coupon', 'fixed', $2, $2, 1, 1, NOW(), TRUE, TRUE, $3, $4)
           ON CONFLICT (code) DO NOTHING
           RETURNING id, code`,
          [rewardCode(), value, userId, REWARD_COUPON_CAMPAIGN]
        )
      ).rows[0]
    }
    if (!coupon) throw new Error('Could not generate a reward coupon code')

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
