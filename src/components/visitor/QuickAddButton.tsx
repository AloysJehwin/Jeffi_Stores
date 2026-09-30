'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion, useReducedMotion } from 'motion/react'
import { useCart } from '@/contexts/CartContext'
import { useToast } from '@/contexts/ToastContext'

interface QuickAddButtonProps {
  productId: string
  productName: string
  slug: string
  hasVariants: boolean
  inStock: boolean
}

const MAX_QTY = 10

export default function QuickAddButton({
  productId,
  productName,
  slug,
  hasVariants,
  inStock,
}: QuickAddButtonProps) {
  const router = useRouter()
  const { addToCart } = useCart()
  const { showToast } = useToast()
  const prefersReduced = useReducedMotion()

  const [open, setOpen] = useState(false)
  const [qty, setQty] = useState(1)
  const [adding, setAdding] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const stop = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const goToOptions = useCallback(
    (e: React.MouseEvent) => {
      stop(e)
      router.push(`/products/${slug}`)
    },
    [router, slug]
  )

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

  const onButtonClick = useCallback(
    (e: React.MouseEvent) => {
      stop(e)
      if (hasVariants) {
        router.push(`/products/${slug}`)
        return
      }
      setOpen(v => !v)
    },
    [hasVariants, router, slug]
  )

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
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
        className="w-8 h-8 rounded-full bg-surface-secondary border border-border-default flex items-center justify-center text-foreground-muted opacity-60 cursor-not-allowed"
      >
        <PlusIcon />
      </button>
    )
  }

  const label = hasVariants ? `Choose options for ${productName}` : `Quick add ${productName} to cart`

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={onButtonClick}
        aria-label={label}
        aria-haspopup={hasVariants ? undefined : 'dialog'}
        aria-expanded={hasVariants ? undefined : open}
        className="w-8 h-8 rounded-full bg-accent-500 hover:bg-accent-600 text-white flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-sm"
      >
        <PlusIcon />
      </button>

      {open && !hasVariants && (
        <QuickAddPicker
          qty={qty}
          adding={adding}
          prefersReduced={!!prefersReduced}
          onQty={setQty}
          onAdd={() => addSimple(qty)}
          onChooseOptions={goToOptions}
          onClose={() => setOpen(false)}
          onStop={stop}
        />
      )}
    </div>
  )
}

interface PickerProps {
  qty: number
  adding: boolean
  prefersReduced: boolean
  onQty: (n: number) => void
  onAdd: () => void
  onChooseOptions: (e: React.MouseEvent) => void
  onClose: () => void
  onStop: (e: React.MouseEvent) => void
}

function QuickAddPicker({ qty, adding, prefersReduced, onQty, onAdd, onClose, onStop }: PickerProps) {
  const dec = (e: React.MouseEvent) => {
    onStop(e)
    onQty(Math.max(1, qty - 1))
  }
  const inc = (e: React.MouseEvent) => {
    onStop(e)
    onQty(Math.min(MAX_QTY, qty + 1))
  }

  const body = (
    <div className="flex flex-col gap-3" onClick={onStop}>
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
      <button
        type="button"
        onClick={e => {
          onStop(e)
          onAdd()
        }}
        disabled={adding}
        className="w-full bg-accent-500 hover:bg-accent-600 disabled:opacity-60 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors"
      >
        {adding ? 'Adding...' : 'Add to cart'}
      </button>
    </div>
  )

  return (
    <>
      {/* Desktop popover, >=640px */}
      <motion.div
        role="dialog"
        aria-label="Quick add"
        initial={prefersReduced ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        onClick={onStop}
        className="hidden sm:block absolute right-0 top-full mt-2 z-30 w-52 rounded-xl border border-border-default bg-surface-elevated shadow-xl p-3"
      >
        {body}
      </motion.div>

      {/* Mobile bottom-sheet, <640px */}
      <div className="sm:hidden fixed inset-0 z-50 flex flex-col justify-end" onClick={onStop}>
        <div className="absolute inset-0 bg-black/50" onClick={onClose} />
        <motion.div
          role="dialog"
          aria-label="Quick add"
          initial={prefersReduced ? false : { y: '100%' }}
          animate={{ y: 0 }}
          transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
          onClick={onStop}
          className="relative bg-surface-elevated rounded-t-2xl shadow-2xl p-5 pb-8"
        >
          <div className="w-10 h-1 bg-border-default rounded-full mx-auto mb-4" />
          {body}
        </motion.div>
      </div>
    </>
  )
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
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  )
}
