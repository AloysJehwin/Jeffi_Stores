'use client'

import { useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useHasScope } from '@/contexts/AdminScopesContext'
import { ap } from '@/lib/shared/admin-path'
import type { DashboardAnalytics, AnalyticsRange } from '@/lib/queries'
import {
  PageHeader,
  Kpi,
  Section,
  ChartCard,
  TrendChart,
  DonutSplit,
  RankedBars,
  FunnelBar,
  LinkedLegend,
  MiniStat,
  ListRows,
  GroupLabel,
  StatusBadge,
  ORDER_STATUS,
  rs,
  rsCompact,
  pctStr,
  numStr,
} from '@/components/admin/kit'
import OpsInsights from './OpsInsights'
import ProductInsights from './ProductInsights'
import GrowthInsights from './GrowthInsights'
import { SectionLink } from './SectionLink'

const RANGES: { key: AnalyticsRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
]

interface DashboardMetrics {
  funnel: {
    pending: number
    processing: number
    shipped: number
    outForDelivery: number
    delivered: number
    cancelled: number
  }
  topProducts: { id: string; name: string; qty: number; revenue: number }[]
  recentOrders: any[]
}

// Whole-percent deltas from the API become fractions for Kpi.
const frac = (v: number | null | undefined) => (v == null ? null : v / 100)

/**
 * Interactive analytics section of the admin dashboard. `ops` renders under the header
 * (support alert + quick actions); `footer` renders last (my tasks + needs attention).
 * Range switches refetch /api/admin/dashboard/analytics; both slots stay static.
 */
