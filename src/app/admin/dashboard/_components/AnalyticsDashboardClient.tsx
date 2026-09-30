'use client'

import { useState, useCallback } from 'react'
import { StatCard } from '@/components/admin/dashboard/StatCard'
import { useHasScope } from '@/contexts/AdminScopesContext'
import { TrendChart, DonutSplit, RankedBars } from '@/components/admin/dashboard/Charts'
import { ap } from '@/lib/shared/admin-path'
import type { DashboardAnalytics, AnalyticsRange } from '@/lib/queries'
import type { ReactNode } from 'react'
import OpsInsights from './OpsInsights'
import ProductInsights from './ProductInsights'
import GrowthInsights from './GrowthInsights'
import {
  Icon,
  GroupLabel,
  SectionHeader,
  SectionCard,
  MiniStat,
  ListRows,
  LinkedLegend,
  FunnelBar,
  statusBadgeClass,
  statusLabel,
  rs,
  rsCompact,
  pctStr,
  numStr,
} from '@/components/admin/dashboard/Primitives'

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

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">Welcome back, {username}</h1>
          <p className="text-sm text-foreground-secondary mt-0.5">Store at a glance, {data.rangeLabel.toLowerCase()}</p>
        </div>
        <div className="flex items-center bg-surface-secondary border border-border-default rounded-xl p-1 gap-0.5 self-start shrink-0">
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
      </div>

      {ops}

      <div className={`space-y-4 sm:space-y-6 transition-opacity ${loading ? 'opacity-60' : ''}`}>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
          <StatCard
            label="Revenue"
            value={rs(k.revenue)}
            sub={`Prev: ${rs(k.revenuePrev)}`}
            pct={k.revenuePct}
            color="bg-accent-500/10 text-accent-600"
            href={canFinancial ? ap('/admin/financial', host) : undefined}
            icon={
              <Icon
                cls="text-accent-600"
                d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            }
          />
          <StatCard
            label="Orders"
            value={numStr(k.orders)}
            sub={`Prev: ${numStr(k.ordersPrev)}`}
            pct={k.ordersPct}
            color="bg-blue-500/10 text-blue-600 dark:text-blue-400"
            href={ap('/admin/orders', host)}
            icon={<Icon cls="text-blue-600 dark:text-blue-400" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />}
          />
          <StatCard
            label="Avg Order Value"
            value={rs(k.aov)}
            sub={`Prev: ${rs(k.aovPrev)}`}
            pct={k.aovPct}
            color="bg-amber-500/10 text-amber-600 dark:text-amber-400"
            href={canFinancial ? ap('/admin/financial', host) : undefined}
            icon={<Icon cls="text-amber-600 dark:text-amber-400" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />}
          />
          <StatCard
            label="Customers"
            value={numStr(k.customers)}
            sub={`Prev: ${numStr(k.customersPrev)}`}
            pct={k.customersPct}
            color="bg-violet-500/10 text-violet-600 dark:text-violet-400"
            href={ap('/admin/customers', host)}
            icon={
              <Icon
                cls="text-violet-600 dark:text-violet-400"
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
              />
            }
          />
          {canFinancial ? (
            <StatCard
              label="Gross Margin"
              value={rsCompact(money.gross)}
              sub={
                money.marginPct != null
                  ? `${pctStr(money.marginPct)} of revenue, prev ${pctStr(money.marginPctPrev)}`
                  : 'No paid revenue yet'
              }
              pct={money.grossPct}
              color="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              href={ap('/admin/financial', host)}
              icon={
                <Icon
                  cls="text-emerald-600 dark:text-emerald-400"
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              }
            />
          ) : (
            <StatCard
              label="Paid Orders"
              value={numStr(conversion.paidOrders)}
              sub={`Prev: ${numStr(conversion.paidOrdersPrev)}`}
              pct={
                conversion.paidOrdersPrev
                  ? Math.round(((conversion.paidOrders - conversion.paidOrdersPrev) / conversion.paidOrdersPrev) * 100)
                  : null
              }
              color="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              href={ap('/admin/orders', host)}
              icon={
                <Icon cls="text-emerald-600 dark:text-emerald-400" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              }
            />
          )}
          <StatCard
            label="Units Sold"
            value={numStr(Math.round(money.units))}
            sub={`Prev: ${numStr(Math.round(money.unitsPrev))}`}
            pct={money.unitsPct}
            color="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
            href={ap('/admin/products', host)}
            icon={
              <Icon
                cls="text-cyan-600 dark:text-cyan-400"
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
              />
            }
          />
          <StatCard
            label="Conversion"
            value={pctStr(conversion.rate, 2)}
            sub={`online paid orders per ${numStr(conversion.sessions)} sessions`}
            pct={conversion.ratePct}
            color="bg-rose-500/10 text-rose-600 dark:text-rose-400"
            href={canTraffic ? ap('/admin/traffic', host) : undefined}
            icon={
              <Icon
                cls="text-rose-600 dark:text-rose-400"
                d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
              />
            }
          />
          <StatCard
            label="Repeat Rate"
            value={pctStr(repeatRate, 0)}
            sub={`${numStr(data.customerSplit.returningCustomers)} returning of ${numStr(activeBuyers)} buyers`}
            color="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
            href={ap('/admin/customers', host)}
            icon={
              <Icon
                cls="text-indigo-600 dark:text-indigo-400"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            }
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
          <SectionCard span>
            <SectionHeader title="Revenue & Orders" actionLabel="Orders" href={ap('/admin/orders', host)} />
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
                <p className="text-base font-bold text-blue-600">{k.orders}</p>
              </div>
            </div>
          </SectionCard>
          <SectionCard>
            <SectionHeader
              title="Payment Split"
              actionLabel="Ledger"
              href={canFinancial ? ap('/admin/financial', host) : undefined}
            />
            <DonutSplit
              size={130}
              centerValue={rs(totalPay)}
              centerLabel="collected"
              segments={[
                { label: 'Online', value: data.payment.online, color: 'rgb(59 130 246)' },
                { label: 'COD', value: data.payment.cod, color: 'rgb(245 158 11)' },
                ...(data.payment.other > 0
                  ? [{ label: 'Other', value: data.payment.other, color: 'rgb(148 163 184)' }]
                  : []),
              ]}
            />
            <LinkedLegend
              items={[
                {
                  label: 'Online',
                  value: rs(data.payment.online),
                  color: 'rgb(59 130 246)',
                  href: ap('/admin/orders', host),
                },
                {
                  label: 'COD',
                  value: rs(data.payment.cod),
                  color: 'rgb(245 158 11)',
                  href: ap('/admin/orders', host),
                },
              ]}
            />
            {data.payment.codOutstanding > 0 && (
              <div className="mt-3 pt-3 border-t border-border-default">
                <MiniStat
                  label={`COD outstanding (${data.payment.codOutstandingCount})`}
                  value={rs(data.payment.codOutstanding)}
                  tone="text-orange-600 dark:text-orange-400"
                  href={canFinancial ? ap('/admin/financial', host) : undefined}
                />
              </div>
            )}
          </SectionCard>
        </div>

        <SectionCard>
          <SectionHeader title="Order Funnel" actionLabel="All orders" href={ap('/admin/orders', host)} />
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
        </SectionCard>

        <GroupLabel title="Fulfilment & service" hint="how fast and how cleanly orders move" />
        <OpsInsights data={data} host={host} />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          <SectionCard href={ap('/admin/categories', host)}>
            <SectionHeader title="Top Categories" />
            <RankedBars items={data.topCategories.map(c => ({ name: c.name, value: c.revenue, sub: rs(c.revenue) }))} />
          </SectionCard>
          <SectionCard href={ap('/admin/brands', host)}>
            <SectionHeader title="Top Brands" />
            <RankedBars
              items={data.topBrands.map(b => ({ name: b.name, value: b.revenue, sub: rs(b.revenue) }))}
              barClass="bg-violet-500"
            />
          </SectionCard>
          <SectionCard href={ap('/admin/business/customers', host)}>
            <SectionHeader title="Buyer Mix" />
            <DonutSplit
              size={130}
              centerValue={rs(data.buyerSplit.businessRevenue + data.buyerSplit.consumerRevenue)}
              centerLabel="revenue"
              segments={[
                {
                  label: `Business (${data.buyerSplit.business})`,
                  value: data.buyerSplit.businessRevenue,
                  color: '#7cb900',
                },
                {
                  label: `Consumer (${data.buyerSplit.consumer})`,
                  value: data.buyerSplit.consumerRevenue,
                  color: 'rgb(59 130 246)',
                },
              ]}
            />
          </SectionCard>
        </div>

        <GroupLabel title="Product intelligence" hint="what sells, what sits, what customers want" />
        <ProductInsights data={data} host={host} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
          <SectionCard>
            <SectionHeader title="Top Products" actionLabel="All products" href={ap('/admin/products', host)} />
            <ListRows
              rows={metrics.topProducts.map((p, i) => ({
                key: p.id,
                primary: `${i + 1}. ${p.name}`,
                value: `${p.qty} sold, ${rs(p.revenue)}`,
                href: ap(`/admin/products/edit/${p.id}`, host),
              }))}
            />
          </SectionCard>
          <SectionCard>
            <SectionHeader title="Recent Orders" actionLabel="All orders" href={ap('/admin/orders', host)} />
            <ListRows
              rows={metrics.recentOrders.map((o: any) => ({
                key: o.id,
                primary: `#${o.order_number || o.id.slice(0, 8)}`,
                secondary: o.users?.first_name
                  ? `${o.users.first_name} ${o.users.last_name || ''}`.trim()
                  : o.customer_name || 'Guest',
                value: rs(Number(o.total_amount)),
                badge: (
                  <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${statusBadgeClass(o.status)}`}>
                    {statusLabel(o.status)}
                  </span>
                ),
                href: ap(`/admin/orders/${o.id}`, host),
              }))}
            />
          </SectionCard>
        </div>

        <GroupLabel title="Growth, customers & cash" hint="where demand comes from and where money sits" />
        <GrowthInsights data={data} host={host} />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {canInventory && (
            <SectionCard>
              <SectionHeader title="Stock Status" actionLabel="Inventory" href={ap('/admin/inventory', host)} />
              <div className="space-y-0.5">
                <MiniStat
                  label="In stock"
                  value={String(data.inventory.inStock)}
                  tone="text-green-600 dark:text-green-400"
                  href={ap('/admin/inventory', host)}
                />
                <MiniStat
                  label="Low stock"
                  value={String(data.inventory.lowStock)}
                  tone="text-yellow-600 dark:text-yellow-400"
                  href={ap('/admin/inventory', host)}
                />
                <MiniStat
                  label="Out of stock"
                  value={String(data.inventory.outOfStock)}
                  tone="text-red-500 dark:text-red-400"
                  href={ap('/admin/inventory', host)}
                />
                <MiniStat
                  label="Inventory value"
                  value={rs(data.inventory.stockValue)}
                  href={canFinancial ? ap('/admin/financial', host) : undefined}
                />
              </div>
            </SectionCard>
          )}
          <SectionCard href={ap('/admin/customers', host)}>
            <SectionHeader title="Customer Split" />
            <DonutSplit
              size={130}
              centerValue={numStr(activeBuyers)}
              centerLabel="active"
              segments={[
                { label: 'New', value: data.customerSplit.newCustomers, color: 'rgb(16 185 129)' },
                { label: 'Returning', value: data.customerSplit.returningCustomers, color: 'rgb(59 130 246)' },
              ]}
            />
          </SectionCard>
          {canReturns && (
            <SectionCard>
              <SectionHeader title="Returns & RTO" actionLabel="Returns" href={ap('/admin/returns', host)} />
              <div className="space-y-0.5">
                <MiniStat
                  label="Return requests"
                  value={String(data.returns.total)}
                  href={ap('/admin/returns', host)}
                />
                <MiniStat
                  label="RTO in transit"
                  value={String(data.returns.rtoInTransit)}
                  tone="text-orange-600 dark:text-orange-400"
                  href={ap('/admin/returns', host)}
                />
                <MiniStat
                  label="RTO delivered back"
                  value={String(data.returns.rtoDelivered)}
                  tone="text-red-500 dark:text-red-400"
                  href={ap('/admin/returns', host)}
                />
              </div>
            </SectionCard>
          )}
        </div>
      </div>

      {footer}
    </div>
  )
}
