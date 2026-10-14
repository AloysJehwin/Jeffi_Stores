import { queryMany, queryOne } from '@/lib/shared/db'
import type { Paginated } from '@/lib/loyalty/queries'
import type { ReferralSettings } from './settings'

export type ReferralStatus = 'joined' | 'rewarded' | 'reversed' | 'capped' | 'rejected'

// Rewards still standing over the last 12 months, which is what the yearly cap counts.
const STANDING_SQL = `status = 'rewarded' AND rewarded_at > NOW() - INTERVAL '365 days'`

// "Rahul S." — enough for the referrer to recognise a friend without exposing their full name.
export function maskName(first: string | null, last: string | null): string {
  const f = (first ?? '').trim()
  const l = (last ?? '').trim()
  if (!f) return 'A friend'
  return l ? `${f} ${l[0].toUpperCase()}.` : f
}

export interface ReferredFriend {
  id: string
  name: string
  status: ReferralStatus
  hasOrdered: boolean
  points: number | null
  signedUpAt: string
  rewardedAt: string | null
}

export interface ReferralSummary {
  counts: Record<ReferralStatus, number>
  pointsEarned: number
  rewardsLeftThisYear: number
  friends: Paginated<ReferredFriend>
}

const FRIEND_PAGE_SIZE = 10

export async function getReferralSummary(
  userId: string,
  settings: ReferralSettings,
  page = 1
): Promise<ReferralSummary> {
  const safePage = Math.max(1, Math.floor(page) || 1)
  const [statusRows, totals, rows] = await Promise.all([
    queryMany<{ status: ReferralStatus; n: number }>(
      `SELECT status, COUNT(*)::int AS n FROM referral_signups WHERE referrer_user_id = $1 GROUP BY status`,
      [userId]
    ),
    queryOne<{ earned: number; standing: number }>(
      `SELECT
         (SELECT COALESCE(SUM(delta), 0)::int FROM loyalty_ledger
           WHERE user_id = $1 AND reason IN ('referral', 'referral_reversal')) AS earned,
         (SELECT COUNT(*)::int FROM referral_signups WHERE referrer_user_id = $1 AND ${STANDING_SQL}) AS standing`,
      [userId]
    ),
    queryMany<{
      id: string
      first_name: string | null
      last_name: string | null
      status: ReferralStatus
      has_ordered: boolean
      points: number | null
      signed_up_at: string
      rewarded_at: string | null
    }>(
      `SELECT s.id::text AS id, u.first_name, u.last_name, s.status, s.points, s.signed_up_at, s.rewarded_at,
              EXISTS (SELECT 1 FROM orders o WHERE o.user_id = s.referred_user_id
                        AND o.status NOT IN ('cancelled', 'returned')) AS has_ordered
       FROM referral_signups s JOIN users u ON u.id = s.referred_user_id
       WHERE s.referrer_user_id = $1
       ORDER BY s.signed_up_at DESC, s.id DESC
       LIMIT $2 OFFSET $3`,
      [userId, FRIEND_PAGE_SIZE, (safePage - 1) * FRIEND_PAGE_SIZE]
    ),
  ])

  const counts: Record<ReferralStatus, number> = { joined: 0, rewarded: 0, reversed: 0, capped: 0, rejected: 0 }
  for (const row of statusRows) counts[row.status] = row.n
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0)

  return {
    counts,
    pointsEarned: totals?.earned ?? 0,
    rewardsLeftThisYear: Math.max(0, settings.yearlyCap - (totals?.standing ?? 0)),
    friends: {
      items: rows.map(row => ({
        id: row.id,
        name: maskName(row.first_name, row.last_name),
        status: row.status,
        hasOrdered: row.has_ordered,
        points: row.points,
        signedUpAt: row.signed_up_at,
        rewardedAt: row.rewarded_at,
      })),
      total,
      page: safePage,
      pageSize: FRIEND_PAGE_SIZE,
    },
  }
}

