'use client'

import { useEffect, useRef, useState } from 'react'
import { canRunOnDeviceSummary, generateRecap, disposeSummarizer } from '@/lib/on-device/runtime'
import { getViewedProducts, getSearches } from '@/lib/on-device/session-signals'
import type { SessionSignals, CartLine } from '@/lib/on-device/prompt'

/**
 * On-device cart recap on the checkout review page. Renders NOTHING unless the
 * device is capable (flag on + WebGPU + memory + GPU limits). The ~400MB model
 * downloads lazily in a Web Worker and the summary streams in — fully
 * non-blocking; checkout works identically whether or not this appears.
 *
 * The parent supplies the resolved line items + total, so this works for BOTH
 * the persisted-cart and buy-now flows (buy-now items aren't in useCart()).
 */
export default function CheckoutRecapSummary({ items, total }: { items: CartLine[]; total: number }) {
  const [capable, setCapable] = useState<boolean | null>(null)
  const [text, setText] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const started = useRef(false)

  // Gate check (runs the capability probe once).
  useEffect(() => {
    let alive = true
    canRunOnDeviceSummary().then(ok => { if (alive) setCapable(ok) })
    return () => { alive = false; disposeSummarizer() }
  }, [])

  // Kick off generation once capable + items are known (only once).
  useEffect(() => {
    if (!capable || started.current) return
    if (!items || items.length === 0) return
    started.current = true

    const itemCount = items.reduce((s, c) => s + c.qty, 0)
    const signals: SessionSignals = {
      cart: items,
      total: Math.round((total || 0) * 100) / 100,
      itemCount,
      viewed: getViewedProducts(),
      searches: getSearches(),
    }

    setState('loading')
    generateRecap(signals, (partial) => setText(partial))
      .then(final => { setText(final); setState('done') })
      .catch((e) => { setErrMsg(e?.message || String(e)); setState('error') })
  }, [capable, items, total])

  // Silent on incapable devices or empty output. (Error is shown on-screen in
  // development to aid debugging; hidden in production.)
  if (capable !== true) return null
  if (state === 'error' && process.env.NODE_ENV === 'production') return null
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
      {state === 'error' ? (
        <p className="text-xs text-red-600 break-words font-mono">[dev] {errMsg || 'unknown error'}</p>
      ) : state === 'loading' && !text ? (
        <p className="text-sm text-foreground-muted animate-pulse">Preparing your summary…</p>
      ) : (
        <p className="text-sm text-foreground leading-relaxed">{text}{state === 'loading' && <span className="animate-pulse">▍</span>}</p>
      )}
    </div>
  )
}
