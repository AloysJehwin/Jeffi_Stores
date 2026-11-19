'use client'

import { Heart } from 'lucide-react'
import QuickAddButton from '@/components/visitor/QuickAddButton'
import { useProductLikeShare } from '@/components/visitor/useProductLikeShare'
import { CardIcon, QUICK_ADD_CLASS, WISHLIST_CLASS, aboveLink, quickAddText, type CardIconName, type CardProduct } from './shared'

// The card's working buttons (QuickAdd, WishlistToggle), on the live store. They sit above the card's stretched link
// (relative z-10); the AI's className styles them. The studio preview draws the inert look-alikes in marks.tsx instead.

export function QuickAddPart({
  product: p,
  text,
  icon,
  className,
  portal,
}: {
  product: CardProduct
  text: string
  icon: CardIconName
  className?: string
  portal: 'storefront' | 'business'
}) {
  return (
    <QuickAddButton
      productId={p.id}
      productName={p.name}
      slug={p.slug}
      hasVariants={p.hasVariants}
      inStock={p.inStock}
      imageUrl={p.image}
      brandName={p.brand}
      categoryName={p.category}
      displayPrice={p.price}
      mrp={p.mrp}
      discountPct={p.discountPct}
      isDigital={p.isDigital}
      portal={portal}
      quick
      triggerClassName="contents"
      buttonClassName={aboveLink(className || QUICK_ADD_CLASS)}
      ariaLabel={`${text || quickAddText(p)}: ${p.name}`}
      buttonContent={
        <>
          <CardIcon name={icon} />
          {text && <span>{text}</span>}
        </>
      }
    />
  )
}

export function WishlistTogglePart({ product: p, label, className }: { product: CardProduct; label?: string; className?: string }) {
  const { isInWishlist, wishlistLoading, handleWishlist } = useProductLikeShare({ id: p.id, slug: p.slug, name: p.name, href: `/products/${p.slug}` })
  return (
    <button
      type="button"
      onClick={handleWishlist}
      disabled={wishlistLoading}
      aria-pressed={isInWishlist}
      aria-label={label ? undefined : isInWishlist ? `Remove ${p.name} from your wishlist` : `Save ${p.name} to your wishlist`}
      className={aboveLink(className || WISHLIST_CLASS)}
    >
      <Heart aria-hidden className={`h-[1.1em] w-[1.1em] shrink-0 transition-transform ${isInWishlist ? 'scale-110' : ''}`} fill={isInWishlist ? 'currentColor' : 'none'} strokeWidth={2} />
      {label && <span>{label}</span>}
    </button>
  )
}
