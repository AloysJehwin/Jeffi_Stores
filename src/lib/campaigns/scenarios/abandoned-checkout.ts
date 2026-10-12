import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, resolveCoupon, sendCampaignEmail, renderItemRows } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { minutes, readDurationParam, cooldownMinutes } from '../duration'
import type { ScenarioModule } from '../types'

interface Params extends Record<string, unknown> {
  minMinutesAfterCancel: number
  autoCancelMaxMinutes: number
  maxRecipientsPerSweep: number
  whatsappEnabled: boolean
  smsEnabled: boolean
}

interface Row {
  id: string
  user_id: string
  order_number: string
  total_amount: string
  order_type?: string | null
}

export const abandonedCheckout: ScenarioModule<Params, Row> = {
  kind: 'abandoned_checkout',
  name: 'Abandoned Checkout',
  description: 'Order auto-cancelled after the 10-minute payment window expired',
  trigger:
    "Fires when an order is auto-cancelled because Razorpay payment didn't complete within the 10-minute window. Only orders cancelled within ~15 min of creation are treated as auto-cancels (not manual cancellations days later). Sends at most once per cooldown window per user.",
  defaultParams: {
    minMinutesAfterCancel: minutes(15),
    autoCancelMaxMinutes: minutes(15),
    maxRecipientsPerSweep: 50,
    whatsappEnabled: false,
    smsEnabled: false,
  },
  paramSchema: {
    minMinutesAfterCancel: {
      type: 'duration',
      recommendedUnit: 'minutes',
      min: minutes(1),
      max: minutes(120),
      label: 'Minimum wait after cancel',
      description: 'Wait at least this many minutes after the order was cancelled',
    },
    autoCancelMaxMinutes: {
      type: 'duration',
      recommendedUnit: 'minutes',
      min: minutes(1),
      max: minutes(120),
      label: 'Auto-cancel detection window',
      description:
        'Only treat as auto-cancel if cancelled within N minutes of order creation. Filters out manual late cancellations.',
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
    smsEnabled: {
      type: 'boolean',
      label: 'Also send via SMS',
      description: "Additionally send this campaign as a text SMS when a phone number is on file (off by default)",
    },
  },

  async findEligible({ campaign, params }) {
    const minAfterCancel = readDurationParam(params, 'minMinutesAfterCancel') ?? minutes(15)
    const autoCancelMax = readDurationParam(params, 'autoCancelMaxMinutes') ?? minutes(15)
    const cooldownMin = cooldownMinutes(params)
    return queryMany<Row>(
      `
      SELECT DISTINCT ON (o.user_id)
        o.id, o.user_id, o.order_number, o.total_amount::text, o.order_type
      FROM orders o
      JOIN users u ON u.id = o.user_id
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      WHERE o.status = 'cancelled' AND o.payment_status = 'cancelled'
        AND (o.updated_at - o.created_at) <= ($6 || ' minutes')::interval
        AND o.updated_at > NOW() - ($2 || ' hours')::interval
        AND o.updated_at < NOW() - ($3 || ' minutes')::interval
        AND u.is_active = TRUE AND u.marketing_opt_out = FALSE
        AND (bp.user_id IS NULL OR bp.approval_status != 'approved')
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = $1
            AND ecs.channel = 'email'
            AND ecs.user_id = o.user_id
            AND ecs.sent_at > NOW() - ($4 || ' minutes')::interval
        )
      ORDER BY o.user_id, o.updated_at DESC
      LIMIT $5
    `,
      [
        campaign.kind,
        campaign.delay_hours,
        String(minAfterCancel),
        String(cooldownMin),
        params.maxRecipientsPerSweep,
        String(autoCancelMax),
      ]
    )
  },

  async findSuppressed({ campaign, params }) {
    const minAfterCancel = readDurationParam(params, 'minMinutesAfterCancel') ?? minutes(15)
    const autoCancelMax = readDurationParam(params, 'autoCancelMaxMinutes') ?? minutes(15)
    const cooldownMin = cooldownMinutes(params)
    const rows = await queryMany<{
      id: string
      user_id: string
      order_number: string
      total_amount: string
      reason: string
      reason_detail: string | null
      blocked_until: string | null
    }>(
      `
      WITH latest_cancelled AS (
        SELECT DISTINCT ON (o.user_id)
          o.id::text, o.user_id::text, o.order_number, o.total_amount::text, o.updated_at
        FROM orders o
        WHERE o.status = 'cancelled' AND o.payment_status = 'cancelled'
          AND (o.updated_at - o.created_at) <= ($5 || ' minutes')::interval
          AND o.updated_at > NOW() - ($2 || ' hours')::interval
          AND o.updated_at < NOW() - ($3 || ' minutes')::interval
        ORDER BY o.user_id, o.updated_at DESC
      )
      SELECT
        lc.id, lc.user_id, lc.order_number, lc.total_amount,
        CASE
          WHEN u.is_active = FALSE THEN 'inactive'
          WHEN u.marketing_opt_out = TRUE THEN 'opted_out'
          WHEN ecs.sent_at IS NOT NULL THEN 'cooldown'
          ELSE 'other'
        END AS reason,
        CASE
          WHEN ecs.sent_at IS NOT NULL THEN 'Sent ' || to_char(ecs.sent_at, 'DD Mon HH24:MI')
          WHEN u.marketing_opt_out THEN 'Marketing opt-out enabled'
          WHEN NOT u.is_active THEN 'Account inactive'
          ELSE NULL
        END AS reason_detail,
        CASE
          WHEN ecs.sent_at IS NOT NULL THEN (ecs.sent_at + ($4 || ' minutes')::interval)::text
          ELSE NULL
        END AS blocked_until
      FROM latest_cancelled lc
      JOIN users u ON u.id = lc.user_id::uuid
      LEFT JOIN LATERAL (
        SELECT sent_at FROM email_campaigns_sent
         WHERE campaign_kind = $1
           AND channel = 'email'
           AND user_id = lc.user_id::uuid
           AND sent_at > NOW() - ($4 || ' minutes')::interval
         ORDER BY sent_at DESC LIMIT 1
      ) ecs ON TRUE
      WHERE u.is_active = FALSE OR u.marketing_opt_out = TRUE OR ecs.sent_at IS NOT NULL
      LIMIT 200
    `,
      [campaign.kind, campaign.delay_hours, String(minAfterCancel), String(cooldownMin), String(autoCancelMax)]
    )
    return rows.map(r => ({
      user_id: r.user_id,
      reference_id: r.id,
      reason: r.reason as any,
      reason_detail: r.reason_detail,
      blocked_until: r.blocked_until,
      raw: { order_number: r.order_number, total_amount: r.total_amount },
    }))
  },

  async send(row, { campaign, params }) {
    const user = await fetchUserContext(row.user_id)
    if (!user) return { ok: false, reason: 'no_user' }

    const items = await queryMany<{
      name: string
      quantity: number
      unit_price: number
      product_slug: string | null
      image_url: string | null
    }>(
      `
      SELECT oi.product_name AS name,
             oi.quantity::float AS quantity,
             oi.unit_price::float AS unit_price,
             p.slug AS product_slug,
             (SELECT image_url FROM product_images WHERE product_id = oi.product_id ORDER BY display_order ASC LIMIT 1) AS image_url
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1::uuid
      LIMIT 8
    `,
      [row.id]
    )

    const itemsHtml = renderItemRows(
      items.map(i => ({
        name: i.name,
        quantity: i.quantity,
        price: i.unit_price,
        imageUrl: i.image_url,
        productUrl: i.product_slug ? `${user.baseUrl}/products/${i.product_slug}` : null,
      }))
    )

    const { couponCode, discountPercent } = await resolveCoupon(campaign, row.user_id)

    // Cancelling a cart order puts its items back in the cart; a "buy now" order's items never were
    // in it, so that customer goes back to the product instead of an empty cart.
    const firstSlug = items.find(i => i.product_slug)?.product_slug
    const ctaUrl =
      row.order_type === 'direct' && firstSlug
        ? `${user.baseUrl}/products/${encodeURIComponent(firstSlug)}`
        : `${user.baseUrl}/cart`

    const emailResult = await sendCampaignEmail({
      campaign,
      user,
      referenceId: row.id,
      vars: {
        firstName: user.first_name || 'there',
        orderNumber: row.order_number,
        total: Number(row.total_amount).toFixed(2),
        itemsHtml,
        couponCode,
        discountPercent,
        ctaUrl,
      },
    })
    if ((params as any).whatsappEnabled) {
      const names = items.map(i => i.name)
      const summary = names.slice(0, 3).join(', ') + (names.length > 3 ? ` and ${names.length - 3} more` : '')
      sendCampaignWhatsApp(campaign.kind, row.user_id, { items: summary }).catch(() => {})
    }
    return emailResult
  },
}
