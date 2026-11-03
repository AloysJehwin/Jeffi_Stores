'use client'

import {
  usePeriod,
  PeriodBar,
  useOverviewData,
  AttentionList,
  type AttentionItem,
} from '@/components/admin/overview/kit'
import { Kpi, KpiGrid } from '@/components/admin/channels/ui'
import { formatKpi, type OverviewKpi } from '@/lib/overviews/ops-kpi'
import { ap } from '@/lib/shared/admin-path'

// Shelving overview: locations, utilisation and unshelved stock.
export default function ShelvingOverview() {
  const [period, setPeriod] = usePeriod()
  const { data, error, loading, reload } = useOverviewData<{ kpis: OverviewKpi[]; attention: AttentionItem[] }>(
    `/api/admin/shelving/overview?from=${period.from}&to=${period.to}`
  )
  return (
    <div className="space-y-3">
      <PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} />
      {error && <p className="text-sm text-red-500">{error}</p>}
      {loading && <div className="h-24 rounded-xl bg-surface-elevated border border-border-default animate-pulse" />}
      {data && (
        <>
          <KpiGrid>
            {data.kpis.map(k => (
              <Kpi
                key={k.key}
                label={k.label}
                value={formatKpi(k.value, k.format)}
                delta={k.delta}
                invert={k.invert}
                sub={k.sub}
              />
            ))}
          </KpiGrid>
          <AttentionList items={data.attention.map(a => ({ ...a, href: a.href && ap(a.href) }))} />
        </>
      )}
    </div>
  )
}
