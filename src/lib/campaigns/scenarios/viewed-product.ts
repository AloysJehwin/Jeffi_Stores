import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, resolveCoupon, sendCampaignEmail, renderItemRows } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days, minutes, hours, readDurationParam, cooldownMinutes } from '../duration'
import type { ScenarioModule } from '../types'

interface Params extends Record<string, unknown> {
  lookback: number
  viewSettle: number
  sendCooldown: number
  maxRecipientsPerSweep: number
  maxItemsPerEmail: number
  whatsappEnabled: boolean
  smsEnabled: boolean
}

interface Row {
  user_id: string
  product_id: string
}

export const viewedProduct: ScenarioModule<Params, Row> = {
  kind: 'viewed_product',
  name: 'Viewed Product',
  description: 'Customer viewed a product but did not add it to cart or buy it',
  trigger:
    'Fires when a logged-in customer viewed a product, left it to settle for the configured delay, and has not added it to cart or ordered it since. Sends at most once per cooldown window per user. Skipped for guests, inactive accounts, and marketing opt-outs.',
  defaultParams: {
    lookback: days(14),
    viewSettle: hours(6),
    sendCooldown: days(7),
    maxRecipientsPerSweep: 50,
    maxItemsPerEmail: 4,
    whatsappEnabled: false,
    smsEnabled: false,
  },
  paramSchema: {
    lookback: {
      type: 'duration',
      min: minutes(1),
      max: days(90),
      recommendedUnit: 'days',
      label: 'Lookback window',
      description: 'Only consider product views within this window',
    },
    viewSettle: {
      type: 'duration',
      min: minutes(1),
      max: days(7),
      recommendedUnit: 'hours',
      label: 'View settle delay',
      description: 'Wait this long after the view before reaching out',
    },
    sendCooldown: {
      type: 'duration',
      min: minutes(1),
      max: days(30),
      recommendedUnit: 'days',
      label: 'Per-user cooldown',
      description: 'Skip users sent this campaign within this window',
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
      description: 'Cap on products rendered in the email body',
    },
    whatsappEnabled: {
      type: 'boolean',
      label: 'Also send via WhatsApp',
      description: "Additionally send this campaign to the customer's WhatsApp when a phone number is on file",
    },
    smsEnabled: {
      type: 'boolean',
      label: 'Also send via SMS',
      description: "Additionally send this campaign as a text SMS when a phone number is on file (off by default)",
    },
  },

  async findEligible({ campaign, params }) {
    const lookbackMin = readDurationParam(params, 'lookback') ?? days(14)
    const settleMin = readDurationParam(params, 'viewSettle') ?? hours(6)
    const cooldownMin = cooldownMinutes(params)

    return queryMany<Row>(
      `
      SELECT DISTINCT ON (pv.user_id) pv.user_id::text, pv.product_id::text
      FROM product_views pv
      JOIN users u ON u.id = pv.user_id
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      WHERE pv.user_id IS NOT NULL
        AND pv.created_at < NOW() - ($2::text || ' minutes')::interval
        AND pv.created_at > NOW() - ($3::text || ' minutes')::interval
        AND u.is_active = TRUE
        AND u.is_guest = FALSE
        AND u.marketing_opt_out = FALSE
        AND (bp.user_id IS NULL OR bp.approval_status != 'approved')
        AND NOT EXISTS (
          SELECT 1 FROM cart_items ci
          WHERE ci.user_id = pv.user_id AND ci.product_id = pv.product_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          WHERE o.user_id = pv.user_id
            AND oi.product_id = pv.product_id
            AND o.status NOT IN ('cancelled', 'refunded')
            AND o.created_at > pv.created_at
        )
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = $1
            AND ecs.channel = 'email'
            AND ecs.user_id = pv.user_id
            AND ecs.sent_at > NOW() - ($4::text || ' minutes')::interval
        )
      ORDER BY pv.user_id, pv.created_at DESC
      LIMIT $5
    `,
      [campaign.kind, String(settleMin), String(lookbackMin), String(cooldownMin), params.maxRecipientsPerSweep]
    )
  },

  async findSuppressed({ campaign, params }) {
    const lookbackMin = readDurationParam(params, 'lookback') ?? days(14)
    const settleMin = readDurationParam(params, 'viewSettle') ?? hours(6)
    const cooldownMin = cooldownMinutes(params)

    const rows = await queryMany<{
      user_id: string
      reason: string
      reason_detail: string | null
      blocked_until: string | null
    }>(
      `
      WITH viewers AS (
        SELECT DISTINCT pv.user_id, MAX(pv.created_at) AS last_view
        FROM product_views pv
        WHERE pv.user_id IS NOT NULL
          AND pv.created_at < NOW() - ($2::text || ' minutes')::interval
          AND pv.created_at > NOW() - ($3::text || ' minutes')::interval
        GROUP BY pv.user_id
      )
      SELECT
        v.user_id::text,
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
      FROM viewers v
      JOIN users u ON u.id = v.user_id
      LEFT JOIN LATERAL (
        SELECT sent_at FROM email_campaigns_sent
         WHERE campaign_kind = $1 AND user_id = v.user_id
           AND channel = 'email'
           AND sent_at > NOW() - ($4::text || ' minutes')::interval
         ORDER BY sent_at DESC LIMIT 1
      ) ecs ON TRUE
      WHERE u.is_active = FALSE OR u.is_guest = TRUE OR u.marketing_opt_out = TRUE OR ecs.sent_at IS NOT NULL
      LIMIT 200
    `,
      [campaign.kind, String(settleMin), String(lookbackMin), String(cooldownMin)]
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
      price: number
      image_url: string | null
    }>(
      `
      SELECT p.id::text AS product_id, p.slug AS product_slug, p.name,
             p.base_price::float AS price,
             (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY display_order ASC LIMIT 1) AS image_url
      FROM products p
      WHERE p.id = $1
      LIMIT 1
    `,
      [row.product_id]
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
    const primary = items[0]

    const emailResult = await sendCampaignEmail({
      campaign,
      user,
      referenceId: row.product_id,
      vars: {
        firstName: user.first_name || 'there',
        productName: primary.name,
        itemsHtml,
        cartItems: itemsHtml,
        couponCode,
        discountPercent,
        ctaUrl: primary.product_slug ? `${user.baseUrl}/products/${primary.product_slug}` : `${user.baseUrl}/products`,
      },
    })

    if (params.whatsappEnabled || (params as any).smsEnabled) {
      sendCampaignWhatsApp(campaign.kind, row.user_id, { items: primary.name, imageUrl: primary.image_url ?? undefined, url: primary.product_slug ? `${user.baseUrl}/products/${primary.product_slug}` : `${user.baseUrl}/products` }, cooldownMinutes(params)).catch(() => {})
    }
    return emailResult
  },
}
