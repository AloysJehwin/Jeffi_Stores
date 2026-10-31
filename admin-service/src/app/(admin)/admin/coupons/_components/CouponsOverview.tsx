'use client'

import Link from 'next/link'
import { ListFilters, useFilterQuery } from '@/components/admin/kit'
import { COUPON_ALIASES, COUPON_FIELDS, COUPON_SEARCH } from '@/lib/filters/fields/coupons'
import {
  AttentionList,
  OverviewSkeleton,
  PeriodBar,
  useOverviewData,
  usePeriod,
  type AttentionItem,
} from '@/components/admin/overview/kit'
import { Badge, Banner, Kpi, KpiGrid, Section, Table, count, money, pct, when } from '@/components/admin/channels/ui'
import { TrendChart, RankedBars, type SeriesDef } from '@/components/admin/dashboard/Charts'
import { delta, type Bucket } from '@/lib/overview/period'
import type { CouponState, CouponTotals } from '@/lib/overviews/coupons'
import { ap } from '@/lib/shared/admin-path'

interface TopCoupon {
  id: string
  code: string
  source: string
  redemptions: number
  customers: number
  discount: number
  revenue: number
}
interface Data {
  bucket: Bucket
  current: CouponTotals
  previous_totals: CouponTotals
  series: { label: string; redemptions: number; discount: number }[]
  top: TopCoupon[]
  sources: { source: string; redemptions: number; discount: number }[]
  state: CouponState
  expiring: { id: string; code: string; valid_until: string; times_used: number; usage_limit: number | null }[]
  unused: { id: string; code: string; created_at: string }[]
  attention: AttentionItem[]
}

const SERIES: SeriesDef[] = [
  { key: 'discount', label: 'Discount given', color: 'rgb(224 123 63)', kind: 'bar', axis: 'money', on: true },
  { key: 'redemptions', label: 'Redemptions', color: 'rgb(59 130 246)', kind: 'line', axis: 'count', on: true },
]

const view = (id: string) => ap(`/admin/coupons/${id}/view`)

export default function CouponsOverview() {
  const [period, setPeriod] = usePeriod()
  // KPIs and charts follow the list's filters; the PeriodBar owns from / to.
  const filters = useFilterQuery(COUPON_FIELDS, { aliases: COUPON_ALIASES, omit: ['from', 'to'] })
  const { data, error, loading, reload } = useOverviewData<Data>(
    `/api/admin/coupons/overview?from=${period.from}&to=${period.to}${filters ? `&${filters}` : ''}`
  )
  const c = data?.current
  const p = data?.previous_totals

  return (
    <div className="space-y-4">
      <PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} />
      <ListFilters
        entity="coupons"
        fields={COUPON_FIELDS}
        aliases={COUPON_ALIASES}
        search={COUPON_SEARCH}
        period
        noun="Coupons"
        tab="overview"
      />
      {error && <Banner ok={false}>{error}</Banner>}
      {loading || !data || !c || !p ? (
        !error && <OverviewSkeleton />
      ) : (
        <>
          <KpiGrid>
            <Kpi
              label="Redemptions"
              value={count(c.redemptions)}
              delta={delta(c.redemptions, p.redemptions)}
              sub={`${count(c.customers)} customers`}
            />
            <Kpi label="Discount given" value={money(c.discount)} delta={delta(c.discount, p.discount)} invert />
            <Kpi
              label="Revenue with coupon"
              value={money(c.coupon_revenue)}
              delta={delta(c.coupon_revenue, p.coupon_revenue)}
              sub={`${count(c.coupon_orders)} orders`}
              highlight
            />
            <Kpi
              label="Discount rate"
              value={pct(c.discount_rate)}
              delta={delta(c.discount_rate, p.discount_rate)}
              invert
              sub="of the price on coupon orders"
            />
            <Kpi
              label="Orders with coupon"
              value={pct(c.order_share)}
              delta={delta(c.order_share, p.order_share)}
              sub={`${pct(c.revenue_share)} of revenue`}
            />
            <Kpi
              label="Active coupons"
              value={count(data.state.active)}
              sub={`${count(data.state.expiring)} expiring in 7 days`}
            />
          </KpiGrid>

          <AttentionList items={data.attention.map(a => ({ ...a, href: a.href && ap(a.href) }))} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Section title="Redemptions and discount">
                <TrendChart
                  points={data.series}
                  series={SERIES}
                  bucket={data.bucket}
                  height={220}
                  ariaLabel="Coupon redemptions and discount over time"
                />
              </Section>
            </div>
            <Section title="By source">
              {data.sources.length ? (
                <RankedBars
                  items={data.sources.map(s => ({
                    name: s.source === 'manual' ? 'Manual' : s.source === 'auto' ? 'Auto-generated' : s.source,
                    value: s.redemptions,
                    sub: money(s.discount),
                  }))}
                  unit="uses"
                />
              ) : (
                <p className="text-sm text-foreground-muted">No redemptions in this period.</p>
              )}
            </Section>
          </div>

          <Section
            title="Top coupons"
            action={
              <Link href={ap('/admin/coupons?tab=list')} className="text-xs text-accent-500 hover:underline">
                All coupons
              </Link>
            }
          >
            <Table
              rows={data.top}
              rowKey={r => r.id}
              empty="No coupons used in this period."
              cols={[
                {
                  key: 'code',
                  label: 'Code',
                  render: r => (
                    <Link href={view(r.id)} className="font-mono text-accent-500 hover:underline">
                      {r.code}
                    </Link>
                  ),
                },
                {
                  key: 'source',
                  label: 'Source',
                  render: r => <Badge tone={r.source === 'manual' ? 'muted' : 'blue'}>{r.source}</Badge>,
                },
                { key: 'uses', label: 'Uses', num: true, render: r => count(r.redemptions), sort: r => r.redemptions },
                { key: 'cust', label: 'Customers', num: true, render: r => count(r.customers), sort: r => r.customers },
                { key: 'disc', label: 'Discount', num: true, render: r => money(r.discount), sort: r => r.discount },
                { key: 'rev', label: 'Revenue', num: true, render: r => money(r.revenue), sort: r => r.revenue },
              ]}
            />
          </Section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section title="Expiring within 7 days">
              <Table
                rows={data.expiring}
                rowKey={r => r.id}
                empty="Nothing expires this week."
                cols={[
                  {
                    key: 'code',
                    label: 'Code',
                    render: r => (
                      <Link href={view(r.id)} className="font-mono text-accent-500 hover:underline">
                        {r.code}
                      </Link>
                    ),
                  },
                  { key: 'until', label: 'Expires', render: r => when(r.valid_until) },
                  {
                    key: 'used',
                    label: 'Used',
                    num: true,
                    render: r => `${count(r.times_used)}${r.usage_limit ? ` / ${count(r.usage_limit)}` : ''}`,
                  },
                ]}
              />
            </Section>
            <Section title="Never used (14+ days)">
              <Table
                rows={data.unused}
                rowKey={r => r.id}
                empty="Every active coupon has been used."
                cols={[
                  {
                    key: 'code',
                    label: 'Code',
                    render: r => (
                      <Link href={view(r.id)} className="font-mono text-accent-500 hover:underline">
                        {r.code}
                      </Link>
                    ),
                  },
                  { key: 'created', label: 'Created', render: r => when(r.created_at) },
                ]}
              />
            </Section>
          </div>
        </>
      )}
    </div>
  )
}
