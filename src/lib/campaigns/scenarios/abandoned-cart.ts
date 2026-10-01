import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, resolveCoupon, sendCampaignEmail, renderItemRows } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import type { ScenarioModule } from '../types'

interface Params extends Record<string, unknown> {
  lookbackDays: number
  sendCooldownDays: number
  maxRecipientsPerSweep: number
  maxItemsPerEmail: number
  secondEmailDelayHours: number
  whatsappEnabled: boolean
}

interface Row {
  user_id: string
  sequence: number
}

export const abandonedCart: ScenarioModule<Params, Row> = {
  kind: 'abandoned_cart',
  name: 'Abandoned Cart',
  description: 'Customer left items in cart without checking out',
  trigger:
    "Fires when a logged-in customer adds items to their cart, then leaves the cart untouched for at least the campaign's delay (in hours). Sends at most once per cooldown window per user. Skipped if cart is empty or if user opted out of marketing.",
  defaultParams: {
    lookbackDays: 30,
    sendCooldownDays: 7,
    maxRecipientsPerSweep: 50,
    maxItemsPerEmail: 5,
    secondEmailDelayHours: 48,
    whatsappEnabled: false,
  },
  paramSchema: {
    lookbackDays: {
      type: 'integer',
      min: 1,
      max: 90,
      label: 'Lookback (days)',
      description: 'Only consider carts updated in the last N days',
    },
    sendCooldownDays: {
      type: 'integer',
      min: 1,
      max: 30,
      label: 'Per-user cooldown (days)',
      description: 'Skip users sent this campaign within N days',
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
    secondEmailDelayHours: {
      type: 'integer',
      min: 24,
      max: 168,
      label: 'Second email delay (hours)',
      description: 'Send follow-up email N hours after first email if cart still not checked out',
    },
    whatsappEnabled: {
      type: 'boolean',
      label: 'Also send via WhatsApp',
      description: "Additionally send this campaign to the customer's WhatsApp when a phone number is on file",
    },
  },

  async findEligible({ campaign, params }) {
    // Sequence 1: users who haven't received ANY email in cooldown window
    // Sequence 2: users who received seq=1 but NOT seq=2, cart still active,
    //             and secondEmailDelayHours have passed since seq=1
    const seq1 = await queryMany<Row>(
      `
      SELECT DISTINCT ci.user_id, 1 AS sequence
      FROM cart_items ci
      JOIN users u ON u.id = ci.user_id
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      WHERE ci.saved_for_later = FALSE
        AND ci.updated_at < NOW() - ($2::text || ' hours')::interval
        AND ci.updated_at > NOW() - ($3::text || ' days')::interval
        AND u.is_active = TRUE
        AND u.is_guest = FALSE
        AND u.marketing_opt_out = FALSE
        AND (bp.user_id IS NULL OR bp.approval_status != 'approved')
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = $1
            AND ecs.user_id = ci.user_id
            AND ecs.sent_at > NOW() - ($4::text || ' days')::interval
        )
      LIMIT $5
    `,
      [campaign.kind, campaign.delay_hours, params.lookbackDays, params.sendCooldownDays, params.maxRecipientsPerSweep]
    )

    // Sequence 2: got seq=1, no seq=2 yet, secondEmailDelayHours passed, cart still active
    const seq2 = await queryMany<Row>(
      `
      SELECT DISTINCT ci.user_id, 2 AS sequence
      FROM cart_items ci
      JOIN users u ON u.id = ci.user_id
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      -- Must have received sequence 1
      JOIN email_campaigns_sent ecs1 ON ecs1.user_id = ci.user_id
        AND ecs1.campaign_kind = $1
        AND (ecs1.metadata->>'sequence')::int = 1
        AND ecs1.sent_at < NOW() - ($5::text || ' hours')::interval
        AND ecs1.sent_at > NOW() - ($3::text || ' days')::interval
      WHERE ci.saved_for_later = FALSE
        AND ci.updated_at > NOW() - ($2::text || ' days')::interval
        AND u.is_active = TRUE
        AND u.is_guest = FALSE
        AND u.marketing_opt_out = FALSE
        AND (bp.user_id IS NULL OR bp.approval_status != 'approved')
        -- No sequence 2 sent yet
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs2
          WHERE ecs2.campaign_kind = $1
            AND ecs2.user_id = ci.user_id
            AND (ecs2.metadata->>'sequence')::int = 2
        )
        -- No order placed after seq1 sent
        AND NOT EXISTS (
          SELECT 1 FROM orders o
          WHERE o.user_id = ci.user_id
            AND o.status NOT IN ('cancelled', 'refunded')
            AND o.created_at > ecs1.sent_at
        )
      LIMIT $4
    `,
      [
        campaign.kind,
        params.lookbackDays,
        params.sendCooldownDays,
        params.maxRecipientsPerSweep,
        params.secondEmailDelayHours,
      ]
    )

    // Merge — seq1 users take priority, don't double-send
    const seq1Ids = new Set(seq1.map(r => r.user_id))
    const uniqueSeq2 = seq2.filter(r => !seq1Ids.has(r.user_id))
    return [...seq1, ...uniqueSeq2]
  },

  async findSuppressed({ campaign, params }) {
    const rows = await queryMany<{
      user_id: string
      reason: string
      reason_detail: string | null
      blocked_until: string | null
    }>(
      `
      WITH eligible_carts AS (
        SELECT DISTINCT ci.user_id
        FROM cart_items ci
        WHERE ci.saved_for_later = FALSE
          AND ci.updated_at < NOW() - ($2::text || ' hours')::interval
          AND ci.updated_at > NOW() - ($3::text || ' days')::interval
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
          WHEN ecs.sent_at IS NOT NULL THEN (ecs.sent_at + ($4::text || ' days')::interval)::text
          ELSE NULL
        END AS blocked_until
      FROM eligible_carts ec
      JOIN users u ON u.id = ec.user_id
      LEFT JOIN LATERAL (
        SELECT sent_at FROM email_campaigns_sent
         WHERE campaign_kind = $1
           AND user_id = ec.user_id
           AND sent_at > NOW() - ($4::text || ' days')::interval
         ORDER BY sent_at DESC LIMIT 1
      ) ecs ON TRUE
      WHERE u.is_active = FALSE OR u.is_guest = TRUE OR u.marketing_opt_out = TRUE OR ecs.sent_at IS NOT NULL
      LIMIT 200
    `,
      [campaign.kind, campaign.delay_hours, params.lookbackDays, params.sendCooldownDays]
    )
    return rows.map(r => ({
      user_id: r.user_id,
      reason: r.reason as any,
      reason_detail: r.reason_detail,
      blocked_until: r.blocked_until,
    }))
  },

  async send(row, { campaign, params }) {
    const sequence = row.sequence || 1
    const items = await queryMany<{
      product_id: string
      product_slug: string | null
      name: string
      quantity: number
      price: number
      image_url: string | null
    }>(
      `
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
    `,
      [row.user_id, params.maxItemsPerEmail]
    )
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

    // Sequence 2 always gets a coupon if available
    const { couponCode, discountPercent } =
      sequence === 2 ? await resolveCoupon(campaign, row.user_id) : await resolveCoupon(campaign, row.user_id)

    const emailResult = await sendCampaignEmail({
      campaign,
      user,
      referenceId: `seq${sequence}`,
      metadata: { sequence },
      vars: {
        firstName: user.first_name || 'there',
        itemCount: items.length,
        cartItems: itemsHtml,
        itemsHtml,
        couponCode,
        discountPercent,
        ctaUrl: `${user.baseUrl}/cart`,
        isFollowUp: sequence === 2 ? 'true' : '',
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
