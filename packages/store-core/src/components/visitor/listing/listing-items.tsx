import ProductCard from '@/components/visitor/ProductCard'
import { pickUnitPrice } from '@/lib/catalog/pricing'
import { round2 } from '@/lib/catalog/gst'

// Pre-render each product as a server-side ReactNode so pages 2..N appended via
// ServerPagedItems carry the same GST / discount maths without re-shipping product data.
export function renderProductItem(product: any, gstEnabled: boolean) {
  const primaryImage = product.product_images?.find((i: any) => i.is_primary) || product.product_images?.[0]
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
  const rawMrp = hasVariants
    ? product.variant_min_mrp
      ? Number(product.variant_min_mrp)
      : null
    : product.mrp
      ? Number(product.mrp)
      : null
  const gstRate = Number(product.gst_percentage ?? 0)
  const mrp = !gstEnabled && rawMrp != null && gstRate > 0 ? round2(rawMrp / (1 + gstRate / 100)) : rawMrp
  const mrpDiscount = mrp && mrp > Number(displayPrice) ? Math.round(((mrp - Number(displayPrice)) / mrp) * 100) : 0
  return (
    <ProductCard
      id={product.id}
      name={product.name}
      slug={product.slug}
      hasVariants={hasVariants}
      displayPrice={Number(displayPrice)}
      mrp={mrp}
      mrpDiscount={mrpDiscount}
      effectiveStock={effectiveStock}
      isDigital={!!product.is_digital}
      primaryImage={primaryImage || null}
      brandName={product.brands?.name ?? null}
      categoryName={product.categories?.name ?? null}
      categoryId={product.categories?.id ?? null}
      discountPct={Number(product.discount_pct ?? 0)}
      extraDeliveryDays={Number(product.extra_delivery_days ?? 0)}
      handlingDays={Number(product.handling_days ?? 2)}
      fragile={product.fragile}
      hazardous={product.hazardous}
      flammable={product.flammable}
    />
  )
}
