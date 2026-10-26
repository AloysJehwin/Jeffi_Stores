'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import ImgWithSkeleton from '@/components/ui/ImgWithSkeleton'
import { backdropImg, onImgError } from '@/lib/shared/image-url'
import { useAuth } from '@/contexts/AuthContext'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { resolveEdd } from '@/lib/shipping/edd-cache'
import ProductWarningBadges from '@/components/shared/ProductWarningBadges'
import { digitalActive } from '@/lib/catalog/digital'
import QuickAddButton from '@/components/visitor/QuickAddButton'
import { useProductLikeShare } from '@/components/visitor/useProductLikeShare'
import { applyDiscount, mrpDiscountPct } from '@/lib/catalog/pricing'
import { bp } from '@/lib/shared/business-path'

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
  categoryId?: string | null
  discountPct?: number
  extraDeliveryDays?: number
  handlingDays?: number
  fragile?: boolean | null
  hazardous?: boolean | null
  flammable?: boolean | null
  badge?: string | null
  isDigital?: boolean
  portal?: 'storefront' | 'business'
}

// Two columns on phones, two or three beside the filters on wider screens.
const CARD_SIZES = '(min-width: 1280px) 30vw, (min-width: 768px) 40vw, 50vw'

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
  categoryId,
  discountPct = 0,
  extraDeliveryDays = 0,
  handlingDays = 2,
  fragile,
  hazardous,
  flammable,
  badge,
  isDigital = false,
  portal = 'storefront',
}: ProductCardProps) {
  const { user } = useAuth()
  const { gstEnabled, digitalProductsEnabled } = useStoreConfig().flags
  const digital = digitalActive(digitalProductsEnabled, isDigital)
  const inStock = digital || effectiveStock > 0
  const [quickAddSignal, setQuickAddSignal] = useState(0)
  const [edd, setEdd] = useState<string | null>(null)

  const isBusiness = portal === 'business'
  const productHref = isBusiness ? bp(`/business/products/${slug}`) : `/products/${slug}`

  const bizDiscountPct = isBusiness && categoryId ? (user?.businessDiscountMap?.[categoryId] ?? 0) : 0
  const businessPrice = bizDiscountPct > 0 ? applyDiscount(displayPrice, bizDiscountPct) : null
  const shownPrice = businessPrice ?? displayPrice
  const shownMrpDiscount = businessPrice && mrp && mrp > 0 ? mrpDiscountPct(mrp, businessPrice) : mrpDiscount

  useEffect(() => {
    if (digital) return
    resolveEdd(!!user, handlingDays, extraDeliveryDays, isBusiness ? 'business' : undefined).then(v => {
      if (v) setEdd(v)
    })
  }, [digital, user, handlingDays, extraDeliveryDays, isBusiness])

  // Touch long-press opens quick add. Pointer events, since React's touchstart is passive and can't preventDefault.
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)
  const suppressClickUntil = useRef(0)
  const pressStart = useRef<{ x: number; y: number } | null>(null)

  // Events from the portalled quick-add popup bubble here through React; only the card's own DOM counts.
  const fromCard = (e: React.SyntheticEvent) => e.currentTarget.contains(e.target as Node)

  function startLongPress(e: React.PointerEvent) {
    if (e.pointerType !== 'touch' || !fromCard(e)) return
    longPressFired.current = false
    pressStart.current = { x: e.clientX, y: e.clientY }
    cancelLongPress()
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      setQuickAddSignal(n => n + 1)
    }, 450)
  }

  function cancelLongPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
    longPressTimer.current = null
  }

  // The click that may follow a fired long-press lands wherever the finger lifts (often the popup's backdrop).
  function endLongPress() {
    cancelLongPress()
    if (longPressFired.current) {
      longPressFired.current = false
      suppressClickUntil.current = Date.now() + 400
    }
  }

  function moveLongPress(e: React.PointerEvent) {
    const start = pressStart.current
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancelLongPress()
  }

  const { isInWishlist, wishlistLoading, handleWishlist, handleShare } = useProductLikeShare({
    id,
    slug,
    name,
    href: productHref,
  })

  const wishlistIcon = (
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
  )

  const eddLabel =
    edd && !digital && inStock
      ? new Date(edd + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      : null

  return (
    <div
      className="group h-full"
      onPointerDown={startLongPress}
      onPointerUp={endLongPress}
      onPointerCancel={endLongPress}
      onPointerMove={moveLongPress}
      onContextMenu={e => {
        if (fromCard(e)) e.preventDefault()
      }}
      onClickCapture={e => {
        if (Date.now() < suppressClickUntil.current) {
          suppressClickUntil.current = 0
          e.preventDefault()
          e.stopPropagation()
        }
      }}
    >
      {/* Phones mirror the app's card (mobile-service ProductCard): 20px radius, soft shadow, border only in dark. */}
      <div
        className="relative bg-surface-elevated rounded-[20px] sm:rounded-lg shadow sm:shadow-sm border border-transparent dark:border-border-default sm:border-border-default overflow-hidden transition-all duration-300 ease-out max-sm:active:scale-[0.98] hover:shadow-xl hover:-translate-y-1 hover:border-accent-300 dark:hover:border-accent-500 h-full flex flex-col"
        style={{ WebkitTouchCallout: 'none', userSelect: 'none' } as React.CSSProperties}
      >
        {/* Image */}
        <div className="relative aspect-[5/3] border-2 border-gray-300 dark:border-gray-600 overflow-hidden rounded-lg mx-3 mt-3">
          {primaryImage ? (
            <>
              <img
                {...backdropImg(primaryImage.image_url)}
                onError={onImgError}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-60 transition-opacity duration-300 group-hover:opacity-80"
              />
              <div className="relative w-full h-full">
                <ImgWithSkeleton
                  src={primaryImage.image_url}
                  alt={name}
                  blurhash={primaryImage.blurhash}
                  sizes={CARD_SIZES}
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

          {/* Business-offer ribbon takes precedence over SALE; SALE only when no % pill says it already.
                Phones keep the corner for the wishlist button instead. */}
          {bizDiscountPct > 0 ? (
            <div className="hidden sm:block absolute top-5 right-[-22px] w-28 rotate-45 bg-gradient-to-r from-rose-500 to-orange-500 text-white text-[8px] font-bold text-center py-0.5 shadow-md pointer-events-none select-none z-10 overflow-hidden">
              Business offer
            </div>
          ) : (
            discountPct > 0 &&
            shownMrpDiscount <= 0 && (
              <div className="hidden sm:block absolute top-4 right-[-16px] w-20 rotate-45 bg-gradient-to-r from-rose-500 to-orange-500 text-white text-[8px] font-bold text-center py-0.5 shadow-md pointer-events-none select-none z-10 overflow-hidden">
                SALE
              </div>
            )
          )}

          {(shownMrpDiscount > 0 || badge || digital || discountPct > 0) && (
            <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
              {shownMrpDiscount > 0 ? (
                <div className="bg-accent-500 dark:bg-accent-600 text-white px-2 py-0.5 rounded-full text-xs font-semibold">
                  {shownMrpDiscount}% off
                </div>
              ) : (
                discountPct > 0 &&
                bizDiscountPct <= 0 && (
                  <div className="sm:hidden bg-gradient-to-r from-rose-500 to-orange-500 text-white px-2 py-0.5 rounded-full text-xs font-semibold">
                    Sale
                  </div>
                )
              )}
              {digital && (
                <div className="bg-violet-600 text-white px-2 py-0.5 rounded-full text-xs font-semibold">Digital</div>
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
              {/* Stretched link: the whole card opens the product; the buttons sit above it. */}
              <Link
                href={productHref}
                className="after:absolute after:inset-0 after:rounded-[20px] sm:after:rounded-lg after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent-500"
              >
                {name}
              </Link>
            </h3>
            <div className="relative z-10 flex-shrink-0 flex items-center gap-1.5 mt-0.5">
              <QuickAddButton
                productId={id}
                productName={name}
                slug={slug}
                hasVariants={hasVariants}
                inStock={inStock}
                imageUrl={primaryImage?.thumbnail_url || primaryImage?.image_url || null}
                brandName={brandName}
                categoryName={categoryName}
                displayPrice={shownPrice}
                mrp={mrp}
                discountPct={bizDiscountPct > 0 ? shownMrpDiscount : (discountPct ?? mrpDiscount)}
                openSignal={quickAddSignal}
                isDigital={digital}
                portal={portal}
              />
              <div className="flex items-center gap-1.5">
                {!isBusiness && (
                  <button
                    onClick={handleWishlist}
                    disabled={wishlistLoading}
                    aria-label={isInWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
                    className="w-7 h-7 rounded-full bg-surface-secondary border border-border-default flex items-center justify-center text-foreground-muted hover:text-red-500 hover:border-red-300 transition-all hover:scale-110 active:scale-95 disabled:opacity-60"
                  >
                    {wishlistIcon}
                  </button>
                )}
                <button
                  onClick={handleShare}
                  aria-label="Share product"
                  className="hidden sm:flex w-7 h-7 rounded-full bg-surface-secondary border border-border-default items-center justify-center text-foreground-muted hover:text-accent-500 hover:border-accent-400 transition-all hover:scale-110 active:scale-95"
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
            {brandName && (
              <div className="truncate">Brand: {brandName}</div>
            )}
            {categoryName && <div className="truncate">Category: {categoryName}</div>}
          </div>
          <div className="mt-auto">
            <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2 mb-0.5 sm:mb-1">
              <span className="text-base sm:text-xl font-bold text-primary-600 dark:text-primary-400 leading-tight">
                {hasVariants ? 'From ' : ''}&#x20B9;
                {Number(shownPrice).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              {businessPrice ? (
                <span className="text-xs sm:text-sm text-foreground-muted line-through leading-tight">
                  &#x20B9;
                  {Number(displayPrice).toLocaleString('en-IN', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
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
            {gstEnabled && (
              <p className="text-[11px] sm:text-[10px] text-foreground-muted mb-2 sm:mb-3">Inclusive of all taxes</p>
            )}
            <div className="flex items-center justify-between gap-1 mt-1 sm:mt-0">
              <span className={`text-xs font-medium truncate ${inStock ? 'text-green-600' : 'text-red-600'}`}>
                {digital ? 'Instant access' : inStock ? 'In Stock' : 'Out of Stock'}
              </span>
              <span className="text-accent-500 group-hover:text-accent-600 font-semibold text-xs sm:text-sm whitespace-nowrap transition-all group-hover:translate-x-1">
                View Details &#x2192;
              </span>
            </div>
            {eddLabel && (
              <p className="text-[11px] sm:text-[10px] text-foreground-muted mt-0.5">
                Deliver by <span className="font-medium text-foreground">{eddLabel}</span>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
