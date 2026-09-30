import { pickUnitPrice } from '@/lib/pricing'

export function productCardProps(product: any, gstEnabled: boolean) {
  const primaryImage = product.product_images?.find((img: any) => img.is_primary) || product.product_images?.[0]
  const hasVariants = product.has_variants
  const displayPrice =
    hasVariants && product.variant_min_price
      ? Number(product.variant_min_price)
      : pickUnitPrice(
          {
            inclusive: Number(product.base_price),
            exGst: product.price_ex_gst != null ? Number(product.price_ex_gst) : undefined,
          },
          gstEnabled
        )
  const effectiveStock = hasVariants
    ? Number(product.variant_stock_total)
    : product.stock_status !== 'Out of Stock'
      ? 1
      : 0
  const rawMrp = product.mrp ? Number(product.mrp) : product.variant_min_mrp ? Number(product.variant_min_mrp) : null
  // MRP is stored GST-inclusive. When GST is off, displayPrice is ex-GST, so put
  // the MRP on the same ex-GST basis before computing the discount / strike-through.
  const gstRate = Number(product.gst_percentage ?? 0)
  const mrp = !gstEnabled && rawMrp != null && gstRate > 0 ? rawMrp / (1 + gstRate / 100) : rawMrp
  const mrpDiscount = mrp && mrp > displayPrice ? Math.round(((mrp - displayPrice) / mrp) * 100) : 0
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    hasVariants,
    displayPrice,
    mrp,
    mrpDiscount,
    effectiveStock,
    primaryImage: primaryImage || null,
    brandName: product.brands?.name || null,
    categoryName: product.categories?.name || null,
    discountPct: Number(product.discount_pct ?? 0),
    extraDeliveryDays: Number(product.extra_delivery_days ?? 0),
  }
}

export type CardProps = ReturnType<typeof productCardProps>

/**
 * ProductCard props for rows headed to a client component or a public API: product_images rows
 * carry storage keys, so only the display fields of the primary image are kept.
 */
export function cardPropsFor(rows: any[], gstEnabled: boolean): CardProps[] {
  return rows.map(row => {
    const card = productCardProps(row, gstEnabled)
    const img = card.primaryImage as { image_url?: string; thumbnail_url?: string; blurhash?: string | null } | null
    return {
      ...card,
      primaryImage: img?.image_url
        ? { image_url: img.image_url, thumbnail_url: img.thumbnail_url, blurhash: img.blurhash ?? null }
        : null,
    }
  })
}
