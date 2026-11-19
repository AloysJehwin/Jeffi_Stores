import { Heart, Star } from 'lucide-react'
import { CardIcon, QUICK_ADD_CLASS, WISHLIST_CLASS, aboveLink, type CardIconName } from './shared'

// The card parts drawn on the server: the price, discount, stock and rating marks (plain text the AI styles with
// className, safe inside a link), and the inert look-alikes of the card's buttons for the studio preview.

/** The fields the marks read; anything else in the value is ignored. */
export interface MarkProduct {
  price?: { formatted?: unknown } | null
  mrp?: { formatted?: unknown } | null
  discountPct?: unknown
  inStock?: unknown
  rating?: unknown
  reviewCount?: unknown
  hasVariants?: unknown
}

const text = (v: unknown) => (typeof v === 'string' ? v : '')

export function PriceTagMark({ product: p, mrp = true, discount = false, from = true, className }: { product: MarkProduct; mrp?: boolean; discount?: boolean; from?: boolean; className?: string }) {
  const price = text(p.price?.formatted)
  if (!price) return null
  const was = mrp ? text(p.mrp?.formatted) : ''
  const pct = Number(p.discountPct) || 0
  return (
    <span className={className || 'inline-flex flex-wrap items-baseline gap-x-2 font-semibold text-foreground'}>
      <span>{from && p.hasVariants ? `From ${price}` : price}</span>
      {was && (
        <>
          {' '}
          <s className="text-[0.85em] font-normal opacity-60">
            <span className="sr-only">MRP </span>
            {was}
          </s>
        </>
      )}
      {discount && pct > 0 && (
        <>
          {' '}
          <span className="text-[0.85em]">{pct}% off</span>
        </>
      )}
    </span>
  )
}

export function DiscountBadgeMark({ product: p, format = 'percent', className }: { product: MarkProduct; format?: 'percent' | 'minus' | 'sale'; className?: string }) {
  const pct = Number(p.discountPct) || 0
  if (pct <= 0) return null
  return (
    <span className={className || 'ui-badge inline-flex items-center rounded-full bg-accent-500 px-2 py-0.5 text-xs font-semibold text-white'}>
      {format === 'sale' ? 'Sale' : format === 'minus' ? `−${pct}%` : `${pct}% off`}
    </span>
  )
}

export function StockBadgeMark({
  product: p,
  always = false,
  soldOut = 'Sold out',
  inStockText = 'In stock',
  className,
}: {
  product: MarkProduct
  always?: boolean
  soldOut?: string
  inStockText?: string
  className?: string
}) {
  const inStock = p.inStock !== false
  if (inStock && !always) return null
  return <span className={className || (inStock ? 'text-xs font-medium text-green-600' : 'text-xs font-medium text-red-600')}>{inStock ? inStockText : soldOut}</span>
}

export function RatingStarsMark({ product: p, count = true, className }: { product: MarkProduct; count?: boolean; className?: string }) {
  const rating = Number(p.rating)
  if (!(rating > 0)) return null
  const n = Math.max(0, Math.floor(Number(p.reviewCount) || 0))
  const full = Math.round(Math.min(5, rating))
  return (
    <span
      role="img"
      aria-label={`Rated ${rating.toFixed(1)} out of 5${n ? ` from ${n} review${n === 1 ? '' : 's'}` : ''}`}
      className={className || 'inline-flex items-center gap-1 text-sm text-accent-600'}
    >
      <span aria-hidden className="inline-flex">
        {Array.from({ length: 5 }, (_, i) => (
          <Star key={i} className={`h-[1em] w-[1em] ${i < full ? 'fill-current' : 'opacity-30'}`} />
        ))}
      </span>
      {count && n > 0 && <span aria-hidden className="opacity-70">({n})</span>}
    </span>
  )
}

/** QuickAdd in the studio preview: how it looks, without a cart behind it. */
export function QuickAddMark({ text: label, icon, className }: { text: string; icon: CardIconName; className?: string }) {
  return (
    <span role="presentation" className={aboveLink(className || QUICK_ADD_CLASS)}>
      <CardIcon name={icon} />
      {label && <span>{label}</span>}
    </span>
  )
}

/** WishlistToggle in the studio preview. */
export function WishlistMark({ label, className }: { label?: string; className?: string }) {
  return (
    <span role="presentation" className={aboveLink(className || WISHLIST_CLASS)}>
      <Heart aria-hidden className="h-[1.1em] w-[1.1em] shrink-0" strokeWidth={2} />
      {label && <span>{label}</span>}
    </span>
  )
}
