'use client'

import { CompactStat, numStr, rsCompact, pctStr } from '@/components/admin/dashboard/Primitives'
import type { B2b } from '@/lib/shared/crm-insights-shared'

export default function B2bCard({ b2b }: { b2b: B2b }) {
  const empty =
    b2b.pendingApprovals === 0 &&
    b2b.openRfqs === 0 &&
    b2b.rfqsInRange === 0 &&
    b2b.openQuotes === 0 &&
    b2b.creditCustomers === 0
  if (empty) return null

  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
      <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">B2B Pipeline</h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <CompactStat
          label="Pending approvals"
          value={numStr(b2b.pendingApprovals)}
          tone={b2b.pendingApprovals > 0 ? 'text-amber-600 dark:text-amber-400' : undefined}
        />
        <CompactStat label="Open RFQs" value={numStr(b2b.openRfqs)} />
        <CompactStat
          label="RFQ conversion"
          value={pctStr(b2b.conversionRate, 0)}
          sub={`${numStr(b2b.rfqsConverted)} of ${numStr(b2b.rfqsInRange)}`}
        />
        <CompactStat label="Open quotes" value={numStr(b2b.openQuotes)} sub={rsCompact(b2b.openQuotesValue)} />
        <CompactStat label="Credit customers" value={numStr(b2b.creditCustomers)} />
        <CompactStat label="Credit limit" value={rsCompact(b2b.creditLimitTotal)} />
        <CompactStat label="Credit used" value={rsCompact(b2b.creditUsed)} />
      </div>
    </div>
  )
}
