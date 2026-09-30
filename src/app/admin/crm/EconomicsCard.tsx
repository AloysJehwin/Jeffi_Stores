'use client'

import Link from 'next/link'
import { ap } from '@/lib/admin-path'
import { CompactStat, rsCompact, rs, numStr, pctStr, daysStr, Chip } from '@/components/admin/dashboard/Primitives'
import { CRM_SEGMENT_KEYS } from '@/lib/crm-insights-shared'
import type { Economics, SegmentRate, SegmentReturn, CrmSegmentKey } from '@/lib/crm-insights-shared'

const SEGMENT_LABEL: Record<CrmSegmentKey, string> = {
  vip: 'VIP', loyal: 'Loyal', repeat: 'Repeat', one_time: 'One time', new: 'New',
  at_risk: 'At risk', dormant: 'Dormant', b2b: 'B2B', lead: 'Lead',
}

const byKey = <T extends { key: CrmSegmentKey }>(rows: T[]) => {
  const m = new Map(rows.map(r => [r.key, r]))
  return CRM_SEGMENT_KEYS.map(k => m.get(k)).filter((r): r is T => !!r)
}

export default function EconomicsCard({ economics, aovBySegment, returnRateBySegment }: {
  economics: Economics; aovBySegment: SegmentRate[]; returnRateBySegment: SegmentReturn[]
}) {
  const empty = economics.paidOrders === 0 && economics.totalValue === 0 && aovBySegment.length === 0
  if (empty) return null

  const aov = byKey(aovBySegment)
  const returns = byKey(returnRateBySegment)
  const topDecilePct = economics.totalValue > 0 ? (economics.topDecileValue / economics.totalValue) * 100 : null

  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
      <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">Value and Economics</h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <CompactStat label="Avg order value" value={economics.aov == null ? 'n/a' : rs(economics.aov)} sub={`${numStr(economics.paidOrders)} paid orders`} />
        <CompactStat label="Lifetime value" value={rsCompact(economics.totalValue)} />
        <CompactStat label="Top decile share" value={pctStr(topDecilePct, 0)} sub={rsCompact(economics.topDecileValue)} />
        <CompactStat label="Avg days between" value={daysStr(economics.avgDaysBetween)} />
        <CompactStat label="New revenue" value={rsCompact(economics.newRevenue)} />
        <CompactStat label="Returning revenue" value={rsCompact(economics.returningRevenue)} />
      </div>

      <p className="text-[11px] uppercase tracking-wide text-foreground-muted font-medium mb-2">Lifetime value bands</p>
      <div className="space-y-1 mb-4">
        {economics.buckets.map(b => (
          <div key={b.label} className="flex items-center justify-between text-xs">
            <span className="text-foreground-secondary">{b.label}</span>
            <span className="text-foreground font-semibold tabular-nums">{numStr(b.count)}</span>
          </div>
        ))}
      </div>

      {aov.length > 0 && (
        <>
          <p className="text-[11px] uppercase tracking-wide text-foreground-muted font-medium mb-2">AOV and returns by segment</p>
          <div className="divide-y divide-border-default">
            {aov.map(s => {
              const ret = returns.find(r => r.key === s.key)
              return (
                <Link
                  key={s.key}
                  href={ap(`/admin/customers?segment=${s.key}`)}
                  className="flex items-center gap-3 py-2 group hover:bg-surface-secondary/50 -mx-2 px-2 rounded-lg transition-colors"
                >
                  <span className="text-xs font-medium text-foreground flex-1 truncate group-hover:text-accent-600 transition-colors">{SEGMENT_LABEL[s.key]}</span>
                  <span className="text-xs text-foreground-secondary tabular-nums">{s.aov == null ? 'n/a' : rs(s.aov)}</span>
                  {ret && ret.returnRate != null && (
                    <Chip tone={ret.returnRate >= 15 ? 'bad' : ret.returnRate >= 5 ? 'warn' : 'good'}>{pctStr(ret.returnRate, 0)} ret</Chip>
                  )}
                </Link>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
