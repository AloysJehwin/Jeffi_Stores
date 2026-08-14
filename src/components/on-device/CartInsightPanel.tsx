'use client'

import { useEffect, useRef, useState } from 'react'
import { canRunOnDeviceSummary, generateCartInsight, disposeSummarizer } from '@/lib/on-device/runtime'
import { readUserProfile } from '@/lib/on-device/user-profile'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import type { CartLine } from '@/lib/on-device/prompt'

export default function CartInsightPanel({ items }: { items: CartLine[] }) {
  const flags = useStoreConfig().flags
  const ondeviceEnabled = flags.ondeviceSummaryEnabled
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle')
  const [source, setSource] = useState<'on-device' | 'ollama'>('on-device')
  const started = useRef(false)
  const prevHash = useRef('')

  useEffect(() => {
    const hash = items.map(i => `${i.name}:${i.qty}`).join('|')
    if (hash === prevHash.current) return
    prevHash.current = hash
    started.current = false
    setText('')
    setState('idle')
  }, [items])

  useEffect(() => {
    if (!ondeviceEnabled) return
    if (state !== 'idle' || started.current || !items.length) return
    started.current = true
    setState('loading')

    canRunOnDeviceSummary().then(async ({ capable, isMobile }) => {
      const platformAllowed = isMobile ? flags.ondeviceSummaryMobileEnabled : flags.ondeviceSummaryDesktopEnabled

      if (capable && platformAllowed) {
        const profile = readUserProfile()
        const signals = {
          cart: items,
          total: null,
          itemCount: items.reduce((s, i) => s + i.qty, 0),
          userProfile: profile.purchaseCount > 0 ? profile : null,
        }
        try {
          setSource('on-device')
          const final = await generateCartInsight(signals, isMobile, partial => setText(partial))
          setText(final); setState('done')
          return
        } catch {
          // fall through to server
        }
      }

      // Server (Ollama) fallback — used on mobile by default and whenever the
      // device can't run the in-browser model.
      try {
        setSource('ollama')
        const res = await fetch('/api/ai-cart-insight', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cart: items }),
        })
        if (!res.ok) throw new Error('ollama failed')
        const data = await res.json() as { text?: string }
        if (!data.text) throw new Error('empty')
        setText(data.text); setState('done')
      } catch {
        setState('idle')
      }
    })
    return () => disposeSummarizer()
  }, [state, items, ondeviceEnabled, flags.ondeviceSummaryMobileEnabled, flags.ondeviceSummaryDesktopEnabled])

  // Only render once real text has started streaming — never flash a loading box
  // that would then vanish on devices where the model can't load (most mobiles).
  if (!text.trim()) return null

  return (
    <div className="flex items-start gap-2.5 px-4 py-3 mt-4 mb-4 bg-surface-elevated rounded-xl border border-border-default">
      <svg className="w-4 h-4 text-accent-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
      <p className="text-sm text-foreground leading-relaxed flex-1">
        {text}{state === 'loading' && <span className="animate-pulse">▍</span>}
      </p>
      <span className="text-[9px] text-foreground-muted self-start mt-0.5 flex-shrink-0">{source}</span>
    </div>
  )
}
