import type { Product } from '../types'
import type { CardProduct } from '../types/home'

const round2 = (n: number) => Math.round(n * 100) / 100

/** The web's productCardProps for a raw /api/products row. */
export function toCard(p: Product & Record<string, any>, gstEnabled: boolean): CardProduct {
  const img = p.product_images?.find(i => i.is_primary) || p.product_images?.[0]
  const incl = Number(p.base_price ?? 0)
  const ex = p.price_ex_gst == null ? null : Number(p.price_ex_gst)
  const unit = gstEnabled ? incl : ex != null && ex > 0 ? ex : incl
  const displayPrice = p.has_variants && p.variant_min_price ? Number(p.variant_min_price) : unit
  const effectiveStock = p.has_variants
    ? Number(p.variant_stock_total ?? 0)
    : p.stock_status != null
      ? p.stock_status !== 'Out of Stock' ? 1 : 0
      : Number(p.stock_quantity ?? 0)
  const rawMrp = p.mrp ? Number(p.mrp) : p.variant_min_mrp ? Number(p.variant_min_mrp) : null
  const gstRate = Number(p.gst_percentage ?? 0)
  const mrp = !gstEnabled && rawMrp != null && gstRate > 0 ? round2(rawMrp / (1 + gstRate / 100)) : rawMrp
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    hasVariants: !!p.has_variants,
    displayPrice,
    mrp,
    mrpDiscount: mrp && mrp > displayPrice ? Math.round(((mrp - displayPrice) / mrp) * 100) : 0,
    effectiveStock,
    primaryImage: img?.image_url ? { image_url: img.image_url, thumbnail_url: img.thumbnail_url, blurhash: (img as any).blurhash ?? null } : null,
    brandName: p.brands?.name ?? null,
    categoryName: p.categories?.name ?? null,
    discountPct: Number(p.discount_pct ?? 0),
    extraDeliveryDays: Number(p.extra_delivery_days ?? 0),
    isDigital: !!p.is_digital,
  }
}
