import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, resolveCoupon, sendCampaignEmail, renderItemRows } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days, minutes, readDurationParam, cooldownMinutes } from '../duration'
import type { ScenarioModule } from '../types'

interface Params extends Record<string, unknown> {
  intervalMultiplier: number
  lookahead: number
  sendCooldown: number
  maxRecipientsPerSweep: number
  whatsappEnabled: boolean
  smsEnabled: boolean
}

interface CandidateRow {
  user_id: string
  product_id: string
  product_slug: string | null
  product_name: string
  is_subscription: boolean
  subscription_interval: string | null
  reorder_interval_days: number | null
  last_purchase_at: string
}

interface Row {
  user_id: string
  product_id: string
}

// subscription_interval is a varchar ('monthly' etc.). Map to canonical minutes in code (spec #17: not SQL).
function intervalToMinutes(interval: string | null): number {
  switch ((interval || '').toLowerCase()) {
    case 'daily':
      return days(1)
    case 'weekly':
      return days(7)
    case 'yearly':
      return days(365)
    case 'monthly':
    default:
      return days(30)
  }
}

// A subscription product keeps its own interval; anything else uses its category's reorder interval
// (Replenishment campaign page), falling back to the parent category's.
const CATEGORY_INTERVAL_SQL = `COALESCE(c.reorder_interval_days, pc.reorder_interval_days)`
const REORDERABLE_SQL = `(p.is_subscription = TRUE OR ${CATEGORY_INTERVAL_SQL} IS NOT NULL)`

function candidateIntervalMinutes(c: CandidateRow): number {
  if (c.is_subscription || c.reorder_interval_days == null) return intervalToMinutes(c.subscription_interval)
  return days(c.reorder_interval_days)
}

export const replenishment: ScenarioModule<Params, Row> = {
  kind: 'replenishment',
  name: 'Replenishment Reminder',
  description: 'Customer is due to reorder a consumable or subscription product',
  trigger:
    "Fires when a customer's last paid purchase of a consumable is older than its reorder interval times the configured multiplier, minus a lookahead so the reminder lands just before they run out. Consumables are subscription products, plus products in a category given a reorder interval on this campaign's page (a subcategory without one uses its parent's). Skipped if the product is already in their cart, and for guests, inactive accounts and marketing opt-outs. Sends at most once per cooldown window per user.",
  defaultParams: {
    intervalMultiplier: 1.0,
    lookahead: days(3),
    sendCooldown: days(14),
    maxRecipientsPerSweep: 50,
    whatsappEnabled: false,
    smsEnabled: false,
  },
  paramSchema: {
    intervalMultiplier: {
      type: 'number',
      min: 0.5,
      max: 3,
      label: 'Interval multiplier',
      description: 'Reorder reminder fires at the product interval times this multiplier',
    },
    lookahead: {
      type: 'duration',
      min: days(0),
      max: days(30),
      recommendedUnit: 'days',
      label: 'Lookahead',
      description: 'Send this far before the estimated run-out so the reorder lands in time',
    },
    sendCooldown: {
      type: 'duration',
      min: minutes(1),
      max: days(90),
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
    const multiplier = typeof params.intervalMultiplier === 'number' ? params.intervalMultiplier : 1.0
    const lookaheadMin = readDurationParam(params, 'lookahead') ?? days(3)
    const cooldownMin = cooldownMinutes(params)

    // Pull the latest paid purchase per (user, subscription product). The interval-vs-elapsed comparison is
    // done in code (interval varchar -> minutes), per spec, so SQL stays interval-string-free.
    const candidates = await queryMany<CandidateRow>(
      `
      SELECT u.id::text AS user_id,
             p.id::text AS product_id,
             p.slug AS product_slug,
             p.name AS product_name,
             p.is_subscription,
             p.subscription_interval,
             ${CATEGORY_INTERVAL_SQL} AS reorder_interval_days,
             MAX(o.created_at)::text AS last_purchase_at
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN products p ON p.id = oi.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN categories pc ON pc.id = c.parent_category_id
      JOIN users u ON u.id = o.user_id
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      WHERE ${REORDERABLE_SQL}
        AND p.is_active = TRUE
        AND o.payment_status = 'paid'
        AND u.is_active = TRUE
        AND u.is_guest = FALSE
        AND u.marketing_opt_out = FALSE
        AND (bp.user_id IS NULL OR bp.approval_status != 'approved')
        AND NOT EXISTS (
          SELECT 1 FROM cart_items ci
          WHERE ci.user_id = u.id AND ci.product_id = p.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = $1
            AND ecs.channel = 'email'
            AND ecs.user_id = u.id
            AND ecs.sent_at > NOW() - ($2::text || ' minutes')::interval
        )
      GROUP BY u.id, p.id, p.slug, p.name, p.is_subscription, p.subscription_interval, ${CATEGORY_INTERVAL_SQL}
      ORDER BY MAX(o.created_at) ASC
      LIMIT $3
    `,
      [campaign.kind, String(cooldownMin), params.maxRecipientsPerSweep]
    )

    const now = Date.now()
    return candidates
      .filter(c => {
        const thresholdMin = candidateIntervalMinutes(c) * multiplier - lookaheadMin
        const elapsedMin = (now - new Date(c.last_purchase_at).getTime()) / 60000
        return elapsedMin >= thresholdMin
      })
      .map(c => ({ user_id: c.user_id, product_id: c.product_id }))
  },

  async findSuppressed({ campaign, params }) {
    const cooldownMin = cooldownMinutes(params)
    const rows = await queryMany<{
      user_id: string
      reason: string
      reason_detail: string | null
      blocked_until: string | null
    }>(
      `
      WITH buyers AS (
        SELECT DISTINCT o.user_id
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN categories pc ON pc.id = c.parent_category_id
        WHERE ${REORDERABLE_SQL} AND o.payment_status = 'paid'
      )
      SELECT
        b.user_id::text,
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
          WHEN ecs.sent_at IS NOT NULL THEN (ecs.sent_at + ($2::text || ' minutes')::interval)::text
          ELSE NULL
        END AS blocked_until
      FROM buyers b
      JOIN users u ON u.id = b.user_id
      LEFT JOIN LATERAL (
        SELECT sent_at FROM email_campaigns_sent
         WHERE campaign_kind = $1 AND user_id = b.user_id
           AND channel = 'email'
           AND sent_at > NOW() - ($2::text || ' minutes')::interval
         ORDER BY sent_at DESC LIMIT 1
      ) ecs ON TRUE
      WHERE u.is_active = FALSE OR u.is_guest = TRUE OR u.marketing_opt_out = TRUE OR ecs.sent_at IS NOT NULL
      LIMIT 200
    `,
      [campaign.kind, String(cooldownMin)]
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

    const primary = items[0]
    const itemsHtml = renderItemRows([
      {
        name: primary.name,
        price: primary.price,
        imageUrl: primary.image_url,
        productUrl: primary.product_slug ? `${user.baseUrl}/products/${primary.product_slug}` : null,
      },
    ])

    const { couponCode, discountPercent } = await resolveCoupon(campaign, row.user_id)

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
      sendCampaignWhatsApp(campaign.kind, row.user_id, { items: primary.name }, cooldownMinutes(params)).catch(() => {})
    }
    return emailResult
  },
}
