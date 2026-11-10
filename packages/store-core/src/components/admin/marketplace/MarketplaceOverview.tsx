'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge, Kpi, KpiGrid, Section, Table, api, count, money, when, type Col } from '@/components/admin/kit/core'
import { ErrorState } from '@/components/admin/kit/states'
import type { MarketplaceEventRow, MarketplaceOverview as Overview } from '@/lib/marketplace/console'
import { CHANNEL_NAME, type Channel } from './queue-shared'
import { MarketplaceOverviewLoading } from './skeletons'

// Overview tab: today's and the week's orders, what needs action (accept, SLA, dispatch, returns),
// and the last pushes from the marketplace.

const EVENT_TONE: Record<string, 'green' | 'amber' | 'red' | 'muted'> = { done: 'green', pending: 'amber', failed: 'red', ignored: 'muted' }

export default function MarketplaceOverview({ channel }: { channel: Channel }) {
  const name = CHANNEL_NAME[channel]
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await api<Overview>(`/api/admin/${channel}/console`)
    if (r.ok) {
      setData(r.data)
      setError(null)
    } else setError(r.data.error || 'Could not load the overview')
  }, [channel])
  useEffect(() => {
    load()
  }, [load])

  if (error) return <ErrorState body={error} />
  if (!data) return <MarketplaceOverviewLoading />
  const k = data.kpis

  const cols: Col<MarketplaceEventRow>[] = [
    { key: 'at', label: 'Received', render: e => <span className="text-xs text-foreground-muted">{when(e.received_at)}</span> },
    { key: 'type', label: 'Event', render: e => <span className="text-foreground">{e.event_type ?? '-'}</span> },
    { key: 'order', label: 'Order', render: e => e.external_order_id ?? '-' },
    {
      key: 'status',
      label: 'Status',
      render: e => (
        <span title={e.last_error ?? ''}>
          <Badge tone={EVENT_TONE[e.status] ?? 'muted'}>{e.status}</Badge>
          {e.source !== 'push' && <span className="ml-1 text-xs text-foreground-muted">{e.source}</span>}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi label="Orders today" value={count(k.ordersToday)} />
        <Kpi label="Orders, 7 days" value={count(k.orders7d)} sub={`${money(k.sales7d)} sales`} />
        <Kpi label="Awaiting accept" value={count(k.awaitingAccept)} highlight={k.awaitingAccept > 0} />
        <Kpi label="Breaching SLA" value={count(k.breachingSla)} highlight={k.breachingSla > 0} sub="Past accept-by or dispatch-by" />
        <Kpi label="RTD pending" value={count(k.rtdPending)} sub="Accepted, not yet ready to dispatch" />
        <Kpi label="Returns open" value={count(k.returnsOpen)} />
      </KpiGrid>

      {(k.stockIssues > 0 || data.failedEvents > 0) && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-foreground">
          {k.stockIssues > 0 && <p>{k.stockIssues} order{k.stockIssues === 1 ? '' : 's'} could not move stock (short or SKU not matched).</p>}
          {data.failedEvents > 0 && <p>{data.failedEvents} pushed event{data.failedEvents === 1 ? '' : 's'} failed to process. See Alerts.</p>}
        </div>
      )}

      <Section title="Recent pushes">
        <p className="mb-3 text-xs text-foreground-muted">
          Last push from {name}: {data.lastPushAt ? when(data.lastPushAt) : 'none yet'}
          {data.pendingEvents > 0 && ` · ${data.pendingEvents} waiting to be processed`}
        </p>
        <Table rows={data.recentEvents} cols={cols} rowKey={e => e.id} empty={`No events from ${name} yet.`} />
      </Section>
    </div>
  )
}
