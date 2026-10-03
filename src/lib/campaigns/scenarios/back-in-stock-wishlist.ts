import { queryMany, query } from '@/lib/shared/db'
import {
  fetchUserContext,
  resolveCoupon,
  sendCampaignEmail,
  fetchProductImageUrl,
  renderHeroProduct,
} from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { cooldownMinutes, cooldownDays } from '../duration'
import type { ScenarioModule } from '../types'

interface Params extends Record<string, unknown> {
  maxWatchesPerSweep: number
  whatsappEnabled: boolean
}

interface Row {
  user_id: string
  product_id: string
  product_name: string
  product_slug: string | null
}

export const backInStockWishlist: ScenarioModule<Params, Row> = {
  kind: 'back_in_stock_wishlist',
  name: 'Back in Stock (Wishlist)',
  description: 'A wishlisted product went from out-of-stock to in-stock',
  trigger:
    'Fires when a wishlisted product transitions from out-of-stock (snapshot_in_stock = FALSE) to in-stock. Dedup is per product. The snapshot is updated to in-stock after sending so it only fires once per transition. Skipped for guests, inactive accounts, and marketing opt-outs.',
  defaultParams: {
    maxWatchesPerSweep: 100,
    whatsappEnabled: false,
  },
  paramSchema: {
    maxWatchesPerSweep: {
      type: 'integer',
      min: 1,
      max: 1000,
      label: 'Max watches per run',
      description: 'Hard limit on wishlist rows scanned',
    },
    whatsappEnabled: {
      type: 'boolean',
      label: 'Also send via WhatsApp',
      description: "Additionally send this campaign to the customer's WhatsApp when a phone number is on file",
    },
  },

  async findEligible({ campaign, params }) {
    const cooldownMin = cooldownMinutes(params)
    return queryMany<Row>(
      `
      SELECT wi.user_id::text, wi.product_id::text, p.name AS product_name, p.slug AS product_slug
      FROM wishlist_items wi
      JOIN users u ON u.id = wi.user_id
      JOIN products p ON p.id = wi.product_id
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      WHERE wi.user_id IS NOT NULL
        AND wi.snapshot_in_stock = FALSE
        AND p.inventory_quantity > 0
        AND u.is_active = TRUE
        AND u.is_guest = FALSE
        AND u.marketing_opt_out = FALSE
        AND (bp.user_id IS NULL OR bp.approval_status != 'approved')
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = $1
            AND ecs.user_id = wi.user_id
            AND ecs.reference_id = wi.product_id::text
            AND ecs.sent_at > NOW() - ($2::text || ' minutes')::interval
        )
      LIMIT $3
    `,
      [campaign.kind, String(cooldownMin), params.maxWatchesPerSweep]
    )
  },

  async findSuppressed({ campaign }) {
    const rows = await queryMany<{
      user_id: string
      reason: string
      reason_detail: string | null
      blocked_until: string | null
    }>(
      `
      SELECT
        wi.user_id::text,
        CASE
          WHEN u.is_active = FALSE OR u.is_guest = TRUE THEN 'inactive'
          WHEN u.marketing_opt_out = TRUE THEN 'opted_out'
          ELSE 'other'
        END AS reason,
        CASE
          WHEN u.marketing_opt_out THEN 'Marketing opt-out enabled'
          WHEN u.is_guest THEN 'Guest user'
          WHEN NOT u.is_active THEN 'Account inactive'
          ELSE NULL
        END AS reason_detail,
        NULL::text AS blocked_until
      FROM wishlist_items wi
      JOIN users u ON u.id = wi.user_id
      JOIN products p ON p.id = wi.product_id
      WHERE wi.snapshot_in_stock = FALSE
        AND p.inventory_quantity > 0
        AND (u.is_active = FALSE OR u.is_guest = TRUE OR u.marketing_opt_out = TRUE)
      LIMIT 200
    `,
      [campaign.kind]
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
    const productCard = renderHeroProduct({ name: row.product_name, imageUrl, productUrl })

    const emailResult = await sendCampaignEmail({
      campaign,
      user,
      referenceId: row.product_id,
      vars: {
        firstName: user.first_name || 'there',
        productName: row.product_name,
        productCard,
        couponCode,
        discountPercent,
        ctaUrl: productUrl,
      },
    })

    await query(
      `UPDATE wishlist_items SET snapshot_in_stock = TRUE, snapshot_taken_at = NOW()
       WHERE user_id = $1 AND product_id = $2`,
      [row.user_id, row.product_id]
    ).catch(() => {})

    if (params.whatsappEnabled) {
      sendCampaignWhatsApp(campaign.kind, row.user_id, { product: row.product_name }, cooldownDays(params)).catch(
        () => {}
      )
    }
    return emailResult
  },
}
