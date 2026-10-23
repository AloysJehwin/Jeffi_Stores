import type { PoolClient } from 'pg'
import { queryOne, queryMany, withTransaction } from '@/lib/shared/db'
import { revokeAllForPrincipal } from '@/lib/auth/auth-sessions'
import { deleteOTP, resetSendOtpCounter } from '@/lib/auth/otp'
import { deleteObjectKey, deleteObjectsUnder } from '@/lib/shared/s3'

// Customer account erasure, as promised on /legal/account-deletion. The users row stays as an anonymised
// tombstone so orders, invoices, returns and subscription history keep their keys for GST and payment
// retention; the addresses those orders point at stay too (they are the invoice's buyer details).
// Everything else personal is deleted or blanked. Business accounts are closed through support.

export type DeletionVia = 'app' | 'web' | 'admin'

export interface DeletionBlocker {
  kind: 'open_orders' | 'open_returns' | 'active_subscription'
  count: number
  message: string
}

export interface DeletionCheck {
  blockers: DeletionBlocker[]
  retainedOrders: number
}

export type DeletionResult =
  | { ok: true; alreadyDeleted?: boolean; summary: Record<string, number> }
  | { ok: false; blockers: DeletionBlocker[] }
  | { ok: false; error: string; status: number }

const OPEN_ORDERS = `SELECT count(*)::int AS n FROM orders
  WHERE user_id = $1
    AND status NOT IN ('delivered', 'completed', 'cancelled', 'returned', 'refunded', 'draft')
    AND NOT (status = 'pending' AND payment_status IN ('unpaid', 'failed') AND created_at < now() - interval '1 day')`
const OPEN_RETURNS = `SELECT count(*)::int AS n FROM return_requests
  WHERE user_id = $1 AND resolved_at IS NULL AND status NOT IN ('rejected', 'cancelled', 'completed', 'refunded', 'closed')`
const ACTIVE_SUBSCRIPTIONS = `SELECT count(*)::int AS n FROM subscriptions
  WHERE user_id = $1 AND status IN ('active', 'authenticated', 'pending', 'halted', 'paused')`

type Count = (sql: string) => Promise<number>

async function blockersFor(count: Count): Promise<DeletionBlocker[]> {
  const [o, r, s] = await Promise.all([OPEN_ORDERS, OPEN_RETURNS, ACTIVE_SUBSCRIPTIONS].map(count))
  const out: DeletionBlocker[] = []
  if (o) out.push({ kind: 'open_orders', count: o, message: `${o} order${o > 1 ? 's are' : ' is'} still in progress. You can delete your account once ${o > 1 ? 'they are' : 'it is'} delivered or cancelled.` })
  if (r) out.push({ kind: 'open_returns', count: r, message: `${r} return or replacement request${r > 1 ? 's are' : ' is'} still open.` })
  if (s) out.push({ kind: 'active_subscription', count: s, message: 'Cancel your active subscription first.' })
  return out
}

const countFor =
  (userId: string, client?: PoolClient): Count =>
  async sql => {
    const row = client
      ? (await client.query<{ n: number }>(sql, [userId])).rows[0]
      : await queryOne<{ n: number }>(sql, [userId])
    return row?.n || 0
  }

export async function checkAccountDeletion(userId: string): Promise<DeletionCheck> {
  const [blockers, retainedOrders] = await Promise.all([
    blockersFor(countFor(userId)),
    countFor(userId)(`SELECT count(*)::int AS n FROM orders WHERE user_id = $1`),
  ])
  return { blockers, retainedOrders }
}

/** Phone formats message_logs.to_number may hold for a stored 10-digit or +91 number. */
function phoneVariants(phone: string | null): string[] {
  const d = (phone || '').replace(/\D/g, '')
  if (d.length < 10) return []
  const last10 = d.slice(-10)
  return [...new Set([phone!, d, last10, `91${last10}`, `+91${last10}`])]
}

