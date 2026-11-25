'use client'

import { useEffect, useMemo } from 'react'
import { updateUserProfile } from '@/lib/storefront-ai/user-profile'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { useAiLine } from './useAiLine'

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
  const enabled = flags.aiStorefrontEnabled && flags.ondeviceSummaryEnabled && items.length > 0
  const body = useMemo(() => ({ itemNames: items.map(i => i.productName) }), [items])
  const { text, off } = useAiLine('/api/ai-affirmation', body, 'text', enabled)

  // The shopper's local history (search banner), recorded once per confirmation.
  useEffect(() => {
    if (!enabled) return
    updateUserProfile({
      categories: [],
      brands: [],
      total,
      itemCount: items.reduce((s, i) => s + i.quantity, 0),
      buyMode: items[0]?.buyMode || null,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  if (!enabled || off || !text) return null

  return (
    <div className="flex items-start gap-2.5 bg-surface-elevated border border-border-default rounded-xl px-4 py-3 mb-6">
      <svg
        className="w-4 h-4 text-accent-500 flex-shrink-0 mt-0.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <p className="text-sm text-foreground leading-relaxed flex-1">{text}</p>
      <span className="text-[9px] text-foreground-muted flex-shrink-0 mt-0.5">AI</span>
    </div>
  )
}
