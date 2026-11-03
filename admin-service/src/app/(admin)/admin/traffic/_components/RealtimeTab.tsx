'use client'

import Link from 'next/link'
import { Badge, Kpi, KpiGrid, Section, Table, count, money, when, type Col } from '@/components/admin/channels/ui'
import type { RealtimeData } from '@/lib/traffic/types'
import { ap } from '@/lib/shared/admin-path'
import { BarSeries, HBars } from './charts'
import { Note } from './shared'

type Sess = RealtimeData['sessions'][number]
type Order = RealtimeData['orders'][number]

const ago = (iso: string, now: string) => {
  const m = Math.max(0, Math.round((Date.parse(now) - Date.parse(iso)) / 60000))
  return m === 0 ? 'now' : `${m} min ago`
}

export default function RealtimeTab({ data }: { data: RealtimeData }) {
  const sessCols: Col<Sess>[] = [
    { key: 'path', label: 'Current page', render: r => <span className="break-all">{r.path}</span> },
    { key: 'source', label: 'Source', render: r => (
      <span className="flex flex-col">
        {r.source}
        <span className="text-xs text-foreground-muted">{r.channel}</span>
      </span>
    ) },
    { key: 'device', label: 'Device', render: r => r.device },
    { key: 'pv', label: 'Pages', num: true, sort: r => r.pageviews, render: r => count(r.pageviews) },
    { key: 'seen', label: 'Last seen', num: true, sort: r => r.lastSeen, render: r => ago(r.lastSeen, data.at) },
  ]
  const orderCols: Col<Order>[] = [
    { key: 'no', label: 'Order', render: r => <Link href={ap(`/admin/orders/${r.id}`)} className="hover:text-accent-600">{r.orderNumber}</Link> },
    { key: 'total', label: 'Total', num: true, render: r => money(r.total) },
    { key: 'status', label: 'Status', render: r => <Badge tone={r.paymentStatus === 'paid' ? 'green' : 'muted'}>{r.status} · {r.paymentStatus}</Badge> },
    { key: 'source', label: 'Source', render: r => r.source },
    { key: 'at', label: 'Placed', render: r => when(r.createdAt) },
  ]
  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi label="Active sessions" value={count(data.activeSessions)} sub="Last 30 minutes" highlight />
        <Kpi label="Pageviews" value={count(data.pageviews)} sub="Last 30 minutes" />
        <Kpi label="Orders" value={count(data.orders.length)} sub="Last hour" />
        <Kpi label="Order value" value={money(data.orders.reduce((s, o) => s + o.total, 0))} sub="Last hour" />
      </KpiGrid>

      <Section title="Page views per minute">
        <BarSeries rows={data.perMinute} label={r => r.minute} series={[{ key: 'views', label: 'Views', color: '#84cc16' }]} height={100} />
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="Pages being viewed">
          <HBars empty="No one is browsing right now" rows={data.pages.map(p => ({ key: p.path, label: p.path, value: p.sessions }))} />
        </Section>
        <Section title="Where they came from">
          <HBars empty="No one is browsing right now" color="rgba(148,163,184,0.7)" rows={data.sources.map(s => ({ key: s.key, label: s.key, value: s.sessions }))} />
        </Section>
      </div>

      <Section title="Active sessions">
        <Table rows={data.sessions} cols={sessCols} rowKey={r => r.sessionId} empty="No active sessions in the last 30 minutes" />
      </Section>

      <Section title="Orders in the last hour">
        <Table rows={data.orders} cols={orderCols} rowKey={r => r.id} empty="No orders in the last hour" />
      </Section>
      <Note>Refreshes every 30 seconds while this tab is open. Updated {when(data.at)}.</Note>
    </div>
  )
}
