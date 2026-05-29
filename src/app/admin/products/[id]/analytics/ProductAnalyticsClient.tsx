'use client'

import { useState } from 'react'
import Link from 'next/link'

interface AnalyticsData {
  product: { id: string; name: string; sku: string; slug: string; brandName: string | null; stock: number; basePrice: number }
  days: number
  totals: {
    views: number
    uniqueViewers: number
    cartAdds: number
    orders: number
    revenue: number
    quantitySold: number
    conversionRate: number
    cartConversionRate: number
    revenuePerView: number
    activeCarts: number
  }
  timeSeries: { date: string; views: number; carts: number; orders: number }[]
  referrers: { referrer: string; sessions: number }[]
  recentBuyers: { orderNumber: string; createdAt: string; quantity: number; total: number; customerName: string }[]
  variantBreakdown: { variantName: string | null; orders: number; quantity: number; revenue: number }[]
}

type Granularity = 'daily' | 'weekly' | 'monthly'
type Row = { date: string; views: number; carts: number; orders: number }

function aggregate(series: Row[], mode: Granularity): Row[] {
  if (mode === 'daily') return series

  const buckets = new Map<string, Row>()

  for (const r of series) {
    const d = new Date(r.date)
    let key: string

    if (mode === 'monthly') {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    } else {
      const day = d.getDay() === 0 ? 6 : d.getDay() - 1
      const mon = new Date(d)
      mon.setDate(d.getDate() - day)
      key = mon.toISOString().slice(0, 10)
    }

    const existing = buckets.get(key)
    if (existing) {
      existing.views += r.views
      existing.carts += r.carts
      existing.orders += r.orders
    } else {
      buckets.set(key, { date: key, views: r.views, carts: r.carts, orders: r.orders })
    }
  }

  return Array.from(buckets.values())
}

