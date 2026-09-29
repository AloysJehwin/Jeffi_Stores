'use client'

import { useEffect, useRef, useState } from 'react'
import { canRunOnDeviceSummary, generateAffirmation, maybeRunFineTune } from '@/lib/on-device/runtime'
import { readUserProfile, updateUserProfile } from '@/lib/on-device/user-profile'
import { useStoreConfig } from '@/contexts/StoreConfigContext'

interface OrderItem {
  productName: string
  quantity: number
  unitPrice: number
  buyMode?: string | null
}

interface Props {
  items: OrderItem[]
  total: number
}

export default function OrderAffirmation({ items, total }: Props) {
  const flags = useStoreConfig().flags
  const ondeviceEnabled = flags.ondeviceSummaryEnabled
  const finetuneEnabled = flags.ondeviceFinetuneEnabled
  const [text, setText] = useState('')
  const [done, setDone] = useState(false)
  const [source, setSource] = useState<'on-device' | 'ollama'>('on-device')
  const [aiOff, setAiOff] = useState(false)
  const aiEnabled = flags.aiStorefrontEnabled && !aiOff
  const started = useRef(false)

  useEffect(() => {
    if (!ondeviceEnabled || !aiEnabled) return
    if (started.current || !items.length) return
    started.current = true

    // Update user profile with this order's signal
    updateUserProfile({
      categories: [], // confirmation page doesn't have category data
      brands: [],
      total,
      itemCount: items.reduce((s, i) => s + i.quantity, 0),
      buyMode: items[0]?.buyMode || null,
    })

    canRunOnDeviceSummary().then(async ({ capable, isMobile }) => {
      const summaryAllowed = isMobile ? flags.ondeviceSummaryMobileEnabled : flags.ondeviceSummaryDesktopEnabled
      const finetuneAllowed = isMobile ? flags.ondeviceFinetuneMobileEnabled : flags.ondeviceFinetuneDesktopEnabled
      const itemNames = items.map(i => i.productName)

      if (capable && summaryAllowed) {
        const profile = readUserProfile()
        try {
          setSource('on-device')
          const final = await generateAffirmation(itemNames, total, profile, isMobile, partial => setText(partial))
          setText(final)
          setDone(true)
          // Best-effort on-device LoRA fine-tune from this affirmation (gated on
          // the DB fine-tune flag + its platform flag + capability).
          maybeRunFineTune(finetuneEnabled && finetuneAllowed, [{
            prompt: `Order affirmation for: ${itemNames.join(', ')}`,
            completion: final,
          }])
          return
        } catch {
          // fall through to server
        }
      }

      // Server (Ollama) fallback — mobile default + any incapable device.
      try {
        setSource('ollama')
        const res = await fetch('/api/ai-affirmation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemNames }),
        })
        if (res.status === 403) { setAiOff(true); return }
        if (!res.ok) throw new Error('ollama failed')
        const data = await res.json() as { text?: string }
        if (!data.text) throw new Error('empty')
        setText(data.text)
        setDone(true)
      } catch {
        // silently fail
      }
    })
  }, [items, total, ondeviceEnabled, aiEnabled, finetuneEnabled, flags.ondeviceSummaryMobileEnabled, flags.ondeviceSummaryDesktopEnabled, flags.ondeviceFinetuneMobileEnabled, flags.ondeviceFinetuneDesktopEnabled])

  if (!aiEnabled || !text) return null

  return (
    <div className="flex items-start gap-2.5 bg-surface-elevated border border-border-default rounded-xl px-4 py-3 mb-6">
      <svg className="w-4 h-4 text-accent-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <p className="text-sm text-foreground leading-relaxed flex-1">
        {text}{!done && <span className="animate-pulse">▍</span>}
      </p>
      <span className="text-[9px] text-foreground-muted flex-shrink-0 mt-0.5">{source}</span>
    </div>
  )
}
