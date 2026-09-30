'use client'

import { useState, useCallback } from 'react'
import type { AnalyticsRange } from '@/lib/queries'
import type { CrmInsights as CrmInsightsData, CrmSegment, CrmSegmentKey } from '@/lib/crm-insights-shared'
import { CRM_SEGMENT_KEYS } from '@/lib/crm-insights-shared'
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

export default function CrmInsights({ initial }: { initial: CrmInsightsData }) {
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
                range === r.key
                  ? 'bg-accent-500 text-white shadow-sm'
                  : 'text-foreground-secondary hover:text-foreground'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <select
          value={segment}
          onChange={e => changeSegment(e.target.value as CrmSegment)}
          disabled={loading}
          className="bg-surface-secondary border border-border-default rounded-xl px-3 py-2 text-xs font-semibold text-foreground disabled:opacity-50 self-start"
        >
          <option value="all">All customers</option>
          {CRM_SEGMENT_KEYS.map(k => (
            <option key={k} value={k}>
              {SEGMENT_LABEL[k]}
            </option>
          ))}
        </select>
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
