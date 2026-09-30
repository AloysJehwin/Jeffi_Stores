'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import Link from 'next/link'
import ImgWithSkeleton from '@/components/ui/ImgWithSkeleton'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { useRouter } from 'next/navigation'
import { resolveEdd } from '@/lib/shipping/edd-cache'
import ProductWarningBadges from '@/components/shared/ProductWarningBadges'
import QuickAddButton from '@/components/visitor/QuickAddButton'

interface ProductCardProps {
  id: string
  name: string
  slug: string
  hasVariants: boolean
  displayPrice: number
  mrp: number | null
  mrpDiscount: number
  effectiveStock: number
  primaryImage?: { image_url: string; thumbnail_url?: string; blurhash?: string | null } | null
  brandName?: string | null
  categoryName?: string | null
  discountPct?: number
  extraDeliveryDays?: number
  handlingDays?: number
  fragile?: boolean | null
  hazardous?: boolean | null
  flammable?: boolean | null
  badge?: string | null
}

export default function ProductCard({
  id,
  name,
  slug,
  hasVariants,
  displayPrice,
  mrp,
  mrpDiscount,
  effectiveStock,
  primaryImage,
  brandName,
  categoryName,
  discountPct = 0,
  extraDeliveryDays = 0,
  handlingDays = 2,
  fragile,
  hazardous,
  flammable,
  badge,
}: ProductCardProps) {
  const { user } = useAuth()
  const { showToast, showConfirm } = useToast()
  const gstEnabled = useStoreConfig().flags.gstEnabled
  const router = useRouter()
  const [isInWishlist, setIsInWishlist] = useState(false)
  const [wishlistLoading, setWishlistLoading] = useState(false)
  const [quickAddSignal, setQuickAddSignal] = useState(0)
  const [edd, setEdd] = useState<string | null>(null)

  useEffect(() => {
    resolveEdd(!!user, handlingDays, extraDeliveryDays).then(v => {
      if (v) setEdd(v)
    })
  }, [user, handlingDays, extraDeliveryDays])

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)

  function startLongPress(e: React.TouchEvent) {
    e.preventDefault()
    longPressFired.current = false
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      setQuickAddSignal(n => n + 1)
    }, 450)
  }

  function cancelLongPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
  }

  const handleWishlist = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!user) {
        showConfirm({
          title: 'Sign In Required',
          message: 'Please sign in to save items to your wishlist.',
          confirmText: 'Sign In',
          cancelText: 'Maybe Later',
          type: 'info',
          onConfirm: () => router.push(`/login?redirect=/products/${slug}`),
        })
        return
      }
      setWishlistLoading(true)
      try {
        if (isInWishlist) {
          const res = await fetch(`/api/wishlist?productId=${id}`, { method: 'DELETE', credentials: 'include' })
          if (res.ok) {
            setIsInWishlist(false)
            showToast('Removed from wishlist', 'success')
          }
        } else {
          const res = await fetch('/api/wishlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: id }),
            credentials: 'include',
          })
          if (res.ok) {
            setIsInWishlist(true)
            showToast('Added to wishlist!', 'success')
          }
        }
      } catch {
        showToast('Failed to update wishlist', 'error')
      } finally {
        setWishlistLoading(false)
      }
    },
    [id, slug, isInWishlist, user]
  )

  const handleShare = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const url = `${window.location.origin}/products/${slug}`
      const shareData = { title: name, text: `Check out ${name}`, url }
      if (navigator.share) {
        try {
          await navigator.share(shareData)
        } catch {}
      } else {
        await navigator.clipboard.writeText(url)
        showToast('Link copied to clipboard!', 'success')
      }
    },
    [slug, name]
  )

  return (
    <>
      <Link
        href={`/products/${slug}`}
        className="group"
        onTouchStart={e => startLongPress(e)}
        onTouchEnd={cancelLongPress}
        onTouchMove={cancelLongPress}
        onContextMenu={e => e.preventDefault()}
        onClick={e => {
          if (longPressFired.current) e.preventDefault()
        }}
      >
        <div
          className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden transition-all duration-300 ease-out hover:shadow-xl hover:-translate-y-1 hover:border-accent-300 dark:hover:border-accent-500 h-full flex flex-col"
          onContextMenu={e => e.preventDefault()}
          style={{ WebkitTouchCallout: 'none', userSelect: 'none' } as React.CSSProperties}
        >
          {/* Image */}
          <div className="relative aspect-[5/3] border-2 border-gray-300 dark:border-gray-600 overflow-hidden rounded-lg mx-3 mt-3">
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
                    blurhash={primaryImage.blurhash}
                    className="w-full h-full object-contain transition-transform duration-500 ease-out group-hover:scale-105"
                  />
                </div>
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <svg className="w-20 h-20 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>
            )}

            {/* Sale ribbon */}
            {discountPct > 0 && (
              <div className="absolute top-4 right-[-16px] w-20 rotate-45 bg-gradient-to-r from-rose-500 to-orange-500 text-white text-[8px] font-bold text-center py-0.5 shadow-md pointer-events-none select-none z-10 overflow-hidden">
                SALE
              </div>
            )}

            {(mrpDiscount > 0 || badge) && (
              <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
                {mrpDiscount > 0 && (
                  <div className="bg-accent-500 dark:bg-accent-600 text-white px-2 py-0.5 rounded-full text-xs font-semibold">
                    {mrpDiscount}% off
                  </div>
                )}
                {badge && (
                  <div className="bg-primary-500 dark:bg-primary-600 text-white px-2 py-0.5 rounded-full text-xs font-semibold">
                    {badge}
                  </div>
                )}
              </div>
            )}

            <div className="absolute bottom-2 left-2 flex flex-col gap-0.5">
              <ProductWarningBadges fragile={fragile} hazardous={hazardous} flammable={flammable} size="xs" />
            </div>
          </div>

          {/* Info */}
          <div className="p-2.5 sm:p-5 flex flex-col flex-grow">
            <div className="flex items-start justify-between gap-2 mb-1.5 sm:mb-2">
              <h3 className="font-semibold text-sm sm:text-base text-foreground mb-1.5 sm:mb-2 group-hover:text-accent-600 transition-colors line-clamp-2 min-h-[2.5rem] sm:min-h-[3rem]">
                {name}
              </h3>
              <div className="flex-shrink-0 flex items-center gap-1.5 mt-0.5">
                <QuickAddButton
                  productId={id}
                  productName={name}
                  slug={slug}
                  hasVariants={hasVariants}
                  inStock={effectiveStock > 0}
                  imageUrl={primaryImage?.thumbnail_url || primaryImage?.image_url || null}
                  brandName={brandName}
                  categoryName={categoryName}
                  displayPrice={displayPrice}
                  mrp={mrp}
                  discountPct={discountPct ?? mrpDiscount}
                  openSignal={quickAddSignal}
                />
                <div className="hidden sm:flex items-center gap-1.5">
                  <button
                    onClick={handleWishlist}
                    disabled={wishlistLoading}
                    aria-label={isInWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
                    className="w-7 h-7 rounded-full bg-surface-secondary border border-border-default flex items-center justify-center text-foreground-muted hover:text-red-500 hover:border-red-300 transition-all hover:scale-110 active:scale-95 disabled:opacity-60"
                  >
                    <svg
                      className={`w-3.5 h-3.5 transition-transform duration-300 ${isInWishlist ? 'animate-heart-pulse' : ''}`}
                      fill={isInWishlist ? 'currentColor' : 'none'}
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                      style={{ color: isInWishlist ? '#ef4444' : undefined }}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                      />
                    </svg>
                  </button>
                  <button
                    onClick={handleShare}
                    aria-label="Share product"
                    className="w-7 h-7 rounded-full bg-surface-secondary border border-border-default flex items-center justify-center text-foreground-muted hover:text-accent-500 hover:border-accent-400 transition-all hover:scale-110 active:scale-95"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            <div className="text-xs text-foreground-muted mb-2 sm:mb-3 space-y-0.5">
              {brandName && <div className="truncate">Brand: {brandName}</div>}
              {categoryName && <div className="truncate">Category: {categoryName}</div>}
            </div>
            <div className="mt-auto">
              <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2 mb-0.5 sm:mb-1">
                <span className="text-base sm:text-xl font-bold text-primary-600 dark:text-primary-400 leading-tight">
                  {hasVariants ? 'From ' : ''}&#x20B9;
                  {Number(displayPrice).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                {mrp && mrp > Number(displayPrice) && (
                  <span className="text-xs sm:text-sm text-foreground-muted line-through leading-tight">
                    &#x20B9;{mrp.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                )}
              </div>
              {gstEnabled && <p className="text-[10px] text-foreground-muted mb-2 sm:mb-3">Inclusive of all taxes</p>}
              <div className="flex items-center justify-between gap-1">
                <span
                  className={`text-xs font-medium whitespace-nowrap ${effectiveStock > 0 ? 'text-green-600' : 'text-red-600'}`}
                >
                  {effectiveStock > 0 ? 'In Stock' : 'Out of Stock'}
                </span>
                <span className="text-accent-500 group-hover:text-accent-600 font-semibold text-xs sm:text-sm whitespace-nowrap transition-all group-hover:translate-x-1">
                  View Details &#x2192;
                </span>
              </div>
              {edd && effectiveStock > 0 && (
                <p className="text-[10px] text-foreground-muted mt-0.5">
                  Deliver by{' '}
                  <span className="font-medium text-foreground">
                    {new Date(edd + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </span>
                </p>
              )}
            </div>
          </div>
        </div>
      </Link>

    </>
  )
}
