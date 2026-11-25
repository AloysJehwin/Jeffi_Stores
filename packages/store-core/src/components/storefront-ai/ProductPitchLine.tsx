'use client'

import { useMemo } from 'react'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { useAiLine } from './useAiLine'

interface Props {
  productName: string
  brand: string | null
  category: string | null
}

export default function ProductPitchLine({ productName, brand, category }: Props) {
  const flags = useStoreConfig().flags
  const enabled = flags.aiStorefrontEnabled && flags.ondeviceSummaryEnabled
  const body = useMemo(() => ({ productName, brand, category }), [productName, brand, category])
  const { text, off } = useAiLine('/api/ai-pitch', body, 'pitch', enabled)

  if (!enabled || off || !text) return null

  return (
    <div className="flex items-start gap-2 mt-3 pt-3 border-t border-border-default">
      <svg
        className="w-3.5 h-3.5 text-accent-500 flex-shrink-0 mt-0.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
        />
      </svg>
      <p className="text-sm text-foreground-secondary leading-relaxed flex-1">{text}</p>
      <span className="text-[9px] text-foreground-muted flex-shrink-0 mt-0.5">AI</span>
    </div>
  )
}
