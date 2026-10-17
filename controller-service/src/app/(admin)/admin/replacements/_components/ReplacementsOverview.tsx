'use client'

import { Kpi, Banner, Section, count, pct } from '@/components/admin/channels/ui'
import { AttentionList, PeriodBar, useOverviewData, usePeriod } from '@/components/admin/overview/kit'
import { delta } from '@/lib/overview/period'
import { BreakdownBars, fmtDays, withAp } from '../../orders/_components/overview-shared'
import type { ReturnsData } from '../../returns/_components/ReturnsOverview'

export default function ReplacementsOverview() {
  const [period, setPeriod] = usePeriod()
  const { data, error, loading, reload } = useOverviewData<ReturnsData>(
    `/api/admin/replacements/overview?from=${period.from}&to=${period.to}`
  )
  const c = data?.kpis.current
  const p = data?.kpis.previous
  return (
    <div className="space-y-4">
      <PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} />
      {error && <Banner ok={false}>{error}</Banner>}
      {loading && !data ? (
        <div className="h-24 rounded-xl bg-surface-elevated border border-border-default animate-pulse" />
      ) : data && c && p ? (
        <>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
            <Kpi label="Requests" value={count(c.requests)} delta={delta(c.requests, p.requests)} invert />
            <Kpi
              label="Replacement rate"
              value={pct(c.rate)}
              delta={delta(c.rate, p.rate)}
              invert
              sub={`Of ${count(c.delivered)} delivered`}
            />
            <Kpi
              label="Open now"
              value={count(data.snapshot.open)}
              sub={`${count(data.snapshot.pendingApproval)} waiting for approval`}
            />
            <Kpi label="Closed" value={count(c.completed)} delta={delta(c.completed, p.completed)} />
            <Kpi label="Time to close" value={fmtDays(c.closeDays)} delta={delta(c.closeDays, p.closeDays)} invert />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <AttentionList items={withAp(data.attention)} />
            <Section title="By reason">
              <BreakdownBars rows={data.byReason.map(r => ({ label: r.label, value: r.count }))} />
            </Section>
          </div>
        </>
      ) : null}
    </div>
  )
}
