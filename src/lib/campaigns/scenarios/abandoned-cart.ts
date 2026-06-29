import { queryMany } from '@/lib/db'
import {
  fetchUserContext,
  resolveCoupon,
  sendCampaignEmail,
  renderItemRows,
} from '@/lib/automation-emails'
import type { ScenarioModule } from '../types'

interface Params extends Record<string, unknown> {
  lookbackDays: number
  sendCooldownDays: number
  maxRecipientsPerSweep: number
  maxItemsPerEmail: number
}

interface Row {
  user_id: string
}

export const abandonedCart: ScenarioModule<Params, Row> = {
  kind: 'abandoned_cart',
  name: 'Abandoned Cart',
  description: 'Customer left items in cart without checking out',
  trigger: 'Fires when a logged-in customer adds items to their cart, then leaves the cart untouched for at least the campaign\'s delay (in hours). Sends at most once per cooldown window per user. Skipped if cart is empty or if user opted out of marketing.',
  defaultParams: {
    lookbackDays: 30,
    sendCooldownDays: 7,
    maxRecipientsPerSweep: 50,
    maxItemsPerEmail: 5,
  },
  paramSchema: {
    lookbackDays:          { type: 'integer', min: 1, max: 90,  label: 'Lookback (days)',          description: 'Only consider carts updated in the last N days' },
    sendCooldownDays:      { type: 'integer', min: 1, max: 30,  label: 'Per-user cooldown (days)', description: 'Skip users sent this campaign within N days' },
    maxRecipientsPerSweep: { type: 'integer', min: 1, max: 500, label: 'Max recipients per run',   description: 'Hard limit per sweep' },
    maxItemsPerEmail:      { type: 'integer', min: 1, max: 10,  label: 'Items shown in email',     description: 'Cap on cart items rendered in the email body' },
  },

  async findEligible({ campaign, params }) {
    return queryMany<Row>(`
      SELECT DISTINCT ci.user_id
      FROM cart_items ci
      JOIN users u ON u.id = ci.user_id
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      WHERE ci.saved_for_later = FALSE
        AND ci.updated_at < NOW() - ($2 || ' hours')::interval
        AND ci.updated_at > NOW() - ($3 || ' days')::interval
        AND u.is_active = TRUE
        AND u.is_guest = FALSE
        AND u.marketing_opt_out = FALSE
        AND (bp.user_id IS NULL OR bp.approval_status != 'approved')
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = $1
            AND ecs.user_id = ci.user_id
            AND ecs.sent_at > NOW() - ($4 || ' days')::interval
        )
      LIMIT $5
    `, [campaign.kind, campaign.delay_hours, params.lookbackDays, params.sendCooldownDays, params.maxRecipientsPerSweep])
  },

  async findSuppressed({ campaign, params }) {
    const rows = await queryMany<{ user_id: string; reason: string; reason_detail: string | null; blocked_until: string | null }>(`
      WITH eligible_carts AS (
        SELECT DISTINCT ci.user_id
        FROM cart_items ci
        WHERE ci.saved_for_later = FALSE
          AND ci.updated_at < NOW() - ($2 || ' hours')::interval
          AND ci.updated_at > NOW() - ($3 || ' days')::interval
      )
      SELECT
        ec.user_id::text,
        CASE
          WHEN u.is_active = FALSE THEN 'inactive'
          WHEN u.is_guest = TRUE THEN 'inactive'
          WHEN u.marketing_opt_out = TRUE THEN 'opted_out'
          WHEN ecs.sent_at IS NOT NULL THEN 'cooldown'
          ELSE 'other'
        END AS reason,
        CASE
          WHEN ecs.sent_at IS NOT NULL THEN 'Sent ' || to_char(ecs.sent_at, 'DD Mon HH24:MI')
          WHEN u.marketing_opt_out THEN 'Marketing opt-out enabled'
          WHEN u.is_guest THEN 'Guest user'
          WHEN NOT u.is_active THEN 'Account inactive'
          ELSE NULL
        END AS reason_detail,
        CASE
          WHEN ecs.sent_at IS NOT NULL THEN (ecs.sent_at + ($4 || ' days')::interval)::text
          ELSE NULL
        END AS blocked_until
      FROM eligible_carts ec
      JOIN users u ON u.id = ec.user_id
      LEFT JOIN LATERAL (
        SELECT sent_at FROM email_campaigns_sent
         WHERE campaign_kind = $1
           AND user_id = ec.user_id
           AND sent_at > NOW() - ($4 || ' days')::interval
         ORDER BY sent_at DESC LIMIT 1
      ) ecs ON TRUE
      WHERE u.is_active = FALSE OR u.is_guest = TRUE OR u.marketing_opt_out = TRUE OR ecs.sent_at IS NOT NULL
      LIMIT 200
    `, [campaign.kind, campaign.delay_hours, params.lookbackDays, params.sendCooldownDays])
    return rows.map(r => ({
      user_id: r.user_id,
      reason: r.reason as any,
      reason_detail: r.reason_detail,
      blocked_until: r.blocked_until,
    }))
  },

  async send(row, { campaign, params }) {
    const items = await queryMany<{ product_id: string; product_slug: string | null; name: string; quantity: number; price: number; image_url: string | null }>(`
      SELECT p.id::text AS product_id,
             p.slug AS product_slug,
             p.name,
             ci.quantity::float AS quantity,
             COALESCE(pv.price, p.base_price)::float AS price,
             (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY display_order ASC LIMIT 1) AS image_url
      FROM cart_items ci
      JOIN products p ON p.id = ci.product_id
      LEFT JOIN product_variants pv ON pv.id = ci.variant_id
      WHERE ci.user_id = $1 AND ci.saved_for_later = FALSE
      LIMIT $2
    `, [row.user_id, params.maxItemsPerEmail])
    if (items.length === 0) return { ok: false, reason: 'no_items' }

    const user = await fetchUserContext(row.user_id)
    if (!user) return { ok: false, reason: 'no_user' }

    const itemsHtml = renderItemRows(
      items.slice(0, params.maxItemsPerEmail).map(i => ({
        name: i.name,
        quantity: i.quantity,
        price: i.price,
        imageUrl: i.image_url,
        productUrl: i.product_slug ? `${user.baseUrl}/products/${i.product_slug}` : null,
      }))
    )

    const { couponCode, discountPercent } = await resolveCoupon(campaign, row.user_id)

    return sendCampaignEmail({
      campaign,
      user,
      referenceId: null,
      vars: {
        firstName: user.first_name || 'there',
        itemCount: items.length,
        cartItems: itemsHtml,
        itemsHtml,
        couponCode,
        discountPercent,
        ctaUrl: `${user.baseUrl}/cart`,
      },
    })
  },
}
