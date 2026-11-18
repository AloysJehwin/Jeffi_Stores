'use client'

import { updateChannelsLabel, useMessagingChannels } from '@/hooks/useStoreFlags'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import ProductImageGallery from './ProductImageGallery'
import dynamic from 'next/dynamic'
import { DocumentList } from '@/components/media/MediaItemView'

import ProductActions from './ProductActions'
import BusinessPriceBadge from './BusinessPriceBadge'
import RazorpayOffers from './RazorpayOffers'
import ProductWarningBadges from '@/components/shared/ProductWarningBadges'
import ReviewSummaryLink from './pdp/ReviewSummaryLink'
import {
  ProductPageProvider,
  useProductPage,
  type PolicyProps,
  type ProductPageInput,
  type ProductPageState,
} from './pdp/ProductPageProvider'

// Players and 3D load only when a product has such media.
const ProductMediaGallery = dynamic(() => import('@/components/media/ProductMediaGallery'), { ssr: false })

export const DeliveryInfo = ({
  returnAllowed,
  returnDays,
  replacementAllowed,
  replacementDays,
  isCodAllowed,
  freeShippingThreshold = 500,
}: PolicyProps) => {
  const updatesVia = updateChannelsLabel(useMessagingChannels())
  const [activePolicy, setActivePolicy] = useState<null | {
    label: string
    sub: string
    detail: string
    bullets: string[]
    color: string
    href: string
    hrefLabel: string
    icon: React.ReactNode
  }>(null)

  const items = [
    {
      icon: (
        <svg
          className="w-7 h-7"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
          <path d="M13 16V5a1 1 0 00-1-1H4a1 1 0 00-1 1v11m10 0h-3M6 16H3m4-7h6l3 5" />
        </svg>
      ),
      label: 'Free Delivery',
      sub: `On orders above ₹${freeShippingThreshold.toLocaleString('en-IN')}`,
      detail: `Free delivery on all orders above ₹${freeShippingThreshold.toLocaleString('en-IN')}. Standard shipping charges apply below this threshold.`,
      bullets: [
        'Delivered within 3–7 business days',
        'Same-day dispatch on orders placed before 2 PM',
        `Tracking link sent via ${updatesVia} after dispatch`,
        'Delivery available across India including remote areas',
      ],
      color: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
      href: '/legal/shipping-policy',
      hrefLabel: 'Read Shipping Policy',
    },
    {
      icon: (
        <svg
          className="w-7 h-7"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      ),
      label: returnAllowed ? 'Easy Returns' : 'Non-Returnable',
      sub: returnAllowed ? `${returnDays}-day return policy` : 'This product cannot be returned',
      detail: returnAllowed
        ? `Hassle-free returns within ${returnDays} days of delivery.`
        : 'This product is non-returnable due to its nature.',
      bullets: returnAllowed
        ? [
            `Raise a return request within ${returnDays} days of delivery`,
            'Item must be unused and in original packaging',
            'Refund processed within 5–7 business days after pickup',
            'Free pickup arranged from your doorstep',
          ]
        : [
            'Please review the product details carefully before ordering',
            'Damaged or defective items — contact support within 48 hours',
            'Wrong item received? We will arrange a replacement',
            'Our team is available 9 AM – 6 PM Mon–Sat',
          ],
      color: returnAllowed
        ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
        : 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400',
      href: '/legal/return-refund-policy',
      hrefLabel: 'Read Return & Refund Policy',
    },
    {
      icon: (
        <svg
          className="w-7 h-7"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
      ),
      label: replacementAllowed ? 'Free Replacement' : 'Non-Replaceable',
      sub: replacementAllowed ? `${replacementDays}-day guarantee` : 'This product cannot be replaced',
      detail: replacementAllowed
        ? `Free replacement within ${replacementDays} days for defective or damaged products.`
        : 'This product is not eligible for replacement under our standard policy.',
      bullets: replacementAllowed
        ? [
            `Request replacement within ${replacementDays} days of delivery`,
            'Applicable for manufacturing defects & damage on delivery',
            'Upload photos of the defect when raising the request',
            'Replacement dispatched within 2–3 business days of approval',
          ]
        : [
            'Damaged on delivery? Contact support within 48 hours with photos',
            'Incorrect item received will be replaced at no cost',
            'Manufacturing defects covered under brand warranty',
            'Contact us at support@jeffistores.in for assistance',
          ],
      color: replacementAllowed
        ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400'
        : 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400',
      href: '/legal/return-refund-policy',
      hrefLabel: 'Read Return & Refund Policy',
    },
    {
      icon: (
        <svg
          className="w-7 h-7"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
      label: '100% Genuine',
      sub: 'Verified authentic products',
      detail: 'Every product is sourced directly from authorised distributors or manufacturers.',
      bullets: [
        'Sourced directly from authorised distributors',
        'Zero tolerance for counterfeit or grey-market goods',
        'Quality inspection before every dispatch',
        'Brand warranty honoured on all genuine products',
      ],
      color: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
      href: '/legal/warranty-policy',
      hrefLabel: 'Read Warranty Policy',
    },
    {
      icon: (
        <svg
          className="w-7 h-7"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      ),
      label: 'Secure Payment',
      sub: 'Encrypted & protected checkout',
      detail:
        'All payments are processed over an encrypted, PCI-DSS compliant gateway. Your card and bank details are never stored on our servers.',
      bullets: [
        '256-bit SSL encrypted checkout',
        'UPI, Cards, Net Banking & Wallets accepted',
        isCodAllowed ? 'Cash on Delivery available for eligible orders' : 'Prepaid orders only for this product',
        'Instant payment confirmation & receipt',
      ],
      color: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
      href: '/legal/terms',
      hrefLabel: 'Read Payment Terms',
    },
  ]

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 items-stretch">
        {items.slice(0, 4).map((item, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setActivePolicy(item)}
            className="flex flex-col sm:flex-row items-start gap-2.5 p-3 rounded-xl border border-border-default bg-surface hover:bg-surface-secondary hover:border-accent-300 transition-colors group h-full overflow-hidden text-left w-full"
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${item.color}`}>
              {item.icon}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground leading-tight group-hover:text-accent-600 transition-colors">
                {item.label}
              </p>
              <p className="text-[11px] text-foreground-muted leading-snug mt-0.5">{item.sub}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Policy popup modal — rendered via portal to avoid z-index/overflow clipping */}
      {activePolicy &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
            onClick={() => setActivePolicy(null)}
          >
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div
              className="relative bg-surface rounded-2xl border border-border-default shadow-2xl w-full max-w-sm p-5 space-y-4"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${activePolicy.color}`}>
                  {activePolicy.icon}
                </div>
                <div>
                  <p className="text-base font-semibold text-foreground">{activePolicy.label}</p>
                  <p className="text-xs text-foreground-muted">{activePolicy.sub}</p>
                </div>
              </div>
              <p className="text-sm text-foreground-secondary leading-relaxed">{activePolicy.detail}</p>
              <ul className="space-y-2">
                {activePolicy.bullets.map((b: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground-secondary">
                    <svg
                      className="w-4 h-4 mt-0.5 shrink-0 text-accent-500"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {b}
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between pt-1">
                <Link
                  href={activePolicy.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-accent-600 hover:underline flex items-center gap-1"
                >
                  {activePolicy.hrefLabel}
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </Link>
                <button
                  type="button"
                  onClick={() => setActivePolicy(null)}
                  className="text-xs text-foreground-muted hover:text-foreground transition-colors px-3 py-1.5 rounded-lg hover:bg-surface-secondary"
                >
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      <button
        type="button"
        onClick={() => setActivePolicy(items[4])}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-border-default bg-surface hover:bg-surface-secondary hover:border-accent-300 transition-colors group text-left"
      >
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${items[4].color}`}>
          {items[4].icon}
        </div>
        <span className="text-[11px] font-medium text-foreground-muted group-hover:text-accent-600 transition-colors w-10 leading-tight shrink-0">
          Secure Payment
        </span>
        <div className="flex items-center gap-1 flex-wrap ml-2">
          {['UPI', 'Cards', 'Net Banking', 'Wallets'].map(m => (
            <span
              key={m}
              className="text-[9px] font-semibold text-foreground-secondary bg-surface-secondary border border-border-default px-1 py-0.5 rounded whitespace-nowrap"
            >
              {m}
            </span>
          ))}
          {isCodAllowed && (
            <span className="text-[9px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 px-1 py-0.5 rounded whitespace-nowrap">
              Cash on Delivery
            </span>
          )}
        </div>
      </button>
    </div>
  )
}

interface PincodeCheckerProps {
  pincode: string
  setPincode: (v: string) => void
  pincodeResult: { ok: boolean; message: string } | null
  setPincodeResult: (v: { ok: boolean; message: string } | null) => void
  pincodeChecking: boolean
  checkPincode: () => void
  pincodeRef: React.RefObject<HTMLInputElement>
}

export const PincodeChecker = ({
  pincode,
  setPincode,
  pincodeResult,
  setPincodeResult,
  pincodeChecking,
  checkPincode,
  pincodeRef,
}: PincodeCheckerProps) => (
  <div className="mt-3 p-3 rounded-xl border border-border-default bg-surface-elevated">
    <p className="text-xs font-semibold text-foreground-secondary mb-2 uppercase tracking-wide">Check Delivery</p>
    <div className="flex gap-2">
      <input
        ref={pincodeRef}
        type="text"
        inputMode="numeric"
        maxLength={6}
        value={pincode}
        onChange={e => {
          setPincode(e.target.value.replace(/\D/g, ''))
          setPincodeResult(null)
        }}
        onKeyDown={e => e.key === 'Enter' && checkPincode()}
        placeholder="Enter pincode"
        autoComplete="postal-code"
        enterKeyHint="go"
        className="flex-1 min-w-0 text-base sm:text-sm px-3 py-2.5 sm:py-2 rounded-lg border border-border-default bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
      />
      <button
        onClick={checkPincode}
        disabled={pincodeChecking}
        className="shrink-0 min-h-[44px] xl:min-h-0 text-sm font-semibold px-4 py-2 rounded-lg border border-border-default bg-surface hover:bg-surface-secondary text-foreground transition-colors disabled:opacity-60"
      >
        {pincodeChecking ? 'Checking…' : 'Check'}
      </button>
    </div>
    {pincodeResult && (
      <p
        className={`text-xs mt-2 font-medium ${pincodeResult.ok ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
      >
        {pincodeResult.ok ? '✓ ' : '✗ '}
        {pincodeResult.message}
      </p>
    )}
  </div>
)

/** The picture gallery, then the product's videos/3D and documents. */
export function PdpGallery({ page }: { page: ProductPageState }) {
  const { product } = page
  return (
    <>
      <ProductImageGallery
        images={page.images}
        productName={product.name}
        variantImages={page.variantImages}
        discountPct={product.discount_pct != null ? Number(product.discount_pct) : null}
      />

      <PdpMediaExtras page={page} />
    </>
  )
}

/** The selection's videos, 3D models and documents. */
export function PdpMediaExtras({ page }: { page: ProductPageState }) {
  const { extras, docs } = page
  return (
    <>
      {extras.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Videos, 3D &amp; more</p>
          <ProductMediaGallery items={extras} ar aspect="aspect-video" />
        </div>
      )}
      {docs.length > 0 && (
        <div className="mt-4">
          <DocumentList items={docs} title="Documents & downloads" />
        </div>
      )}
    </>
  )
}

/** The pincode check, wired to the page's state. */
export function PdpPincodeChecker({ page }: { page: ProductPageState }) {
  return (
    <PincodeChecker
      pincode={page.pincode}
      setPincode={page.setPincode}
      pincodeResult={page.pincodeResult}
      setPincodeResult={page.setPincodeResult}
      pincodeChecking={page.pincodeChecking}
      checkPincode={page.checkPincode}
      pincodeRef={page.pincodeRef}
    />
  )
}

export function PdpWishlistButton({ page }: { page: ProductPageState }) {
  const { isInWishlist } = page
  return (
    <button
      onClick={page.handleWishlist}
      disabled={page.wishlistLoading}
      aria-label={isInWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
      className="w-11 h-11 rounded-full border border-border-secondary bg-surface-elevated hover:bg-surface-secondary flex items-center justify-center transition-all hover:scale-110 active:scale-95 disabled:opacity-60"
    >
      <svg
        className={`w-5 h-5 transition-transform duration-300 ${isInWishlist ? 'animate-heart-pulse' : ''}`}
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
  )
}

export function PdpShareButton({ page }: { page: ProductPageState }) {
  return (
    <button
      onClick={page.handleShare}
      aria-label="Share product"
      className="w-11 h-11 rounded-full border border-border-secondary bg-surface-elevated hover:bg-surface-secondary flex items-center justify-center text-foreground-secondary hover:text-accent-500 transition-colors"
    >
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
        />
      </svg>
    </button>
  )
}

/** Low-stock urgency, and the back-in-stock form for an out-of-stock product. */
export function PdpStockNotice({ page }: { page: ProductPageState }) {
  const { product } = page
  return (
    <div className="mb-4">
      {product.stock_status === 'Low Stock' && (
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 px-2 py-0.5 rounded-full">
          Only a few left — order soon
        </span>
      )}
      {product.stock_status === 'Out of Stock' && (
        <div className="space-y-3">
          {page.notifySubmitted ? (
            <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 px-3 py-2 rounded-lg">
              <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              We&apos;ll email you when this is back in stock.
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="email"
                value={page.notifyEmail}
                onChange={e => page.setNotifyEmail(e.target.value)}
                placeholder="Enter your email"
                className="flex-1 min-w-0 text-sm px-3 py-2 rounded-lg border border-border-default bg-surface-elevated text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              <button
                onClick={page.handleNotifyMe}
                className="shrink-0 text-sm font-semibold px-4 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 text-white transition-colors"
              >
                Notify Me
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** The built-in product details: gallery and delivery on one side, title, price and the buy buttons on the other. */
function ProductDetailBody({ page }: { page: ProductPageState }) {
  const { product, reviewSummary, isDigital, policy } = page
  return (
    <>
      {/* Image column — order-1 on mobile, natural on desktop */}
      <div className="order-1 lg:order-none">
        <PdpGallery page={page} />

        <div className="hidden lg:block mt-4">
          {isDigital ? (
            <div className="rounded-lg border border-border-default bg-surface-secondary/40 p-4 text-sm text-foreground-secondary">
              Digital product — delivered instantly to your vault. No shipping.
            </div>
          ) : (
            <>
              <DeliveryInfo {...policy} />
              <PdpPincodeChecker page={page} />
            </>
          )}
        </div>
      </div>

      {/* Product info column — order-2 on mobile, natural on desktop */}
      <div className="order-2 lg:order-none">
        <div className="flex items-start justify-between gap-3 mb-4">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground flex-1">{product.name}</h1>
          <div className="flex items-center gap-2 shrink-0 mt-1">
            {' '}
            <PdpWishlistButton page={page} />
            <PdpShareButton page={page} />
          </div>
        </div>

        {reviewSummary && <ReviewSummaryLink summary={reviewSummary} className="-mt-2 mb-4" />}

        <ProductWarningBadges fragile={product.fragile} hazardous={product.hazardous} flammable={product.flammable} />

        {/* Low stock urgency + notify me for out-of-stock */}
        <PdpStockNotice page={page} />

        {!page.hasVariants && <BusinessPriceBadge price={page.displayPrice} categoryId={product.categories?.id} />}

        <ProductActions s={page.purchase} />

        <RazorpayOffers />

        {/* Product Specifications — rendered in page.tsx Specifications card */}
      </div>

      <div className="order-3 lg:hidden">
        <DeliveryInfo {...policy} />
        <PdpPincodeChecker page={page} />
      </div>
    </>
  )
}

function MountedProductDetail() {
  const page = useProductPage()
  return page ? <ProductDetailBody page={page} /> : null
}

/**
 * The product details. Inside a page's ProductPageProvider it reads that; on its own it mounts one from `product`.
 */
export default function ProductDetailClient(props: Partial<ProductPageInput>) {
  const mounted = useProductPage()
  if (mounted) return <ProductDetailBody page={mounted} />
  if (!props.product) return null
  return (
    <ProductPageProvider {...(props as ProductPageInput)}>
      <MountedProductDetail />
    </ProductPageProvider>
  )
}
