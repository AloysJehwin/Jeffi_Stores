'use client'

import {
  Kpi,
  KpiGrid,
  Section,
  Banner,
  Table,
  Badge,
  count,
  money,
  pct,
  when,
  type Tone,
} from '@/components/admin/channels/ui'
import {
  AttentionList,
  OverviewSkeleton,
  PeriodBar,
  useOverviewData,
  usePeriod,
  type AttentionItem,
} from '@/components/admin/overview/kit'
import { TrendChart, type SeriesDef } from '@/components/admin/dashboard/Charts'
import { delta, type Bucket, type Period } from '@/lib/overview/period'
import { fmtDays, withAp } from '../../orders/_components/overview-shared'

interface Kpis {
  shipments: number
  shippedValue: number
  delivered: number
  transitDays: number | null
  onTimeRate: number | null
  rto: number
  rtoRate: number | null
  freight: number
  billed: number
  freightPerOrder: number | null
  extraCharges: number
  weightDisputes: number
  codCollected: number
  codCollectedOrders: number
  codRemitted: number
  codRemittedOrders: number
  pickupRequests: number
  pickupAwbs: number
  pickupsPickedUp: number
  pickupsFailed: number
}

interface Data {
  period: Period
  previous: Period
  bucket: Bucket
  kpis: { current: Kpis; previous: Kpis }
  snapshot: {
    inTransit: number
    ndr: number
    overdue: number
    rtoOpen: number
    awaitingPickupRequest: number
    pendingPickups: number
    missedPickups: number
    codUnremitted: number
    codUnremittedValue: number
  }
  series: { label: string; shipped: number; delivered: number }[]
  zones: {
    zone: string
    label: string
    delivered: number
    avgDays: number | null
    promisedDays: number
    withinPromise: number | null
  }[]
  pickups: {
    id: string
    pickupId: string | null
    pickupDate: string
    awbCount: number
    status: string
    createdAt: string
  }[]
  attention: AttentionItem[]
}

const SERIES: SeriesDef[] = [
  { key: 'shipped', label: 'Shipped', color: 'rgb(59 130 246)', kind: 'bar', axis: 'count', on: true },
  { key: 'delivered', label: 'Delivered', color: 'rgb(16 185 129)', kind: 'line', axis: 'count', on: true },
]

const PICKUP_TONE: Record<string, Tone> = { pending: 'amber', failed: 'red', rescheduled: 'blue', picked_up: 'green' }

export default function DelhiveryOverview() {
  const [period, setPeriod] = usePeriod()
  const { data, error, loading, reload } = useOverviewData<Data>(
    `/api/admin/delhivery/overview?from=${period.from}&to=${period.to}`
  )
  return (
    <div className="space-y-4">
      <PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} />
      {error && <Banner ok={false}>{error}</Banner>}
      {loading && !data ? <OverviewSkeleton /> : data ? <Body d={data} /> : null}
    </div>
  )
}

