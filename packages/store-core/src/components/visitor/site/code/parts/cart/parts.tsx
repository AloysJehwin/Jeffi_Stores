'use client'

import type { ReactNode } from 'react'
import FreeShippingProgress from '@/components/visitor/cart/FreeShippingProgress'
import { useCheckoutParts } from '../checkout/context'
import { CheckoutCoupon } from '../checkout/parts'
import { useCartParts } from './context'
import { CartEmptyPage, CartLineCard, CartLineList, CartMobileBar, CheckoutCta, CouponInput, SavedForLater, SummaryTotals } from './pieces'
import type { DemoLine } from './demo'
import { DemoTotals, money } from './demo-ui'

// The cart parts an AI cart page places. Each reads the page's one cart state (CartPartsProvider); with none (the
// studio preview) it shows the sample lines it was given, inert.

const COLS = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' } as const
type Cols = keyof typeof COLS

function LinesSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      {[0, 1].map(i => (
        <div key={i} className="h-28 rounded-lg bg-surface-secondary animate-pulse" />
      ))}
    </div>
  )
}

function DemoImage({ line, className }: { line: DemoLine; className: string }) {
  return (
    <div className={`${className} bg-surface-secondary rounded-lg overflow-hidden border border-border-default`}>
      {line.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={line.image} alt={line.name} className="w-full h-full object-cover" />
      )}
    </div>
  )
}

function DemoQty({ qty }: { qty: number }) {
  return (
    <span className="inline-flex items-center border border-border-secondary rounded-lg text-sm" aria-hidden>
      <span className="px-3 py-1.5 text-foreground-muted">−</span>
      <span className="px-3 py-1.5 border-x border-border-secondary font-semibold text-foreground">{qty}</span>
      <span className="px-3 py-1.5 text-foreground-muted">+</span>
    </span>
  )
}

