'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import CopySku from '@/components/ui/CopySku'
import { ap } from '@/lib/shared/admin-path'

interface AnalyticsData {
  product: {
    id: string
    name: string
    sku: string
    slug: string
    brandName: string | null
    stock: number
    basePrice: number
  }
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

function Modal({
  title: titleText,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-elevated rounded-2xl border border-border-default p-6 w-full max-w-lg shadow-2xl max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-foreground">{titleText}</h2>
            {subtitle && <p className="text-xs text-foreground-muted mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-secondary transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1">{children}</div>
        {footer && <div className="pt-4 shrink-0 border-t border-border-default mt-2">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

const RANGES = [7, 14, 30, 60, 90]
const PREVIEW = 5

export default function ProductAnalyticsClient({ productId, initial }: { productId: string; initial: AnalyticsData }) {
  const [data, setData] = useState<AnalyticsData>(initial)
  const [days, setDays] = useState(initial.days)
  const [loading, setLoading] = useState(false)
  const [granularity, setGranularity] = useState<Granularity>('daily')
  const [showZeros, setShowZeros] = useState(false)
  const [refModal, setRefModal] = useState(false)
  const [variantModal, setVariantModal] = useState(false)
  const [buyerModal, setBuyerModal] = useState(false)

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
  const maxViews = Math.max(...displayed.map(d => d.views), 1)
  const maxCarts = Math.max(...displayed.map(d => d.carts), 1)
  const maxOrders = Math.max(...displayed.map(d => d.orders), 1)

  const refPreview = data.referrers.slice(0, PREVIEW)
  const refHasMore = data.referrers.length > PREVIEW

  const variantPreview = data.variantBreakdown.slice(0, PREVIEW)
  const variantHasMore = data.variantBreakdown.length > PREVIEW

  const buyerPreview = data.recentBuyers.slice(0, PREVIEW)
  const buyerHasMore = data.recentBuyers.length > PREVIEW

  return (
    <div className="space-y-5">
      <div className="bg-zinc-800 dark:bg-zinc-900 rounded-2xl p-6 text-white shadow-md border border-zinc-700">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold truncate">{data.product.name}</h1>
            <div className="flex items-center gap-3 mt-1 text-xs text-zinc-400 flex-wrap">
              <span className="font-mono">
                SKU: {data.product.sku}
                {data.product.sku && <CopySku sku={data.product.sku} className="ml-1" />}
              </span>
              {data.product.brandName && <span>Brand: {data.product.brandName}</span>}
              <span>
                Stock:{' '}
                <span
                  className={
                    data.product.stock === 0
                      ? 'text-red-400'
                      : data.product.stock < 10
                        ? 'text-orange-400'
                        : 'text-green-400'
                  }
                >
                  {data.product.stock}
                </span>
              </span>
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
          <Stat
            label="Views"
            value={data.totals.views.toLocaleString('en-IN')}
            sub={`${data.totals.uniqueViewers.toLocaleString('en-IN')} unique`}
          />
          <Stat
            label="Cart Adds"
            value={data.totals.cartAdds.toLocaleString('en-IN')}
            sub={data.totals.activeCarts > 0 ? `${data.totals.activeCarts} active now` : ''}
          />
          <Stat
            label="Orders"
            value={data.totals.orders.toLocaleString('en-IN')}
            sub={`${data.totals.quantitySold.toLocaleString('en-IN')} units sold`}
          />
          <Stat
            label="Revenue"
            value={`₹${Math.round(data.totals.revenue).toLocaleString('en-IN')}`}
            sub={`₹${data.totals.revenuePerView}/view`}
          />
          <Stat
            label="Conversion"
            value={`${data.totals.conversionRate}%`}
            sub={`${data.totals.cartConversionRate}% cart→order`}
            highlight={data.totals.conversionRate >= 5}
          />
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
                <button
                  onClick={() => setShowZeros(true)}
                  className="underline hover:text-foreground transition-colors"
                >
                  Show all {aggregated.length}{' '}
                  {granularity === 'daily' ? 'days' : granularity === 'weekly' ? 'weeks' : 'months'}
                </button>
              )}
            </p>
          ) : (
            <div className="space-y-3">
              {displayed.map(d => (
                <div key={d.date} className="flex items-center gap-3 text-xs">
                  <span className={`shrink-0 text-foreground-muted ${granularity === 'weekly' ? 'w-32' : 'w-20'}`}>
                    {fmtLabel(d.date, granularity)}
                  </span>
                  <div className="flex-1 flex flex-col gap-1">
                    <div className="flex items-center gap-1 h-2.5">
                      <div
                        className="bg-blue-500 rounded-sm h-full transition-all"
                        style={{ width: `${(d.views / maxViews) * 100}%`, minWidth: d.views > 0 ? '2px' : '0' }}
                        title={`${d.views} views`}
                      />
                      <span className="text-foreground tabular-nums text-[10px] w-6 shrink-0">{d.views}</span>
                    </div>
                    <div className="flex items-center gap-1 h-2.5">
                      <div
                        className="bg-amber-400 rounded-sm h-full transition-all"
                        style={{ width: `${(d.carts / maxCarts) * 100}%`, minWidth: d.carts > 0 ? '2px' : '0' }}
                        title={`${d.carts} cart adds`}
                      />
                      <span className="text-amber-500 dark:text-amber-400 tabular-nums text-[10px] w-6 shrink-0">
                        {d.carts}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 h-2.5">
                      <div
                        className="bg-green-500 rounded-sm h-full transition-all"
                        style={{ width: `${(d.orders / maxOrders) * 100}%`, minWidth: d.orders > 0 ? '2px' : '0' }}
                        title={`${d.orders} orders`}
                      />
                      <span className="text-green-600 dark:text-green-400 tabular-nums text-[10px] font-semibold w-6 shrink-0">
                        {d.orders}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between mt-4 pt-3 border-t border-border-default text-xs text-foreground-muted flex-wrap gap-2">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-2.5 bg-blue-500 rounded-sm inline-block" /> Views
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-2.5 bg-amber-400 rounded-sm inline-block" /> Cart adds
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-2.5 bg-green-500 rounded-sm inline-block" /> Orders
              </span>
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

        {/* Top Referrers */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Top Referrers</h2>
            {refHasMore && (
              <button
                onClick={() => setRefModal(true)}
                className="text-xs text-accent-500 hover:text-accent-600 font-medium"
              >
                View all ({data.referrers.length}) →
              </button>
            )}
          </div>
          {data.referrers.length === 0 ? (
            <p className="text-sm text-foreground-muted">No referrer data yet.</p>
          ) : (
            <div className="space-y-2.5">
              {refPreview.map(r => (
                <ReferrerRow key={r.referrer} r={r} />
              ))}
              {refHasMore && (
                <button
                  onClick={() => setRefModal(true)}
                  className="w-full text-center text-xs text-foreground-muted hover:text-foreground pt-1 transition-colors"
                >
                  +{data.referrers.length - PREVIEW} more
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Variant Breakdown */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Variant Breakdown</h2>
            {variantHasMore && (
              <button
                onClick={() => setVariantModal(true)}
                className="text-xs text-accent-500 hover:text-accent-600 font-medium"
              >
                View all ({data.variantBreakdown.length}) →
              </button>
            )}
          </div>
          {data.variantBreakdown.length === 0 ? (
            <p className="text-sm text-foreground-muted">No paid orders in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <VariantTable rows={variantPreview} />
              {variantHasMore && (
                <button
                  onClick={() => setVariantModal(true)}
                  className="w-full text-center text-xs text-foreground-muted hover:text-foreground pt-2.5 pb-0.5 transition-colors"
                >
                  +{data.variantBreakdown.length - PREVIEW} more
                </button>
              )}
            </div>
          )}
        </div>

        {/* Recent Buyers */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Recent Buyers</h2>
            {buyerHasMore && (
              <button
                onClick={() => setBuyerModal(true)}
                className="text-xs text-accent-500 hover:text-accent-600 font-medium"
              >
                View all ({data.recentBuyers.length}) →
              </button>
            )}
          </div>
          {data.recentBuyers.length === 0 ? (
            <p className="text-sm text-foreground-muted">No buyers yet.</p>
          ) : (
            <div className="space-y-2.5">
              {buyerPreview.map(b => (
                <BuyerRow key={`${b.orderNumber}-${b.createdAt}`} b={b} />
              ))}
              {buyerHasMore && (
                <button
                  onClick={() => setBuyerModal(true)}
                  className="w-full text-center text-xs text-foreground-muted hover:text-foreground pt-1 transition-colors"
                >
                  +{data.recentBuyers.length - PREVIEW} more
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {refModal && (
        <Modal
          title="Top Referrers"
          subtitle={`${data.referrers.length} sources · last ${days} days`}
          onClose={() => setRefModal(false)}
        >
          <div className="space-y-2.5 py-1">
            {data.referrers.map(r => (
              <ReferrerRow key={r.referrer} r={r} />
            ))}
          </div>
        </Modal>
      )}

      {variantModal && (
        <Modal
          title="Variant Breakdown"
          subtitle={`${data.variantBreakdown.length} variants · last ${days} days`}
          onClose={() => setVariantModal(false)}
        >
          <VariantTable rows={data.variantBreakdown} />
        </Modal>
      )}

      {buyerModal && (
        <Modal
          title="Recent Buyers"
          subtitle={`${data.recentBuyers.length} orders · last ${days} days`}
          onClose={() => setBuyerModal(false)}
        >
          <div className="divide-y divide-border-default">
            {data.recentBuyers.map(b => (
              <BuyerRow key={`${b.orderNumber}-${b.createdAt}`} b={b} large />
            ))}
          </div>
        </Modal>
      )}
    </div>
  )
}

function ReferrerRow({ r }: { r: { referrer: string; sessions: number } }) {
  return (
    <div className="flex items-center justify-between text-sm gap-2">
      <span className="text-foreground truncate flex-1 text-xs font-mono">{r.referrer}</span>
      <span className="text-foreground-secondary tabular-nums text-xs shrink-0">{r.sessions.toLocaleString()}</span>
    </div>
  )
}

function VariantTable({
  rows,
}: {
  rows: { variantName: string | null; orders: number; quantity: number; revenue: number }[]
}) {
  return (
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
        {rows.map((v, i) => (
          <tr key={i}>
            <td className="py-2 text-foreground">
              {v.variantName || <span className="text-foreground-muted italic">No variant</span>}
            </td>
            <td className="py-2 text-right tabular-nums">{v.orders}</td>
            <td className="py-2 text-right tabular-nums">{v.quantity}</td>
            <td className="py-2 text-right tabular-nums font-semibold">
              ₹{Math.round(v.revenue).toLocaleString('en-IN')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function BuyerRow({
  b,
  large,
}: {
  b: { orderNumber: string; createdAt: string; quantity: number; total: number; customerName: string }
  large?: boolean
}) {
  return (
    <Link
      href={ap(`/admin/orders?search=${b.orderNumber}`)}
      className={`flex items-center justify-between text-sm ${large ? 'py-2.5' : 'py-1.5'} hover:bg-surface-secondary/50 px-2 -mx-2 rounded transition-colors`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-foreground truncate">{b.customerName}</p>
        <p className="text-xs text-foreground-muted">
          {new Date(b.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} ·{' '}
          {b.quantity}× #{b.orderNumber}
        </p>
      </div>
      <span className="font-semibold text-foreground tabular-nums whitespace-nowrap ml-3">
        ₹{Math.round(b.total).toLocaleString('en-IN')}
      </span>
    </Link>
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
