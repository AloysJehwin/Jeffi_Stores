'use client'

import { useState } from 'react'
import { Badge, Empty, Kpi, KpiGrid, Section, Table, Tabs, change, count, money, pct, type Col } from '@/components/admin/channels/ui'
import type { AcquisitionData, ChannelRow, DrillRow } from '@/lib/traffic/types'
import { BarSeries } from './charts'
import { Change, Note, bucketLabel, rateText, ratio } from './shared'

type Drill = 'source' | 'campaign' | 'referrer'

export default function AcquisitionTab({ data }: { data: AcquisitionData }) {
  const [drill, setDrill] = useState<Drill>('source')
  const prev = new Map(data.previousChannels.map(c => [c.channel, c]))
  const t = data.totals
  if (!t.sessions && !t.orders) return <Empty msg="No tracked sessions or online orders in this period yet." />

  const paid = data.channels.filter(c => c.paid)
  const paidSessions = paid.reduce((s, c) => s + c.sessions, 0)
  const paidRevenue = paid.reduce((s, c) => s + c.revenue, 0)

  const channelCols: Col<ChannelRow>[] = [
    {
      key: 'label',
      label: 'Channel',
      render: r => (
        <span className="flex items-center gap-1.5">
          {r.label}
          {r.paid && <Badge tone="amber">paid</Badge>}
        </span>
      ),
      sort: r => r.label,
    },
    {
      key: 'sessions',
      label: 'Sessions',
      num: true,
      sort: r => r.sessions,
      render: r => (
        <span className="flex flex-col items-end">
          {count(r.sessions)}
          <Change cur={r.sessions} prev={prev.get(r.channel)?.sessions ?? 0} />
        </span>
      ),
    },
    { key: 'new', label: 'New visitors', num: true, sort: r => r.newVisitors, render: r => count(r.newVisitors) },
    { key: 'conv', label: 'Conversion', num: true, sort: r => ratio(r.convertedSessions, r.sessions) ?? -1, render: r => rateText(r.convertedSessions, r.sessions, 2) },
    {
      key: 'orders',
      label: 'Orders',
      num: true,
      sort: r => r.orders,
      render: r => (
        <span className="flex flex-col items-end">
          {count(r.orders)}
          <Change cur={r.orders} prev={prev.get(r.channel)?.orders ?? 0} />
        </span>
      ),
    },
    { key: 'revenue', label: 'Revenue', num: true, sort: r => r.revenue, render: r => money(r.revenue) },
    { key: 'rps', label: 'Rev / session', num: true, sort: r => ratio(r.revenue, r.sessions) ?? -1, render: r => money(ratio(r.revenue, r.sessions), 2) },
  ]

  const drillCols = (keyLabel: string, tracked: boolean): Col<DrillRow>[] => [
    { key: 'key', label: keyLabel, render: r => <span className="break-all">{r.key}</span>, sort: r => r.key },
    { key: 'sessions', label: 'Sessions', num: true, sort: r => r.sessions, render: r => count(r.sessions) },
    { key: 'conv', label: 'Conversion', num: true, sort: r => ratio(r.convertedSessions, r.sessions) ?? -1, render: r => rateText(r.convertedSessions, r.sessions, 2) },
    { key: 'orders', label: tracked ? 'Orders (tracked)' : 'Orders', num: true, sort: r => r.orders, render: r => count(r.orders) },
    { key: 'revenue', label: 'Revenue', num: true, sort: r => r.revenue, render: r => money(r.revenue) },
  ]

  const rows = drill === 'source' ? data.sourceMedium : drill === 'campaign' ? data.campaigns : data.referrers

  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi label="Sessions" value={count(t.sessions)} />
        <Kpi label="Online orders" value={count(t.orders)} sub={money(t.revenue)} />
        <Kpi label="Attributed orders" value={count(t.attributedOrders)} sub={`${pct(ratio(t.attributedOrders, t.orders), 0)} carry a click or UTM tag`} />
        <Kpi label="Paid sessions" value={count(paidSessions)} sub={pct(ratio(paidSessions, t.sessions), 0) + ' of sessions'} />
        <Kpi label="Paid revenue" value={money(paidRevenue)} sub={pct(ratio(paidRevenue, t.revenue), 0) + ' of revenue'} />
        <Kpi
          label="Channels"
          value={count(data.channels.length)}
          delta={change(data.channels.length, data.previousChannels.length)}
        />
      </KpiGrid>

      <Section title="By channel">
        <Table rows={data.channels} cols={channelCols} rowKey={r => r.channel} empty="No channel data" />
      </Section>

      <Section title={`Paid vs organic sessions by ${data.period.bucket}`}>
        <BarSeries
          stacked
          rows={data.paidTrend}
          label={r => bucketLabel(r.bucket, data.period.bucket)}
          series={[
            { key: 'organic', label: 'Organic and direct', color: 'rgba(148,163,184,0.7)' },
            { key: 'paid', label: 'Paid', color: '#f97316' },
          ]}
        />
      </Section>

      <Section title="Drill down">
        <div className="space-y-3">
          <Tabs<Drill>
            value={drill}
            onChange={setDrill}
            tabs={[
              { id: 'source', label: 'Source / medium' },
              { id: 'campaign', label: 'UTM campaign' },
              { id: 'referrer', label: 'Referrer domain' },
            ]}
          />
          <Table
            key={drill}
            rows={rows}
            cols={drillCols(drill === 'source' ? 'Source / medium' : drill === 'campaign' ? 'Campaign' : 'Referrer', drill === 'referrer')}
            rowKey={r => r.key}
            empty={drill === 'campaign' ? 'No UTM-tagged visits or orders in this period' : drill === 'referrer' ? 'No visits from other sites in this period' : 'No data'}
          />
        </div>
      </Section>

      <Note>
        Sessions are grouped by how they landed (click id, UTM tags, else the referring site). Orders and revenue come
        from each order&apos;s own last ad click or UTM-tagged visit within 90 days, as on the Sources report, so an
        order with no tag counts as Direct. Social posts carry utm_campaign=social_&lt;id&gt;. Referrer orders are the
        ones tracked in those sessions.
      </Note>
    </div>
  )
}
