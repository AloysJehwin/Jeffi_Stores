'use client'

import { useMemo, useState } from 'react'
import { ThumbsUp, ThumbsDown } from 'lucide-react'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { useAiLine, type CartLine } from './useAiLine'

export default function CheckoutRecapSummary({ items, total }: { items: CartLine[]; total: number }) {
  const flags = useStoreConfig().flags
  const enabled = flags.aiStorefrontEnabled && flags.ondeviceSummaryEnabled && items.length > 0
  const body = useMemo(
    () => ({ cart: items, total: Math.round((total || 0) * 100) / 100, itemCount: items.reduce((s, c) => s + c.qty, 0) }),
    [items, total]
  )
  const { text, off } = useAiLine('/api/ai-recap', body, 'text', enabled)
  const [feedback, setFeedback] = useState<'liked' | 'disliked' | null>(null)

  if (!enabled || off || !text) return null

  return (
    <div className="rounded-xl border border-border-default bg-surface-elevated p-4 mb-4">
      <div className="flex items-center gap-2 mb-1.5">
        <svg className="w-4 h-4 text-accent-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <span className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Your order at a glance</span>
        <span className="text-[9px] text-foreground-muted ml-auto">AI summary</span>
      </div>

      <p className="text-sm text-foreground leading-relaxed">{text}</p>

      {!feedback ? (
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border-default">
          <span className="text-[10px] text-foreground-muted">Helpful?</span>
          <button
            type="button"
            onClick={() => setFeedback('liked')}
            className="text-foreground-muted hover:text-accent-500 transition-colors"
            aria-label="Liked"
          >
            <ThumbsUp className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setFeedback('disliked')}
            className="text-foreground-muted hover:text-red-500 transition-colors"
            aria-label="Disliked"
          >
            <ThumbsDown className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <p className="text-[10px] text-foreground-muted mt-2 pt-2 border-t border-border-default">
          {feedback === 'liked' ? 'Thanks for the feedback!' : 'Got it, thanks for telling us.'}
        </p>
      )}
    </div>
  )
}
