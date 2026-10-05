import type { PoolClient } from 'pg'
import { queryMany, queryOne, withTransaction } from '@/lib/shared/db'
import { getLoyaltySettings, markLoyaltyLaunched, type LoyaltySettings } from './settings'
import { tierForPoints, tierRank } from './tiers'

const LOCK_NAMESPACE = 7001
const DEFAULT_MAX_USERS = 500

export function eligibleCustomerSql(alias: string): string {
  return `(${alias}.is_guest = FALSE AND ${alias}.is_active = TRUE
    AND NOT EXISTS (
      SELECT 1 FROM business_profiles bp WHERE bp.user_id = ${alias}.id AND bp.approval_status = 'approved'
    ))`
}

const KEPT_AND_PAID_SQL = `(o.source = 'online' AND o.status IN ('delivered', 'return_rejected') AND o.payment_status IN ('paid', 'cod_collected'))`
// Never updated_at: it moves whenever an order is touched, which would restart the wait.
const SETTLED_AT_SQL = `COALESCE(o.delivered_at, o.created_at)`

// $1 credit delay days, $2 count-from date, $3 rupees per point, $4 tier multipliers; scoped adds $5 user id.
// An order is settled once per kept cycle, even at zero points, so a later rate or tier change never re-opens it.
// An order that comes back after a take-back gets the points it held before, not a fresh calculation.
export function orderStatesCte(scoped: boolean): string {
  const scope = scoped
    ? `AND (o.user_id = $5::uuid OR l.user_id = $5::uuid OR (
         o.customer_email = (SELECT email FROM users WHERE id = $5::uuid)
         AND o.customer_phone = (SELECT phone FROM users WHERE id = $5::uuid)))`
    : ''
  return `
  WITH ledger AS (
    SELECT order_id, (ARRAY_AGG(user_id ORDER BY created_at))[1] AS user_id, SUM(delta)::int AS net,
           COUNT(*) FILTER (WHERE reason = 'order_earn') > COUNT(*) FILTER (WHERE reason = 'order_reversal')
             AS credited,
           (ARRAY_AGG(delta ORDER BY created_at DESC) FILTER (WHERE reason = 'order_earn'))[1] AS last_earned
    FROM loyalty_ledger
    WHERE order_id IS NOT NULL AND reason IN ('order_earn', 'order_reversal')
    GROUP BY order_id
  ),
  facts AS (
    SELECT o.id AS order_id,
           o.order_number,
           COALESCE(l.user_id, direct.id, matched.id) AS owner_id,
           COALESCE(l.net, 0) AS net,
           COALESCE(l.credited, FALSE) AS credited,
           l.last_earned,
           ${KEPT_AND_PAID_SQL} AS kept,
           ${SETTLED_AT_SQL} <= NOW() - ($1::int * INTERVAL '1 day') AS matured,
           ($2::date IS NULL OR ${SETTLED_AT_SQL} >= $2::date) AS in_range,
           ${SETTLED_AT_SQL} + ($1::int * INTERVAL '1 day') AS credit_at,
           GREATEST(COALESCE(o.subtotal, 0) - COALESCE(o.discount_amount, 0), 0) AS base
    FROM orders o
    LEFT JOIN ledger l ON l.order_id = o.id
    LEFT JOIN users ou ON ou.id = o.user_id
    LEFT JOIN LATERAL (
      SELECT u.id FROM users u WHERE u.id = o.user_id AND ${eligibleCustomerSql('u')}
    ) direct ON TRUE
    LEFT JOIN LATERAL (
      SELECT u.id FROM users u
      WHERE (o.user_id IS NULL OR ou.is_guest = TRUE)
        AND o.customer_email IS NOT NULL AND o.customer_phone IS NOT NULL
        AND u.email = o.customer_email AND u.phone = o.customer_phone
        AND ${eligibleCustomerSql('u')}
      ORDER BY u.created_at ASC
      LIMIT 1
    ) matched ON TRUE
    WHERE ${KEPT_AND_PAID_SQL} OR l.order_id IS NOT NULL
      ${scope}
  ),
  states AS (
    SELECT f.order_id, f.order_number, f.owner_id, f.net, f.base, f.credit_at, d.points_due,
           CASE
             WHEN NOT f.kept AND f.credited THEN 'reverse'
             WHEN f.kept AND NOT f.credited AND f.in_range AND d.owner_eligible
               THEN CASE WHEN f.matured THEN 'earn' WHEN d.points_due >= 1 THEN 'pending' END
           END AS state
    FROM facts f
    CROSS JOIN LATERAL (
      SELECT COALESCE(f.last_earned, FLOOR(f.base / $3::numeric * COALESCE(($4::jsonb ->> COALESCE(
               (SELECT la.tier FROM loyalty_accounts la WHERE la.user_id = f.owner_id), 'bronze'))::numeric, 1)))::int
               AS points_due,
             EXISTS (SELECT 1 FROM users u WHERE u.id = f.owner_id AND ${eligibleCustomerSql('u')}) AS owner_eligible
    ) d
    WHERE f.owner_id IS NOT NULL
  )`
}

