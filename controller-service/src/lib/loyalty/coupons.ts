import crypto from 'crypto'
import type { PoolClient } from 'pg'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function couponCode(prefix: string): string {
  let code = ''
  for (const byte of crypto.randomBytes(8)) code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
  return `${prefix}-${code}`
}

export interface UserCouponSpec {
  prefix: string
  description: string
  discountType: 'fixed' | 'percentage'
  value: number
  minPurchase: number
  maxDiscount: number | null
  validUntil: Date | null
  /** Fits generated_for_campaign varchar(64). */
  campaign: string
  userId: string
}

/**
 * A personal, single-use, auto-generated coupon inside the caller's transaction. Retries the random
 * code on a collision; throws rather than leave the caller without a coupon.
 */
export async function insertUserCoupon(client: PoolClient, spec: UserCouponSpec): Promise<{ id: string; code: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { rows } = await client.query<{ id: string; code: string }>(
      `INSERT INTO coupons
         (code, description, discount_type, discount_value, min_purchase_amount, max_discount_amount, usage_limit,
          usage_limit_per_user, valid_from, valid_until, is_active, auto_generated, generated_for_user_id,
          generated_for_campaign)
       VALUES ($1, $2, $3, $4, $5, $6, 1, 1, NOW(), $7, TRUE, TRUE, $8, $9)
       ON CONFLICT (code) DO NOTHING
       RETURNING id, code`,
      [
        couponCode(spec.prefix),
        spec.description,
        spec.discountType,
        spec.value,
        spec.minPurchase,
        spec.maxDiscount,
        spec.validUntil,
        spec.userId,
        spec.campaign,
      ]
    )
    if (rows[0]) return rows[0]
  }
  throw new Error('Could not generate a reward coupon code')
}
