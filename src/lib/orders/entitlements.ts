import 'server-only'
import type { PoolClient } from 'pg'

/**
 * Vault entitlements: the per-order_item record that lets a buyer open a digital file in the vault.
 *
 * Grants are created INSIDE the caller's paid-commit transaction (commitOrder, the subscription
 * cycle commit, and the admin/webhook mark-paid paths all pass their own client), so a grant can
 * never exist without the committed order. They are idempotent per order_item via the UNIQUE
 * vault_entitlements_order_item_id_key, so the verify-endpoint/webhook race can't double-grant.
 *
 * Revocation is the refund counterpart: a full or per-line refund flips the matching entitlements
 * to 'revoked' and stamps order_items.access_revoked_at. The vault refuses revoked/expired rows.
 */

export interface GrantInput {
  orderId: string
  userId: string
  /** 'one_time' for a normal purchase, 'subscription' for a renewal cycle. */
  source?: 'one_time' | 'subscription'
  subscriptionId?: string | null
  /** For subscription access: when access lapses (paid-period end + grace). NULL = permanent. */
  accessExpiresAt?: Date | string | null
}

/**
 * Grant vault access for every DIGITAL line of an order. Reads order_items.is_digital (the snapshot
 * taken at order creation), so non-digital lines are skipped. Also stamps order_items.granted_at.
 * Returns the number of lines granted. Safe to call more than once (idempotent).
 */
export async function grantOrderEntitlements(client: PoolClient, input: GrantInput): Promise<number> {
  const { orderId, userId, source = 'one_time', subscriptionId = null, accessExpiresAt = null } = input

  const res = await client.query<{ id: string }>(
    `
    INSERT INTO vault_entitlements
      (user_id, product_id, order_id, order_item_id, source, status, subscription_id, access_expires_at, granted_at)
    SELECT $2, oi.product_id, oi.order_id, oi.id, $3, 'active', $4, $5, NOW()
    FROM order_items oi
    WHERE oi.order_id = $1
      AND oi.is_digital = TRUE
      AND oi.product_id IS NOT NULL
    ON CONFLICT (order_item_id) DO UPDATE SET
      -- A subscription renewal re-extends access on the same entitlement row.
      status = 'active',
      access_revoked_at = NULL,
      revoked_at = NULL,
      revoke_reason = NULL,
      access_expires_at = EXCLUDED.access_expires_at,
      updated_at = NOW()
    RETURNING id
    `,
    [orderId, userId, source, subscriptionId, accessExpiresAt]
  )

  if (res.rowCount && res.rowCount > 0) {
    await client.query(
      `UPDATE order_items SET granted_at = COALESCE(granted_at, NOW()), access_revoked_at = NULL
       WHERE order_id = $1 AND is_digital = TRUE`,
      [orderId]
    )
  }
  return res.rowCount ?? 0
}

/**
 * Revoke vault access. Pass orderItemIds to revoke only specific lines (a per-line refund); omit it
 * to revoke the whole order (a full refund/chargeback). Returns the number of lines revoked.
 */
export async function revokeOrderEntitlements(
  client: PoolClient,
  opts: { orderId: string; orderItemIds?: string[]; reason?: string }
): Promise<number> {
  const { orderId, orderItemIds, reason = 'refund' } = opts
  const scoped = orderItemIds && orderItemIds.length > 0

  const res = await client.query(
    `
    UPDATE vault_entitlements
    SET status = 'revoked', revoked_at = NOW(), revoke_reason = $2, updated_at = NOW()
    WHERE order_id = $1
      AND status = 'active'
      ${scoped ? 'AND order_item_id = ANY($3::uuid[])' : ''}
    `,
    scoped ? [orderId, reason.slice(0, 40), orderItemIds] : [orderId, reason.slice(0, 40)]
  )

  await client.query(
    `UPDATE order_items SET access_revoked_at = NOW()
     WHERE order_id = $1 ${scoped ? 'AND id = ANY($2::uuid[])' : 'AND is_digital = TRUE'}`,
    scoped ? [orderId, orderItemIds] : [orderId]
  )
  return res.rowCount ?? 0
}
