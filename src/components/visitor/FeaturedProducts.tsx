'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Product {
  id: string
  name: string
  slug: string
  base_price: number
  mrp: number | null
  variant_min_price: number | null
  has_variants: boolean
  product_images: Array<{ thumbnail_url: string; is_primary: boolean }>
}

export default function FeaturedProducts() {
  const [products, setProducts] = useState<Product[]>([])

  useEffect(() => {
    fetch('/api/products?sort=popular&limit=4')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.products) setProducts(d.products.slice(0, 4)) })
      .catch(() => {})
  }, [])

  if (products.length === 0) return null

  return (
    <div className="mt-8">
      <h2 className="text-base font-semibold text-foreground mb-3">You might also like</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {products.map(p => {
          const image = p.product_images?.find(i => i.is_primary) || p.product_images?.[0]
          const price = (p.has_variants && p.variant_min_price) ? p.variant_min_price : p.base_price
          const mrp = p.mrp ? Number(p.mrp) : null
          const discount = mrp && mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0
          return (
            <Link key={p.id} href={`/products/${p.slug}`}
              className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden hover:shadow-md transition-shadow group"
            >
              <div className="relative aspect-square bg-surface overflow-hidden">
                {image ? (
                  <img src={image.thumbnail_url} alt={p.name}
                    className="w-full h-full object-contain p-2 group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg className="w-10 h-10 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
                {discount > 0 && (
                  <span className="absolute top-2 right-2 bg-accent-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    {discount}% off
                  </span>
                )}
              </div>
              <div className="p-3">
                <p className="text-xs font-medium text-foreground line-clamp-2 mb-1 group-hover:text-accent-600 transition-colors">{p.name}</p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-sm font-bold text-foreground">₹{Number(price).toLocaleString('en-IN')}</span>
                  {mrp && mrp > price && (
                    <span className="text-[10px] text-foreground-muted line-through">₹{mrp.toLocaleString('en-IN')}</span>
                  )}
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
