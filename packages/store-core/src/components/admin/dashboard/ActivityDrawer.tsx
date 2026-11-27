'use client'

import { useMemo } from 'react'
import type { ActivityChannel, DashboardActivity } from '../../../lib/dashboard/activity-types'
import { activityToInsights } from '../../../lib/dashboard/activity-insights'
import type { InsightsQuery } from '../../../lib/insights/series'
import { InsightsDrawer, type InsightsSection } from '../insights/InsightsDrawer'
import { WeekdayRhythm } from './WeekdayRhythm'
import { TimeToShip } from './TimeToShip'
import { ThroughputLines } from './ThroughputLines'
import { ProductShippedTable } from './ProductShippedTable'

export interface ActivityDrawerProps {
  /** The activity already loaded for the dashboard (26 weeks, all channels); later queries go through `load`. */
  activity: DashboardActivity
  open: boolean
  onClose: () => void
  storeName?: string
  /** YYYY-MM-DD of today, for the daily-average maths in the chart tooltip. */
  today?: string
  load: (next: { weeks: number; channel: ActivityChannel }) => Promise<DashboardActivity | null>
}

const CHANNELS: { value: ActivityChannel; label: string }[] = [
  { value: 'all', label: 'All channels' },
  { value: 'online', label: 'Online' },
  { value: 'cod', label: 'COD' },
  { value: 'business', label: 'Business' },
]
const COPY = { subject: 'Orders shipped', unit: 'shipped', noun: 'orders', empty: 'No shipments in this range.' }

const SECTIONS: InsightsSection<DashboardActivity>[] = [
  { title: 'Weekday rhythm', half: true, render: s => <WeekdayRhythm weekday={s.extra!.weekday} /> },
  {
    title: 'Time to ship',
    half: true,
    render: ({ extra: a }) => <TimeToShip buckets={a!.timeToShip} medianDays={a!.medianDaysToShip} within2dPct={a!.shippedWithin2dPct} />,
  },
  { title: 'Throughput · weekly', render: ({ extra: a }) => <ThroughputLines throughput={a!.throughput} backlog={a!.backlog} /> },
  { title: 'Top products shipped', render: s => <ProductShippedTable products={s.extra!.topProducts} /> },
]

/** The dashboard's "Orders shipped" insights drawer: the 3D shipped-orders chart and fulfilment breakdowns. */
export function ActivityDrawer({ activity, open, onClose, storeName, today, load }: ActivityDrawerProps) {
  const initial = useMemo(() => activityToInsights(activity, today), [activity, today])
  return (
    <InsightsDrawer<DashboardActivity>
      open={open}
      onClose={onClose}
      subtitle={storeName}
      initial={initial}
      title="Orders shipped"
      copy={COPY}
      filter={{ label: 'Channel', options: CHANNELS, initial: activity.channel }}
      sections={SECTIONS}
      exportKey="dashboard.activity"
      exportFilters={f => ({ channels: f && f !== 'all' ? [f] : CHANNELS.filter(c => c.value !== 'all').map(c => c.value) })}
      load={async (q: InsightsQuery) => {
        const next = await load({ weeks: q.weeks, channel: (q.filter ?? 'all') as ActivityChannel })
        return next && activityToInsights(next, today)
      }}
    />
  )
}
