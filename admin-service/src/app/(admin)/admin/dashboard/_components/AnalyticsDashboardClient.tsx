'use client'

import { useState, useCallback, useRef, useMemo } from 'react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useHasScope } from '@/contexts/AdminScopesContext'
import { ap } from '@/lib/shared/admin-path'
import type { DashboardAnalytics, AnalyticsRange } from '@/lib/queries'
import { DonutSplit, RankedBars, FunnelBar, LinkedLegend, MiniStat, ListRows, GroupLabel, StatusBadge, ORDER_STATUS, rs, rsCompact, pctStr, numStr, hoursStr, delta } from '@/components/admin/kit'
import { DashCard, SegmentedPills, DeltaChip, Sparkline, CompareArea, FlowStream, WeekdayBars, DotCalendar, ActivityLegend, MetricList, ActivityDrawer } from '@/components/admin/dashboard'
import type { ActivityChannel, DashboardActivity } from '@/lib/dashboard/activity-types'
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

const WEEK_CHANNELS = [
  { value: 'all', label: 'All' },
  { value: 'online', label: 'Online' },
  { value: 'cod', label: 'COD' },
  { value: 'business', label: 'Business' },
]

const localDay = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function fetchActivity(weeks: number, channel: ActivityChannel): Promise<DashboardActivity | null> {
  try {
    const res = await fetch(`/api/admin/dashboard/activity?weeks=${weeks}&channel=${channel}`, { credentials: 'include' })
    if (!res.ok) return null
    const j = await res.json()
    return j.activity ?? null
  } catch {
    return null
  }
}

function KpiCard({ label, value, pct, spark, prevLabel, href }: { label: string; value: string; pct?: number | null; spark?: number[]; prevLabel: string; href?: string }) {
  const body = (
    <div className="flex items-end justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground-muted">{label}</p>
        <p className="mt-1 text-[22px] font-semibold leading-8 tracking-tight tabular-nums text-foreground sm:text-[28px] [overflow-wrap:anywhere]">{value}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-foreground-muted">
          {pct !== undefined && <DeltaChip value={pct} />}
          <span>vs {prevLabel}</span>
        </p>
      </div>
      {spark && spark.length > 1 && <Sparkline values={spark} width={96} height={32} ariaLabel={`${label} trend`} className="hidden shrink-0 sm:block" />}
    </div>
  )
  return href ? (
    <Link href={href} aria-label={label} className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500">
      <DashCard className="h-full transition-transform duration-200 hover:-translate-y-0.5">{body}</DashCard>
    </Link>
  ) : (
    <DashCard>{body}</DashCard>
  )
}