function fmtLabel(date: string, mode: Granularity): string {
  const d = new Date(date)
  if (mode === 'monthly') {
    return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
  }
  if (mode === 'weekly') {
    const sun = new Date(d)
    sun.setDate(d.getDate() + 6)
    const fmt = (dt: Date) => dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
    return `${fmt(d)} – ${fmt(sun)}`
  }
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

const RANGES = [7, 14, 30, 60, 90]

export default function ProductAnalyticsClient({ productId, initial }: { productId: string; initial: AnalyticsData }) {
  const [data, setData] = useState<AnalyticsData>(initial)
  const [days, setDays] = useState(initial.days)
  const [loading, setLoading] = useState(false)
  const [granularity, setGranularity] = useState<Granularity>('daily')
  const [showZeros, setShowZeros] = useState(false)

  async function changeRange(d: number) {
    setLoading(true)
    setDays(d)
    try {
      const res = await fetch(`/api/admin/products/${productId}/analytics?days=${d}`, { credentials: 'include' })
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
    }
  }

  const aggregated = aggregate(data.timeSeries, granularity)
  const hasZeros = aggregated.some(r => r.views + r.carts + r.orders === 0)
  const displayed = showZeros ? aggregated : aggregated.filter(r => r.views + r.carts + r.orders > 0)
  const maxValue = Math.max(...displayed.map(d => Math.max(d.views, d.carts * 5, d.orders * 20)), 1)

  return (
    <div className="space-y-5">
      <div className="bg-zinc-800 dark:bg-zinc-900 rounded-2xl p-6 text-white shadow-md border border-zinc-700">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold truncate">{data.product.name}</h1>
            <div className="flex items-center gap-3 mt-1 text-xs text-zinc-400 flex-wrap">
              <span className="font-mono">SKU: {data.product.sku}</span>
              {data.product.brandName && <span>Brand: {data.product.brandName}</span>}
              <span>Stock: <span className={data.product.stock === 0 ? 'text-red-400' : data.product.stock < 10 ? 'text-orange-400' : 'text-green-400'}>{data.product.stock}</span></span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {RANGES.map(d => (
              <button
                key={d}
                onClick={() => changeRange(d)}
                disabled={loading}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 ${
                  days === d ? 'bg-accent-500 text-white' : 'bg-white/10 text-zinc-300 hover:bg-white/20'
                } disabled:opacity-50`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <Stat label="Views" value={data.totals.views.toLocaleString('en-IN')} sub={`${data.totals.uniqueViewers.toLocaleString('en-IN')} unique`} />
          <Stat label="Cart Adds" value={data.totals.cartAdds.toLocaleString('en-IN')} sub={data.totals.activeCarts > 0 ? `${data.totals.activeCarts} active now` : ''} />
          <Stat label="Orders" value={data.totals.orders.toLocaleString('en-IN')} sub={`${data.totals.quantitySold.toLocaleString('en-IN')} units sold`} />
          <Stat label="Revenue" value={`₹${Math.round(data.totals.revenue).toLocaleString('en-IN')}`} sub={`₹${data.totals.revenuePerView}/view`} />
          <Stat label="Conversion" value={`${data.totals.conversionRate}%`} sub={`${data.totals.cartConversionRate}% cart→order`} highlight={data.totals.conversionRate >= 5} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-surface-elevated rounded-xl border border-border-default p-5">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-foreground">Traffic</h2>
            <div className="flex items-center gap-1 bg-surface-secondary rounded-lg p-0.5">
              {(['daily', 'weekly', 'monthly'] as const).map(g => (
                <button
                  key={g}
                  onClick={() => setGranularity(g)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    granularity === g
                      ? 'bg-surface-elevated shadow text-foreground'
                      : 'text-foreground-muted hover:text-foreground'
                  }`}
                >
                  {g === 'daily' ? 'Day' : g === 'weekly' ? 'Week' : 'Month'}
                </button>
              ))}
            </div>
          </div>

          {displayed.length === 0 ? (
            <p className="text-sm text-foreground-muted py-2">
              No activity in this range.{' '}
              {hasZeros && (
                <button onClick={() => setShowZeros(true)} className="underline hover:text-foreground transition-colors">
                  Show all {aggregated.length} {granularity === 'daily' ? 'days' : granularity === 'weekly' ? 'weeks' : 'months'}
                </button>
              )}
            </p>
          ) : (
            <div className="space-y-2.5">
              {displayed.map(d => (
                <div key={d.date} className="flex items-center gap-3 text-xs">
                  <span className={`shrink-0 text-foreground-muted ${granularity === 'weekly' ? 'w-32' : 'w-20'}`}>
                    {fmtLabel(d.date, granularity)}
                  </span>
                  <div className="flex-1 flex items-center gap-1 h-5">
                    <div
                      className="bg-blue-500 rounded h-full transition-all"
                      style={{ width: `${(d.views / maxValue) * 100}%`, minWidth: d.views > 0 ? '2px' : '0' }}
                      title={`${d.views} views`}
                    />
                    <span className="text-foreground tabular-nums w-10 text-right">{d.views}</span>
                  </div>
                  <span className="text-foreground-secondary tabular-nums w-8 text-right">{d.carts}c</span>
                  <span className="text-green-600 dark:text-green-400 tabular-nums w-8 text-right font-semibold">{d.orders}o</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between mt-4 pt-3 border-t border-border-default text-xs text-foreground-muted flex-wrap gap-2">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-blue-500 rounded inline-block" /> Views</span>
              <span><span className="font-semibold text-foreground-secondary">N</span>c Cart adds</span>
              <span><span className="font-semibold text-green-600 dark:text-green-400">N</span>o Orders</span>
            </div>
            {hasZeros && (
              <button
                onClick={() => setShowZeros(v => !v)}
                className="text-accent-500 hover:text-accent-600 font-medium transition-colors"
              >
                {showZeros
                  ? 'Hide zero days'
                  : `Show all ${aggregated.length} ${granularity === 'daily' ? 'days' : granularity === 'weekly' ? 'weeks' : 'months'}`}
              </button>
            )}
          </div>
        </div>

        <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Top Referrers</h2>
          {data.referrers.length === 0 ? (
            <p className="text-sm text-foreground-muted">No referrer data yet.</p>
          ) : (
            <div className="space-y-2.5">
              {data.referrers.map(r => (
                <div key={r.referrer} className="flex items-center justify-between text-sm">
                  <span className="text-foreground truncate flex-1 mr-2">{r.referrer}</span>
                  <span className="text-foreground-secondary tabular-nums text-xs">{r.sessions.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Variant Breakdown</h2>
          {data.variantBreakdown.length === 0 ? (
            <p className="text-sm text-foreground-muted">No paid orders in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-foreground-muted border-b border-border-default">
                    <th className="text-left py-2 font-semibold">Variant</th>
                    <th className="text-right py-2 font-semibold">Orders</th>
                    <th className="text-right py-2 font-semibold">Qty</th>
                    <th className="text-right py-2 font-semibold">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-default">
                  {data.variantBreakdown.map((v, i) => (
                    <tr key={i}>
                      <td className="py-2 text-foreground">{v.variantName || <span className="text-foreground-muted italic">No variant</span>}</td>
                      <td className="py-2 text-right tabular-nums">{v.orders}</td>
                      <td className="py-2 text-right tabular-nums">{v.quantity}</td>
                      <td className="py-2 text-right tabular-nums font-semibold">₹{Math.round(v.revenue).toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Recent Buyers</h2>
          {data.recentBuyers.length === 0 ? (
            <p className="text-sm text-foreground-muted">No buyers yet.</p>
          ) : (
            <div className="space-y-2.5">
              {data.recentBuyers.map(b => (
                <Link
                  key={b.orderNumber}
                  href={`/admin/orders?search=${b.orderNumber}`}
                  className="flex items-center justify-between text-sm py-1.5 hover:bg-surface-secondary/50 px-2 -mx-2 rounded transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground truncate">{b.customerName}</p>
                    <p className="text-xs text-foreground-muted">
                      {new Date(b.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} · {b.quantity}× #{b.orderNumber}
                    </p>
                  </div>
                  <span className="font-semibold text-foreground tabular-nums whitespace-nowrap ml-3">₹{Math.round(b.total).toLocaleString('en-IN')}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className="bg-white/5 rounded-xl p-3.5 border border-white/10">
      <p className="text-zinc-400 text-[10px] uppercase tracking-widest font-medium">{label}</p>
      <p className={`font-bold text-2xl mt-1 ${highlight ? 'text-green-400' : 'text-white'}`}>{value}</p>
      {sub && <p className="text-zinc-500 text-[10px] mt-0.5 truncate">{sub}</p>}
    </div>
  )
}
