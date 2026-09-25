'use client'

import Link from 'next/link'
import { ap } from '@/lib/admin-path'
import { CompactStat, numStr, rsCompact } from '@/components/admin/dashboard/Primitives'
import type { Intent, SearchTerm } from '@/lib/crm-insights-shared'

export default function IntentCard({ intent, topSearches }: { intent: Intent; topSearches: SearchTerm[] }) {
  const totalAbandoned = intent.abandoned.reduce((s, a) => s + a.count, 0)
  const empty = totalAbandoned === 0 && intent.savedForLater === 0 && intent.wishlistItems === 0 && topSearches.length === 0
  if (empty) return null

  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
      <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">Purchase Intent</h2>

      <p className="text-[11px] uppercase tracking-wide text-foreground-muted font-medium mb-2">Abandoned carts</p>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {intent.abandoned.map(a => (
          <CompactStat key={a.label} label={a.label} value={numStr(a.count)} sub={rsCompact(a.value)} />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <CompactStat label="Saved for later" value={numStr(intent.savedForLater)} />
        <CompactStat label="Wishlist items" value={numStr(intent.wishlistItems)} />
        <CompactStat label="Wishlist in stock" value={numStr(intent.wishlistInStock)} />
      </div>

      {topSearches.length > 0 && (
        <>
          <p className="text-[11px] uppercase tracking-wide text-foreground-muted font-medium mb-2">Top searches</p>
          <div className="flex flex-wrap gap-2">
            {topSearches.map(t => (
              <Link
                key={t.query}
                href={ap(`/admin/products?search=${encodeURIComponent(t.query)}`)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-surface-secondary text-foreground-secondary rounded-full text-xs font-medium hover:bg-surface-secondary/50 transition-colors"
              >
                {t.query}
                <span className="text-[10px] opacity-70 tabular-nums">{t.count}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
