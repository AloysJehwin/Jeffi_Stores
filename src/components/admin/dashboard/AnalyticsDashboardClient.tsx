'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { StatCard } from './StatCard'
import { TrendChart, DonutSplit, RankedBars } from './Charts'
import { ap } from '@/lib/admin-path'
import type { DashboardAnalytics, AnalyticsRange } from '@/lib/queries'
import type { ReactNode } from 'react'

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

const Chevron = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
)

/** Section title + optional right-aligned action link with trailing chevron. */
function SectionHeader({ title, actionLabel, href }: { title: string; actionLabel?: string; href?: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {actionLabel && href && (
        <Link href={href} className="inline-flex items-center gap-0.5 text-xs font-medium text-accent-600 hover:text-accent-500 transition-colors">
          {actionLabel} <Chevron />
        </Link>
      )}
    </div>
  )
}

/**
 * Unified premium tile shell. With `href` the whole card navigates (link mode —
 * must contain NO inner anchors). Without `href` it's a plain div (div mode —
 * for tiles that hold their own inner links, avoiding nested <a>).
 */
function SectionCard({ href, span, children }: { href?: string; span?: boolean; children: ReactNode }) {
  const base = `bg-surface-elevated rounded-xl ring-1 ring-border-default/70 dark:ring-white/5 shadow-sm dark:shadow-none p-4 sm:p-5 ${span ? 'lg:col-span-2' : ''}`
  if (href) {
    return (
      <Link href={href} className={`${base} block hover:ring-accent-500/50 hover:shadow-md transition-[box-shadow,ring-color] duration-200`}>
        {children}
      </Link>
    )
  }
  return <div className={base}>{children}</div>
}

/** Inline label/value pair, optionally a drill-down link, with tone accent. */
function MiniStat({ label, value, tone, href }: { label: string; value: string; tone?: string; href?: string }) {
  const val = <span className={`text-sm font-bold tabular-nums ${tone || 'text-foreground'}`}>{value}</span>
  const inner = (
    <>
      <span className="text-xs text-foreground-muted">{label}</span>
      {val}
    </>
  )
  if (href) {
    return (
      <Link href={href} className="flex items-center justify-between rounded-md px-1 -mx-1 py-1 hover:bg-surface-secondary transition-colors">
        {inner}
      </Link>
    )
  }
  return <div className="flex items-center justify-between py-1">{inner}</div>
}

/** Thin clickable row list (top products / recent orders). */
function ListRows({ rows }: { rows: { key: string; primary: string; secondary?: string; value?: string; badge?: ReactNode; href: string }[] }) {
  if (!rows.length) return <p className="text-xs text-foreground-muted py-4 text-center">No data yet.</p>
  return (
    <div className="divide-y divide-border-default">
      {rows.map(r => (
        <Link key={r.key} href={r.href} className="flex items-center gap-3 py-2.5 group hover:bg-surface-secondary rounded-md px-1 -mx-1 transition-colors">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground truncate group-hover:text-accent-600 transition-colors">{r.primary}</p>
            {r.secondary && <p className="text-xs text-foreground-muted truncate mt-0.5">{r.secondary}</p>}
          </div>
          <div className="text-right shrink-0 flex flex-col items-end gap-1">
            {r.badge}
            {r.value && <span className="text-xs font-semibold text-foreground tabular-nums">{r.value}</span>}
          </div>
        </Link>
      ))}
    </div>
  )
}

