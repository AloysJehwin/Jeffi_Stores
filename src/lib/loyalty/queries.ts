import { queryMany, queryOne } from '@/lib/shared/db'
import { orderStateParams, orderStatesCte } from './reconcile'
import { REWARD_COUPON_CAMPAIGN } from './redeem'
import type { LoyaltySettings } from './settings'
import { multiplierFor, nextTierAfter, tierName, TIER_KEYS } from './tiers'

export interface LoyaltyAccount {
  points: number
  lifetimePoints: number
  tier: string
  tierUpdatedAt: string | null
}

export interface LoyaltyLedgerEntry {
  id: string
  delta: number
  reason: string
  orderNumber: string | null
  couponCode: string | null
  note: string | null
  createdAt: string
}

export interface RewardCoupon {
  code: string
  value: number
  minPurchase: number
  createdAt: string
}

export async function getLoyaltyAccount(userId: string): Promise<LoyaltyAccount> {
  const row = await queryOne<{ points: number; lifetime_points: number; tier: string; tier_updated_at: string | null }>(
    `SELECT points, lifetime_points, tier, tier_updated_at FROM loyalty_accounts WHERE user_id = $1`,
    [userId]
  )
  return {
    points: row?.points ?? 0,
    lifetimePoints: row?.lifetime_points ?? 0,
    tier: row?.tier ?? TIER_KEYS[0],
    tierUpdatedAt: row?.tier_updated_at ?? null,
  }
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export async function listLoyaltyLedger(
  userId: string,
  page: number,
  pageSize: number
): Promise<Paginated<LoyaltyLedgerEntry>> {
  const safePage = Math.max(1, Math.floor(page) || 1)
  const safeSize = Math.min(100, Math.max(1, Math.floor(pageSize) || 1))
  const [rows, count] = await Promise.all([
    queryMany<{
      id: string
      delta: number
      reason: string
      order_number: string | null
      coupon_code: string | null
      note: string | null
      created_at: string
    }>(
      `SELECT l.id::text AS id, l.delta, l.reason, o.order_number, c.code AS coupon_code, l.note, l.created_at
       FROM loyalty_ledger l
       LEFT JOIN orders o ON o.id = l.order_id
       LEFT JOIN coupons c ON c.id = l.coupon_id
       WHERE l.user_id = $1 AND l.delta <> 0
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT $2 OFFSET $3`,
      [userId, safeSize, (safePage - 1) * safeSize]
    ),
    queryOne<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM loyalty_ledger WHERE user_id = $1 AND delta <> 0`,
      [userId]
    ),
  ])
  return {
    items: rows.map(row => ({
      id: row.id,
      delta: row.delta,
      reason: row.reason,
      orderNumber: row.order_number,
      couponCode: row.coupon_code,
      note: row.note,
      createdAt: row.created_at,
    })),
    total: count?.total ?? 0,
    page: safePage,
    pageSize: safeSize,
  }
}

export async function listRewardCoupons(
  userId: string,
  page = 1,
  pageSize = 100
): Promise<Paginated<RewardCoupon>> {
  const safePage = Math.max(1, Math.floor(page) || 1)
  const safeSize = Math.min(100, Math.max(1, Math.floor(pageSize) || 1))
  const [rows, count] = await Promise.all([
    queryMany<{ code: string; value: string; min_purchase: string | null; created_at: string }>(
      `SELECT c.code, c.discount_value AS value, c.min_purchase_amount AS min_purchase, c.created_at
       FROM coupons c
       WHERE c.generated_for_user_id = $1
         AND c.generated_for_campaign = $2
         AND c.is_active = TRUE
         AND (c.valid_until IS NULL OR c.valid_until > NOW())
         AND c.times_used < COALESCE(c.usage_limit, 1)
       ORDER BY c.created_at DESC
       LIMIT $3 OFFSET $4`,
      [userId, REWARD_COUPON_CAMPAIGN, safeSize, (safePage - 1) * safeSize]
    ),
    queryOne<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM coupons c
       WHERE c.generated_for_user_id = $1
         AND c.generated_for_campaign = $2
         AND c.is_active = TRUE
         AND (c.valid_until IS NULL OR c.valid_until > NOW())
         AND c.times_used < COALESCE(c.usage_limit, 1)`,
      [userId, REWARD_COUPON_CAMPAIGN]
    ),
  ])
  return {
    items: rows.map(row => ({
      code: row.code,
      value: Number(row.value),
      minPurchase: Number(row.min_purchase ?? 0),
      createdAt: row.created_at,
    })),
    total: count?.total ?? 0,
    page: safePage,
    pageSize: safeSize,
  }
}

export async function getPendingPoints(
  userId: string,
  settings: LoyaltySettings
): Promise<{ points: number; nextCreditAt: string | null }> {
  const row = await queryOne<{ points: number; next_credit_at: string | null }>(
    `${orderStatesCte(true)}
     SELECT COALESCE(SUM(points_due), 0)::int AS points, MIN(credit_at) AS next_credit_at
     FROM states WHERE owner_id = $5::uuid AND state = 'pending'`,
    [...orderStateParams(settings), userId]
  )
  return { points: row?.points ?? 0, nextCreditAt: row?.next_credit_at ?? null }
}

