'use client'

import { useState, useCallback, useEffect } from 'react'
import type { AnalyticsRange } from '@/lib/queries'
import type { CrmInsights as CrmInsightsData, CrmSegment, CrmSegmentKey } from '@/lib/shared/crm-insights-shared'
import { CRM_SEGMENT_KEYS } from '@/lib/shared/crm-insights-shared'
import Select from '@/components/ui/Select'
import GrowthRetentionCard from './GrowthRetentionCard'
import EconomicsCard from './EconomicsCard'
import HealthFactorsCard from './HealthFactorsCard'
import ServiceCard from './ServiceCard'
import ReachCard from './ReachCard'
import IntentCard from './IntentCard'
import WorkloadCard from './WorkloadCard'
import B2bCard from './B2bCard'
import GeographyCard from './GeographyCard'

const RANGES: { key: AnalyticsRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
]

const SEGMENT_LABEL: Record<CrmSegmentKey, string> = {
  vip: 'VIP',
  loyal: 'Loyal',
  repeat: 'Repeat',
  one_time: 'One time',
  new: 'New',
  at_risk: 'At risk',
  dormant: 'Dormant',
  b2b: 'B2B',
  lead: 'Lead',
}

export default function CrmInsights({
  initial,
  syncRange,
}: {
  initial: CrmInsightsData
  /** Follows the overview period when it maps onto a range. */
  syncRange?: AnalyticsRange | null
}) {
  const [data, setData] = useState<CrmInsightsData>(initial)
  const [range, setRange] = useState<AnalyticsRange>(initial.range)
  const [segment, setSegment] = useState<CrmSegment>(initial.segment)
  const [loading, setLoading] = useState(false)

  const refetch = useCallback(async (r: AnalyticsRange, seg: CrmSegment) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/crm/insights?range=${r}&segment=${seg}`, { credentials: 'include' })
      if (res.ok) setData(await res.json())
    } catch {
      /* keep previous data */
    } finally {
      setLoading(false)
    }
  }, [])

  const changeRange = useCallback(
    (r: AnalyticsRange) => {
      if (r === range || loading) return
      setRange(r)
      refetch(r, segment)
    },
    [range, segment, loading, refetch]
  )

  useEffect(() => {
    if (!syncRange || syncRange === range) return
    setRange(syncRange)
    refetch(syncRange, segment)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncRange])

  const changeSegment = useCallback(
    (seg: CrmSegment) => {
      if (seg === segment || loading) return
      setSegment(seg)
      refetch(range, seg)
    },
    [range, segment, loading, refetch]
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center bg-surface-secondary border border-border-default rounded-xl p-1 gap-0.5 self-start">
          {RANGES.map(r => (
            <button
              key={r.key}
              onClick={() => changeRange(r.key)}
              disabled={loading}
              className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 disabled:opacity-50 ${
                range === r.key ? 'bg-accent-500 text-white' : 'text-foreground-secondary hover:text-foreground'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <Select<CrmSegment>
          value={segment}
          onChange={changeSegment}
          disabled={loading}
          size="sm"
          className="self-start"
          aria-label="Customer segment"
          options={[
            { value: 'all', label: 'All customers' },
            ...CRM_SEGMENT_KEYS.map(k => ({ value: k as CrmSegment, label: SEGMENT_LABEL[k] })),
          ]}
        />
      </div>

      <div className={`space-y-5 transition-opacity ${loading ? 'opacity-60' : ''}`}>
        <GrowthRetentionCard growth={data.growth} cohorts={data.cohorts} />
        <EconomicsCard
          economics={data.economics}
          aovBySegment={data.aovBySegment}
          returnRateBySegment={data.returnRateBySegment}
        />
        <HealthFactorsCard health={data.health} transitions={data.healthTransitions} gains={data.healthGains} />
        <ServiceCard service={data.service} lowReviews={data.lowReviews} />
        <ReachCard reach={data.reach} />
        <IntentCard intent={data.intent} topSearches={data.topSearches} />
        <WorkloadCard
          workload={data.workload}
          tasksByAssignee={data.tasksByAssignee}
          notesPerWeek={data.notesPerWeek}
        />
        <B2bCard b2b={data.b2b} />
        <GeographyCard states={data.geographyStates} cities={data.geographyCities} />
      </div>
    </div>
  )
}
