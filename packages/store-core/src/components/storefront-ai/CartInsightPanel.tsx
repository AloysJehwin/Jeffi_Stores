'use client'

import { useMemo } from 'react'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { useAiLine, type CartLine } from './useAiLine'

export default function CartInsightPanel({ items }: { items: CartLine[] }) {
  const flags = useStoreConfig().flags
  const enabled = flags.aiStorefrontEnabled && flags.ondeviceSummaryEnabled && items.length > 0
  const body = useMemo(() => ({ cart: items }), [items])
  const { text, off } = useAiLine('/api/ai-cart-insight', body, 'text', enabled)

  // Only render once real text arrives, so no box flashes when the AI is unavailable.
  if (!enabled || off || !text) return null

  return (
    <div className="flex items-start gap-2.5 px-4 py-3 mt-4 mb-4 bg-surface-elevated rounded-xl border border-border-default">
      <svg
        className="w-4 h-4 text-accent-500 flex-shrink-0 mt-0.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
      <p className="text-sm text-foreground leading-relaxed flex-1">{text}</p>
      <span className="text-[9px] text-foreground-muted self-start mt-0.5 flex-shrink-0">AI</span>
    </div>
  )
}