export interface LoyaltySummary {
  tier: { key: string; name: string; multiplier: number }
  nextTier: { key: string; name: string; minPoints: number; pointsToGo: number } | null
  points: number
  lifetimePoints: number
  pending: { points: number; nextCreditAt: string | null }
  history: Paginated<Omit<LoyaltyLedgerEntry, 'note'>>
  coupons: Paginated<RewardCoupon>
}

const HISTORY_PAGE_SIZE = 10
const COUPON_PAGE_SIZE = 6

export async function getLoyaltySummary(
  userId: string,
  settings: LoyaltySettings,
  pages: { historyPage?: number; couponPage?: number } = {}
): Promise<LoyaltySummary> {
  const [account, pending, ledger, coupons] = await Promise.all([
    getLoyaltyAccount(userId),
    getPendingPoints(userId, settings),
    listLoyaltyLedger(userId, pages.historyPage ?? 1, HISTORY_PAGE_SIZE),
    listRewardCoupons(userId, pages.couponPage ?? 1, COUPON_PAGE_SIZE),
  ])
  const next = nextTierAfter(account.tier, settings.tiers)
  return {
    tier: { key: account.tier, name: tierName(account.tier), multiplier: multiplierFor(account.tier, settings.tiers) },
    nextTier: next
      ? {
          key: next.key,
          name: next.name,
          minPoints: next.minPoints,
          pointsToGo: Math.max(0, next.minPoints - Math.max(0, account.lifetimePoints)),
        }
      : null,
    points: account.points,
    lifetimePoints: account.lifetimePoints,
    pending,
    history: { ...ledger, items: ledger.items.map(({ note: _note, ...entry }) => entry) },
    coupons,
  }
}

export interface LoyaltyMember {
  userId: string
  name: string
  email: string
  phone: string | null
  tier: string
  points: number
  lifetimePoints: number
  updatedAt: string
}

export async function listLoyaltyMembers(opts: {
  page: number
  pageSize: number
  tier?: string | null
  search?: string | null
}): Promise<{ members: LoyaltyMember[]; total: number }> {
  const tier = opts.tier && (TIER_KEYS as readonly string[]).includes(opts.tier) ? opts.tier : null
  const search = opts.search?.trim() ? `%${opts.search.trim()}%` : null
  const where = `
    FROM loyalty_accounts la
    JOIN users u ON u.id = la.user_id
    WHERE ($1::text IS NULL OR la.tier = $1)
      AND ($2::text IS NULL OR u.email ILIKE $2 OR u.phone ILIKE $2
           OR (COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) ILIKE $2)`
  const [rows, count] = await Promise.all([
    queryMany<{
      user_id: string
      first_name: string | null
      last_name: string | null
      email: string
      phone: string | null
      tier: string
      points: number
      lifetime_points: number
      updated_at: string
    }>(
      `SELECT la.user_id::text AS user_id, u.first_name, u.last_name, u.email, u.phone,
              la.tier, la.points, la.lifetime_points, la.updated_at
       ${where}
       ORDER BY la.lifetime_points DESC, la.updated_at DESC
       LIMIT $3 OFFSET $4`,
      [tier, search, opts.pageSize, (opts.page - 1) * opts.pageSize]
    ),
    queryOne<{ total: number }>(`SELECT COUNT(*)::int AS total ${where}`, [tier, search]),
  ])
  return {
    members: rows.map(row => ({
      userId: row.user_id,
      name: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email,
      email: row.email,
      phone: row.phone,
      tier: row.tier,
      points: row.points,
      lifetimePoints: row.lifetime_points,
      updatedAt: row.updated_at,
    })),
    total: count?.total ?? 0,
  }
}

export interface LoyaltyStats {
  members: number
  outstandingPoints: number
  redeemedPoints: number
  byTier: Record<string, number>
}

export async function getLoyaltyStats(): Promise<LoyaltyStats> {
  const [tiers, totals] = await Promise.all([
    queryMany<{ tier: string; members: number }>(
      `SELECT tier, COUNT(*)::int AS members FROM loyalty_accounts GROUP BY tier`
    ),
    queryOne<{ outstanding: number; redeemed: number }>(
      `SELECT COALESCE(SUM(delta), 0)::int AS outstanding,
              COALESCE(-SUM(delta) FILTER (WHERE reason IN ('redeem', 'redeem_refund')), 0)::int AS redeemed
       FROM loyalty_ledger`
    ),
  ])
  const byTier: Record<string, number> = Object.fromEntries(TIER_KEYS.map(key => [key, 0]))
  for (const row of tiers) byTier[row.tier] = (byTier[row.tier] ?? 0) + row.members
  return {
    members: tiers.reduce((sum, row) => sum + row.members, 0),
    outstandingPoints: totals?.outstanding ?? 0,
    redeemedPoints: totals?.redeemed ?? 0,
    byTier,
  }
}
