'use client'

import { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { motion, useReducedMotion } from 'motion/react'
import { useCart } from '@/contexts/CartContext'
import { useToast } from '@/contexts/ToastContext'
import QuickAddPicker, { QuickAddHeaderActions } from '@/components/visitor/QuickAddPicker'
import { startBuyNow } from '@/lib/client/buy-now'
import { bp } from '@/lib/shared/business-path'

interface QuickAddButtonProps {
  productId: string
  productName: string
  slug: string
  hasVariants: boolean
  inStock: boolean
  imageUrl?: string | null
  brandName?: string | null
  categoryName?: string | null
  displayPrice?: number
  mrp?: number | null
  discountPct?: number
  // Increment to open the picker from outside (e.g. a card long-press). 0 = no external open.
  openSignal?: number
  // Digital products are Buy Now only — the popup never adds them to the cart.
  isDigital?: boolean
  portal?: 'storefront' | 'business'
}

const MAX_QTY = 10

export default function QuickAddButton({
  productId,
  productName,
  slug,
  hasVariants,
  inStock,
  imageUrl,
  brandName,
  categoryName,
  displayPrice,
  mrp,
  discountPct,
  openSignal = 0,
  isDigital = false,
  portal = 'storefront',
}: QuickAddButtonProps) {
  const { addToCart } = useCart()
  const router = useRouter()
  const productHref = portal === 'business' ? bp(`/business/products/${slug}`) : `/products/${slug}`
  const { showToast } = useToast()
  const prefersReduced = useReducedMotion()

  const [open, setOpen] = useState(false)
  const [qty, setQty] = useState(1)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (openSignal > 0 && inStock) setOpen(true)
  }, [openSignal, inStock])

  const stop = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const addSimple = useCallback(
    async (quantity: number) => {
      if (adding) return
      setAdding(true)
      try {
        await addToCart(productId, quantity)
        showToast(quantity === 1 ? 'Added to cart!' : `${quantity} added to cart!`, 'success')
        setOpen(false)
        setQty(1)
      } catch (err) {
        showToast(err instanceof Error && err.message ? err.message : 'Could not add to cart', 'error')
      } finally {
        setAdding(false)
      }
    },
    [adding, addToCart, productId, showToast]
  )

  const buySimple = useCallback(async () => {
    if (adding) return
    setAdding(true)
    const r = await startBuyNow({ productId, qty: 1 }, portal)
    if (r.ok) {
      setOpen(false)
      router.push(r.href)
    } else {
      showToast(r.error, 'error')
      setAdding(false)
    }
  }, [adding, portal, productId, router, showToast])

  const onButtonClick = useCallback((e: React.MouseEvent) => {
    stop(e)
    setOpen(v => !v)
  }, [])

  useEffect(() => {
    if (!open) return
    // The picker renders in a portal with its own backdrop that closes on click.
    // An outside-click check would misfire for clicks inside that portal, so only Escape closes here.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    if (typeof window !== 'undefined' && window.innerWidth < 640) document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!inStock) {
    return (
      <button
        type="button"
        disabled
        aria-label="Out of stock"
        onClick={stop}
        className="w-7 h-7 rounded-full bg-surface-secondary border border-border-default flex items-center justify-center text-foreground-muted opacity-60 cursor-not-allowed"
      >
        <PlusIcon />
      </button>
    )
  }

  const label = hasVariants
    ? `Choose options for ${productName}`
    : isDigital
      ? `Buy ${productName}`
      : `Quick add ${productName} to cart`

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onButtonClick}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="w-7 h-7 rounded-full bg-accent-500 hover:bg-accent-600 text-white flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-sm"
      >
        <PlusIcon />
      </button>

      {open && hasVariants && (
        <QuickAddPicker
          productId={productId}
          productName={productName}
          slug={slug}
          onClose={() => setOpen(false)}
          onStop={stop}
          imageUrl={imageUrl}
          brandName={brandName}
          categoryName={categoryName}
          displayPrice={displayPrice}
          mrp={mrp}
          discountPct={discountPct}
          inStock={inStock}
          isDigital={isDigital}
          portal={portal}
          productHref={productHref}
        />
      )}

      {open && !hasVariants && (
        <SimpleQtyPicker
          qty={qty}
          adding={adding}
          prefersReduced={!!prefersReduced}
          productName={productName}
          imageUrl={imageUrl}
          brandName={brandName}
          categoryName={categoryName}
          displayPrice={displayPrice}
          mrp={mrp}
          discountPct={discountPct}
          inStock={inStock}
          isDigital={isDigital}
          productId={productId}
          slug={slug}
          productHref={productHref}
          showWishlist={portal !== 'business'}
          onQty={setQty}
          onAdd={() => (isDigital ? buySimple() : addSimple(qty))}
          onClose={() => setOpen(false)}
          onStop={stop}
        />
      )}
    </div>
  )
}