export function orderStateParams(settings: LoyaltySettings): unknown[] {
  const multipliers = Object.fromEntries(settings.tiers.map(tier => [tier.key, tier.multiplier]))
  return [settings.creditDelayDays, settings.countFrom, settings.rupeesPerPoint, JSON.stringify(multipliers)]
}

function refundsDueSql(userFilter: string): string {
  return `
  SELECT r.user_id::text AS user_id, r.coupon_id::text AS coupon_id, (-r.delta)::int AS points
  FROM loyalty_ledger r
  WHERE r.reason = 'redeem' AND r.coupon_id IS NOT NULL AND r.delta < 0 ${userFilter}
    AND EXISTS (
      SELECT 1 FROM coupon_usage cu JOIN orders o ON o.id = cu.order_id
      WHERE cu.coupon_id = r.coupon_id AND o.status IN ('cancelled', 'returned'))
    AND NOT EXISTS (
      SELECT 1 FROM coupon_usage cu JOIN orders o ON o.id = cu.order_id
      WHERE cu.coupon_id = r.coupon_id AND o.status NOT IN ('cancelled', 'returned'))
    AND NOT EXISTS (
      SELECT 1 FROM loyalty_ledger x WHERE x.reason = 'redeem_refund' AND x.coupon_id = r.coupon_id)`
}

// Thresholds are bound as three consecutive parameters starting at $first: silver, gold, platinum.
function tierLagSql(first: number): string {
  return `
  (CASE WHEN la.lifetime_points >= $${first + 2}::int THEN 3
        WHEN la.lifetime_points >= $${first + 1}::int THEN 2
        WHEN la.lifetime_points >= $${first}::int THEN 1 ELSE 0 END)
  > (CASE la.tier WHEN 'platinum' THEN 3 WHEN 'gold' THEN 2 WHEN 'silver' THEN 1 ELSE 0 END)`
}

function thresholdParams(settings: LoyaltySettings): number[] {
  return ['silver', 'gold', 'platinum'].map(
    key => settings.tiers.find(tier => tier.key === key)?.minPoints ?? Number.MAX_SAFE_INTEGER
  )
}

export interface ReconcileResult {
  enabled: boolean
  silent: boolean
  users: number
  earned: number
  reversed: number
  refunded: number
  upgrades: number
  failures: number
  more: boolean
}

interface UserOutcome {
  earned: number
  reversed: number
  refunded: number
  upgraded: boolean
}

interface OrderAction {
  order_id: string
  net: number
  base: number
  points_due: number
  state: 'earn' | 'reverse'
}

export async function lockLoyaltyUser(client: PoolClient, userId: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock($1::int, hashtext($2::text))`, [LOCK_NAMESPACE, userId])
}

export async function ensureLoyaltyAccount(client: PoolClient, userId: string): Promise<void> {
  await client.query(`INSERT INTO loyalty_accounts (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId])
}

// Upgrades made before the first full pass has finished are not stamped, so they are never emailed.
export async function refreshLoyaltyAccount(
  client: PoolClient,
  userId: string,
  settings: LoyaltySettings
): Promise<{ points: number; lifetimePoints: number; tier: string; upgraded: boolean }> {
  const sums = (
    await client.query<{ points: number; lifetime: number }>(
      `SELECT COALESCE(SUM(delta), 0)::int AS points,
              COALESCE(SUM(delta) FILTER (WHERE reason IN ('order_earn', 'order_reversal', 'adjustment')), 0)::int
                AS lifetime
       FROM loyalty_ledger WHERE user_id = $1`,
      [userId]
    )
  ).rows[0]
  const account = (
    await client.query<{ points: number; lifetime_points: number; tier: string }>(
      `SELECT points, lifetime_points, tier FROM loyalty_accounts WHERE user_id = $1 FOR UPDATE`,
      [userId]
    )
  ).rows[0]
  const target = tierForPoints(sums.lifetime, settings.tiers)
  const upgraded = tierRank(target.key) > tierRank(account.tier)
  const tier = upgraded ? target.key : account.tier
  if (sums.points !== account.points || sums.lifetime !== account.lifetime_points || upgraded) {
    await client.query(
      `UPDATE loyalty_accounts
          SET points = $2, lifetime_points = $3, tier = $4,
              tier_updated_at = CASE WHEN $5::boolean THEN NOW() ELSE tier_updated_at END,
              updated_at = NOW()
        WHERE user_id = $1`,
      [userId, sums.points, sums.lifetime, tier, upgraded && Boolean(settings.launchedAt)]
    )
  }
  return { points: sums.points, lifetimePoints: sums.lifetime, tier, upgraded }
}

