'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Product {
  id: string
  name: string
  slug: string
  base_price: number
  sale_price: number | null
  mrp: number | null
  has_variants: boolean
  variant_min_price: number | null
  product_images: Array<{ image_url: string; thumbnail_url: string; is_primary: boolean }>
}

interface RecommendedProductsProps {
  title?: string
  limit?: number
}

export default function RecommendedProducts({ title = 'You Might Also Like', limit = 4 }: RecommendedProductsProps) {
  const [products, setProducts] = useState<Product[]>([])

  useEffect(() => {
    fetch(`/api/products?limit=${limit}&sort=newest&is_active=true`)
      .then(r => r.ok ? r.json() : null)
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
        {products.map((product) => {
          const img = product.product_images?.find(i => i.is_primary) || product.product_images?.[0]
          const price = product.has_variants && product.variant_min_price
            ? product.variant_min_price
            : (product.sale_price || product.base_price)
          const mrp = product.mrp ? Number(product.mrp) : null
          const discount = mrp && mrp > Number(price)
            ? Math.round(((mrp - Number(price)) / mrp) * 100)
            : 0

          return (
            <Link key={product.id} href={`/products/${product.slug}`} className="group">
              <div className="bg-surface rounded-lg border border-border-default overflow-hidden hover:shadow-md transition-shadow">
                <div className="relative aspect-square overflow-hidden bg-surface-secondary">
                  {img ? (
                    <img
                      src={img.thumbnail_url || img.image_url}
                      alt={product.name}
                      className="w-full h-full object-contain p-1"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg className="w-8 h-8 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                  {discount > 0 && (
                    <span className="absolute top-1 right-1 bg-accent-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-semibold">
                      {discount}% off
                    </span>
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs font-medium text-foreground group-hover:text-accent-600 transition-colors line-clamp-2 leading-tight mb-1">
                    {product.name}
                  </p>
                  <p className="text-xs font-bold text-primary-600 dark:text-primary-400">
                    {product.has_variants ? 'From ' : ''}₹{Number(price).toLocaleString('en-IN')}
                  </p>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