export interface AdminReferralRow {
  id: string
  status: ReferralStatus
  rejectReason: string | null
  points: number | null
  signedUpAt: string
  rewardedAt: string | null
  referrer: { id: string; name: string; email: string }
  friend: { id: string; name: string; email: string }
}

const STATUSES: ReferralStatus[] = ['joined', 'rewarded', 'reversed', 'capped', 'rejected']

export async function listReferralSignups(opts: {
  page: number
  pageSize: number
  status?: string | null
  search?: string | null
}): Promise<{ rows: AdminReferralRow[]; total: number }> {
  const status = opts.status && (STATUSES as string[]).includes(opts.status) ? opts.status : null
  const search = opts.search?.trim() ? `%${opts.search.trim()}%` : null
  const where = `
    FROM referral_signups s
    JOIN users r ON r.id = s.referrer_user_id
    JOIN users f ON f.id = s.referred_user_id
    WHERE ($1::text IS NULL OR s.status = $1)
      AND ($2::text IS NULL OR r.email ILIKE $2 OR f.email ILIKE $2
           OR (COALESCE(r.first_name, '') || ' ' || COALESCE(r.last_name, '')) ILIKE $2
           OR (COALESCE(f.first_name, '') || ' ' || COALESCE(f.last_name, '')) ILIKE $2)`
  const [rows, count] = await Promise.all([
    queryMany<{
      id: string
      status: ReferralStatus
      reject_reason: string | null
      points: number | null
      signed_up_at: string
      rewarded_at: string | null
      r_id: string
      r_first: string | null
      r_last: string | null
      r_email: string
      f_id: string
      f_first: string | null
      f_last: string | null
      f_email: string
    }>(
      `SELECT s.id::text AS id, s.status, s.reject_reason, s.points, s.signed_up_at, s.rewarded_at,
              r.id::text AS r_id, r.first_name AS r_first, r.last_name AS r_last, r.email AS r_email,
              f.id::text AS f_id, f.first_name AS f_first, f.last_name AS f_last, f.email AS f_email
       ${where}
       ORDER BY s.signed_up_at DESC, s.id DESC
       LIMIT $3 OFFSET $4`,
      [status, search, opts.pageSize, (opts.page - 1) * opts.pageSize]
    ),
    queryOne<{ total: number }>(`SELECT COUNT(*)::int AS total ${where}`, [status, search]),
  ])
  const fullName = (first: string | null, last: string | null, email: string) =>
    [first, last].filter(Boolean).join(' ') || email
  return {
    rows: rows.map(row => ({
      id: row.id,
      status: row.status,
      rejectReason: row.reject_reason,
      points: row.points,
      signedUpAt: row.signed_up_at,
      rewardedAt: row.rewarded_at,
      referrer: { id: row.r_id, name: fullName(row.r_first, row.r_last, row.r_email), email: row.r_email },
      friend: { id: row.f_id, name: fullName(row.f_first, row.f_last, row.f_email), email: row.f_email },
    })),
    total: count?.total ?? 0,
  }
}

export interface ReferralStats {
  signups: number
  byStatus: Record<ReferralStatus, number>
  pointsPaid: number
  referrers: number
}

export async function getReferralStats(): Promise<ReferralStats> {
  const [statusRows, totals] = await Promise.all([
    queryMany<{ status: ReferralStatus; n: number }>(
      `SELECT status, COUNT(*)::int AS n FROM referral_signups GROUP BY status`
    ),
    queryOne<{ paid: number; referrers: number }>(
      `SELECT
         (SELECT COALESCE(SUM(delta), 0)::int FROM loyalty_ledger WHERE reason IN ('referral', 'referral_reversal')) AS paid,
         (SELECT COUNT(DISTINCT referrer_user_id)::int FROM referral_signups) AS referrers`
    ),
  ])
  const byStatus: Record<ReferralStatus, number> = { joined: 0, rewarded: 0, reversed: 0, capped: 0, rejected: 0 }
  for (const row of statusRows) byStatus[row.status] = row.n
  return {
    signups: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
    byStatus,
    pointsPaid: totals?.paid ?? 0,
    referrers: totals?.referrers ?? 0,
  }
}