/** Clickable donut legend — makes each segment a real drill-down (DonutSplit stays visual-only). */
function LinkedLegend({ items }: { items: { label: string; value: string; color: string; href: string }[] }) {
  return (
    <ul className="mt-3 space-y-0.5">
      {items.map((it, i) => (
        <li key={i}>
          <Link href={it.href} className="flex items-center gap-2 text-xs rounded-md px-1 -mx-1 py-1 hover:bg-surface-secondary transition-colors">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: it.color }} />
            <span className="text-foreground-secondary flex-1 min-w-0 truncate">{it.label}</span>
            <span className="text-foreground font-semibold tabular-nums">{it.value}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

const FUNNEL_STAGES = [
  { key: 'pending', label: 'Pending', dot: 'bg-yellow-400 dark:bg-yellow-500', text: 'text-yellow-700 dark:text-yellow-300' },
  { key: 'processing', label: 'Processing', dot: 'bg-blue-400 dark:bg-blue-500', text: 'text-blue-700 dark:text-blue-300' },
  { key: 'shipped', label: 'Shipped', dot: 'bg-indigo-400 dark:bg-indigo-500', text: 'text-indigo-700 dark:text-indigo-300' },
  { key: 'out_for_delivery', label: 'Out for Delivery', dot: 'bg-violet-400 dark:bg-violet-500', text: 'text-violet-700 dark:text-violet-300' },
  { key: 'delivered', label: 'Delivered', dot: 'bg-accent-500', text: 'text-accent-600' },
  { key: 'cancelled', label: 'Cancelled', dot: 'bg-red-400 dark:bg-red-500', text: 'text-red-700 dark:text-red-300' },
] as const

/** Segmented horizontal funnel bar; each stage is a status-filtered order link. */
function FunnelBar({ counts, hrefFor }: { counts: Record<string, number>; hrefFor: (key: string) => string }) {
  const total = FUNNEL_STAGES.reduce((s, st) => s + (counts[st.key] || 0), 0)
  return (
    <div className="space-y-3">
      <div className="flex gap-1 h-2.5">
        {FUNNEL_STAGES.map(st => {
          const v = counts[st.key] || 0
          const pct = total > 0 ? Math.max(2, Math.round((v / total) * 100)) : 100 / FUNNEL_STAGES.length
          return (
            <Link
              key={st.key}
              href={hrefFor(st.key)}
              className={`${st.dot} rounded-full hover:opacity-80 transition-opacity`}
              style={{ flexGrow: v || 0.15 }}
              title={`${st.label}: ${v}`}
            />
          )
        })}
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {FUNNEL_STAGES.map(st => (
          <Link key={st.key} href={hrefFor(st.key)} className="group rounded-lg px-2 py-1.5 hover:bg-surface-secondary transition-colors">
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${st.dot}`} />
              <span className="text-xs text-foreground-muted truncate group-hover:text-foreground transition-colors">{st.label}</span>
            </div>
            <p className={`text-base font-bold tabular-nums mt-0.5 ${st.text}`}>{counts[st.key] || 0}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}

function statusBadgeClass(status: string) {
  if (status === 'delivered') return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
  if (status === 'processing' || status === 'confirmed') return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
  if (status === 'shipped') return 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
  if (status === 'out_for_delivery') return 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
  if (status === 'cancelled') return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
  if (status === 'cancel_requested') return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
  return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
}

function statusLabel(s: string) {
  if (s === 'out_for_delivery') return 'Out for Delivery'
  if (s === 'cancel_requested') return 'Cancel Req.'
  return s.replace(/_/g, ' ')
}

interface DashboardMetrics {
  funnel: { pending: number; processing: number; shipped: number; outForDelivery: number; delivered: number; cancelled: number }
  topProducts: { id: string; name: string; qty: number; revenue: number }[]
  recentOrders: any[]
}

/**
 * Interactive analytics section of the admin dashboard — the "Operations Command
 * Center" landing. Server-renders the initial range and the static ops block
 * (passed as children); refetches /api/admin/dashboard/analytics on range change.
 * Every data point drills down via ap(path, host).
 */
export default function AnalyticsDashboardClient({ initial, metrics, host, username, children }: {
  initial: DashboardAnalytics
  metrics: DashboardMetrics
  host: string
  username: string
  children?: ReactNode
}) {
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
  const topProductsMax = metrics.topProducts.reduce((m, p) => Math.max(m, p.qty), 1)

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* A. Header + range */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">Welcome back, {username}</h1>
          <p className="text-sm text-foreground-secondary mt-0.5">Store at a glance · {data.rangeLabel}</p>
        </div>
        <div className="flex items-center bg-surface-secondary border border-border-default rounded-xl p-1 gap-0.5 self-start shrink-0">
          {RANGES.map(r => (
            <button
              key={r.key}
              onClick={() => changeRange(r.key)}
              disabled={loading}
              className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 disabled:opacity-50 ${
                range === r.key ? 'bg-accent-500 text-white shadow-sm' : 'text-foreground-secondary hover:text-foreground'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* B/C/D. Server-static ops block (alert + command bar + needs-attention) */}
      {children}

      {/* Range-aware analytics dim during refetch; ops block above stays crisp */}
      <div className={`space-y-4 sm:space-y-6 transition-opacity ${loading ? 'opacity-60' : ''}`}>
        {/* E. KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
          <StatCard label="Revenue" value={rs(k.revenue)} sub={`Prev: ${rs(k.revenuePrev)}`} pct={k.revenuePct} color="bg-accent-500/10 text-accent-600" href={ap('/admin/financial', host)}
            icon={<Icon cls="text-accent-600" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />} />
          <StatCard label="Orders" value={k.orders.toLocaleString('en-IN')} sub={`Prev: ${k.ordersPrev}`} pct={k.ordersPct} color="bg-blue-500/10 text-blue-600 dark:text-blue-400" href={ap('/admin/orders', host)}
            icon={<Icon cls="text-blue-600 dark:text-blue-400" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />} />
          <StatCard label="Avg Order Value" value={rs(k.aov)} sub={`Prev: ${rs(k.aovPrev)}`} pct={k.aovPct} color="bg-amber-500/10 text-amber-600 dark:text-amber-400" href={ap('/admin/financial', host)}
            icon={<Icon cls="text-amber-600 dark:text-amber-400" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />} />
          <StatCard label="Customers" value={k.customers.toLocaleString('en-IN')} sub={`Prev: ${k.customersPrev}`} pct={k.customersPct} color="bg-violet-500/10 text-violet-600 dark:text-violet-400" href={ap('/admin/customers', host)}
            icon={<Icon cls="text-violet-600 dark:text-violet-400" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />} />
        </div>

        {/* F. Trend (2/3) + Payment (1/3) — trend chart hidden on mobile */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
          <SectionCard span>
            <SectionHeader title="Revenue & Orders" actionLabel="Orders" href={ap('/admin/orders', host)} />
            <div className="hidden sm:block">
              <TrendChart points={data.trend} />
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
            <SectionHeader title="Payment Split" actionLabel="Ledger" href={ap('/admin/financial', host)} />
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
            <LinkedLegend items={[
              { label: 'Online', value: rs(data.payment.online), color: 'rgb(59 130 246)', href: ap('/admin/orders', host) },
              { label: 'COD', value: rs(data.payment.cod), color: 'rgb(245 158 11)', href: ap('/admin/orders', host) },
            ]} />
            {data.payment.codOutstanding > 0 && (
              <div className="mt-3 pt-3 border-t border-border-default">
                <MiniStat label={`COD outstanding (${data.payment.codOutstandingCount})`} value={rs(data.payment.codOutstanding)} tone="text-orange-600 dark:text-orange-400" href={ap('/admin/financial', host)} />
              </div>
            )}
          </SectionCard>
        </div>

        {/* G. Order Funnel */}
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
            hrefFor={(key) => ap(`/admin/orders?status=${key}`, host)}
          />
        </SectionCard>

        {/* H. Categories / Brands / Buyer mix */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          <SectionCard href={ap('/admin/categories', host)}>
            <SectionHeader title="Top Categories" />
            <RankedBars items={data.topCategories.map(c => ({ name: c.name, value: c.revenue, sub: rs(c.revenue) }))} />
          </SectionCard>
          <SectionCard href={ap('/admin/brands', host)}>
            <SectionHeader title="Top Brands" />
            <RankedBars items={data.topBrands.map(b => ({ name: b.name, value: b.revenue, sub: rs(b.revenue) }))} barClass="bg-violet-500" />
          </SectionCard>
          <SectionCard href={ap('/admin/business/customers', host)}>
            <SectionHeader title="Buyer Mix" />
            <DonutSplit
              size={130}
              centerValue={rs(data.buyerSplit.businessRevenue + data.buyerSplit.consumerRevenue)}
              centerLabel="revenue"
              segments={[
                { label: `Business (${data.buyerSplit.business})`, value: data.buyerSplit.businessRevenue, color: '#7cb900' },
                { label: `Consumer (${data.buyerSplit.consumer})`, value: data.buyerSplit.consumerRevenue, color: 'rgb(59 130 246)' },
              ]}
            />
          </SectionCard>
        </div>

        {/* I. Top products / Recent orders */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
          <SectionCard>
            <SectionHeader title="Top Products" actionLabel="All products" href={ap('/admin/products', host)} />
            <ListRows rows={metrics.topProducts.map((p, i) => ({
              key: p.id,
              primary: `${i + 1}. ${p.name}`,
              value: `${p.qty} · ${rs(p.revenue)}`,
              href: ap(`/admin/products/edit/${p.id}`, host),
            }))} />
          </SectionCard>
          <SectionCard>
            <SectionHeader title="Recent Orders" actionLabel="All orders" href={ap('/admin/orders', host)} />
            <ListRows rows={metrics.recentOrders.map((o: any) => ({
              key: o.id,
              primary: `#${o.order_number || o.id.slice(0, 8)}`,
              secondary: o.users?.first_name ? `${o.users.first_name} ${o.users.last_name || ''}`.trim() : o.customer_name || 'Guest',
              value: rs(Number(o.total_amount)),
              badge: <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${statusBadgeClass(o.status)}`}>{statusLabel(o.status)}</span>,
              href: ap(`/admin/orders/${o.id}`, host),
            }))} />
          </SectionCard>
        </div>

        {/* J. Inventory / Customer split / Returns */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          <SectionCard>
            <SectionHeader title="Inventory Health" actionLabel="Inventory" href={ap('/admin/inventory', host)} />
            <div className="space-y-0.5">
              <MiniStat label="In stock" value={String(data.inventory.inStock)} tone="text-green-600 dark:text-green-400" href={ap('/admin/inventory', host)} />
              <MiniStat label="Low stock" value={String(data.inventory.lowStock)} tone="text-yellow-600 dark:text-yellow-400" href={ap('/admin/inventory', host)} />
              <MiniStat label="Out of stock" value={String(data.inventory.outOfStock)} tone="text-red-500 dark:text-red-400" href={ap('/admin/inventory', host)} />
              <MiniStat label="Stock value" value={rs(data.inventory.stockValue)} href={ap('/admin/financial', host)} />
            </div>
          </SectionCard>
          <SectionCard href={ap('/admin/customers', host)}>
            <SectionHeader title="Customer Split" />
            <DonutSplit
              size={130}
              centerValue={(data.customerSplit.newCustomers + data.customerSplit.returningCustomers).toLocaleString('en-IN')}
              centerLabel="active"
              segments={[
                { label: 'New', value: data.customerSplit.newCustomers, color: 'rgb(16 185 129)' },
                { label: 'Returning', value: data.customerSplit.returningCustomers, color: 'rgb(59 130 246)' },
              ]}
            />
          </SectionCard>
          <SectionCard>
            <SectionHeader title="Returns & RTO" actionLabel="Returns" href={ap('/admin/returns', host)} />
            <div className="space-y-0.5">
              <MiniStat label="Return requests" value={String(data.returns.total)} href={ap('/admin/returns', host)} />
              <MiniStat label="RTO in transit" value={String(data.returns.rtoInTransit)} tone="text-orange-600 dark:text-orange-400" href={ap('/admin/returns', host)} />
              <MiniStat label="RTO delivered back" value={String(data.returns.rtoDelivered)} tone="text-red-500 dark:text-red-400" href={ap('/admin/returns', host)} />
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
