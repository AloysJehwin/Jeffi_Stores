import { queryMany } from '@/lib/shared/db'
import { REWARD_COUPON_CAMPAIGN } from '@/lib/loyalty/redeem'

// A customer's personal coupons (generated_for_user_id): rewards-game wins, loyalty redemptions and
// one-off codes the store issued them.

export type CouponStatus = 'usable' | 'used' | 'expired'

export interface AccountCoupon {
  id: string
  code: string
  source: 'game' | 'loyalty' | 'store'
  /** The prize label for a game win, else the coupon description. */
  label: string | null
  discountType: 'fixed' | 'percentage'
  value: number
  minPurchase: number
  maxDiscount: number | null
  validUntil: string | null
  createdAt: string
  status: CouponStatus
}

/**
 * Status of coupon `c` for the user `userRef` (an SQL expression), on the same rules as
 * /api/coupons/apply: used up (overall or by them) wins over expired or switched off.
 */
export function couponStatusSql(userRef: string): string {
  return `CASE
    WHEN (c.usage_limit IS NOT NULL AND COALESCE(c.times_used, 0) >= c.usage_limit)
      OR (c.usage_limit_per_user IS NOT NULL
          AND (SELECT COUNT(*) FROM coupon_usage u WHERE u.coupon_id = c.id AND u.user_id = ${userRef}) >= c.usage_limit_per_user)
      THEN 'used'
    WHEN c.is_active = FALSE OR c.is_draft = TRUE OR (c.valid_until IS NOT NULL AND c.valid_until <= NOW()) THEN 'expired'
    ELSE 'usable' END`
}

const LIMIT = 50

interface Row {
  id: string
  code: string
  description: string | null
  prize_label: string | null
  campaign: string | null
  discount_type: string
  value: number
  min_purchase: number
  max_discount: number | null
  valid_until: string | null
  created_at: string
  status: CouponStatus
}

/** Usable ones first, then newest; `usableOnly` for the cart and the win card. */
export async function listAccountCoupons(
  userId: string,
  opts: { usableOnly?: boolean } = {}
): Promise<AccountCoupon[]> {
  const rows = await queryMany<Row>(
    `SELECT * FROM (
       SELECT c.id, c.code, c.description, c.generated_for_campaign AS campaign,
              (SELECT p.prize_label FROM reward_game_plays p WHERE p.coupon_id = c.id LIMIT 1) AS prize_label,
              c.discount_type, c.discount_value::float8 AS value,
              COALESCE(c.min_purchase_amount, 0)::float8 AS min_purchase,
              c.max_discount_amount::float8 AS max_discount, c.valid_until, c.created_at,
              ${couponStatusSql('$1::uuid')} AS status
       FROM coupons c
       WHERE c.generated_for_user_id = $1::uuid
         AND c.is_draft = FALSE
         AND (c.valid_from IS NULL OR c.valid_from <= NOW())
     ) x
     WHERE ($2::boolean = FALSE OR x.status = 'usable')
     ORDER BY (x.status = 'usable') DESC, x.created_at DESC
     LIMIT ${LIMIT}`,
    [userId, opts.usableOnly === true]
  )
  return rows.map(row => ({
    id: row.id,
    code: row.code,
    source: row.campaign?.startsWith('reward_game:')
      ? 'game'
      : row.campaign === REWARD_COUPON_CAMPAIGN
        ? 'loyalty'
        : 'store',
    label: row.prize_label ?? row.description,
    discountType: row.discount_type === 'percentage' ? 'percentage' : 'fixed',
    value: Number(row.value),
    minPurchase: Number(row.min_purchase ?? 0),
    maxDiscount: row.max_discount == null ? null : Number(row.max_discount),
    validUntil: row.valid_until ? new Date(row.valid_until).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    status: row.status,
  }))
}
