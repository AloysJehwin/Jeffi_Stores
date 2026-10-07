import { queryMany } from '@/lib/shared/db'
import {
  fetchUserContext,
  resolveCoupon,
  sendCampaignEmail,
  renderItemRows,
} from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days, hours, readDurationParam, cooldownMinutes, cooldownDays } from '../duration'
import type { ScenarioModule } from '../types'

interface Params extends Record<string, unknown> {
  lookback: number
  viewSettle: number
  sendCooldown: number
  minViews: number
  maxRecipientsPerSweep: number
  maxItemsPerEmail: number
  whatsappEnabled: boolean
}

interface Row {
  user_id: string
  category_id: string
}

export const viewedCategory: ScenarioModule<Params, Row> = {
  kind: 'viewed_category',
  name: 'Viewed Category',
  description: 'Customer browsed several products in a category but bought nothing from it',
  trigger:
    'Fires when a logged-in customer viewed at least the configured number of distinct products in one category within the lookback window, let them settle, and has not ordered anything from that category since. Sends at most once per cooldown window per user. Skipped for guests, inactive accounts, and marketing opt-outs.',
  defaultParams: {
    lookback: days(14),
    viewSettle: hours(6),
    sendCooldown: days(7),
    minViews: 2,
    maxRecipientsPerSweep: 50,
    maxItemsPerEmail: 4,
    whatsappEnabled: false,
  },
  paramSchema: {
    lookback: {
      type: 'duration',
      min: hours(1),
      max: days(90),
      recommendedUnit: 'days',
      label: 'Lookback window',
      description: 'Only consider product views within this window',
    },
    viewSettle: {
      type: 'duration',
      min: hours(1),
      max: days(7),
      recommendedUnit: 'hours',
      label: 'View settle delay',
      description: 'Wait this long after the latest view before reaching out',
    },
    sendCooldown: {
      type: 'duration',
      min: hours(1),
      max: days(30),
      recommendedUnit: 'days',
      label: 'Per-user cooldown',
      description: 'Skip users sent this campaign within this window',
    },
    minViews: {
      type: 'integer',
      min: 1,
      max: 20,
      label: 'Minimum products viewed',
      description: 'Distinct products the customer must have viewed in the category',
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
  },

  async findEligible({ campaign, params }) {
    const lookbackMin = readDurationParam(params, 'lookback') ?? days(14)
    const settleMin = readDurationParam(params, 'viewSettle') ?? hours(6)
    const cooldownMin = cooldownMinutes(params)

    return queryMany<Row>(
      `
      SELECT user_id::text, category_id::text
      FROM (
        SELECT pv.user_id, p.category_id,
               COUNT(DISTINCT pv.product_id) AS views,
               MAX(pv.created_at) AS last_view
        FROM product_views pv
        JOIN users u ON u.id = pv.user_id
        JOIN products p ON p.id = pv.product_id
        LEFT JOIN business_profiles bp ON bp.user_id = u.id
        WHERE pv.user_id IS NOT NULL
          AND p.category_id IS NOT NULL
          AND pv.created_at < NOW() - ($2::text || ' minutes')::interval
          AND pv.created_at > NOW() - ($3::text || ' minutes')::interval
          AND u.is_active = TRUE
          AND u.is_guest = FALSE
          AND u.marketing_opt_out = FALSE
          AND (bp.user_id IS NULL OR bp.approval_status != 'approved')
          AND NOT EXISTS (
            SELECT 1 FROM email_campaigns_sent ecs
            WHERE ecs.campaign_kind = $1
              AND ecs.user_id = pv.user_id
              AND ecs.sent_at > NOW() - ($4::text || ' minutes')::interval
          )
        GROUP BY pv.user_id, p.category_id
        HAVING COUNT(DISTINCT pv.product_id) >= $5
      ) viewed
      WHERE NOT EXISTS (
        SELECT 1 FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products op ON op.id = oi.product_id
        WHERE o.user_id = viewed.user_id
          AND op.category_id = viewed.category_id
          AND o.status NOT IN ('cancelled', 'refunded')
          AND o.created_at > viewed.last_view
      )
      ORDER BY last_view DESC
      LIMIT $6
    `,
      [
        campaign.kind,
        String(settleMin),
        String(lookbackMin),
        String(cooldownMin),
        params.minViews,
        params.maxRecipientsPerSweep,
      ]
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
        SELECT DISTINCT pv.user_id
        FROM product_views pv
        JOIN products p ON p.id = pv.product_id
        WHERE pv.user_id IS NOT NULL
          AND p.category_id IS NOT NULL
          AND pv.created_at < NOW() - ($2::text || ' minutes')::interval
          AND pv.created_at > NOW() - ($3::text || ' minutes')::interval
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

    const category = await queryMany<{ name: string; slug: string | null }>(
      `SELECT name, slug FROM categories WHERE id = $1 LIMIT 1`,
      [row.category_id]
    )
    const categoryName = category[0]?.name || 'these products'
    const categorySlug = category[0]?.slug || null

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
      WHERE p.category_id = $1 AND p.is_active = TRUE
      ORDER BY p.created_at DESC
      LIMIT $2
    `,
      [row.category_id, params.maxItemsPerEmail]
    )
    if (items.length === 0) return { ok: false, reason: 'no_items' }

    const itemsHtml = renderItemRows(
      items.map(i => ({
        name: i.name,
        price: i.price,
        imageUrl: i.image_url,
        productUrl: i.product_slug ? `${user.baseUrl}/products/${i.product_slug}` : null,
      }))
    )

    const { couponCode, discountPercent } = await resolveCoupon(campaign, row.user_id)

    const emailResult = await sendCampaignEmail({
      campaign,
      user,
      referenceId: row.category_id,
      vars: {
        firstName: user.first_name || 'there',
        categoryName,
        itemsHtml,
        cartItems: itemsHtml,
        couponCode,
        discountPercent,
        ctaUrl: categorySlug ? `${user.baseUrl}/categories/${categorySlug}` : `${user.baseUrl}/products`,
      },
    })

    if (params.whatsappEnabled) {
      sendCampaignWhatsApp(campaign.kind, row.user_id, { items: categoryName }, cooldownDays(params)).catch(() => {})
    }
    return emailResult
  },
}