export default function AnalyticsDashboardClient({
  initial,
  metrics,
  host,
  username,
  ops,
  footer,
}: {
  initial: DashboardAnalytics
  metrics: DashboardMetrics
  host: string
  username: string
  ops?: ReactNode
  footer?: ReactNode
}) {
  const canFinancial = useHasScope('financial:read')
  const canInventory = useHasScope('inventory:read')
  const canReturns = useHasScope('returns:read')
  const canTraffic = useHasScope('traffic:read')
  const [data, setData] = useState<DashboardAnalytics>(initial)
  const [range, setRange] = useState<AnalyticsRange>(initial.range)
  const [loading, setLoading] = useState(false)

  const changeRange = useCallback(
    async (r: AnalyticsRange) => {
      if (r === range || loading) return
      setRange(r)
      setLoading(true)
      try {
        const res = await fetch(`/api/admin/dashboard/analytics?range=${r}`, { credentials: 'include' })
        if (res.ok) {
          const j = await res.json()
          if (j.analytics) setData(j.analytics)
        }
      } catch {
        /* keep previous data */
      } finally {
        setLoading(false)
      }
    },
    [range, loading]
  )

  const k = data.kpis
  const { money, conversion } = data.insights
  const totalPay = data.payment.online + data.payment.cod + data.payment.other
  const activeBuyers = data.customerSplit.newCustomers + data.customerSplit.returningCustomers
  const repeatRate = activeBuyers > 0 ? (data.customerSplit.returningCustomers / activeBuyers) * 100 : null

  const rangeBar = (
    <div className="max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="inline-flex h-control gap-0.5 p-0.5 bg-surface-elevated border border-border-default rounded-lg">
        {RANGES.map(r => (
          <button
            key={r.key}
            type="button"
            onClick={() => changeRange(r.key)}
            disabled={loading}
            className={`flex items-center px-2.5 sm:px-3 text-xs font-medium rounded-md disabled:opacity-50 whitespace-nowrap ${
              range === r.key ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="space-y-5">
      <PageHeader title={`Welcome back, ${username}`} description={`Store at a glance, ${data.rangeLabel.toLowerCase()}`} actions={rangeBar} />

      {ops}

      <div className={`space-y-5 transition-opacity ${loading ? 'opacity-60' : ''}`}>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <Kpi label="Revenue" value={rs(k.revenue)} sub={`Prev: ${rs(k.revenuePrev)}`} delta={frac(k.revenuePct)} highlight href={canFinancial ? ap('/admin/financial', host) : undefined} />
          <Kpi label="Orders" value={numStr(k.orders)} sub={`Prev: ${numStr(k.ordersPrev)}`} delta={frac(k.ordersPct)} href={ap('/admin/orders', host)} />
          <Kpi label="Avg Order Value" value={rs(k.aov)} sub={`Prev: ${rs(k.aovPrev)}`} delta={frac(k.aovPct)} href={canFinancial ? ap('/admin/financial', host) : undefined} />
          <Kpi label="Customers" value={numStr(k.customers)} sub={`Prev: ${numStr(k.customersPrev)}`} delta={frac(k.customersPct)} href={ap('/admin/customers', host)} />
          {canFinancial ? (
            <Kpi
              label="Gross Margin"
              value={rsCompact(money.gross)}
              sub={money.marginPct != null ? `${pctStr(money.marginPct)} of revenue, prev ${pctStr(money.marginPctPrev)}` : 'No paid revenue yet'}
              delta={frac(money.grossPct)}
              href={ap('/admin/financial', host)}
            />
          ) : (
            <Kpi
              label="Paid Orders"
              value={numStr(conversion.paidOrders)}
              sub={`Prev: ${numStr(conversion.paidOrdersPrev)}`}
              delta={
                conversion.paidOrdersPrev
                  ? (conversion.paidOrders - conversion.paidOrdersPrev) / conversion.paidOrdersPrev
                  : null
              }
              href={ap('/admin/orders', host)}
            />
          )}
          <Kpi label="Units Sold" value={numStr(Math.round(money.units))} sub={`Prev: ${numStr(Math.round(money.unitsPrev))}`} delta={frac(money.unitsPct)} href={ap('/admin/products', host)} />
          <Kpi
            label="Conversion"
            value={pctStr(conversion.rate, 2)}
            sub={`online paid orders per ${numStr(conversion.sessions)} sessions`}
            delta={frac(conversion.ratePct)}
            href={canTraffic ? ap('/admin/traffic', host) : undefined}
          />
          <Kpi label="Repeat Rate" value={pctStr(repeatRate, 0)} sub={`${numStr(data.customerSplit.returningCustomers)} returning of ${numStr(activeBuyers)} buyers`} href={ap('/admin/customers', host)} />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <ChartCard title="Revenue & Orders" action={<SectionLink href={ap('/admin/orders', host)} label="Orders" />}>
              <div className="hidden sm:block">
                <TrendChart points={data.trend} bucket={data.trendBucket} />
              </div>
              <div className="sm:hidden flex gap-4 py-2">
                <div className="flex-1 text-center">
                  <p className="text-xs text-foreground-muted">Revenue</p>
                  <p className="text-base font-bold text-accent-600">{rs(k.revenue)}</p>
                </div>
                <div className="flex-1 text-center">
                  <p className="text-xs text-foreground-muted">Orders</p>
                  <p className="text-base font-bold text-foreground">{k.orders}</p>
                </div>
              </div>
            </ChartCard>
          </div>
          <ChartCard title="Payment Split" action={<SectionLink href={canFinancial ? ap('/admin/financial', host) : undefined} label="Ledger" />}>
            <DonutSplit
              size={130}
              centerValue={rs(totalPay)}
              centerLabel="collected"
              segments={[
                { label: 'Online', value: data.payment.online, color: 'rgb(59 130 246)' },
                { label: 'COD', value: data.payment.cod, color: 'rgb(245 158 11)' },
                ...(data.payment.other > 0 ? [{ label: 'Other', value: data.payment.other, color: 'rgb(148 163 184)' }] : []),
              ]}
            />
            <LinkedLegend
              items={[
                { label: 'Online', value: rs(data.payment.online), color: 'rgb(59 130 246)', href: ap('/admin/orders', host) },
                { label: 'COD', value: rs(data.payment.cod), color: 'rgb(245 158 11)', href: ap('/admin/orders', host) },
              ]}
            />
            {data.payment.codOutstanding > 0 && (
              <div className="mt-3 pt-3 border-t border-border-default">
                <MiniStat
                  label={`COD outstanding (${data.payment.codOutstandingCount})`}
                  value={rs(data.payment.codOutstanding)}
                  tone="text-amber-600 dark:text-amber-400"
                  href={canFinancial ? ap('/admin/financial', host) : undefined}
                />
              </div>
            )}
          </ChartCard>
        </div>

        <Section title="Order Funnel" action={<SectionLink href={ap('/admin/orders', host)} label="All orders" />}>
          <FunnelBar
            counts={{
              pending: metrics.funnel.pending,
              processing: metrics.funnel.processing,
              shipped: metrics.funnel.shipped,
              out_for_delivery: metrics.funnel.outForDelivery,
              delivered: metrics.funnel.delivered,
              cancelled: metrics.funnel.cancelled,
            }}
            hrefFor={key => ap(`/admin/orders?status=${key}`, host)}
          />
        </Section>

        <GroupLabel title="Fulfilment & service" hint="how fast and how cleanly orders move" />
        <OpsInsights data={data} host={host} />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <ChartCard title="Top Categories" action={<SectionLink href={ap('/admin/categories', host)} label="Categories" />}>
            <RankedBars items={data.topCategories.map(c => ({ name: c.name, value: c.revenue, sub: rs(c.revenue) }))} />
          </ChartCard>
          <ChartCard title="Top Brands" action={<SectionLink href={ap('/admin/brands', host)} label="Brands" />}>
            <RankedBars items={data.topBrands.map(b => ({ name: b.name, value: b.revenue, sub: rs(b.revenue) }))} barClass="bg-violet-500" />
          </ChartCard>
          <ChartCard title="Buyer Mix" action={<SectionLink href={ap('/admin/business/customers', host)} label="Business" />}>
            <DonutSplit
              size={130}
              centerValue={rs(data.buyerSplit.businessRevenue + data.buyerSplit.consumerRevenue)}
              centerLabel="revenue"
              segments={[
                { label: `Business (${data.buyerSplit.business})`, value: data.buyerSplit.businessRevenue, color: '#7cb900' },
                { label: `Consumer (${data.buyerSplit.consumer})`, value: data.buyerSplit.consumerRevenue, color: 'rgb(59 130 246)' },
              ]}
            />
          </ChartCard>
        </div>

        <GroupLabel title="Product intelligence" hint="what sells, what sits, what customers want" />
        <ProductInsights data={data} host={host} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Section title="Top Products" action={<SectionLink href={ap('/admin/products', host)} label="All products" />}>
            <ListRows
              rows={metrics.topProducts.map((p, i) => ({
                key: p.id,
                primary: `${i + 1}. ${p.name}`,
                value: `${p.qty} sold, ${rs(p.revenue)}`,
                href: ap(`/admin/products/${p.id}/edit`, host),
              }))}
            />
          </Section>
          <Section title="Recent Orders" action={<SectionLink href={ap('/admin/orders', host)} label="All orders" />}>
            <ListRows
              rows={metrics.recentOrders.map((o: any) => ({
                key: o.id,
                primary: `#${o.order_number || o.id.slice(0, 8)}`,
                secondary: o.users?.first_name ? `${o.users.first_name} ${o.users.last_name || ''}`.trim() : o.customer_name || 'Guest',
                value: rs(Number(o.total_amount)),
                badge: <StatusBadge status={o.status} map={ORDER_STATUS} />,
                href: ap(`/admin/orders/${o.id}/view`, host),
              }))}
            />
          </Section>
        </div>

        <GroupLabel title="Growth, customers & cash" hint="where demand comes from and where money sits" />
        <GrowthInsights data={data} host={host} />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {canInventory && (
            <Section title="Stock Status" action={<SectionLink href={ap('/admin/inventory', host)} label="Inventory" />}>
              <div className="space-y-0.5">
                <MiniStat label="In stock" value={String(data.inventory.inStock)} tone="text-green-600 dark:text-green-400" href={ap('/admin/inventory', host)} />
                <MiniStat label="Low stock" value={String(data.inventory.lowStock)} tone="text-amber-600 dark:text-amber-400" href={ap('/admin/inventory', host)} />
                <MiniStat label="Out of stock" value={String(data.inventory.outOfStock)} tone="text-red-500" href={ap('/admin/inventory', host)} />
                <MiniStat label="Inventory value" value={rs(data.inventory.stockValue)} href={canFinancial ? ap('/admin/financial', host) : undefined} />
              </div>
            </Section>
          )}
          <ChartCard title="Customer Split" action={<SectionLink href={ap('/admin/customers', host)} label="Customers" />}>
            <DonutSplit
              size={130}
              centerValue={numStr(activeBuyers)}
              centerLabel="active"
              segments={[
                { label: 'New', value: data.customerSplit.newCustomers, color: 'rgb(16 185 129)' },
                { label: 'Returning', value: data.customerSplit.returningCustomers, color: 'rgb(59 130 246)' },
              ]}
            />
          </ChartCard>
          {canReturns && (
            <Section title="Returns & RTO" action={<SectionLink href={ap('/admin/returns', host)} label="Returns" />}>
              <div className="space-y-0.5">
                <MiniStat label="Return requests" value={String(data.returns.total)} href={ap('/admin/returns', host)} />
                <MiniStat label="RTO in transit" value={String(data.returns.rtoInTransit)} tone="text-amber-600 dark:text-amber-400" href={ap('/admin/returns', host)} />
                <MiniStat label="RTO delivered back" value={String(data.returns.rtoDelivered)} tone="text-red-500" href={ap('/admin/returns', host)} />
              </div>
            </Section>
          )}
        </div>
      </div>

      {footer}
    </div>
  )
}
