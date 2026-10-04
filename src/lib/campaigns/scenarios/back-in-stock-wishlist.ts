import { queryMany } from '@/lib/shared/db'
import { PRODUCT_IN_STOCK_SQL } from '@/lib/queries/shared'
import {
  fetchUserContext,
  resolveCoupon,
  sendCampaignEmail,
  fetchProductImageUrl,
  renderHeroProduct,
} from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { cooldownDays } from '../duration'
import { NOT_RECENTLY_EMAILED_SQL, settleWishlistEvent, syncWishlistSnapshots } from './_wishlist-base'
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
  out_of_stock_since: string
}

export const backInStockWishlist: ScenarioModule<Params, Row> = {
  kind: 'back_in_stock_wishlist',
  name: 'Back in Stock (Wishlist)',
  description: 'A wishlisted product went from out-of-stock to in-stock',
  trigger:
    'Fires when a wishlisted product goes from Out of Stock back to in stock (by stock status, not inventory quantity). The snapshot is refreshed once the email is sent, so it fires once per transition. Skipped for guests, inactive accounts, and marketing opt-outs.',
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
    await syncWishlistSnapshots()
    return queryMany<Row>(
      `
      SELECT wi.user_id::text, wi.product_id::text, p.name AS product_name, p.slug AS product_slug,
             EXTRACT(EPOCH FROM wi.snapshot_taken_at)::bigint::text AS out_of_stock_since
      FROM wishlist_items wi
      JOIN users u ON u.id = wi.user_id
      JOIN products p ON p.id = wi.product_id
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      WHERE wi.user_id IS NOT NULL
        AND wi.snapshot_in_stock = FALSE
        AND p.is_active = TRUE
        AND ${PRODUCT_IN_STOCK_SQL}
        AND u.is_active = TRUE
        AND u.is_guest = FALSE
        AND u.marketing_opt_out = FALSE
        AND (bp.user_id IS NULL OR bp.approval_status != 'approved')
        AND ${NOT_RECENTLY_EMAILED_SQL}
      ORDER BY wi.snapshot_taken_at ASC
      LIMIT $2
    `,
      [campaign.kind, params.maxWatchesPerSweep]
    )
  },

  async findSuppressed() {
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
        AND p.is_active = TRUE
        AND ${PRODUCT_IN_STOCK_SQL}
        AND (u.is_active = FALSE OR u.is_guest = TRUE OR u.marketing_opt_out = TRUE)
      LIMIT 200
    `
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
      referenceId: `${row.product_id}:${row.out_of_stock_since}`,
      vars: {
        firstName: user.first_name || 'there',
        productName: row.product_name,
        productCard,
        couponCode,
        discountPercent,
        ctaUrl: productUrl,
      },
    })

    await settleWishlistEvent(emailResult, row.user_id, row.product_id)

    if (params.whatsappEnabled) {
      sendCampaignWhatsApp(campaign.kind, row.user_id, { product: row.product_name }, cooldownDays(params)).catch(
        () => {}
      )
    }
    return emailResult
  },
}
