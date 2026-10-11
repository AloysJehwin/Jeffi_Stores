import { queryMany } from '@/lib/shared/db'
import {
  fetchUserContext,
  resolveCoupon,
  sendCampaignEmail,
  fetchProductImageUrl,
  renderHeroProduct,
} from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days, minutes, readDurationParam, cooldownMinutes, cooldownDays } from '../duration'
import type { ScenarioModule } from '../types'

interface Params extends Record<string, unknown> {
  sinceReview: number
  whatsappEnabled: boolean
}

interface Row {
  review_id: string
  user_id: string
  product_id: string
  product_name: string
  product_slug: string | null
}

export const reviewPhotoFollowup: ScenarioModule<Params, Row> = {
  kind: 'review_photo_followup',
  name: 'Review Photo Follow-up',
  description: 'Customer left a text-only review; nudge them to add a photo',
  trigger:
    'Fires when a customer left an approved review at least the configured window ago that has no photo attached. Nudges them to add one for a perk. Dedup is per-review. Skipped once a photo is added, and for guests, inactive accounts, and marketing opt-outs.',
  defaultParams: {
    sinceReview: days(3),
    whatsappEnabled: false,
  },
  paramSchema: {
    sinceReview: {
      type: 'duration',
      min: minutes(1),
      max: days(60),
      recommendedUnit: 'days',
      label: 'Wait after review',
      description: 'Only follow up on reviews left at least this long ago',
    },
    whatsappEnabled: {
      type: 'boolean',
      label: 'Also send via WhatsApp',
      description: "Additionally send this campaign to the customer's WhatsApp when a phone number is on file",
    },
  },

  async findEligible({ campaign, params }) {
    const sinceMin = readDurationParam(params, 'sinceReview') ?? days(3)
    const cooldownMin = cooldownMinutes(params)

    return queryMany<Row>(
      `
      SELECT r.id::text AS review_id,
             r.user_id::text,
             r.product_id::text,
             p.name AS product_name,
             p.slug AS product_slug
      FROM product_reviews r
      JOIN users u ON u.id = r.user_id
      JOIN products p ON p.id = r.product_id
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      WHERE r.user_id IS NOT NULL
        AND r.is_approved = TRUE
        AND array_length(r.image_urls, 1) IS NULL
        AND r.created_at < NOW() - ($2::text || ' minutes')::interval
        AND u.is_active = TRUE
        AND u.is_guest = FALSE
        AND u.marketing_opt_out = FALSE
        AND (bp.user_id IS NULL OR bp.approval_status != 'approved')
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = $1
            AND ecs.user_id = r.user_id
            AND ecs.reference_id = r.id::text
            AND ecs.sent_at > NOW() - ($3::text || ' minutes')::interval
        )
      ORDER BY r.created_at ASC
      LIMIT $4
    `,
      [campaign.kind, String(sinceMin), String(cooldownMin), params.maxRecipientsPerSweep]
    )
  },

  async findSuppressed({ campaign, params }) {
    const sinceMin = readDurationParam(params, 'sinceReview') ?? days(3)
    const cooldownMin = cooldownMinutes(params)

    const rows = await queryMany<{
      user_id: string
      reason: string
      reason_detail: string | null
      blocked_until: string | null
    }>(
      `
      SELECT
        r.user_id::text,
        CASE
          WHEN u.is_active = FALSE OR u.is_guest = TRUE THEN 'inactive'
          WHEN u.marketing_opt_out = TRUE THEN 'opted_out'
          WHEN array_length(r.image_urls, 1) IS NOT NULL THEN 'other'
          WHEN ecs.sent_at IS NOT NULL THEN 'cooldown'
          ELSE 'other'
        END AS reason,
        CASE
          WHEN array_length(r.image_urls, 1) IS NOT NULL THEN 'Photo already added'
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
      FROM product_reviews r
      JOIN users u ON u.id = r.user_id
      LEFT JOIN LATERAL (
        SELECT sent_at FROM email_campaigns_sent
         WHERE campaign_kind = $1 AND user_id = r.user_id AND reference_id = r.id::text
           AND sent_at > NOW() - ($3::text || ' minutes')::interval
         ORDER BY sent_at DESC LIMIT 1
      ) ecs ON TRUE
      WHERE r.is_approved = TRUE
        AND r.created_at < NOW() - ($2::text || ' minutes')::interval
        AND (
          u.is_active = FALSE OR u.is_guest = TRUE OR u.marketing_opt_out = TRUE
          OR array_length(r.image_urls, 1) IS NOT NULL OR ecs.sent_at IS NOT NULL
        )
      LIMIT 200
    `,
      [campaign.kind, String(sinceMin), String(cooldownMin)]
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

    const { couponCode, discountPercent } = await resolveCoupon(campaign, row.user_id)
    const imageUrl = await fetchProductImageUrl(row.product_id)
    const productUrl = row.product_slug ? `${user.baseUrl}/products/${row.product_slug}` : `${user.baseUrl}/products`
    // Opens the customer's own review ready for a photo (sign-in first if needed).
    const addPhotoUrl = row.product_slug ? `${user.baseUrl}/products/${row.product_slug}?review=edit` : productUrl
    const productCard = renderHeroProduct({ name: row.product_name, imageUrl, productUrl })

    const emailResult = await sendCampaignEmail({
      campaign,
      user,
      referenceId: row.review_id,
      vars: {
        firstName: user.first_name || 'there',
        productName: row.product_name,
        productCard,
        couponCode,
        discountPercent,
        ctaUrl: addPhotoUrl,
      },
    })

    if (params.whatsappEnabled) {
      sendCampaignWhatsApp(campaign.kind, row.user_id, { product: row.product_name }, cooldownDays(params)).catch(
        () => {}
      )
    }
    return emailResult
  },
}
