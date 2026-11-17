'use client'

import { useState } from 'react'
import ImgWithSkeleton from '@/components/ui/ImgWithSkeleton'
import ProductImageGallery, { Lightbox } from '@/components/visitor/ProductImageGallery'
import { DeliveryInfo, PdpGallery, PdpMediaExtras, PdpPincodeChecker, PdpShareButton, PdpWishlistButton } from '@/components/visitor/ProductDetailClient'
import {
  BuyNowButton,
  PurchaseButtons,
  PurchaseNotices,
  PurchaseOptions,
  PurchasePrice,
  PurchaseQuantity,
  PurchaseStickyBar,
  PurchaseSubscribe,
  type VariantPickerStyle,
} from '@/components/visitor/ProductActions'
import ReviewSummaryLink from '@/components/visitor/pdp/ReviewSummaryLink'
import { useProductPage } from '@/components/visitor/pdp/ProductPageProvider'

// The product page's interactive parts for code sections. Each reads the page's ProductPageProvider, so they share
// the selection, quantity and wishlist in any order; outside a product page they render nothing.

type Cls = { className?: string }

export function ProductGalleryPart({ layout = 'carousel', media = true, className }: Cls & { layout?: 'carousel' | 'grid' | 'stacked'; media?: boolean }) {
  const page = useProductPage()
  const [open, setOpen] = useState<number | null>(null)
  if (!page) return null
  if (layout === 'carousel') {
    return (
      <div className={className}>
        {media ? (
          <PdpGallery page={page} />
        ) : (
          <ProductImageGallery
            images={page.images}
            productName={page.product.name}
            variantImages={page.variantImages}
            discountPct={page.product.discount_pct != null ? Number(page.product.discount_pct) : null}
          />
        )}
      </div>
    )
  }
  const images = page.variantImages?.length ? page.variantImages : page.images
  const name = page.product.name
  return (
    <div className={className}>
      <div className={layout === 'grid' ? 'grid grid-cols-2 gap-3' : 'flex flex-col gap-3'}>
        {images.map((image, i) => (
          <button
            key={image.id}
            type="button"
            aria-haspopup="dialog"
            onClick={() => setOpen(i)}
            className={`relative block w-full overflow-hidden rounded-xl border border-border-default bg-surface-elevated cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${layout === 'grid' ? 'aspect-square' : 'aspect-[4/3]'}`}
          >
            <ImgWithSkeleton
              src={image.image_url}
              alt={`${name} - Image ${i + 1}`}
              blurhash={image.blurhash}
              loading={i < 2 ? undefined : 'lazy'}
              sizes={layout === 'grid' ? '(min-width: 1024px) 30vw, 50vw' : '(min-width: 1024px) 60vw, 100vw'}
              className="w-full h-full object-contain"
            />
          </button>
        ))}
      </div>
      {open != null && images.length > 0 && (
        <Lightbox images={images} index={Math.min(open, images.length - 1)} productName={name} onIndex={setOpen} onClose={() => setOpen(null)} />
      )}
      {media && <PdpMediaExtras page={page} />}
    </div>
  )
}

export function ProductPricePart({ size = 'full', className }: Cls & { size?: 'full' | 'compact' }) {
  const page = useProductPage()
  if (!page) return null
  return (
    <div className={className}>
      <PurchasePrice s={page.purchase} compact={size === 'compact'} />
    </div>
  )
}

export function ProductRatingPart({ className }: Cls) {
  const page = useProductPage()
  if (!page?.reviewSummary) return null
  return <ReviewSummaryLink summary={page.reviewSummary} className={className} />
}

export function VariantPickerPart({ style = 'buttons', className }: Cls & { style?: VariantPickerStyle }) {
  const page = useProductPage()
  if (!page?.purchase.hasVariants) return null
  return (
    <div className={className}>
      <PurchaseOptions s={page.purchase} style={style} />
    </div>
  )
}

export function QuantityPickerPart({ stock = true, className }: Cls & { stock?: boolean }) {
  const page = useProductPage()
  if (!page) return null
  return (
    <div className={className}>
      <PurchaseQuantity s={page.purchase} stock={stock} />
    </div>
  )
}

/** Add to cart with what goes with it: launch notices, buy-once/subscribe, View cart and the sticky bar. */
export function AddToCartPart({ label, viewCart = true, sticky = true, className }: Cls & { label?: string; viewCart?: boolean; sticky?: boolean }) {
  const page = useProductPage()
  if (!page) return null
  const s = page.purchase
  return (
    <div className={`space-y-4${className ? ` ${className}` : ''}`}>
      <PurchaseNotices s={s} />
      <PurchaseSubscribe s={s} />
      <PurchaseButtons s={s} buyNow="digital" viewCart={viewCart} addLabel={label} />
      {sticky && <PurchaseStickyBar s={s} />}
    </div>
  )
}

/** Buy Now; for a digital product AddToCart already shows it, so this stays empty. */
export function BuyNowPart({ label, className }: Cls & { label?: string }) {
  const page = useProductPage()
  if (!page) return null
  const s = page.purchase
  if (s.digital || s.alreadyOwned || s.subscribing) return null
  return (
    <div className={className}>
      <BuyNowButton s={s} label={label} />
    </div>
  )
}

export function WishlistButtonPart({ share = false, className }: Cls & { share?: boolean }) {
  const page = useProductPage()
  if (!page) return null
  return (
    <div className={`flex items-center gap-2${className ? ` ${className}` : ''}`}>
      <PdpWishlistButton page={page} />
      {share && <PdpShareButton page={page} />}
    </div>
  )
}

export function DeliveryCheckPart({ policies = true, className }: Cls & { policies?: boolean }) {
  const page = useProductPage()
  if (!page) return null
  if (page.isDigital) {
    return (
      <div className={className}>
        <div className="rounded-lg border border-border-default bg-surface-secondary/40 p-4 text-sm text-foreground-secondary">
          Digital product — delivered instantly to your vault. No shipping.
        </div>
      </div>
    )
  }
  return (
    <div className={className}>
      {policies && <DeliveryInfo {...page.policy} />}
      <PdpPincodeChecker page={page} />
    </div>
  )
}
