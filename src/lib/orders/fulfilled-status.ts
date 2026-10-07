import 'server-only'

/**
 * One source of truth for "the order reached its customer".
 *
 * Historically that meant status 'delivered'. Digital products are never shipped — they are
 * granted access instead and land in status 'granted' (label "Access granted"). To the many
 * delivered-keyed features (loyalty earning, referral rewards, review-request campaigns, the
 * verified-purchase badge, the Completed/Delivered dashboard counts) a granted digital order is
 * the same event as a delivered physical one, so they all funnel through this module instead of
 * hard-coding 'delivered'.
 *
 * Grant time is stamped into BOTH granted_at and delivered_at, so SQL that already keys on
 * delivered_at (the loyalty credit clock, the review window, referral_invite) keeps working with
 * no change beyond swapping its status predicate for FULFILLED_SQL.
 */

export const FULFILLED_STATUSES = ['delivered', 'granted'] as const
export type FulfilledStatus = (typeof FULFILLED_STATUSES)[number]

/** True when an order status means the customer has received the goods (shipped or granted). */
export function isFulfilledStatus(status: string | null | undefined): boolean {
  return status === 'delivered' || status === 'granted'
}

/**
 * SQL predicate equivalent of {@link isFulfilledStatus}. Pass the alias the query uses for the
 * orders row ('o' by default, '' for an unaliased `orders` table). Returns e.g.
 * `o.status IN ('delivered','granted')`.
 */
export function fulfilledSql(alias = 'o'): string {
  const col = alias ? `${alias}.status` : 'status'
  return `${col} IN ('delivered', 'granted')`
}

/** Default-alias constant for the common `o.`-aliased case. */
export const FULFILLED_SQL = fulfilledSql('o')

/**
 * The timestamp an order became fulfilled. granted_at is stamped alongside delivered_at at grant
 * time, so COALESCE(delivered_at, granted_at, created_at) is stable for both digital and physical.
 */
export function settledAtSql(alias = 'o'): string {
  const p = alias ? `${alias}.` : ''
  return `COALESCE(${p}delivered_at, ${p}granted_at, ${p}created_at)`
}

export const SETTLED_AT_SQL = settledAtSql('o')
