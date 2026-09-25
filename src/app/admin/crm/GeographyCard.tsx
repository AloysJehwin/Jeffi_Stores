'use client'

import { ListRows, rsCompact, numStr } from '@/components/admin/dashboard/Primitives'
import { ap } from '@/lib/admin-path'
import type { GeoRow } from '@/lib/crm-insights-shared'

export default function GeographyCard({ states, cities }: { states: GeoRow[]; cities: GeoRow[] }) {
  if (states.length === 0 && cities.length === 0) return null

  const stateRows = states.map(g => ({
    key: g.name,
    primary: g.name,
    secondary: `${numStr(g.customers)} customers`,
    value: rsCompact(g.revenue),
    href: ap(`/admin/orders?state=${encodeURIComponent(g.name)}`),
  }))
  const cityRows = cities.map(g => ({
    key: `${g.name}-${g.state ?? ''}`,
    primary: g.name,
    secondary: [g.state, `${numStr(g.customers)} customers`].filter(Boolean).join(' · '),
    value: rsCompact(g.revenue),
    href: ap(`/admin/orders?city=${encodeURIComponent(g.name)}`),
  }))

  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
      <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">Geography</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {stateRows.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-foreground-muted font-medium mb-1">Top states</p>
            <ListRows rows={stateRows} />
          </div>
        )}
        {cityRows.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-foreground-muted font-medium mb-1">Top cities</p>
            <ListRows rows={cityRows} />
          </div>
        )}
      </div>
    </div>
  )
}