export async function deleteCustomerAccount(
  userId: string,
  opts: { via: DeletionVia; adminId?: string | null; reason?: string | null }
): Promise<DeletionResult> {
  const user = await queryOne<{
    id: string
    email: string
    phone: string | null
    user_type: string
    avatar_s3_key: string | null
    deleted_at: string | null
  }>(`SELECT id, email, phone, user_type, avatar_s3_key, deleted_at FROM users WHERE id = $1`, [userId])
  if (!user) return { ok: false, error: 'Account not found', status: 404 }
  if (user.deleted_at) return { ok: true, alreadyDeleted: true, summary: {} }
  if (user.user_type === 'business') {
    return { ok: false, error: 'Business accounts are closed through support. Email support@jeffistores.in.', status: 400 }
  }

  const blockers = await blockersFor(countFor(userId))
  if (blockers.length) return { ok: false, blockers }

  const email = user.email.toLowerCase()
  const phones = phoneVariants(user.phone)
  const reviewIds = (await queryMany<{ id: string }>(`SELECT id FROM product_reviews WHERE user_id = $1`, [userId])).map(r => r.id)
  const noteKeys = (
    await queryMany<{ s3_key: string; s3_thumbnail_key: string | null }>(
      `SELECT a.s3_key, a.s3_thumbnail_key FROM customer_note_attachments a
         JOIN customer_notes n ON n.id = a.note_id WHERE n.user_id = $1`,
      [userId]
    )
  ).flatMap(a => [a.s3_key, a.s3_thumbnail_key].filter((k): k is string => !!k))

  await revokeAllForPrincipal('customer', userId)

  const summary: Record<string, number> = {}
  const raced = await withTransaction(async client => {
    await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [userId])
    const late = await blockersFor(countFor(userId, client))
    if (late.length) return late

    const run = async (key: string, sql: string, params: unknown[] = [userId]) => {
      const r = await client.query(sql, params)
      if (r.rowCount) summary[key] = (summary[key] || 0) + r.rowCount
    }

    await run('addresses', `DELETE FROM addresses a WHERE a.user_id = $1
      AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.shipping_address_id = a.id OR o.billing_address_id = a.id)`)
    for (const t of [
      'cart_items',
      'wishlist_items',
      'product_reviews',
      'user_search_history',
      'search_logs',
      'search_queries',
      'page_events',
      'product_views',
      'notifications',
      'support_sessions',
      'websocket_connections',
      'ai_feedback',
      'ai_queries',
      'customer_notes',
      'customer_profiles',
      'customer_tags',
      'customer_tasks',
      'customer_health_history',
      'customer_health',
      'customer_activity_log',
      'campaign_send_counts',
      'email_campaigns_sent',
      'coupon_eligible_users',
      'loyalty_ledger',
      'loyalty_accounts',
      'vault_tickets',
      'vault_entitlements',
      'vault_access_log',
      'pending_payment_intents',
      'message_logs',
    ]) {
      await run(t, `DELETE FROM ${t} WHERE user_id = $1`)
    }
    if (phones.length) await run('message_logs', `DELETE FROM message_logs WHERE to_number = ANY($1)`, [phones])
    await run('coupons', `DELETE FROM coupons c WHERE c.generated_for_user_id = $1
      AND NOT EXISTS (SELECT 1 FROM coupon_usage u WHERE u.coupon_id = c.id)`)
    await run('referrals', `DELETE FROM referral_signups WHERE referrer_user_id = $1 OR referred_user_id = $1`)
    await run('referrals', `DELETE FROM referrals WHERE referrer_user_id = $1`)
    await run('referrals', `UPDATE referrals SET referred_user_id = NULL, referred_email = NULL WHERE referred_user_id = $1`)
    await run('email_logs', `DELETE FROM email_logs WHERE user_id = $1 OR lower(email) = $2`, [userId, email])
    await run('email_logs', `DELETE FROM email_campaign_logs WHERE lower(email) = $1 OR lower(to_address) = $1`, [email])
    await run('login_history', `DELETE FROM failed_login_attempts WHERE user_id = $1 OR lower(email) = $2`, [userId, email])
    await run('login_history', `DELETE FROM otp_verifications WHERE lower(email) = $1`, [email])
    await run('back_in_stock', `DELETE FROM back_in_stock_notify WHERE lower(email) = $1`, [email])
    await run('sessions', `DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type IN ('customer', 'vault')`)
    await run('orders_anonymised', `UPDATE orders SET customer_email = NULL, customer_phone = NULL,
      gclid = NULL, gbraid = NULL, wbraid = NULL, meta_click_ids = NULL WHERE user_id = $1`)

    await client.query(
      `UPDATE users SET email = 'deleted-' || id || '@deleted.invalid', phone = NULL, first_name = 'Deleted',
         last_name = 'customer', password_hash = NULL, last_login = NULL, is_active = false, session_id = NULL,
         is_flagged = false, flag_reason = NULL, google_id = NULL, marketing_opt_out = true,
         marketing_opt_out_at = now(), unsubscribe_token = gen_random_uuid(), avatar_url = NULL,
         avatar_s3_key = NULL, avatar_is_custom = false, policies_accepted_version = NULL,
         policies_accepted_at = NULL, phone_verified = false, phone_verified_at = NULL, date_of_birth = NULL,
         deleted_at = now(), updated_at = now()
       WHERE id = $1`,
      [userId]
    )
    await client.query(
      `INSERT INTO account_deletions (user_id, requested_via, performed_by_admin_id, reason, summary)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, opts.via, opts.adminId ?? null, opts.reason?.slice(0, 500) || null, JSON.stringify(summary)]
    )
    return null
  })
  if (raced) return { ok: false, blockers: raced }

  await Promise.all([deleteOTP(email), resetSendOtpCounter(email)]).catch(() => {})
  const files = [
    ...(user.avatar_s3_key ? [deleteObjectKey(user.avatar_s3_key)] : []),
    ...noteKeys.map(k => deleteObjectKey(k)),
    ...reviewIds.map(id => deleteObjectsUnder(`reviews/${id}/`)),
  ]
  const settled = await Promise.allSettled(files)
  const failed = settled.filter(r => r.status === 'rejected').length
  if (failed) console.error(`[account-deletion] ${failed} file(s) for user ${userId} could not be deleted`)
  return { ok: true, summary }
}
