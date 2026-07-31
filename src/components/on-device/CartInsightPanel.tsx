'use client'

import { useEffect, useRef, useState } from 'react'
import { canRunOnDeviceSummary, generateCartInsight, disposeSummarizer } from '@/lib/on-device/runtime'
import { readUserProfile } from '@/lib/on-device/user-profile'
import type { CartLine } from '@/lib/on-device/prompt'

export default function CartInsightPanel({ items }: { items: CartLine[] }) {
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle')
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
    if (state !== 'idle' || started.current || !items.length) return
    started.current = true
    setState('loading')

    canRunOnDeviceSummary().then(({ capable, isMobile }) => {
      if (!capable) { setState('idle'); return }
      const profile = readUserProfile()
      const signals = {
        cart: items,
        total: null,
        itemCount: items.reduce((s, i) => s + i.qty, 0),
        userProfile: profile.purchaseCount > 0 ? profile : null,
      }
      generateCartInsight(signals, isMobile, partial => setText(partial))
        .then(final => { setText(final); setState('done') })
        .catch(() => setState('idle'))
    })
    return () => disposeSummarizer()
  }, [state, items])

  if (state === 'idle' || (state === 'done' && !text.trim())) return null

  return (
    <div className="flex items-start gap-2.5 px-4 py-3 mb-4 bg-surface-elevated rounded-xl border border-border-default">
      <svg className="w-4 h-4 text-accent-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
      <p className="text-sm text-foreground leading-relaxed flex-1">
        {state === 'loading' && !text
          ? <span className="text-foreground-muted animate-pulse">Building your overview…</span>
          : <>{text}{state === 'loading' && <span className="animate-pulse">▍</span>}</>
        }
      </p>
      <span className="text-[9px] text-foreground-muted self-start mt-0.5 flex-shrink-0">on-device</span>
    </div>
  )
}