interface SimplePickerProps {
  qty: number
  adding: boolean
  prefersReduced: boolean
  productName: string
  imageUrl?: string | null
  brandName?: string | null
  categoryName?: string | null
  displayPrice?: number
  mrp?: number | null
  discountPct?: number
  inStock?: boolean
  isDigital: boolean
  productId: string
  slug: string
  productHref: string
  showWishlist: boolean
  onQty: (n: number) => void
  onAdd: () => void
  onClose: () => void
  onStop: (e: React.MouseEvent) => void
}

function SimpleQtyPicker({
  qty,
  adding,
  prefersReduced,
  productName,
  imageUrl,
  brandName,
  categoryName,
  displayPrice,
  mrp,
  discountPct,
  inStock,
  isDigital,
  productId,
  slug,
  productHref,
  showWishlist,
  onQty,
  onAdd,
  onClose,
  onStop,
}: SimplePickerProps) {
  const dec = (e: React.MouseEvent) => {
    onStop(e)
    onQty(Math.max(1, qty - 1))
  }
  const inc = (e: React.MouseEvent) => {
    onStop(e)
    onQty(Math.min(MAX_QTY, qty + 1))
  }

  const body = (
    <div className="flex flex-col gap-4" onClick={onStop}>
      <div className="flex items-start gap-3">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={productName}
            className="flex-shrink-0 w-16 h-16 rounded-xl border border-border-default object-contain bg-surface-secondary"
          />
        ) : (
          <div className="flex-shrink-0 w-16 h-16 rounded-xl border border-border-default bg-surface-secondary" />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold text-foreground leading-snug line-clamp-2">{productName}</h3>
          {brandName && <p className="text-sm text-foreground-secondary truncate">{brandName}</p>}
          {categoryName && <p className="text-sm text-foreground-secondary truncate">{categoryName}</p>}
        </div>
        <QuickAddHeaderActions
          productId={productId}
          productName={productName}
          slug={slug}
          href={productHref}
          showWishlist={showWishlist}
          onClose={onClose}
          onStop={onStop}
        />
      </div>

      {displayPrice != null && (
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-2xl font-bold text-primary-600 dark:text-primary-400">
            Rs. {displayPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          {mrp != null && mrp > displayPrice && (
            <span className="text-sm text-foreground-muted line-through">
              Rs. {mrp.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          )}
          {discountPct != null && discountPct > 0 && (
            <span className="rounded-full bg-accent-500 px-2 py-0.5 text-xs font-semibold text-white">
              {discountPct}% off
            </span>
          )}
        </div>
      )}

      {!isDigital && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">Quantity</span>
          <div className="flex items-center gap-1">
            <StepButton onClick={dec} disabled={qty <= 1} label="Decrease quantity">
              &#8722;
            </StepButton>
            <span className="w-8 text-center text-sm font-semibold text-foreground tabular-nums">{qty}</span>
            <StepButton onClick={inc} disabled={qty >= MAX_QTY} label="Increase quantity">
              &#43;
            </StepButton>
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={e => {
          onStop(e)
          onAdd()
        }}
        disabled={adding || inStock === false}
        className="w-full bg-accent-500 hover:bg-accent-600 disabled:opacity-60 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors"
      >
        {isDigital ? (adding ? 'Processing...' : 'Buy Now') : adding ? 'Adding...' : 'Add to cart'}
      </button>
    </div>
  )

  if (typeof document === 'undefined') return null

  const overlay = (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center"
      onClick={onStop}
      role="dialog"
      aria-modal="true"
      aria-label={isDigital ? 'Quick buy' : 'Quick add to cart'}
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <motion.div
        initial={prefersReduced ? false : { y: '100%', opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
        onClick={onStop}
        className="relative w-full sm:w-[26rem] sm:max-w-[calc(100vw-2rem)] bg-surface-elevated rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 pb-8 sm:pb-5"
      >
        <div className="w-10 h-1 bg-border-default rounded-full mx-auto mb-4 sm:hidden" />
        {body}
      </motion.div>
    </div>
  )

  return createPortal(overlay, document.body)
}

function StepButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: (e: React.MouseEvent) => void
  disabled: boolean
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="w-7 h-7 rounded-full border border-border-default bg-surface-secondary text-foreground flex items-center justify-center text-base leading-none disabled:opacity-40 hover:border-accent-400 transition-colors"
    >
      {children}
    </button>
  )
}

function PlusIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  )
}
