'use client'

import { useState, useCallback } from 'react'
import { StatCard } from './StatCard'
import { TrendChart, DonutSplit, RankedBars } from './Charts'
import type { DashboardAnalytics, AnalyticsRange } from '@/lib/queries'

const RANGES: { key: AnalyticsRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
]

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-IN')}`

const Icon = ({ d, cls }: { d: string; cls: string }) => (
  <svg className={`w-5 h-5 ${cls}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
)

function Card({ title, right, children, className = '' }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-surface-elevated rounded-xl border border-border-default p-5 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  )
}

/**
 * Interactive analytics section of the admin dashboard. Server-renders the
 * initial range; refetches /api/admin/dashboard/analytics on range change.
 */
export default function AnalyticsDashboardClient({ initial }: { initial: DashboardAnalytics }) {
  const [data, setData] = useState<DashboardAnalytics>(initial)
  const [range, setRange] = useState<AnalyticsRange>(initial.range)
  const [loading, setLoading] = useState(false)

  const changeRange = useCallback(async (r: AnalyticsRange) => {
    if (r === range || loading) return
    setRange(r)
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/dashboard/analytics?range=${r}`, { credentials: 'include' })
      if (res.ok) {
        const j = await res.json()
        if (j.analytics) setData(j.analytics)
      }
    } catch { /* keep previous data */ }
    finally { setLoading(false) }
  }, [range, loading])

  const k = data.kpis
  const totalPay = data.payment.online + data.payment.cod + data.payment.other

  return (
    <div className={`space-y-5 transition-opacity ${loading ? 'opacity-60' : ''}`}>
      {/* Range selector */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-foreground-muted">{data.rangeLabel}</p>
        <div className="flex items-center bg-surface-secondary border border-border-default rounded-xl p-1 gap-0.5">
          {RANGES.map(r => (
            <button
              key={r.key}
              onClick={() => changeRange(r.key)}
              disabled={loading}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 disabled:opacity-50 ${
                range === r.key ? 'bg-accent-500 text-white shadow-sm' : 'text-foreground-secondary hover:text-foreground'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Range KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Revenue" value={rs(k.revenue)} sub={`Prev: ${rs(k.revenuePrev)}`} pct={k.revenuePct} color="bg-emerald-100 dark:bg-emerald-900/30" icon={<Icon cls="text-emerald-600 dark:text-emerald-400" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />} />
        <StatCard label="Orders" value={k.orders.toLocaleString('en-IN')} sub={`Prev: ${k.ordersPrev}`} pct={k.ordersPct} color="bg-violet-100 dark:bg-violet-900/30" icon={<Icon cls="text-violet-600 dark:text-violet-400" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />} />
        <StatCard label="Avg Order Value" value={rs(k.aov)} sub={`Prev: ${rs(k.aovPrev)}`} pct={k.aovPct} color="bg-blue-100 dark:bg-blue-900/30" icon={<Icon cls="text-blue-600 dark:text-blue-400" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />} />
        <StatCard label="Customers" value={k.customers.toLocaleString('en-IN')} sub={`Prev: ${k.customersPrev}`} pct={k.customersPct} color="bg-orange-100 dark:bg-orange-900/30" icon={<Icon cls="text-orange-600 dark:text-orange-400" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />} />
      </div>

      {/* Revenue trend (wide) + Payment split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card title="Revenue Trend" className="lg:col-span-2">
          <TrendChart points={data.trend} />
        </Card>
        <Card title="Payment Split">
          <DonutSplit
            size={130}
            centerValue={rs(totalPay)}
            centerLabel="collected"
            segments={[
              { label: 'Online', value: data.payment.online, color: 'rgb(59 130 246)' },
              { label: 'COD', value: data.payment.cod, color: 'rgb(168 85 247)' },
              ...(data.payment.other > 0 ? [{ label: 'Other', value: data.payment.other, color: 'rgb(148 163 184)' }] : []),
            ]}
          />
          {data.payment.codOutstanding > 0 && (
            <div className="mt-3 pt-3 border-t border-border-default flex items-center justify-between">
              <span className="text-xs text-foreground-muted">COD outstanding ({data.payment.codOutstandingCount})</span>
              <span className="text-sm font-bold text-orange-600 dark:text-orange-400">{rs(data.payment.codOutstanding)}</span>
            </div>
          )}
        </Card>
      </div>

      {/* Customer + buyer splits */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="New vs Returning Customers">
          <DonutSplit
            size={130}
            centerValue={(data.customerSplit.newCustomers + data.customerSplit.returningCustomers).toLocaleString('en-IN')}
            centerLabel="active"
            segments={[
              { label: 'New', value: data.customerSplit.newCustomers, color: 'rgb(16 185 129)' },
              { label: 'Returning', value: data.customerSplit.returningCustomers, color: 'rgb(59 130 246)' },
            ]}
          />
        </Card>
        <Card title="Business vs Consumer">
          <DonutSplit
            size={130}
            centerValue={rs(data.buyerSplit.businessRevenue + data.buyerSplit.consumerRevenue)}
            centerLabel="revenue"
            segments={[
              { label: `Business (${data.buyerSplit.business})`, value: data.buyerSplit.businessRevenue, color: 'rgb(139 92 246)' },
              { label: `Consumer (${data.buyerSplit.consumer})`, value: data.buyerSplit.consumerRevenue, color: 'rgb(234 88 12)' },
            ]}
          />
        </Card>
      </div>

      {/* Top categories + brands */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="Top Categories">
          <RankedBars items={data.topCategories.map(c => ({ name: c.name, value: c.revenue, sub: rs(c.revenue) }))} />
        </Card>
        <Card title="Top Brands">
          <RankedBars items={data.topBrands.map(b => ({ name: b.name, value: b.revenue, sub: rs(b.revenue) }))} barClass="bg-violet-500" />
        </Card>
      </div>

      {/* Inventory health + Returns/RTO */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card title="Inventory Health" className="lg:col-span-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400 tabular-nums">{data.inventory.inStock}</p>
              <p className="text-xs text-foreground-muted mt-0.5">In stock</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400 tabular-nums">{data.inventory.lowStock}</p>
              <p className="text-xs text-foreground-muted mt-0.5">Low stock</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-red-500 dark:text-red-400 tabular-nums">{data.inventory.outOfStock}</p>
              <p className="text-xs text-foreground-muted mt-0.5">Out of stock</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground tabular-nums">{rs(data.inventory.stockValue)}</p>
              <p className="text-xs text-foreground-muted mt-0.5">Stock value</p>
            </div>
          </div>
        </Card>
        <Card title="Returns / RTO">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-foreground-muted">Return requests</span>
              <span className="text-lg font-bold text-foreground tabular-nums">{data.returns.total}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-foreground-muted">RTO in transit</span>
              <span className="text-sm font-semibold text-orange-600 dark:text-orange-400 tabular-nums">{data.returns.rtoInTransit}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-foreground-muted">RTO delivered back</span>
              <span className="text-sm font-semibold text-red-500 dark:text-red-400 tabular-nums">{data.returns.rtoDelivered}</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
