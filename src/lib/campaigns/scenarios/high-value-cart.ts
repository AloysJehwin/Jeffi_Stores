import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, resolveCoupon, sendCampaignEmail, renderItemRows } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days, minutes, hours, readDurationParam, cooldownMinutes, cooldownDays } from '../duration'
import type { ScenarioModule } from '../types'

// A priority tier of abandoned_cart: fires only for carts whose subtotal is AT OR ABOVE minCartValue.
// To avoid double-sending with abandoned_cart, abandoned_cart must be constrained to carts BELOW the same
// floor (the parent owns that guard on abandoned-cart.ts). This scenario records its own dedup marker, so a
// user can never receive both tiers for the same cart within the cooldown window.
interface Params extends Record<string, unknown> {
  lookback: number
  sendCooldown: number
  minCartValue: number
  maxRecipientsPerSweep: number
  maxItemsPerEmail: number
  whatsappEnabled: boolean
}

interface Row {
  user_id: string
}

export const highValueCart: ScenarioModule<Params, Row> = {
  kind: 'high_value_cart',
  name: 'High-Value Cart',
  description: 'Customer left a high-value cart without checking out (priority abandoned-cart tier)',
  trigger:
    "Fires when a logged-in customer's active cart subtotal is at or above the configured value floor, the cart has been idle for at least the campaign's delay, and has not been checked out. Mutually exclusive with the standard abandoned-cart campaign (which handles carts below the floor). Sends at most once per cooldown window per user.",
  defaultParams: {
    lookback: days(7),
    sendCooldown: days(7),
    minCartValue: 5000,
    maxRecipientsPerSweep: 50,
    maxItemsPerEmail: 5,
    whatsappEnabled: false,
  },
  paramSchema: {
    lookback: {
      type: 'duration',
      min: minutes(1),
      max: days(90),
      recommendedUnit: 'days',
      label: 'Lookback window',
      description: 'Only consider carts updated within this window',
    },
    sendCooldown: {
      type: 'duration',
      min: minutes(1),
      max: days(30),
      recommendedUnit: 'days',
      label: 'Per-user cooldown',
      description: 'Skip users sent this campaign within this window',
    },
    minCartValue: {
      type: 'integer',
      min: 1,
      max: 1000000,
      label: 'Minimum cart value',
      description: 'Only email carts whose subtotal is at or above this amount',
    },
    maxRecipientsPerSweep: {
      type: 'integer',
      min: 1,
      max: 500,
      label: 'Max recipients per run',
      description: 'Hard limit per sweep',
    },
    maxItemsPerEmail: {
      type: 'integer',
      min: 1,
      max: 10,
      label: 'Items shown in email',
      description: 'Cap on cart items rendered in the email body',
    },
    whatsappEnabled: {
      type: 'boolean',
      label: 'Also send via WhatsApp',
      description: "Additionally send this campaign to the customer's WhatsApp when a phone number is on file",
    },
  },

  async findEligible({ campaign, params }) {
    const lookbackMin = readDurationParam(params, 'lookback') ?? days(7)
    const cooldownMin = cooldownMinutes(params)

    return queryMany<Row>(
      `
      SELECT ci.user_id::text
      FROM cart_items ci
      JOIN users u ON u.id = ci.user_id
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      WHERE ci.saved_for_later = FALSE
        AND ci.updated_at < NOW() - ($2::text || ' hours')::interval
        AND ci.updated_at > NOW() - ($3::text || ' minutes')::interval
        AND u.is_active = TRUE
        AND u.is_guest = FALSE
        AND u.marketing_opt_out = FALSE
        AND (bp.user_id IS NULL OR bp.approval_status != 'approved')
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = $1
            AND ecs.user_id = ci.user_id
            AND ecs.sent_at > NOW() - ($4::text || ' minutes')::interval
        )
      GROUP BY ci.user_id
      HAVING SUM(ci.price_at_addition * ci.quantity) >= $5
      ORDER BY SUM(ci.price_at_addition * ci.quantity) DESC
      LIMIT $6
    `,
      [
        campaign.kind,
        campaign.delay_hours,
        String(lookbackMin),
        String(cooldownMin),
        params.minCartValue,
        params.maxRecipientsPerSweep,
      ]
    )
  },

  async findSuppressed({ campaign, params }) {
    const lookbackMin = readDurationParam(params, 'lookback') ?? days(7)
    const cooldownMin = cooldownMinutes(params)

    const rows = await queryMany<{
      user_id: string
      reason: string
      reason_detail: string | null
      blocked_until: string | null
    }>(
      `
      WITH carts AS (
        SELECT ci.user_id, SUM(ci.price_at_addition * ci.quantity) AS cart_value
        FROM cart_items ci
        WHERE ci.saved_for_later = FALSE
          AND ci.updated_at < NOW() - ($2::text || ' hours')::interval
          AND ci.updated_at > NOW() - ($3::text || ' minutes')::interval
        GROUP BY ci.user_id
        HAVING SUM(ci.price_at_addition * ci.quantity) >= $5
      )
      SELECT
        c.user_id::text,
        CASE
          WHEN u.is_active = FALSE OR u.is_guest = TRUE THEN 'inactive'
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
          WHEN ecs.sent_at IS NOT NULL THEN (ecs.sent_at + ($4::text || ' minutes')::interval)::text
          ELSE NULL
        END AS blocked_until
      FROM carts c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN LATERAL (
        SELECT sent_at FROM email_campaigns_sent
         WHERE campaign_kind = $1 AND user_id = c.user_id
           AND sent_at > NOW() - ($4::text || ' minutes')::interval
         ORDER BY sent_at DESC LIMIT 1
      ) ecs ON TRUE
      WHERE u.is_active = FALSE OR u.is_guest = TRUE OR u.marketing_opt_out = TRUE OR ecs.sent_at IS NOT NULL
      LIMIT 200
    `,
      [campaign.kind, campaign.delay_hours, String(lookbackMin), String(cooldownMin), params.minCartValue]
    )
    return rows.map(r => ({
      user_id: r.user_id,
      reason: r.reason as any,
      reason_detail: r.reason_detail,
      blocked_until: r.blocked_until,
    }))
  },

  async send(row, { campaign, params }) {
    const user = await fetchUserContext(row.user_id)
    if (!user) return { ok: false, reason: 'no_user' }

    const items = await queryMany<{
      product_slug: string | null
      name: string
      quantity: number
      price: number
      image_url: string | null
    }>(
      `
      SELECT p.slug AS product_slug, p.name,
             ci.quantity::float AS quantity,
             COALESCE(pv.price, p.base_price)::float AS price,
             (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY display_order ASC LIMIT 1) AS image_url
      FROM cart_items ci
      JOIN products p ON p.id = ci.product_id
      LEFT JOIN product_variants pv ON pv.id = ci.variant_id
      WHERE ci.user_id = $1 AND ci.saved_for_later = FALSE
      LIMIT $2
    `,
      [row.user_id, params.maxItemsPerEmail]
    )
    if (items.length === 0) return { ok: false, reason: 'no_items' }

    const itemsHtml = renderItemRows(
      items.map(i => ({
        name: i.name,
        quantity: i.quantity,
        price: i.price,
        imageUrl: i.image_url,
        productUrl: i.product_slug ? `${user.baseUrl}/products/${i.product_slug}` : null,
      }))
    )

    const { couponCode, discountPercent } = await resolveCoupon(campaign, row.user_id)
    const names = items.map(i => i.name)
    const summary = names.slice(0, 3).join(', ') + (names.length > 3 ? ` and ${names.length - 3} more` : '')

    const emailResult = await sendCampaignEmail({
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

    if (params.whatsappEnabled) {
      sendCampaignWhatsApp(campaign.kind, row.user_id, { items: summary }, cooldownDays(params)).catch(() => {})
    }
    return emailResult
  },
}
