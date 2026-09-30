import { queryMany, query } from '@/lib/db'
import {
  fetchUserContext,
  fetchProductImageUrl,
  resolveCoupon,
  sendCampaignEmail,
  renderHeroProduct,
} from '@/lib/automation-emails'
import type { ScenarioModule } from '../types'

interface Params extends Record<string, unknown> {
  priceDropThresholdPct: number
  maxWatchesPerSweep: number
}

interface Row {
  user_id: string
  product_id: string
  product_name: string
  product_slug: string
  snapshot_price: string
  current_price: string
  current_in_stock: boolean
}

export const priceDrop: ScenarioModule<Params, Row> = {
  kind: 'price_drop',
  name: 'Price Drop',
  description: 'Wishlisted product price dropped',
  trigger:
    "Fires when a wishlisted product's base_price drops by at least the configured threshold % below the snapshot price. Skipped if the product just came back in stock (that's a restock event instead). Wishlist snapshot is updated after sending.",
  defaultParams: { priceDropThresholdPct: 5, maxWatchesPerSweep: 100 },
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
  },

  async findEligible({ params }) {
    const factor = (100 - params.priceDropThresholdPct) / 100
    return queryMany<Row>(
      `
      SELECT wi.user_id, wi.product_id, p.name AS product_name, p.slug AS product_slug,
             wi.snapshot_price::text AS snapshot_price,
             p.base_price::text AS current_price,
             (p.inventory_quantity > 0) AS current_in_stock
      FROM wishlist_items wi
      JOIN products p ON p.id = wi.product_id
      JOIN users u ON u.id = wi.user_id
      WHERE u.marketing_opt_out = FALSE AND u.is_active = TRUE AND u.is_guest = FALSE
        AND wi.snapshot_taken_at IS NOT NULL
        AND wi.snapshot_price IS NOT NULL
        AND p.base_price < wi.snapshot_price * $1
        AND NOT (wi.snapshot_in_stock = FALSE AND p.inventory_quantity > 0)
      LIMIT $2
    `,
      [factor, params.maxWatchesPerSweep]
    )
  },

  async send(row, { campaign }) {
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
      referenceId: row.product_id,
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

    await query(
      `UPDATE wishlist_items
       SET snapshot_price = $1, snapshot_in_stock = $2, snapshot_taken_at = NOW()
       WHERE user_id = $3 AND product_id = $4`,
      [newPrice, row.current_in_stock, row.user_id, row.product_id]
    ).catch(() => {})

    return result
  },
}
