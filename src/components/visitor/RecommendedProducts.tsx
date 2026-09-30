'use client'

import { useEffect, useState } from 'react'
import ProductCard from '@/components/visitor/ProductCard'

interface Product {
  id: string
  name: string
  slug: string
  base_price: number
  price_ex_gst: number | null
  mrp: number | null
  has_variants: boolean
  variant_min_price: number | null
  variant_min_mrp: number | null
  variant_stock_total: number | null
  stock_status: string | null
  discount_pct: number | null
  extra_delivery_days: number | null
  product_images: Array<{ image_url: string; thumbnail_url: string; is_primary: boolean }>
  brands?: { name: string } | null
  categories?: { name: string } | null
}

interface RecommendedProductsProps {
  title?: string
  limit?: number
}

export default function RecommendedProducts({ title = 'You Might Also Like', limit = 4 }: RecommendedProductsProps) {
  const [products, setProducts] = useState<Product[]>([])

  useEffect(() => {
    fetch(`/api/products?limit=${limit}&sort=newest&is_active=true`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data?.products) setProducts(data.products.slice(0, limit))
      })
      .catch(() => {})
  }, [limit])

  if (products.length === 0) return null

  return (
    <div className="mt-8 bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6">
      <h3 className="text-lg font-bold text-foreground mb-4">{title}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {products.map(product => {
          const primaryImage = product.product_images?.find(i => i.is_primary) || product.product_images?.[0]
          const hasVariants = product.has_variants
          const displayPrice =
            hasVariants && product.variant_min_price ? Number(product.variant_min_price) : Number(product.base_price)
          const effectiveStock = hasVariants
            ? Number(product.variant_stock_total ?? 0)
            : product.stock_status !== 'Out of Stock'
              ? 1
              : 0
          const mrp = product.mrp
            ? Number(product.mrp)
            : product.variant_min_mrp
              ? Number(product.variant_min_mrp)
              : null
          const mrpDiscount = mrp && mrp > displayPrice ? Math.round(((mrp - displayPrice) / mrp) * 100) : 0

          return (
            <ProductCard
              key={product.id}
              id={product.id}
              name={product.name}
              slug={product.slug}
              hasVariants={hasVariants}
              displayPrice={displayPrice}
              mrp={mrp}
              mrpDiscount={mrpDiscount}
              effectiveStock={effectiveStock}
              primaryImage={primaryImage || null}
              brandName={product.brands?.name || null}
              categoryName={product.categories?.name || null}
              discountPct={Number(product.discount_pct ?? 0)}
              extraDeliveryDays={Number(product.extra_delivery_days ?? 0)}
              handlingDays={Number((product as any).handling_days ?? 2)}
            />
          )
        })}
      </div>
    </div>
  )
}
