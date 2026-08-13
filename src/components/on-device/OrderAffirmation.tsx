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
  const ondeviceEnabled = useStoreConfig().flags.ondeviceSummaryEnabled
  const finetuneEnabled = useStoreConfig().flags.ondeviceFinetuneEnabled
  const [text, setText] = useState('')
  const [done, setDone] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (!ondeviceEnabled) return
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

    canRunOnDeviceSummary().then(({ capable, isMobile }) => {
      if (!capable) return
      const profile = readUserProfile()
      const itemNames = items.map(i => i.productName)
      generateAffirmation(itemNames, total, profile, isMobile, partial => setText(partial))
        .then(final => {
          setText(final)
          setDone(true)
          // Best-effort on-device LoRA fine-tune from this affirmation (gated on
          // the DB fine-tune flag + capability inside maybeRunFineTune).
          maybeRunFineTune(finetuneEnabled, [{
            prompt: `Order affirmation for: ${itemNames.join(', ')}`,
            completion: final,
          }])
        })
        .catch(() => {})
    })
  }, [items, total, ondeviceEnabled, finetuneEnabled])

  if (!text) return null

  return (
    <div className="flex items-start gap-2.5 bg-surface-elevated border border-border-default rounded-xl px-4 py-3 mb-6">
      <svg className="w-4 h-4 text-accent-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <p className="text-sm text-foreground leading-relaxed flex-1">
        {text}{!done && <span className="animate-pulse">▍</span>}
      </p>
      <span className="text-[9px] text-foreground-muted flex-shrink-0 mt-0.5">on-device</span>
    </div>
  )
}
