import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, resolveCoupon, sendCampaignEmail, renderItemRows } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { sendCampaignPush } from '@/lib/campaigns/push-dispatch'
import { minutes, readDurationParam, cooldownMinutes } from '../duration'
import type { ScenarioModule } from '../types'
import { verifyDraftToken } from '@/lib/orders/order-draft'

interface Params extends Record<string, unknown> {
  minMinutesAfterCancel: number
  autoCancelMaxMinutes: number
  maxRecipientsPerSweep: number
  whatsappEnabled: boolean
  smsEnabled: boolean
  pushEnabled?: boolean
}

interface Row {
  id: string
  user_id: string
  order_number: string
  total_amount: string
  order_type?: string | null
  /** 'intent': a payment attempt that never became an order (pending_payment_intents). */
  source?: 'order' | 'intent'
  razorpay_order_id?: string
  draft_token?: string
}

// A checkout draft lives 30 minutes (order-draft.ts); a payment can still land until then.
const DRAFT_LIFE_MINUTES = 30

export const abandonedCheckout: ScenarioModule<Params, Row> = {
  kind: 'abandoned_checkout',
  name: 'Abandoned Checkout',
  description: 'Checkout started but payment never completed',
  trigger:
    "Fires when a customer starts paying at checkout and the payment never completes: a payment attempt that never became an order (once its 30-minute checkout has expired plus the wait below), or an order auto-cancelled within ~15 min of creation because its payment didn't complete. Skipped if the customer has ordered since. Sends at most once per cooldown window per user.",
  defaultParams: {
    minMinutesAfterCancel: minutes(15),
    autoCancelMaxMinutes: minutes(15),
    maxRecipientsPerSweep: 50,
    whatsappEnabled: false,
    smsEnabled: false,
    pushEnabled: false,
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
    pushEnabled: {
      type: 'boolean',
      label: 'Also send as an app push',
      description: 'Additionally notify the customer in the store app (quiet hours and the 2-a-day push limit apply)',
    },
  },

  async findEligible({ campaign, params }) {
    const minAfterCancel = readDurationParam(params, 'minMinutesAfterCancel') ?? minutes(15)
    const autoCancelMax = readDurationParam(params, 'autoCancelMaxMinutes') ?? minutes(15)
    const cooldownMin = cooldownMinutes(params)
    const orders = await queryMany<Row>(
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
    // Checkout now creates the order only once payment succeeds: an abandoned payment leaves an uncommitted
    // pending_payment_intents row and no order. One that expired (draft life + the wait) within the last
    // delay_hours, from a customer who has not ordered or paid since.
    const intents = await queryMany<Row>(
      `
      SELECT DISTINCT ON (pi.user_id)
        pi.id::text, pi.user_id::text, '' AS order_number, (pi.amount_paise / 100.0)::text AS total_amount,
        'intent' AS source, pi.razorpay_order_id, pi.draft_token
      FROM pending_payment_intents pi
      JOIN users u ON u.id = pi.user_id
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      WHERE pi.committed = FALSE
        AND pi.created_at < NOW() - ($3 || ' minutes')::interval
        AND pi.created_at > NOW() - ($3 || ' minutes')::interval - ($2 || ' hours')::interval
        AND u.is_active = TRUE AND u.marketing_opt_out = FALSE
        AND (bp.user_id IS NULL OR bp.approval_status != 'approved')
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = pi.user_id AND o.created_at > pi.created_at)
        AND NOT EXISTS (
          SELECT 1 FROM pending_payment_intents p2
          WHERE p2.user_id = pi.user_id AND p2.committed = TRUE AND p2.created_at > pi.created_at
        )
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = $1
            AND ecs.channel = 'email'
            AND ecs.user_id = pi.user_id
            AND ecs.sent_at > NOW() - ($4 || ' minutes')::interval
        )
      ORDER BY pi.user_id, pi.created_at DESC
      LIMIT $5
    `,
      [campaign.kind, campaign.delay_hours, String(DRAFT_LIFE_MINUTES + minAfterCancel), String(cooldownMin), params.maxRecipientsPerSweep]
    )
    const seen = new Set(orders.map(r => r.user_id))
    return [...orders, ...intents.filter(r => !seen.has(r.user_id))].slice(0, params.maxRecipientsPerSweep)
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

    const intent = row.source === 'intent' ? await intentItems(row) : null
    if (row.source === 'intent' && !intent?.items.length) return { ok: false, reason: 'no_items' }
    const items =
      intent?.items ??
      (await queryMany<CheckoutItem>(
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
      ))

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
      (row.order_type === 'direct' || intent?.mode === 'buyNow') && firstSlug
        ? `${user.baseUrl}/products/${encodeURIComponent(firstSlug)}`
        : `${user.baseUrl}/cart`

    const emailResult = await sendCampaignEmail({
      campaign,
      user,
      referenceId: row.id,
      vars: {
        firstName: user.first_name || 'there',
        // A payment attempt has no order number: its payment reference stands in.
        orderNumber: row.order_number || (row.razorpay_order_id ?? '').replace(/^order_/, '').slice(-8).toUpperCase(),
        total: Number(row.total_amount).toFixed(2),
        itemsHtml,
        couponCode,
        discountPercent,
        ctaUrl,
      },
    })
    if ((params as any).whatsappEnabled || (params as any).smsEnabled || params.pushEnabled) {
      const names = items.map(i => i.name)
      const summary = names.slice(0, 3).join(', ') + (names.length > 3 ? ` and ${names.length - 3} more` : '')
      const msgVars = { items: summary, imageUrl: items.find(i => i.image_url)?.image_url ?? undefined, url: ctaUrl }
      if ((params as any).whatsappEnabled || (params as any).smsEnabled) sendCampaignWhatsApp(campaign.kind, row.user_id, msgVars, cooldownMinutes(params)).catch(() => {})
      if (params.pushEnabled) sendCampaignPush(campaign.kind, row.user_id, msgVars, cooldownMinutes(params)).catch(() => {})
    }
    return emailResult
  },
}

interface CheckoutItem {
  name: string
  quantity: number
  unit_price: number
  product_slug: string | null
  image_url: string | null
}

const PRODUCT_SQL = `p.name, p.slug AS product_slug,
  (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY display_order ASC LIMIT 1) AS image_url`

/** What a payment attempt was for: the buy-now item in its draft, or the customer's cart (still holding the items). */
async function intentItems(row: Row): Promise<{ mode: 'cart' | 'buyNow'; items: CheckoutItem[] } | null> {
  const draft = row.draft_token ? await verifyDraftToken(row.draft_token, { ignoreExpiry: true }) : null
  if (draft?.mode === 'buyNow' && draft.buyNowItem) {
    const b = draft.buyNowItem
    const items = await queryMany<CheckoutItem>(
      `SELECT ${PRODUCT_SQL}, $2::float AS quantity, $3::float AS unit_price FROM products p WHERE p.id = $1::uuid`,
      [b.productId, b.qty, b.price]
    )
    return { mode: 'buyNow', items }
  }
  const items = await queryMany<CheckoutItem>(
    `SELECT ${PRODUCT_SQL}, ci.quantity::float AS quantity, COALESCE(pv.price, p.base_price)::float AS unit_price
     FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     LEFT JOIN product_variants pv ON pv.id = ci.variant_id
     WHERE ci.user_id = $1::uuid AND ci.saved_for_later = FALSE
     LIMIT 8`,
    [row.user_id]
  )
  return { mode: 'cart', items }
}
