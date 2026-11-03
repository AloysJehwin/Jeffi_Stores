import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, resolveCoupon, sendCampaignEmail, renderItemRows } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days, minutes, hours, readDurationParam, cooldownMinutes } from '../duration'
import type { ScenarioModule } from '../types'

// A product sitting in the cart is now cheaper than when the customer added it. cart_items.price_at_addition
// captures the add-time price, so this needs no price-history table: compare it to the current price.
interface Params extends Record<string, unknown> {
  lookback: number
  sendCooldown: number
  priceDropThresholdPct: number
  maxRecipientsPerSweep: number
  maxItemsPerEmail: number
  whatsappEnabled: boolean
  smsEnabled: boolean
}

interface Row {
  user_id: string
}

export const cartPriceDrop: ScenarioModule<Params, Row> = {
  kind: 'cart_price_drop',
  name: 'Cart Price Drop',
  description: 'A product in the customer’s cart is now cheaper than when they added it',
  trigger:
    'Fires when a product currently in the cart has a current price at least the configured percentage below the price it was added at, within the lookback window and not yet checked out. Sends at most once per cooldown window per user. Skipped for guests, inactive accounts, and marketing opt-outs.',
  defaultParams: {
    lookback: days(14),
    sendCooldown: days(7),
    priceDropThresholdPct: 5,
    maxRecipientsPerSweep: 50,
    maxItemsPerEmail: 5,
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
    priceDropThresholdPct: {
      type: 'integer',
      min: 1,
      max: 90,
      label: 'Price drop threshold %',
      description: 'Email only when a cart item is at least this % cheaper than when it was added',
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
    smsEnabled: {
      type: 'boolean',
      label: 'Also send via SMS',
      description: "Additionally send this campaign as a text SMS when a phone number is on file (off by default)",
    },
  },

  async findEligible({ campaign, params }) {
    const lookbackMin = readDurationParam(params, 'lookback') ?? days(14)
    const cooldownMin = cooldownMinutes(params)
    const factor = (100 - params.priceDropThresholdPct) / 100

    return queryMany<Row>(
      `
      SELECT DISTINCT ci.user_id::text
      FROM cart_items ci
      JOIN users u ON u.id = ci.user_id
      JOIN products p ON p.id = ci.product_id
      LEFT JOIN product_variants pv ON pv.id = ci.variant_id
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      WHERE ci.saved_for_later = FALSE
        AND ci.updated_at > NOW() - ($3::text || ' minutes')::interval
        AND u.is_active = TRUE
        AND u.is_guest = FALSE
        AND u.marketing_opt_out = FALSE
        AND (bp.user_id IS NULL OR bp.approval_status != 'approved')
        AND COALESCE(pv.price, p.base_price) < ci.price_at_addition * $2
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = $1
            AND ecs.channel = 'email'
            AND ecs.user_id = ci.user_id
            AND ecs.sent_at > NOW() - ($4::text || ' minutes')::interval
        )
      LIMIT $5
    `,
      [campaign.kind, factor, String(lookbackMin), String(cooldownMin), params.maxRecipientsPerSweep]
    )
  },

  async findSuppressed({ campaign, params }) {
    const lookbackMin = readDurationParam(params, 'lookback') ?? days(14)
    const cooldownMin = cooldownMinutes(params)
    const factor = (100 - params.priceDropThresholdPct) / 100

    const rows = await queryMany<{
      user_id: string
      reason: string
      reason_detail: string | null
      blocked_until: string | null
    }>(
      `
      WITH drops AS (
        SELECT DISTINCT ci.user_id
        FROM cart_items ci
        JOIN products p ON p.id = ci.product_id
        LEFT JOIN product_variants pv ON pv.id = ci.variant_id
        WHERE ci.saved_for_later = FALSE
          AND ci.updated_at > NOW() - ($3::text || ' minutes')::interval
          AND COALESCE(pv.price, p.base_price) < ci.price_at_addition * $2
      )
      SELECT
        d.user_id::text,
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
      FROM drops d
      JOIN users u ON u.id = d.user_id
      LEFT JOIN LATERAL (
        SELECT sent_at FROM email_campaigns_sent
         WHERE campaign_kind = $1 AND user_id = d.user_id
           AND channel = 'email'
           AND sent_at > NOW() - ($4::text || ' minutes')::interval
         ORDER BY sent_at DESC LIMIT 1
      ) ecs ON TRUE
      WHERE u.is_active = FALSE OR u.is_guest = TRUE OR u.marketing_opt_out = TRUE OR ecs.sent_at IS NOT NULL
      LIMIT 200
    `,
      [campaign.kind, factor, String(lookbackMin), String(cooldownMin)]
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

    const factor = (100 - params.priceDropThresholdPct) / 100
    const items = await queryMany<{
      product_slug: string | null
      name: string
      old_price: number
      new_price: number
      image_url: string | null
    }>(
      `
      SELECT p.slug AS product_slug, p.name,
             ci.price_at_addition::float AS old_price,
             COALESCE(pv.price, p.base_price)::float AS new_price,
             (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY display_order ASC LIMIT 1) AS image_url
      FROM cart_items ci
      JOIN products p ON p.id = ci.product_id
      LEFT JOIN product_variants pv ON pv.id = ci.variant_id
      WHERE ci.user_id = $1 AND ci.saved_for_later = FALSE
        AND COALESCE(pv.price, p.base_price) < ci.price_at_addition * $2
      ORDER BY (ci.price_at_addition - COALESCE(pv.price, p.base_price)) DESC
      LIMIT $3
    `,
      [row.user_id, factor, params.maxItemsPerEmail]
    )
    if (items.length === 0) return { ok: false, reason: 'no_items' }

    const itemsHtml = renderItemRows(
      items.map(i => ({
        name: i.name,
        price: i.new_price,
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

    if (params.whatsappEnabled || (params as any).smsEnabled) {
      sendCampaignWhatsApp(campaign.kind, row.user_id, { items: summary, imageUrl: items.find(i => i.image_url)?.image_url ?? undefined, url: `${user.baseUrl}/cart` }, cooldownMinutes(params)).catch(() => {})
    }
    return emailResult
  },
}
