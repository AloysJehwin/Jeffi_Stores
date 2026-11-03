import { queryMany } from '@/lib/shared/db'
import { cooldownMinutes } from '../duration'
import { PRODUCT_IN_STOCK_SQL } from '@/lib/queries/shared'
import {
  fetchUserContext,
  fetchProductImageUrl,
  resolveCoupon,
  sendCampaignEmail,
  renderHeroProduct,
} from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import {
  NOT_RECENTLY_EMAILED_SQL,
  SAVED_ITEMS_SQL,
  settleWishlistEvent,
  syncWishlistSnapshots,
} from './_wishlist-base'
import type { ScenarioModule } from '../types'

interface Params extends Record<string, unknown> {
  maxWatchesPerSweep: number
  whatsappEnabled: boolean
  smsEnabled: boolean
}

interface Row {
  user_id: string
  product_id: string
  product_name: string
  product_slug: string
  out_of_stock_since: string
}

export const restock: ScenarioModule<Params, Row> = {
  kind: 'restock',
  name: 'Back in Stock',
  description: 'Wishlisted product back in stock',
  trigger:
    "Fires when a product on a customer's wishlist goes from Out of Stock back to in stock (by stock status, not inventory quantity). One send per product per restock event; the wishlist snapshot is refreshed once the email is sent so the next out-to-in transition notifies again.",
  defaultParams: { maxWatchesPerSweep: 100, whatsappEnabled: false, smsEnabled: false },
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
    smsEnabled: {
      type: 'boolean',
      label: 'Also send via SMS',
      description: "Additionally send this campaign as a text SMS when a phone number is on file (off by default)",
    },
  },

  async findEligible({ campaign, params }) {
    await syncWishlistSnapshots()
    return queryMany<Row>(
      `
      SELECT wi.user_id, wi.product_id, p.name AS product_name, p.slug AS product_slug,
             EXTRACT(EPOCH FROM wi.snapshot_taken_at)::bigint::text AS out_of_stock_since
      FROM ${SAVED_ITEMS_SQL} wi
      JOIN products p ON p.id = wi.product_id
      JOIN users u ON u.id = wi.user_id
      WHERE u.marketing_opt_out = FALSE AND u.is_active = TRUE AND u.is_guest = FALSE
        AND p.is_active = TRUE
        AND wi.snapshot_taken_at IS NOT NULL
        AND wi.snapshot_in_stock = FALSE
        AND ${PRODUCT_IN_STOCK_SQL}
        AND ${NOT_RECENTLY_EMAILED_SQL}
      ORDER BY wi.snapshot_taken_at ASC
      LIMIT $2
    `,
      [campaign.kind, params.maxWatchesPerSweep]
    )
  },

  async send(row, { campaign, params }) {
    const user = await fetchUserContext(row.user_id)
    if (!user) return { ok: false, reason: 'no_user' }

    const { couponCode, discountPercent } = await resolveCoupon(campaign, row.user_id)
    const productImageUrl = await fetchProductImageUrl(row.product_id)
    const productUrl = `${user.baseUrl}/products/${row.product_slug}`
    const productCard = renderHeroProduct({
      name: row.product_name,
      imageUrl: productImageUrl,
      productUrl,
    })

    const result = await sendCampaignEmail({
      campaign,
      user,
      referenceId: `${row.product_id}:${row.out_of_stock_since}`,
      vars: {
        firstName: user.first_name || 'there',
        productName: row.product_name,
        productImageUrl,
        productCard,
        couponCode,
        discountPercent,
        ctaUrl: productUrl,
      },
    })

    await settleWishlistEvent(result, row.user_id, row.product_id)

    if ((params as any).whatsappEnabled || (params as any).smsEnabled) {
      sendCampaignWhatsApp(campaign.kind, row.user_id, { product: row.product_name }, cooldownMinutes(params)).catch(() => {})
    }

    return result
  },
}
