'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface RecentProduct {
  id: string
  name: string
  slug: string
  price: number
  mrp?: number | null
  brand?: string | null
  inStock?: boolean
  image: string | null
}

const STORAGE_KEY = 'jeffi_recently_viewed'
const MAX_ITEMS = 7

export function trackRecentlyViewed(product: RecentProduct) {
  try {
    const existing: RecentProduct[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    const filtered = existing.filter(p => p.id !== product.id)
    const updated = [product, ...filtered].slice(0, MAX_ITEMS)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  } catch {}
}

export default function RecentlyViewed({ excludeId }: { excludeId?: string }) {
  const [products, setProducts] = useState<RecentProduct[]>([])

  useEffect(() => {
    try {
      const stored: RecentProduct[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
      setProducts(stored.filter(p => p.id !== excludeId).slice(0, 6))
    } catch {}
  }, [excludeId])

  if (products.length < 6) return null

  return (
    <div className="mt-10">
      <h2 className="text-2xl font-bold text-foreground mb-6">Recently Viewed</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {products.map(product => {
          const discount = product.mrp && product.mrp > product.price
            ? Math.round(((product.mrp - product.price) / product.mrp) * 100)
            : 0

          return (
            <Link key={product.id} href={`/products/${product.slug}`} className="group">
              <div className="flex flex-col h-full bg-surface-elevated rounded-xl border border-border-default overflow-hidden hover:shadow-md hover:border-accent-300 transition-all duration-200">
                <div className="relative aspect-square bg-surface overflow-hidden">
                  {product.image ? (
                    <img src={product.image} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg className="w-8 h-8 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                  {discount > 0 && (
                    <div className="absolute top-1.5 right-1.5 bg-accent-500 text-white px-1.5 py-0.5 rounded-full text-xs font-bold leading-none shadow">
                      {discount}% off
                    </div>
                  )}
                </div>
                <div className="flex flex-col flex-1 p-2 gap-0.5">
                  {product.brand && (
                    <span className="text-xs text-accent-600 dark:text-accent-400 font-medium uppercase tracking-wide truncate leading-none">{product.brand}</span>
                  )}
                  <p className="text-xs text-foreground font-medium line-clamp-2 group-hover:text-accent-600 transition-colors flex-1 leading-snug">{product.name}</p>
                  <div className="flex items-baseline gap-1 mt-0.5">
                    <span className="text-xs font-bold text-primary-600 dark:text-primary-400">
                      ₹{product.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                    {product.mrp && product.mrp > product.price && (
                      <span className="text-xs text-foreground-muted line-through leading-none">
                        ₹{product.mrp.toLocaleString('en-IN', { minimumFractionDigits: 0 })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