function DemoLines({ lines, variant, columns }: { lines: DemoLine[]; variant: 'list' | 'cards'; columns: Cols }) {
  if (variant === 'cards')
    return (
      <div className={`grid grid-cols-1 ${COLS[columns]} gap-4`}>
        {lines.map(l => (
          <div key={l.id} className="flex flex-col bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4">
            <DemoImage line={l} className="w-full aspect-square" />
            <p className="mt-3 font-semibold text-foreground line-clamp-2">{l.name}</p>
            <p className="mt-1 text-lg font-bold text-primary-600 dark:text-primary-400">{money(l.price)}</p>
            <div className="mt-3 flex items-center justify-between">
              <DemoQty qty={l.qty} />
              <span className="font-bold text-foreground">{money(l.price * l.qty)}</span>
            </div>
          </div>
        ))}
      </div>
    )
  return (
    <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
      {lines.map(l => (
        <div key={l.id} className="p-4 sm:p-6 border-b border-border-default last:border-b-0 flex gap-4 sm:gap-6">
          <DemoImage line={l} className="w-24 h-24 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-base sm:text-lg font-semibold text-foreground">{l.name}</p>
            {l.brand && <p className="text-xs text-foreground-muted mt-0.5">{l.brand}</p>}
            <p className="mt-2 text-lg font-bold text-primary-600 dark:text-primary-400">
              {money(l.price)}
              {l.mrp && l.mrp > l.price && <span className="ml-2 text-sm font-normal text-foreground-muted line-through">{money(l.mrp)}</span>}
            </p>
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <DemoQty qty={l.qty} />
              <span className="text-sm text-foreground-secondary">Save for later</span>
              <span className="text-sm text-red-600">Remove</span>
            </div>
            <p className="mt-3 text-sm text-foreground-secondary">
              Subtotal: <span className="text-lg font-bold text-foreground">{money(l.price * l.qty)}</span>
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

/** The cart's lines (quantity, save for later, remove), then the saved-for-later list. */
export function CartLinesPart({
  variant = 'list',
  columns = 2,
  saved = true,
  className,
  demo = [],
}: {
  variant?: 'list' | 'cards'
  columns?: Cols
  saved?: boolean
  className?: string
  demo?: DemoLine[]
}) {
  const c = useCartParts()
  if (!c)
    return demo.length ? (
      <div className={className}>
        <DemoLines lines={demo} variant={variant} columns={columns} />
      </div>
    ) : null
  if (c.isLoading)
    return (
      <div className={className}>
        <LinesSkeleton />
      </div>
    )
  const hasLines = c.cartItems.length > 0
  if (!hasLines && (!saved || c.savedItems.length === 0)) return null
  return (
    <div className={className}>
      {hasLines &&
        (variant === 'cards' ? (
          <div className={`grid grid-cols-1 ${COLS[columns] ?? COLS[2]} gap-4`}>
            {c.cartItems.map(item => (
              <CartLineCard key={item.id} item={item} c={c} />
            ))}
          </div>
        ) : (
          <CartLineList c={c} />
        ))}
      {saved && <SavedForLater c={c} />}
    </div>
  )
}

/** Subtotal, GST, the applied coupon and the total; hidden while the cart is empty. */
export function CartSummaryPart({ className, demo = [] }: { className?: string; demo?: DemoLine[] }) {
  const c = useCartParts()
  if (!c)
    return demo.length ? (
      <div className={className}>
        <DemoTotals lines={demo} />
      </div>
    ) : null
  if (c.isLoading || c.cartItems.length === 0) return null
  return (
    <div className={className}>
      <SummaryTotals c={c} />
    </div>
  )
}

/** The coupon box: on the cart, enter or remove a coupon (with offers); at checkout, the coupon carried from the cart. */
export function CouponBoxPart({ className, demo = false }: { className?: string; demo?: boolean }) {
  const c = useCartParts()
  const co = useCheckoutParts()
  if (co) return <CheckoutCoupon c={co} className={className} />
  if (!c)
    return demo ? (
      <div className={className}>
        <div className="flex gap-2" aria-hidden>
          <span className="flex-1 px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground-muted">Coupon code</span>
          <span className="px-4 py-2 text-sm font-semibold bg-accent-500 text-white rounded-lg">Apply</span>
        </div>
      </div>
    ) : null
  if (c.isLoading || c.cartItems.length === 0) return null
  return (
    <div className={className}>
      {c.couponNotice}
      <CouponInput c={c} />
    </div>
  )
}

/** How far the cart is from free delivery (physical lines only); nothing when the store has no threshold. */
export function FreeShippingPart({ className, demo = [] }: { className?: string; demo?: DemoLine[] }) {
  const c = useCartParts()
  if (!c) {
    if (!demo.length) return null
    return (
      <div className={className}>
        <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4">
          <p className="text-sm text-foreground">
            Add <span className="font-semibold">₹250</span> more to get free delivery
          </p>
          <div className="mt-2 h-2 rounded-full bg-surface-secondary overflow-hidden">
            <div className="h-full w-3/4 rounded-full bg-accent-500" />
          </div>
        </div>
      </div>
    )
  }
  if (c.isLoading || c.cartItems.length === 0) return null
  return (
    <div className={className}>
      <FreeShippingProgress subtotal={c.physicalTotal} />
    </div>
  )
}

/** Proceed to checkout (or sign in first), plus the phone bottom bar with the total. Place it once. */
export function CheckoutButtonPart({ label, className, demo = false }: { label?: string; className?: string; demo?: boolean }) {
  const c = useCartParts()
  if (!c)
    return demo ? (
      <div className={className}>
        <span className="w-full bg-accent-500 text-white px-6 py-3 rounded-lg font-semibold flex items-center justify-center">{label || 'Proceed to Checkout'}</span>
      </div>
    ) : null
  if (c.isLoading || c.cartItems.length === 0) return null
  return (
    <div className={className}>
      <CheckoutCta c={c} label={label || undefined} />
      <CartMobileBar c={c} />
    </div>
  )
}

/** Shown only while the cart has no lines: its children, or the built-in empty cart. */
export function CartEmptyPart({ children, className }: { children?: ReactNode; className?: string }) {
  const c = useCartParts()
  if (!c || c.isLoading || c.cartItems.length > 0) return null
  const hasChildren = Array.isArray(children) ? children.length > 0 : children != null && children !== false
  return (
    <div className={className}>
      {hasChildren ? (
        <>
          {c.couponNotice}
          {children}
        </>
      ) : (
        <CartEmptyPage couponNotice={c.couponNotice} />
      )}
    </div>
  )
}

const DEFAULT_UPSELL_GRID = 'grid grid-cols-2 md:grid-cols-4 gap-4'

/** Products to add, rendered on the server per item; the ones already in the cart (or saved) drop out here. */
export function CartUpsellPart({
  items,
  limit = 4,
  className,
}: {
  items: { id: string; node: ReactNode }[]
  limit?: number
  className?: string
}) {
  const c = useCartParts()
  if (c && (c.isLoading || c.cartItems.length === 0)) return null
  const taken = new Set(c ? [...c.cartItems, ...c.savedItems].map(i => i.product_id) : [])
  const shown = items.filter(i => !taken.has(i.id)).slice(0, limit)
  if (!shown.length) return null
  return (
    <div className={className || DEFAULT_UPSELL_GRID}>
      {shown.map(i => (
        <div key={i.id} className="contents">
          {i.node}
        </div>
      ))}
    </div>
  )
}
