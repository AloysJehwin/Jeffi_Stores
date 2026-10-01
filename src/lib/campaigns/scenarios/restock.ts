import { queryMany, query } from '@/lib/shared/db'
import {
  fetchUserContext,
  fetchProductImageUrl,
  resolveCoupon,
  sendCampaignEmail,
  renderHeroProduct,
} from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import type { ScenarioModule } from '../types'

interface Params extends Record<string, unknown> {
  maxWatchesPerSweep: number
  whatsappEnabled: boolean
}

interface Row {
  user_id: string
  product_id: string
  product_name: string
  product_slug: string
  current_price: string
  current_in_stock: boolean
}

export const restock: ScenarioModule<Params, Row> = {
  kind: 'restock',
  name: 'Back in Stock',
  description: 'Wishlisted product back in stock',
  trigger:
    "Fires when a product on a customer's wishlist transitions from out-of-stock (snapshot_in_stock=false) back to in-stock (inventory_quantity>0). One send per product per restock event; the wishlist snapshot is updated after sending so the next out→in transition will trigger again.",
  defaultParams: { maxWatchesPerSweep: 100, whatsappEnabled: false },
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

  async findEligible({ params }) {
    return queryMany<Row>(
      `
      SELECT wi.user_id, wi.product_id, p.name AS product_name, p.slug AS product_slug,
             p.base_price::text AS current_price,
             (p.inventory_quantity > 0) AS current_in_stock
      FROM wishlist_items wi
      JOIN products p ON p.id = wi.product_id
      JOIN users u ON u.id = wi.user_id
      WHERE u.marketing_opt_out = FALSE AND u.is_active = TRUE AND u.is_guest = FALSE
        AND wi.snapshot_taken_at IS NOT NULL
        AND wi.snapshot_in_stock = FALSE
        AND p.inventory_quantity > 0
      LIMIT $1
    `,
      [params.maxWatchesPerSweep]
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
      referenceId: row.product_id,
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

    await query(
      `UPDATE wishlist_items
       SET snapshot_price = $1, snapshot_in_stock = $2, snapshot_taken_at = NOW()
       WHERE user_id = $3 AND product_id = $4`,
      [parseFloat(row.current_price), row.current_in_stock, row.user_id, row.product_id]
    ).catch(() => {})

    if ((params as any).whatsappEnabled) {
      sendCampaignWhatsApp(campaign.kind, row.user_id, { product: row.product_name }).catch(() => {})
    }

    return result
  },
}
