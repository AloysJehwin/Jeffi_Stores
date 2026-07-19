'use client'

import { useEffect, useRef, useState } from 'react'
import { useCart } from '@/contexts/CartContext'
import { canRunOnDeviceSummary, generateRecap, disposeSummarizer } from '@/lib/on-device/runtime'
import { getViewedProducts, getSearches } from '@/lib/on-device/session-signals'
import type { SessionSignals, CartLine } from '@/lib/on-device/prompt'

/**
 * On-device cart recap on the checkout review page. Renders NOTHING unless the
 * device is capable (flag on + WebGPU + memory + GPU limits). The ~400MB model
 * downloads lazily in a Web Worker and the summary streams in — fully
 * non-blocking; checkout works identically whether or not this appears.
 */
export default function CheckoutRecapSummary() {
  const { cartItems, getCartTotal } = useCart()
  const [capable, setCapable] = useState<boolean | null>(null)
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const started = useRef(false)

  // Gate check (runs the capability probe once).
  useEffect(() => {
    let alive = true
    canRunOnDeviceSummary().then(ok => { if (alive) setCapable(ok) })
    return () => { alive = false; disposeSummarizer() }
  }, [])

  // Kick off generation once capable + cart is populated (only once).
  useEffect(() => {
    if (!capable || started.current) return
    if (!cartItems || cartItems.length === 0) return
    started.current = true

    const cart: CartLine[] = cartItems.map((it: any) => ({
      name: it.variant?.variant_name
        ? `${it.products?.name} ${it.variant.variant_name}`
        : (it.products?.name || 'Item'),
      category: it.products?.category_id ? null : null, // category name not on cart item; brand suffices
      brand: it.products?.brand_name ?? null,
      qty: it.quantity || 1,
    }))
    const itemCount = cart.reduce((s, c) => s + c.qty, 0)

    const signals: SessionSignals = {
      cart,
      total: Math.round((getCartTotal() || 0) * 100) / 100,
      itemCount,
      viewed: getViewedProducts(),
      searches: getSearches(),
    }

    setState('loading')
    generateRecap(signals, (partial) => setText(partial))
      .then(final => { setText(final); setState('done') })
      .catch(() => setState('error'))
  }, [capable, cartItems, getCartTotal])

  // Silent on incapable devices, errors, or empty output.
  if (capable !== true) return null
  if (state === 'error') return null
  if (state === 'idle') return null
  if (state === 'done' && !text.trim()) return null

  return (
    <div className="rounded-xl border border-border-default bg-surface-elevated p-4 mb-4">
      <div className="flex items-center gap-2 mb-1.5">
        <svg className="w-4 h-4 text-accent-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <span className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Your order at a glance</span>
        <span className="text-[9px] text-foreground-muted ml-auto">on-device · private</span>
      </div>
      {state === 'loading' && !text ? (
        <p className="text-sm text-foreground-muted animate-pulse">Preparing your summary…</p>
      ) : (
        <p className="text-sm text-foreground leading-relaxed">{text}{state === 'loading' && <span className="animate-pulse">▍</span>}</p>
      )}
    </div>
  )
}
