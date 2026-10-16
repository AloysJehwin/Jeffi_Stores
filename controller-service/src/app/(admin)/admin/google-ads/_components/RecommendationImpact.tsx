'use client'

import { money } from '@/lib/google-ads/format'
import type { Economics, MarginImpact } from '@/lib/google-ads/margin-impact'

// Our margin view on a Google recommendation (lib/google-ads/margin-impact.ts).

const tone = {
  gain: 'text-green-700 dark:text-green-400',
  loss: 'text-red-600 dark:text-red-400',
  neutral: 'text-foreground-muted',
}

export function MarginCell({ m, currency }: { m?: MarginImpact | null; currency: string }) {
  if (!m) return <span>-</span>
  return (
    <div className="text-right">
      {m.profitImpact == null ? (
        <span className="text-foreground-muted">-</span>
      ) : (
        <span className={`font-medium ${m.verdict ? tone[m.verdict] : ''}`}>
          {m.profitImpact > 0 ? '+' : ''}
          {money(m.profitImpact, currency)}
        </span>
      )}
      {m.note && <p className="text-[11px] text-foreground-muted max-w-[16rem] ml-auto whitespace-normal">{m.note}</p>}
    </div>
  )
}

export function StockBadge({ m }: { m?: MarginImpact | null }) {
  if (!m?.stockConflict) return <span className="text-foreground-muted">-</span>
  return (
    <span title={m.stockConflict} className="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium bg-red-500/10 text-red-600 dark:text-red-400 whitespace-normal">
      Stock conflict: {m.stockConflict}
    </span>
  )
}

export function MarginBasis({ rows }: { rows: { economics?: Economics }[] }) {
  const e = rows.find(r => r.economics)?.economics
  if (!e) return null
  return (
    <p className="text-xs text-foreground-muted mt-1">
      Profit effect = Google&apos;s forecast extra conversions x
      {e.basis === 'ads_orders' ? ' your average Google Ads order' : e.basis === 'all_orders' ? ' your average order' : ' order value'}
      {e.marginRate != null ? ` at a ${Math.round(e.marginRate * 100)}% gross margin (from cost prices)` : ' (no margin: cost prices missing)'}, less the extra
      spend. An estimate, not Google&apos;s number.
    </p>
  )
}
