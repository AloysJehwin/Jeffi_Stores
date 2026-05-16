'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface RecentProduct {
  id: string
  name: string
  slug: string
  price: number
  image: string | null
}

const STORAGE_KEY = 'jeffi_recently_viewed'
const MAX_ITEMS = 6

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
      setProducts(stored.filter(p => p.id !== excludeId))
    } catch {}
  }, [excludeId])

  if (products.length === 0) return null

  return (
    <div className="mt-8">
      <h2 className="text-xl font-bold text-foreground mb-4">Recently Viewed</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {products.map(product => (
          <Link key={product.id} href={`/products/${product.slug}`} className="group">
            <div className="bg-surface-elevated rounded-lg border border-border-default overflow-hidden hover:border-accent-400 transition-colors">
              <div className="aspect-square bg-surface">
                {product.image ? (
                  <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg className="w-8 h-8 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
              </div>
              <div className="p-2">
                <p className="text-xs text-foreground font-medium line-clamp-2 group-hover:text-accent-600 transition-colors">{product.name}</p>
                <p className="text-xs font-semibold text-primary-600 dark:text-primary-400 mt-1">
                  ₹{product.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