function Body({ d }: { d: Data }) {
  const c = d.kpis.current
  const p = d.kpis.previous
  const s = d.snapshot
  return (
    <>
      <KpiGrid>
        <Kpi label="Shipments" value={count(c.shipments)} delta={delta(c.shipments, p.shipments)} highlight />
        <Kpi label="Delivered" value={count(c.delivered)} delta={delta(c.delivered, p.delivered)} />
        <Kpi
          label="In transit now"
          value={count(s.inTransit)}
          sub={s.overdue ? `${count(s.overdue)} past promised date` : undefined}
        />
        <Kpi label="Failed attempts (NDR)" value={count(s.ndr)} sub="Open now" />
        <Kpi
          label="RTO rate"
          value={pct(c.rtoRate)}
          delta={delta(c.rtoRate, p.rtoRate)}
          invert
          sub={`${count(c.rto)} RTO, ${count(s.rtoOpen)} still returning`}
        />
        <Kpi
          label="Time in transit"
          value={fmtDays(c.transitDays)}
          delta={delta(c.transitDays, p.transitDays)}
          invert
        />
        <Kpi
          label="On time"
          value={pct(c.onTimeRate)}
          delta={delta(c.onTimeRate, p.onTimeRate)}
          sub="By the promised date"
        />
        <Kpi
          label="Freight per order"
          value={money(c.freightPerOrder)}
          delta={delta(c.freightPerOrder, p.freightPerOrder)}
          invert
          sub={`${count(c.billed)} billed`}
        />
        <Kpi
          label="Freight billed"
          value={money(c.freight)}
          delta={delta(c.freight, p.freight)}
          invert
          sub={c.extraCharges ? `${money(c.extraCharges)} extra weight` : undefined}
        />
        <Kpi
          label="COD collected"
          value={money(c.codCollected)}
          delta={delta(c.codCollected, p.codCollected)}
          sub={`${count(c.codCollectedOrders)} orders`}
        />
        <Kpi
          label="COD remitted"
          value={money(c.codRemitted)}
          delta={delta(c.codRemitted, p.codRemitted)}
          sub={`${money(s.codUnremittedValue)} outstanding`}
        />
        <Kpi
          label="Pickup requests"
          value={count(c.pickupRequests)}
          delta={delta(c.pickupRequests, p.pickupRequests)}
          sub={`${count(c.pickupAwbs)} AWBs, ${count(c.pickupsFailed)} failed`}
        />
      </KpiGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <AttentionList items={withAp(d.attention)} />
        <Section title="Pickups not yet collected">
          <p className="text-xs text-foreground-muted mb-3">
            {count(s.awaitingPickupRequest)} shipments have an AWB but no pickup request. {count(s.pendingPickups)}{' '}
            requests pending
            {s.missedPickups ? `, ${count(s.missedPickups)} past their date` : ''}.
          </p>
          <Table
            rows={d.pickups}
            rowKey={r => r.id}
            empty="Every pickup request has been collected."
            pageSize={8}
            cols={[
              { key: 'date', label: 'Pickup date', render: r => r.pickupDate },
              { key: 'id', label: 'Request', render: r => r.pickupId ?? '-' },
              { key: 'awbs', label: 'AWBs', num: true, render: r => count(r.awbCount) },
              {
                key: 'status',
                label: 'Status',
                render: r => <Badge tone={PICKUP_TONE[r.status] ?? 'muted'}>{r.status.replace(/_/g, ' ')}</Badge>,
              },
              { key: 'created', label: 'Raised', render: r => when(r.createdAt) },
            ]}
          />
        </Section>
      </div>

      <Section title="Shipped and delivered">
        <TrendChart
          points={d.series}
          series={SERIES}
          bucket={d.bucket}
          height={220}
          ariaLabel="Shipments and deliveries over the period"
        />
      </Section>

      <Section title="Delivery time by zone">
        <Table
          rows={d.zones}
          rowKey={r => r.zone}
          empty="No deliveries in this period."
          cols={[
            { key: 'zone', label: 'Zone', render: r => r.label },
            {
              key: 'delivered',
              label: 'Delivered',
              num: true,
              render: r => count(r.delivered),
              sort: r => r.delivered,
            },
            { key: 'avg', label: 'Avg days', num: true, render: r => fmtDays(r.avgDays), sort: r => r.avgDays ?? -1 },
            { key: 'promised', label: 'Promised', num: true, render: r => `${r.promisedDays} days` },
            {
              key: 'within',
              label: 'Within promise',
              num: true,
              render: r => (
                <span className={r.withinPromise != null && r.withinPromise < 0.9 ? 'text-red-500' : ''}>
                  {pct(r.withinPromise)}
                </span>
              ),
              sort: r => r.withinPromise ?? -1,
            },
          ]}
        />
        <p className="mt-2 text-xs text-foreground-muted">
          Zones and promised days come from the delivery estimate settings.
        </p>
      </Section>
    </>
  )
}
