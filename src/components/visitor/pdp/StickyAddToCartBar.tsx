'use client'

import { useEffect, useState } from 'react'
import ImgWithSkeleton from '@/components/ui/ImgWithSkeleton'
import { useCompare } from '@/contexts/CompareContext'
import { PDP_BUY_BUTTONS_ID, PDP_OPTIONS_ID, formatRupees, scrollToId, type StickyBarAction } from './pdp'

// The fixed site header is h-16 / lg:h-20; buy buttons tucked under it count as scrolled away.
const HEADER_OFFSET_PX = 80
// CompareBar sits fixed at bottom-0 and is this tall whenever 2+ products are queued to compare.
const ABOVE_COMPARE_BAR = 'bottom-[73px]'

interface StickyAddToCartBarProps {
  action: StickyBarAction
  name: string
  image?: string | null
  price: number
  mrp?: number | null
  unitLabel?: string | null
  quantity: number
  adding: boolean
  onAdd: () => void
}

/** Slim bottom bar that appears once the main Buy Now / Add to Cart buttons have scrolled away. */
export default function StickyAddToCartBar({ action, name, image, price, mrp, unitLabel, quantity, adding, onAdd }: StickyAddToCartBarProps) {
  const [pastControls, setPastControls] = useState(false)
  const { compareList } = useCompare()

  useEffect(() => {
    const el = document.getElementById(PDP_BUY_BUTTONS_ID)
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      const visibleTop = entry.rootBounds?.top ?? HEADER_OFFSET_PX
      setPastControls(!entry.isIntersecting && entry.boundingClientRect.bottom <= visibleTop)
    }, { rootMargin: `-${HEADER_OFFSET_PX}px 0px 0px 0px` })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (!action || !pastControls) return null

  const unit = unitLabel ? unitLabel.replace(/^(.+?)2$/, '$1²') : null
  const showMrp = mrp != null && Number(mrp) > price
  const position = compareList.length >= 2 ? ABOVE_COMPARE_BAR : 'bottom-0 pb-[env(safe-area-inset-bottom)]'

  return (
    <div
      role="region"
      aria-label="Quick add to cart"
      className={`fixed inset-x-0 ${position} z-30 bg-surface-elevated border-t border-border-default shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.25)] animate-slide-up motion-reduce:animate-none`}
    >
      <div className="container mx-auto px-4 py-2 flex items-center gap-3">
        <div className="w-11 h-11 shrink-0 rounded-md border border-border-default bg-surface-secondary overflow-hidden">
          {image && <ImgWithSkeleton src={image} alt="" className="w-full h-full object-contain" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground truncate">{name}</p>
          <p className="flex items-baseline gap-x-2 text-sm whitespace-nowrap overflow-hidden">
            <span className="font-bold text-primary-600 dark:text-primary-400">Rs. {formatRupees(price)}</span>
            {unit && <span className="text-xs text-foreground-secondary">/ {unit}</span>}
            {showMrp && <span className="hidden sm:inline text-xs text-foreground-muted line-through">Rs. {formatRupees(Number(mrp))}</span>}
            {quantity !== 1 && <span className="text-xs text-foreground-muted">Qty {quantity}</span>}
          </p>
        </div>
        {action === 'add' ? (
          <button
            type="button"
            onClick={onAdd}
            disabled={adding}
            className="shrink-0 inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 sm:px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {adding && <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" aria-hidden="true" />}
            {adding ? 'Adding...' : 'Add to Cart'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => scrollToId(PDP_OPTIONS_ID, 'center')}
            className="shrink-0 bg-accent-500 hover:bg-accent-600 text-white px-4 sm:px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors"
          >
            Choose options
          </button>
        )}
      </div>
    </div>
  )
}
