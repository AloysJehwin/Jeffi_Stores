import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, resolveCoupon, sendCampaignEmail, renderItemRows } from '@/lib/shared/automation-emails'
import { PRODUCT_IN_STOCK_SQL } from '@/lib/queries/shared'
import { SAVED_ITEMS_SQL } from './_wishlist-base'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days, minutes, readDurationParam, cooldownMinutes } from '../duration'
import type { ScenarioModule } from '../types'

interface Params extends Record<string, unknown> {
  idleFor: number
  maxItemsPerEmail: number
  maxRecipientsPerSweep: number
  whatsappEnabled: boolean
}

interface Row {
  user_id: string
}

export const wishlistReminder: ScenarioModule<Params, Row> = {
  kind: 'wishlist_reminder',
  name: 'Wishlist Reminder',
  description: 'Customer has an untouched, in-stock saved item they never ordered',
  trigger:
    "Fires when a product has sat on the wishlist or in the cart's Saved for later, untouched, for at least the idle window, is still in stock, and was never ordered by the user. Sends at most once per cooldown window per user. Skipped for guests, inactive accounts, and marketing opt-outs.",
  defaultParams: {
    idleFor: days(14),
    maxItemsPerEmail: 4,
    maxRecipientsPerSweep: 100,
    whatsappEnabled: false,
  },
  paramSchema: {
    idleFor: {
      type: 'duration',
      min: minutes(1),
      max: days(180),
      recommendedUnit: 'days',
      label: 'Idle window',
      description: 'Only remind about wishlist items untouched for at least this long',
    },
    maxItemsPerEmail: {
      type: 'integer',
      min: 1,
      max: 10,
      label: 'Items shown in email',
      description: 'Cap on wishlist items rendered in the email body',
    },
    maxRecipientsPerSweep: {
      type: 'integer',
      min: 1,
      max: 500,
      label: 'Max recipients per run',
      description: 'Hard limit per sweep',
    },
    whatsappEnabled: {
      type: 'boolean',
      label: 'Also send via WhatsApp',
      description: "Additionally send this campaign to the customer's WhatsApp when a phone number is on file",
    },
  },

  async findEligible({ campaign, params }) {
    const idleMin = readDurationParam(params, 'idleFor') ?? days(14)
    const cooldownMin = cooldownMinutes(params)

    return queryMany<Row>(
      `
      SELECT DISTINCT wi.user_id::text
      FROM ${SAVED_ITEMS_SQL} wi
      JOIN users u ON u.id = wi.user_id
      JOIN products p ON p.id = wi.product_id
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      WHERE wi.user_id IS NOT NULL
        AND wi.saved_at < NOW() - ($2::text || ' minutes')::interval
        AND p.is_active = TRUE
        AND ${PRODUCT_IN_STOCK_SQL}
        AND u.is_active = TRUE
        AND u.is_guest = FALSE
        AND u.marketing_opt_out = FALSE
        AND (bp.user_id IS NULL OR bp.approval_status != 'approved')
        AND NOT EXISTS (
          SELECT 1 FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          WHERE o.user_id = wi.user_id
            AND oi.product_id = wi.product_id
            AND o.status NOT IN ('cancelled', 'refunded')
        )
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = $1
            AND ecs.user_id = wi.user_id
            AND ecs.sent_at > NOW() - ($3::text || ' minutes')::interval
        )
      LIMIT $4
    `,
      [campaign.kind, String(idleMin), String(cooldownMin), params.maxRecipientsPerSweep]
    )
  },

  async findSuppressed({ campaign, params }) {
    const idleMin = readDurationParam(params, 'idleFor') ?? days(14)
    const cooldownMin = cooldownMinutes(params)

    const rows = await queryMany<{
      user_id: string
      reason: string
      reason_detail: string | null
      blocked_until: string | null
    }>(
      `
      WITH wishers AS (
        SELECT DISTINCT wi.user_id
        FROM ${SAVED_ITEMS_SQL} wi
        WHERE wi.user_id IS NOT NULL
          AND wi.saved_at < NOW() - ($2::text || ' minutes')::interval
      )
      SELECT
        w.user_id::text,
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
          WHEN ecs.sent_at IS NOT NULL THEN (ecs.sent_at + ($3::text || ' minutes')::interval)::text
          ELSE NULL
        END AS blocked_until
      FROM wishers w
      JOIN users u ON u.id = w.user_id
      LEFT JOIN LATERAL (
        SELECT sent_at FROM email_campaigns_sent
         WHERE campaign_kind = $1 AND user_id = w.user_id
           AND sent_at > NOW() - ($3::text || ' minutes')::interval
         ORDER BY sent_at DESC LIMIT 1
      ) ecs ON TRUE
      WHERE u.is_active = FALSE OR u.is_guest = TRUE OR u.marketing_opt_out = TRUE OR ecs.sent_at IS NOT NULL
      LIMIT 200
    `,
      [campaign.kind, String(idleMin), String(cooldownMin)]
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
      product_id: string
      product_slug: string | null
      name: string
      source: 'wishlist' | 'cart'
      price: number
      image_url: string | null
    }>(
      `
      SELECT p.id::text AS product_id, p.slug AS product_slug, p.name, wi.source,
             p.base_price::float AS price,
             (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY display_order ASC LIMIT 1) AS image_url
      FROM ${SAVED_ITEMS_SQL} wi
      JOIN products p ON p.id = wi.product_id
      WHERE wi.user_id = $1 AND p.is_active = TRUE AND ${PRODUCT_IN_STOCK_SQL}
      ORDER BY wi.saved_at ASC
      LIMIT $2
    `,
      [row.user_id, params.maxItemsPerEmail]
    )
    if (items.length === 0) return { ok: false, reason: 'no_items' }

    const itemsHtml = renderItemRows(
      items.slice(0, params.maxItemsPerEmail).map(i => ({
        name: i.name,
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
        itemsHtml,
        cartItems: itemsHtml,
        couponCode,
        discountPercent,
        // Saved-for-later items live on the cart page, so send them there when nothing is on the wishlist.
        ctaUrl: `${user.baseUrl}/${items.some(i => i.source === 'wishlist') ? 'wishlist' : 'cart'}`,
      },
    })

    if (params.whatsappEnabled) {
      sendCampaignWhatsApp(campaign.kind, row.user_id, { items: summary }, cooldownMinutes(params)).catch(() => {})
    }
    return emailResult
  },
}
