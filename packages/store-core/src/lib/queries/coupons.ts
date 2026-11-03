import { buildWhere, type FilterQuery } from '@jeffi/list-filters'
import { entityOrderBy, queryCount, queryMany, queryOne } from './shared'
import { COUPONS_ENTITY } from '@/lib/filters/entities/coupons'

/** One page of coupons for a normalised filter query, plus the matching total. */
export async function queryCoupons(
  q: FilterQuery,
  opts: { page?: number; limit?: number; sort?: string; dir?: string } = {}
) {
  const w = buildWhere(COUPONS_ENTITY, q, 1)
  const limit = opts.limit || 25
  const offset = ((opts.page || 1) - 1) * limit
  const [coupons, total] = await Promise.all([
    queryMany(
      `SELECT c.* FROM coupons c ${w.where} ${entityOrderBy(COUPONS_ENTITY, opts.sort, opts.dir)} LIMIT $${w.nextIdx} OFFSET $${w.nextIdx + 1}`,
      [...w.params, limit, offset]
    ),
    queryCount(`SELECT COUNT(*) FROM coupons c ${w.where}`, w.params),
  ])
  return { coupons, total }
}

export interface CouponsSummary {
  total: number
  active: number
  expired: number
  campaign: number
}

/** The list's KPI strip over every matching coupon (not just the page shown). */
export async function getCouponsSummary(q: FilterQuery): Promise<CouponsSummary> {
  const w = buildWhere(COUPONS_ENTITY, q, 1)
  const r = await queryOne<CouponsSummary>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE c.is_active)::int AS active,
            COUNT(*) FILTER (WHERE c.valid_until < NOW())::int AS expired,
            COUNT(*) FILTER (WHERE c.auto_generated)::int AS campaign
     FROM coupons c ${w.where}`,
    w.params
  )
  return r ?? { total: 0, active: 0, expired: 0, campaign: 0 }
}