function QuietStat({ label, value, sub, href }: { label: string; value: string; sub?: string; href?: string }) {
  const inner = (
    <>
      <span className="text-foreground-muted">{label}</span> <span className="font-semibold tabular-nums text-foreground">{value}</span>
      {sub && <span className="text-foreground-muted"> · {sub}</span>}
    </>
  )
  return href ? (
    <Link href={href} className="text-xs hover:underline">
      {inner}
    </Link>
  ) : (
    <span className="text-xs">{inner}</span>
  )
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
  activity: initialActivity = null,
  storeName,
}: {
  activity?: DashboardActivity | null
  storeName?: string
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
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerActivity, setDrawerActivity] = useState<DashboardActivity | null>(initialActivity)
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [weekChannel, setWeekChannel] = useState<ActivityChannel>('all')
  const [weekData, setWeekData] = useState<DashboardActivity | null>(initialActivity)
  const shippedCard = useRef<HTMLDivElement>(null)
  const today = useMemo(localDay, [])

  const refetchDrawer = useCallback(async ({ weeks, channel }: { weeks: number; channel: ActivityChannel }) => {
    setDrawerLoading(true)
    const next = await fetchActivity(weeks, channel)
    if (next) setDrawerActivity(next)
    setDrawerLoading(false)
  }, [])

  const changeWeekChannel = useCallback(async (c: ActivityChannel) => {
    setWeekChannel(c)
    const next = await fetchActivity(26, c)
    if (next) setWeekData(next)
  }, [])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    requestAnimationFrame(() => shippedCard.current?.querySelector<HTMLElement>('[role="button"]')?.focus())
  }, [])

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

  const prevLabel = data.range === 'today' ? 'yesterday' : 'previous period'
  const rangeBar = (
    <div className="max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <SegmentedPills ariaLabel="Date range" options={RANGES.map(r => ({ value: r.key, label: r.label }))} value={range} onChange={changeRange} />
    </div>
  )
  const f = data.insights.fulfilment
  const wd = weekData
  const cal = initialActivity

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-foreground-muted">Welcome back, {username}</p>
          <h1 className="mt-0.5 text-[28px] font-semibold leading-9 tracking-[-0.02em] text-foreground">Store analytics</h1>
          <p className="mt-1 text-sm text-foreground-muted">Revenue, orders and fulfilment · {data.rangeLabel.toLowerCase()}</p>
        </div>
        {rangeBar}
      </header>

      {ops}

      <div className={`space-y-6 transition-opacity ${loading ? 'opacity-60' : ''}`}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KpiCard label="Orders" value={numStr(k.orders)} pct={k.ordersPct} spark={data.spark.orders} prevLabel={prevLabel} href={ap('/admin/orders', host)} />
            <KpiCard label="Avg order value" value={rs(k.aov)} pct={k.aovPct} spark={data.spark.aov} prevLabel={prevLabel} href={canFinancial ? ap('/admin/financial', host) : undefined} />
            <KpiCard label="Customers" value={numStr(k.customers)} pct={k.customersPct} spark={data.spark.customers} prevLabel={prevLabel} href={ap('/admin/customers', host)} />
            <KpiCard label="Conversion" value={pctStr(conversion.rate, 2)} pct={conversion.ratePct} spark={data.spark.conversion} prevLabel={prevLabel} href={canTraffic ? ap('/admin/traffic', host) : undefined} />
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 px-1">
            {canFinancial ? (
              <QuietStat
                label="Gross margin"
                value={rsCompact(money.gross)}
                sub={money.marginPct != null ? `${pctStr(money.marginPct)} of revenue` : 'No paid revenue yet'}
                href={ap('/admin/financial', host)}
              />
            ) : (
              <QuietStat label="Paid orders" value={numStr(conversion.paidOrders)} sub={`Prev: ${numStr(conversion.paidOrdersPrev)}`} href={ap('/admin/orders', host)} />
            )}
            <QuietStat label="Units sold" value={numStr(Math.round(money.units))} sub={`Prev: ${numStr(Math.round(money.unitsPrev))}`} href={ap('/admin/products', host)} />
            <QuietStat label="Repeat rate" value={pctStr(repeatRate, 0)} sub={`${numStr(data.customerSplit.returningCustomers)} returning of ${numStr(activeBuyers)} buyers`} href={ap('/admin/customers', host)} />
          </div>
        </div>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">
            Revenue <span className="text-[11px] font-normal text-foreground-muted">· compared with {prevLabel}</span>
          </h2>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <DashCard className="xl:col-span-2" title="Revenue" action={<SectionLink href={canFinancial ? ap('/admin/financial', host) : undefined} label="Ledger" />}>
              <p className="text-[32px] font-semibold leading-10 tracking-tight tabular-nums text-foreground sm:text-[40px] sm:leading-[48px]">{rs(k.revenue)}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-foreground-muted">
                <DeltaChip value={k.revenuePct} />
                <span>vs {rs(k.revenuePrev)} previous</span>
              </p>
              <div className="mt-3">
                <CompareArea
                  points={data.trend.map((t, i) => ({ label: t.label, current: t.revenue, previous: data.trendPrev[i]?.revenue ?? 0 }))}
                  format={rs}
                />
              </div>
            </DashCard>
            <DashCard title="Order flow" hint="placed to delivered" action={<SectionLink href={ap('/admin/orders', host)} label="All orders" />}>
              <FlowStream flow={data.flow} />
            </DashCard>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">
            Fulfilment <span className="text-[11px] font-normal text-foreground-muted">· {numStr(metrics.funnel.pending + metrics.funnel.processing)} open orders</span>
          </h2>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <DashCard title="Orders this week" hint="placed per day">
              {wd ? (
                <WeekdayBars
                  days={wd.thisWeek}
                  avg={wd.placedAvg8w}
                  today={today}
                  channels={WEEK_CHANNELS}
                  channel={weekChannel}
                  onChannelChange={v => changeWeekChannel(v as ActivityChannel)}
                />
              ) : (
                <p className="py-8 text-center text-xs text-foreground-muted">Weekly activity is unavailable right now.</p>
              )}
            </DashCard>
            <div ref={shippedCard} className="min-w-0">
              <DashCard
                title="Orders shipped"
                hint={cal ? 'last 26 weeks' : undefined}
                onClick={drawerActivity ? () => setDrawerOpen(true) : undefined}
                ariaLabel="Orders shipped, open details"
                className="h-full"
              >
                {cal ? (
                  <>
                    <p className="text-[28px] font-semibold leading-9 tabular-nums text-foreground">{numStr(cal.totals.shipped)}</p>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-foreground-muted">
                      <span>Busiest day {cal.totals.busiestDay ? numStr(cal.totals.busiestDay.count) : '–'}</span>
                      <span>Streak {cal.totals.currentStreak}d</span>
                    </div>
                    <div className="mt-3 overflow-hidden">
                      <DotCalendar days={cal.days} />
                    </div>
                    <div className="mt-2">
                      <ActivityLegend />
                    </div>
                  </>
                ) : (
                  <p className="py-8 text-center text-xs text-foreground-muted">Shipped orders are unavailable right now.</p>
                )}
              </DashCard>
            </div>
            <DashCard title="Fulfilment health" action={<SectionLink href={ap('/admin/orders?status=processing', host)} label="Processing" />}>
              <MetricList
                metrics={[
                  { label: 'Avg time to ship', value: hoursStr(f.avgHoursToShip), delta: delta(f.avgHoursToShip, f.avgHoursToShipPrev), invertDelta: true },
                  { label: 'On-time delivery', value: pctStr(f.onTimePct, 0) },
                  { label: 'RTO orders', value: numStr(data.returns.rtoInTransit + data.returns.rtoDelivered), hint: `${numStr(data.returns.rtoInTransit)} in transit` },
                  { label: 'Return rate', value: pctStr(f.returnRate) },
                ]}
              />
            </DashCard>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <div className="xl:col-span-2 [&>section]:h-full">
          <DashCard title="Order funnel" action={<SectionLink href={ap('/admin/orders', host)} label="All orders" />}>
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
        </DashCard>
          </div>
          <DashCard title="Payment split" action={<SectionLink href={canFinancial ? ap('/admin/financial', host) : undefined} label="Ledger" />}>
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
          </DashCard>
        </div>

        <GroupLabel title="Fulfilment & service" hint="how fast and how cleanly orders move" />
        <OpsInsights data={data} host={host} />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <DashCard title="Top categories" action={<SectionLink href={ap('/admin/categories', host)} label="Categories" />}>
            <RankedBars items={data.topCategories.map(c => ({ name: c.name, value: c.revenue, sub: rs(c.revenue) }))} />
          </DashCard>
          <DashCard title="Top brands" action={<SectionLink href={ap('/admin/brands', host)} label="Brands" />}>
            <RankedBars items={data.topBrands.map(b => ({ name: b.name, value: b.revenue, sub: rs(b.revenue) }))} barClass="bg-violet-500" />
          </DashCard>
          <DashCard title="Buyer mix" action={<SectionLink href={ap('/admin/business/customers', host)} label="Business" />}>
            <DonutSplit
              size={130}
              centerValue={rs(data.buyerSplit.businessRevenue + data.buyerSplit.consumerRevenue)}
              centerLabel="revenue"
              segments={[
                { label: `Business (${data.buyerSplit.business})`, value: data.buyerSplit.businessRevenue, color: '#7cb900' },
                { label: `Consumer (${data.buyerSplit.consumer})`, value: data.buyerSplit.consumerRevenue, color: 'rgb(59 130 246)' },
              ]}
            />
          </DashCard>
        </div>

        <GroupLabel title="Product intelligence" hint="what sells, what sits, what customers want" />
        <ProductInsights data={data} host={host} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <DashCard title="Top products" action={<SectionLink href={ap('/admin/products', host)} label="All products" />}>
            <ListRows
              rows={metrics.topProducts.map((p, i) => ({
                key: p.id,
                primary: `${i + 1}. ${p.name}`,
                value: `${p.qty} sold, ${rs(p.revenue)}`,
                href: ap(`/admin/products/${p.id}/edit`, host),
              }))}
            />
          </DashCard>
          <DashCard title="Recent orders" action={<SectionLink href={ap('/admin/orders', host)} label="All orders" />}>
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
          </DashCard>
        </div>

        <GroupLabel title="Growth, customers & cash" hint="where demand comes from and where money sits" />
        <GrowthInsights data={data} host={host} />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {canInventory && (
            <DashCard title="Stock status" action={<SectionLink href={ap('/admin/inventory', host)} label="Inventory" />}>
              <div className="space-y-0.5">
                <MiniStat label="In stock" value={String(data.inventory.inStock)} tone="text-green-600 dark:text-green-400" href={ap('/admin/inventory', host)} />
                <MiniStat label="Low stock" value={String(data.inventory.lowStock)} tone="text-amber-600 dark:text-amber-400" href={ap('/admin/inventory', host)} />
                <MiniStat label="Out of stock" value={String(data.inventory.outOfStock)} tone="text-red-500" href={ap('/admin/inventory', host)} />
                <MiniStat label="Inventory value" value={rs(data.inventory.stockValue)} href={canFinancial ? ap('/admin/financial', host) : undefined} />
              </div>
            </DashCard>
          )}
          <DashCard title="Customer split" action={<SectionLink href={ap('/admin/customers', host)} label="Customers" />}>
            <DonutSplit
              size={130}
              centerValue={numStr(activeBuyers)}
              centerLabel="active"
              segments={[
                { label: 'New', value: data.customerSplit.newCustomers, color: 'rgb(16 185 129)' },
                { label: 'Returning', value: data.customerSplit.returningCustomers, color: 'rgb(59 130 246)' },
              ]}
            />
          </DashCard>
          {canReturns && (
            <DashCard title="Returns & RTO" action={<SectionLink href={ap('/admin/returns', host)} label="Returns" />}>
              <div className="space-y-0.5">
                <MiniStat label="Return requests" value={String(data.returns.total)} href={ap('/admin/returns', host)} />
                <MiniStat label="RTO in transit" value={String(data.returns.rtoInTransit)} tone="text-amber-600 dark:text-amber-400" href={ap('/admin/returns', host)} />
                <MiniStat label="RTO delivered back" value={String(data.returns.rtoDelivered)} tone="text-red-500" href={ap('/admin/returns', host)} />
              </div>
            </DashCard>
          )}
        </div>
      </div>

      {footer}

      {drawerActivity && (
        <ActivityDrawer activity={drawerActivity} open={drawerOpen} onClose={closeDrawer} loading={drawerLoading} storeName={storeName} today={today} onRefetch={refetchDrawer} />
      )}
    </div>
  )
}