async function reconcileUser(userId: string, settings: LoyaltySettings): Promise<UserOutcome> {
  return withTransaction(async client => {
    await lockLoyaltyUser(client, userId)
    const actions = (
      await client.query<OrderAction>(
        `${orderStatesCte(true)}
         SELECT order_id::text AS order_id, net, base::float8 AS base, points_due, state
         FROM states WHERE owner_id = $5::uuid AND state IN ('earn', 'reverse')`,
        [...orderStateParams(settings), userId]
      )
    ).rows
    const refunds = (
      await client.query<{ coupon_id: string; points: number }>(refundsDueSql('AND r.user_id = $1::uuid'), [userId])
    ).rows
    const hasAccount =
      (await client.query(`SELECT 1 FROM loyalty_accounts WHERE user_id = $1`, [userId])).rows.length > 0
    const outcome: UserOutcome = { earned: 0, reversed: 0, refunded: 0, upgraded: false }
    if (!hasAccount && actions.length === 0 && refunds.length === 0) return outcome

    await ensureLoyaltyAccount(client, userId)
    for (const action of actions) {
      if (action.state === 'earn') {
        await client.query(
          `INSERT INTO loyalty_ledger (user_id, delta, reason, order_id, base_amount)
           VALUES ($1, $2, 'order_earn', $3, $4)`,
          [userId, action.points_due, action.order_id, action.base]
        )
        outcome.earned += action.points_due
      } else {
        await client.query(
          `INSERT INTO loyalty_ledger (user_id, delta, reason, order_id) VALUES ($1, $2, 'order_reversal', $3)`,
          [userId, -action.net, action.order_id]
        )
        outcome.reversed += action.net
      }
    }
    for (const refund of refunds) {
      await client.query(
        `INSERT INTO loyalty_ledger (user_id, delta, reason, coupon_id) VALUES ($1, $2, 'redeem_refund', $3)`,
        [userId, refund.points, refund.coupon_id]
      )
      outcome.refunded += refund.points
    }
    outcome.upgraded = (await refreshLoyaltyAccount(client, userId, settings)).upgraded
    return outcome
  })
}

async function userHasWork(userId: string, settings: LoyaltySettings): Promise<boolean> {
  const row = await queryOne<{ pending: boolean }>(
    `${orderStatesCte(true)}
     SELECT (
       EXISTS (SELECT 1 FROM states WHERE owner_id = $5::uuid AND state IN ('earn', 'reverse'))
       OR EXISTS (${refundsDueSql('AND r.user_id = $5::uuid')})
       OR EXISTS (SELECT 1 FROM loyalty_accounts la WHERE la.user_id = $5::uuid AND ${tierLagSql(6)})
     ) AS pending`,
    [...orderStateParams(settings), userId, ...thresholdParams(settings)]
  )
  return row?.pending === true
}

async function findUsersWithWork(settings: LoyaltySettings, limit: number): Promise<string[]> {
  const rows = await queryMany<{ user_id: string }>(
    `${orderStatesCte(false)}
     SELECT user_id FROM (
       SELECT owner_id::text AS user_id FROM states WHERE state IN ('earn', 'reverse')
       UNION
       SELECT due.user_id FROM (${refundsDueSql('')}) due
       UNION
       SELECT la.user_id::text FROM loyalty_accounts la WHERE ${tierLagSql(5)}
     ) pending
     ORDER BY user_id
     LIMIT $8::int`,
    [...orderStateParams(settings), ...thresholdParams(settings), limit]
  )
  return rows.map(row => row.user_id)
}

export async function reconcileLoyalty(opts: { userId?: string; maxUsers?: number } = {}): Promise<ReconcileResult> {
  const settings = await getLoyaltySettings()
  const silent = !settings.launchedAt
  const result: ReconcileResult = {
    enabled: settings.enabled,
    silent,
    users: 0,
    earned: 0,
    reversed: 0,
    refunded: 0,
    upgrades: 0,
    failures: 0,
    more: false,
  }
  if (!settings.enabled) return result

  let userIds: string[]
  if (opts.userId) {
    userIds = (await userHasWork(opts.userId, settings)) ? [opts.userId] : []
  } else {
    const limit = opts.maxUsers ?? DEFAULT_MAX_USERS
    const found = await findUsersWithWork(settings, limit + 1)
    result.more = found.length > limit
    userIds = found.slice(0, limit)
  }

  for (const userId of userIds) {
    try {
      const outcome = await reconcileUser(userId, settings)
      result.users += 1
      result.earned += outcome.earned
      result.reversed += outcome.reversed
      result.refunded += outcome.refunded
      if (outcome.upgraded) result.upgrades += 1
    } catch (err) {
      result.failures += 1
      console.error('[loyalty] reconcile failed for user', userId, err)
    }
  }

  if (!opts.userId && silent && !result.more) await markLoyaltyLaunched()
  return result
}

export async function reconcileLoyaltyUntilDone(budgetMs = 20_000): Promise<ReconcileResult> {
  const deadline = Date.now() + budgetMs
  const total = await reconcileLoyalty()
  while (total.more && Date.now() < deadline) {
    const next = await reconcileLoyalty()
    total.users += next.users
    total.earned += next.earned
    total.reversed += next.reversed
    total.refunded += next.refunded
    total.upgrades += next.upgrades
    total.failures += next.failures
    total.more = next.more
    if (next.users === 0) break
  }
  return total
}
