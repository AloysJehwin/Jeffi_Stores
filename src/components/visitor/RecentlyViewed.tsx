'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { applyDiscount, mrpDiscountPct } from '@/lib/pricing'

interface RecentProduct {
  id: string
  name: string
  slug: string
  price: number
  mrp?: number | null
  brand?: string | null
  inStock?: boolean
  image: string | null
  categoryId?: string | null
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

export default function RecentlyViewed({ excludeId, basePath = '/products' }: { excludeId?: string; basePath?: string }) {
  const { user } = useAuth()
  const [products, setProducts] = useState<RecentProduct[]>([])
  const [quickView, setQuickView] = useState<RecentProduct | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)

  useEffect(() => {
    try {
      const stored: RecentProduct[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
      setProducts(stored.filter(p => p.id !== excludeId).slice(0, 6))
    } catch {}
  }, [excludeId])

  useEffect(() => {
    if (!quickView) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [quickView])

  function startLongPress(e: React.TouchEvent, product: RecentProduct) {
    e.preventDefault()
    longPressFired.current = false
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      setQuickView(product)
    }, 450)
  }

  function cancelLongPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
  }

  if (products.length < 6) return null

  return (
    <>
    <div className="mt-10">
      <h2 className="text-2xl font-bold text-foreground mb-6">Recently Viewed</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {products.map(product => {
          const discountPct = product.categoryId ? (user?.businessDiscountMap?.[product.categoryId] ?? 0) : 0
          const businessPrice = discountPct > 0 ? applyDiscount(product.price, discountPct) : null
          const shownPrice = businessPrice ?? product.price
          const discount = product.mrp && product.mrp > shownPrice
            ? mrpDiscountPct(product.mrp, shownPrice)
            : 0

          return (
            <Link
              key={product.id}
              href={`${basePath}/${product.slug}`}
              className="group"
              onTouchStart={(e) => startLongPress(e, product)}
              onTouchEnd={cancelLongPress}
              onTouchMove={cancelLongPress}
              onContextMenu={(e) => e.preventDefault()}
              onClick={(e) => { if (longPressFired.current) e.preventDefault() }}
            >
              <div
                className="flex flex-col h-full bg-surface-elevated rounded-xl border border-border-default overflow-hidden hover:shadow-md hover:border-accent-300 transition-all duration-200"
                onContextMenu={(e) => e.preventDefault()}
                style={{ WebkitTouchCallout: 'none', userSelect: 'none' } as React.CSSProperties}
              >
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
                  {discountPct > 0 && (
                    <div className="absolute top-5 right-[-28px] w-28 rotate-45 bg-gradient-to-r from-amber-500 to-rose-500 text-white text-[9px] font-bold text-center py-0.5 shadow-md pointer-events-none select-none z-10">
                      Business offer
                    </div>
                  )}
                  {discount > 0 && (
                    <div className="absolute top-1.5 left-1.5 bg-accent-500 text-white px-1.5 py-0.5 rounded-full text-xs font-bold leading-none shadow">
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
                      ₹{shownPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                    {businessPrice ? (
                      <span className="text-xs text-foreground-muted line-through leading-none">
                        ₹{product.price.toLocaleString('en-IN', { minimumFractionDigits: 0 })}
                      </span>
                    ) : product.mrp && product.mrp > product.price ? (
                      <span className="text-xs text-foreground-muted line-through leading-none">
                        ₹{product.mrp.toLocaleString('en-IN', { minimumFractionDigits: 0 })}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>

    {/* Mobile long-press quick-view */}
    {quickView && (
      <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
        <div
          className="absolute inset-0 bg-black/50"
          onTouchEnd={(e) => { e.preventDefault(); setQuickView(null) }}
          onTouchMove={(e) => e.preventDefault()}
          onClick={() => setQuickView(null)}
        />
        <div className="relative bg-surface-elevated rounded-t-2xl shadow-2xl p-5 pb-8 animate-slide-up">
          <div className="w-10 h-1 bg-border-default rounded-full mx-auto mb-4" />

          <div className="flex gap-4 mb-4">
            <div className="w-20 h-20 rounded-xl border border-border-default bg-surface-secondary flex-shrink-0 overflow-hidden">
              {quickView.image ? (
                <img src={quickView.image} alt={quickView.name} className="w-full h-full object-contain p-1" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-base text-foreground leading-snug mb-1">{quickView.name}</h3>
              {quickView.brand && <p className="text-xs text-foreground-muted">{quickView.brand}</p>}
            </div>
          </div>

          <div className="flex items-center gap-3 mb-4">
            <span className="text-2xl font-bold text-primary-600 dark:text-primary-400">
              ₹{quickView.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
            {quickView.mrp && quickView.mrp > quickView.price && (() => {
              const d = Math.round(((quickView.mrp - quickView.price) / quickView.mrp) * 100)
              return (
                <>
                  <span className="text-sm text-foreground-muted line-through">
                    ₹{quickView.mrp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                  {d > 0 && (
                    <span className="text-xs font-semibold bg-accent-500 text-white px-2 py-0.5 rounded-full">
                      {d}% off
                    </span>
                  )}
                </>
              )
            })()}
          </div>

          <p className="text-xs text-foreground-muted mb-5">Incl. all taxes</p>

          <Link
            href={`${basePath}/${quickView.slug}`}
            onClick={() => setQuickView(null)}
            className="block w-full text-center bg-accent-500 hover:bg-accent-600 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            View Full Details
          </Link>
        </div>
      </div>
    )}
    </>
  )
}
