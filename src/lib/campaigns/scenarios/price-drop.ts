import { queryMany } from '@/lib/shared/db'
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
  priceDropThresholdPct: number
  maxWatchesPerSweep: number
  whatsappEnabled: boolean
  smsEnabled: boolean
}

interface Row {
  user_id: string
  product_id: string
  product_name: string
  product_slug: string
  snapshot_price: string
  current_price: string
}

export const priceDrop: ScenarioModule<Params, Row> = {
  kind: 'price_drop',
  name: 'Price Drop',
  description: 'Saved product price dropped',
  trigger:
    "Fires when a product on the wishlist or saved for later in the cart has a base_price drops by at least the configured threshold % below the snapshot price. Only for active products that are in stock. The wishlist snapshot is refreshed once the email is sent, so a further drop notifies again.",
  defaultParams: { priceDropThresholdPct: 5, maxWatchesPerSweep: 100, whatsappEnabled: false, smsEnabled: false },
  paramSchema: {
    priceDropThresholdPct: {
      type: 'integer',
      min: 1,
      max: 90,
      label: 'Price drop threshold %',
      description: 'Email only when the new price is at least this % cheaper than the snapshot',
    },
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
    const factor = (100 - params.priceDropThresholdPct) / 100
    return queryMany<Row>(
      `
      SELECT wi.user_id, wi.product_id, p.name AS product_name, p.slug AS product_slug,
             wi.snapshot_price::text AS snapshot_price,
             p.base_price::text AS current_price
      FROM ${SAVED_ITEMS_SQL} wi
      JOIN products p ON p.id = wi.product_id
      JOIN users u ON u.id = wi.user_id
      WHERE u.marketing_opt_out = FALSE AND u.is_active = TRUE AND u.is_guest = FALSE
        AND p.is_active = TRUE
        AND wi.snapshot_taken_at IS NOT NULL
        AND wi.snapshot_price IS NOT NULL
        AND p.base_price < wi.snapshot_price * $2
        AND ${PRODUCT_IN_STOCK_SQL}
        AND ${NOT_RECENTLY_EMAILED_SQL}
      ORDER BY wi.snapshot_taken_at ASC
      LIMIT $3
    `,
      [campaign.kind, factor, params.maxWatchesPerSweep]
    )
  },

  async send(row, { campaign, params }) {
    const user = await fetchUserContext(row.user_id)
    if (!user) return { ok: false, reason: 'no_user' }

    const oldPrice = parseFloat(row.snapshot_price)
    const newPrice = parseFloat(row.current_price)

    const { couponCode, discountPercent } = await resolveCoupon(campaign, row.user_id)
    const productImageUrl = await fetchProductImageUrl(row.product_id)
    const productUrl = `${user.baseUrl}/products/${row.product_slug}`
    const productCard = renderHeroProduct({
      name: row.product_name,
      imageUrl: productImageUrl,
      productUrl,
      oldPrice,
      newPrice,
    })

    const result = await sendCampaignEmail({
      campaign,
      user,
      referenceId: `${row.product_id}:${row.snapshot_price}`,
      vars: {
        firstName: user.first_name || 'there',
        productName: row.product_name,
        productImageUrl,
        productCard,
        oldPrice: Math.round(oldPrice).toString(),
        newPrice: Math.round(newPrice).toString(),
        couponCode,
        discountPercent,
        ctaUrl: productUrl,
      },
    })

    await settleWishlistEvent(result, row.user_id, row.product_id)
    if ((params.whatsappEnabled || (params as any).smsEnabled) && result.ok) {
      sendCampaignWhatsApp(campaign.kind, row.user_id, {
        headline: `${row.product_name} is now ₹${Math.round(newPrice).toLocaleString('en-IN')}`,
        code: couponCode || '',
        discount: discountPercent ? String(discountPercent) : '',
      }).catch(() => {})
    }

    return result
  },
}
