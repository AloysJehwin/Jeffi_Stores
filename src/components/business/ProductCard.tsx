'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import Link from 'next/link'
import ImgWithSkeleton from '@/components/ui/ImgWithSkeleton'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { applyDiscount, mrpDiscountPct } from '@/lib/pricing'
import { bp } from '@/lib/business-path'

interface ProductCardProps {
  id: string
  name: string
  slug: string
  hasVariants: boolean
  displayPrice: number
  mrp: number | null
  mrpDiscount: number
  effectiveStock: number
  primaryImage?: { image_url: string; thumbnail_url?: string } | null
  brandName?: string | null
  categoryName?: string | null
  categoryId?: string | null
}

export default function ProductCard({
  id, name, slug, hasVariants, displayPrice, mrp, mrpDiscount,
  effectiveStock, primaryImage, brandName, categoryName, categoryId,
}: ProductCardProps) {
  const { user } = useAuth()

  // Apply per-category business discount off the selling price, show combined % off MRP
  const discountPct = categoryId ? (user?.businessDiscountMap?.[categoryId] ?? 0) : 0
  const businessPrice = discountPct > 0 ? applyDiscount(displayPrice, discountPct) : null
  const shownPrice = businessPrice ?? displayPrice
  const shownDiscount = businessPrice && mrp && mrp > 0
    ? mrpDiscountPct(mrp, businessPrice)
    : mrpDiscount
  const { showToast } = useToast()
  const [showQuickView, setShowQuickView] = useState(false)

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)

  useEffect(() => {
    if (!showQuickView) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [showQuickView])

  function startLongPress(e: React.TouchEvent) {
    e.preventDefault()
    longPressFired.current = false
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      setShowQuickView(true)
    }, 450)
  }

  function cancelLongPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
  }

  const handleShare = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const url = `${window.location.origin}${bp(`/business/products/${slug}`)}`
    const shareData = { title: name, text: `Check out ${name}`, url }
    if (navigator.share) {
      try { await navigator.share(shareData) } catch {}
    } else {
      await navigator.clipboard.writeText(url)
      showToast('Link copied to clipboard!', 'success')
    }
  }, [slug, name])

  return (
    <>
      <Link
        href={bp(`/business/products/${slug}`)}
        className="group"
        onTouchStart={(e) => startLongPress(e)}
        onTouchEnd={cancelLongPress}
        onTouchMove={cancelLongPress}
        onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => { if (longPressFired.current) e.preventDefault() }}
      >
        <div
          className="relative bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden transition-all duration-300 ease-out hover:shadow-xl hover:-translate-y-1 hover:border-accent-300 dark:hover:border-accent-500 h-full flex flex-col"
          onContextMenu={(e) => e.preventDefault()}
          style={{ WebkitTouchCallout: 'none', userSelect: 'none' } as React.CSSProperties}
        >
          {/* Image wrapper */}
          <div className="relative mx-3 mt-3">
          <div className="relative aspect-[5/3] border-2 border-gray-300 dark:border-gray-600 overflow-hidden rounded-lg">
            {primaryImage ? (
              <>
                <img
                  src={primaryImage.image_url}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-60 transition-opacity duration-300 group-hover:opacity-80"
                />
                <div className="relative w-full h-full">
                  <ImgWithSkeleton
                    src={primaryImage.image_url}
                    alt={name}
                    className="w-full h-full object-contain transition-transform duration-500 ease-out group-hover:scale-105"
                  />
                </div>
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <svg className="w-20 h-20 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            )}
            {discountPct > 0 && (
              <div className="absolute top-8 right-[-32px] w-36 rotate-45 bg-gradient-to-r from-amber-500 to-rose-500 text-white text-[10px] font-bold text-center py-1 shadow-md pointer-events-none select-none z-10">
                Business offer
              </div>
            )}

            {shownDiscount > 0 && (
              <div className="absolute top-2 left-2 bg-accent-500 dark:bg-accent-600 text-white px-2 py-0.5 rounded-full text-xs font-semibold">
                {shownDiscount}% off
              </div>
            )}

          </div>
          </div>

          {/* Info */}
          <div className="p-2.5 sm:p-5 flex flex-col flex-grow">
            <div className="flex items-start justify-between gap-2 mb-1.5 sm:mb-2">
              <h3 className="font-semibold text-sm sm:text-base text-foreground group-hover:text-accent-600 transition-colors line-clamp-2 min-h-[2.5rem] sm:min-h-[3rem]">
                {name}
              </h3>
              <button
                onClick={handleShare}
                aria-label="Share product"
                className="flex-shrink-0 w-7 h-7 rounded-full bg-surface-secondary border border-border-default flex items-center justify-center text-foreground-muted hover:text-accent-500 hover:border-accent-400 transition-all hover:scale-110 active:scale-95 mt-0.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              </button>
            </div>
            <div className="text-xs text-foreground-muted mb-2 sm:mb-3 space-y-0.5">
              {brandName && <div className="truncate">Brand: {brandName}</div>}
              {categoryName && <div className="truncate">Category: {categoryName}</div>}
            </div>
            <div className="mt-auto">
              <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2 mb-0.5 sm:mb-1">
                <span className="text-base sm:text-xl font-bold text-primary-600 dark:text-primary-400 leading-tight">
                  {hasVariants ? 'From ' : ''}&#x20B9;{Number(shownPrice).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                {businessPrice ? (
                  <span className="text-xs sm:text-sm text-foreground-muted line-through leading-tight">
                    &#x20B9;{Number(displayPrice).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                ) : mrp && mrp > Number(displayPrice) ? (
                  <span className="text-xs sm:text-sm text-foreground-muted line-through leading-tight">
                    &#x20B9;{mrp.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                ) : null}
              </div>
              {businessPrice && (
                <p className="text-[10px] text-accent-600 dark:text-accent-400 font-medium mb-0.5">Your business price</p>
              )}
              <p className="text-[10px] text-foreground-muted mb-2 sm:mb-3">Inclusive of all taxes</p>
              <div className="flex items-center justify-between gap-1">
                <span className={`text-xs font-medium whitespace-nowrap ${effectiveStock > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {effectiveStock > 0 ? 'In Stock' : 'Out of Stock'}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-accent-500 group-hover:text-accent-600 font-semibold text-xs sm:text-sm whitespace-nowrap transition-all group-hover:translate-x-1">
                    View Details &#x2192;
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Link>

      {/* Mobile quick-view bottom sheet — long-press only, hidden on md+ */}
      {showQuickView && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <div
            className="absolute inset-0 bg-black/50"
            onTouchEnd={(e) => { e.preventDefault(); setShowQuickView(false) }}
            onTouchMove={(e) => e.preventDefault()}
            onClick={() => setShowQuickView(false)}
          />
          <div className="relative bg-surface-elevated rounded-t-2xl shadow-2xl p-5 pb-8 animate-slide-up">
            <div className="w-10 h-1 bg-border-default rounded-full mx-auto mb-4" />

            <div className="flex gap-4 mb-4">
              <div className="w-20 h-20 rounded-xl border border-border-default bg-surface-secondary flex-shrink-0 overflow-hidden">
                {primaryImage ? (
                  <img src={primaryImage.image_url} alt={name} className="w-full h-full object-contain p-1" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg className="w-8 h-8 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-base text-foreground leading-snug mb-1">{name}</h3>
                {brandName && <p className="text-xs text-foreground-muted">{brandName}</p>}
                {categoryName && <p className="text-xs text-foreground-muted">{categoryName}</p>}
              </div>
            </div>

            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl font-bold text-primary-600 dark:text-primary-400">
                {hasVariants ? 'From ' : ''}&#x20B9;{Number(shownPrice).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              {businessPrice ? (
                <>
                  <span className="text-sm text-foreground-muted line-through">
                    &#x20B9;{Number(displayPrice).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-xs font-semibold bg-accent-500 text-white px-2 py-0.5 rounded-full">
                    {shownDiscount}% off
                  </span>
                </>
              ) : mrp && mrp > Number(displayPrice) ? (
                <>
                  <span className="text-sm text-foreground-muted line-through">
                    &#x20B9;{mrp.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-xs font-semibold bg-accent-500 text-white px-2 py-0.5 rounded-full">
                    {mrpDiscount}% off
                  </span>
                </>
              ) : null}
            </div>

            <div className="flex items-center gap-2 mb-5">
              <span className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1 rounded-full ${
                effectiveStock > 0
                  ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                  : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${effectiveStock > 0 ? 'bg-green-500' : 'bg-red-500'}`} />
                {effectiveStock > 0 ? 'In Stock' : 'Out of Stock'}
              </span>
              <span className="text-xs text-foreground-muted">Incl. all taxes</span>
            </div>

            <Link
              href={bp(`/business/products/${slug}`)}
              onClick={() => setShowQuickView(false)}
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
