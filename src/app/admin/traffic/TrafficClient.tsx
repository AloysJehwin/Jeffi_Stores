'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Smartphone, Tablet as TabletIcon, Monitor,
  TrendingUp, TrendingDown, Minus,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  BarChart2, Search, AlertCircle, ShoppingCart, Eye, Package,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const FUNNEL_LABELS: Record<string, string> = {
  home: 'Homepage', categories: 'Categories', category: 'Category Page',
  product: 'Product Page', cart: 'Cart', checkout: 'Checkout', order_placed: 'Order Placed',
}

const FUNNEL_COLORS: Record<string, string> = {
  home: 'bg-blue-500', categories: 'bg-indigo-500', category: 'bg-violet-500',
  product: 'bg-purple-500', cart: 'bg-amber-500', checkout: 'bg-orange-500', order_placed: 'bg-green-500',
}

const FUNNEL_FILL: Record<string, string> = {
  home: '#3b82f6', categories: '#6366f1', category: '#8b5cf6',
  product: '#a855f7', cart: '#f59e0b', checkout: '#f97316', order_placed: '#22c55e',
}

const DEVICE_ICONS: Record<string, LucideIcon> = {
  Mobile: Smartphone, Tablet: TabletIcon, Desktop: Monitor,
}

const DEVICE_COLORS: Record<string, string> = {
  Mobile: '#3b82f6', Tablet: '#8b5cf6', Desktop: '#22c55e',
}

const BROWSER_COLORS_HEX: Record<string, string> = {
  Chrome: '#eab308', Firefox: '#f97316', Safari: '#60a5fa',
  Edge: '#2563eb', Opera: '#ef4444', Chromium: '#14b8a6', Other: '#6b7280',
}

interface FunnelStep { page: string; sessions: number; users: number; pct: number }
interface DayRow { date: string; sessions: number; pageviews: number }
interface RefRow { referrer: string; sessions: number }
interface PageRow { path: string; hits: number; sessions: number }
interface DeviceRow { type: string; sessions: number }
interface BrowserRow { browser: string; sessions: number }
interface HourRow { hour: number; hits: number }
interface Totals { sessions: number; pageviews: number; conversions: number; bounceRate: number; avgPages: number }
interface TopProductRow {
  productId: string; name: string; slug: string; views: number;
  uniqueViewers: number; cartAdds: number; orders: number; revenue: number; conversionRate: number
}
interface ConversionLaggardRow { productId: string; name: string; slug: string; views: number; orders: number }
interface SearchTermRow { query: string; searches: number; clicks: number }
interface NoResultSearchRow { query: string; searches: number }

interface TrafficData {
  funnel: FunnelStep[]
  topPages: PageRow[]
  topReferrers: RefRow[]
  dailySessions: DayRow[]
  devices: DeviceRow[]
  browsers: BrowserRow[]
  hourly: HourRow[]
  topProducts: TopProductRow[]
  conversionLaggards: ConversionLaggardRow[]
  topSearchTerms: SearchTermRow[]
  noResultSearches: NoResultSearchRow[]
  totals: Totals
}

const DAYS_OPTIONS = [
  { label: '7d', value: 7 },
  { label: '14d', value: 14 },
  { label: '30d', value: 30 },
  { label: '60d', value: 60 },
]

const PAGE_SIZE = 10

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, highlight, icon: Icon, trend }: {
  label: string; value: string; sub?: string; highlight?: boolean
  icon?: LucideIcon; trend?: 'up' | 'down' | 'flat'
}) {
  return (
    <div className={`bg-surface-elevated border rounded-xl p-4 flex flex-col gap-1 ${highlight ? 'border-accent-500/50' : 'border-border-default'}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs text-foreground-muted uppercase tracking-wide font-medium">{label}</p>
        {Icon && <Icon className="w-4 h-4 text-foreground-muted" />}
      </div>
      <div className="flex items-end gap-2">
        <p className={`text-2xl font-bold ${highlight ? 'text-accent-500' : 'text-foreground'}`}>{value}</p>
        {trend === 'up' && <TrendingUp className="w-4 h-4 text-green-500 mb-1" />}
        {trend === 'down' && <TrendingDown className="w-4 h-4 text-red-400 mb-1" />}
        {trend === 'flat' && <Minus className="w-4 h-4 text-foreground-muted mb-1" />}
      </div>
      {sub && <p className="text-xs text-foreground-muted">{sub}</p>}
    </div>
  )
}

// ─── Section ──────────────────────────────────────────────────────────────────
function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-surface-elevated border border-border-default rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}

function Empty({ msg = 'No data yet' }: { msg?: string }) {
  return <p className="text-sm text-foreground-muted text-center py-8">{msg}</p>
}

// ─── Donut Chart ──────────────────────────────────────────────────────────────
function DonutChart({ segments, size = 120 }: {
  segments: { label: string; value: number; color: string }[]
  size?: number
}) {
  const total = segments.reduce((s, x) => s + x.value, 0)
  if (total === 0) return <Empty />
  const r = 40, cx = 50, cy = 50, stroke = 14
  const circ = 2 * Math.PI * r

  let offset = 0
  const slices = segments.map(seg => {
    const frac = seg.value / total
    const dash = frac * circ
    const gap = circ - dash
    const slice = { ...seg, offset, dash, gap, frac }
    offset += dash
    return slice
  })

  return (
    <div className="flex flex-col items-center gap-3">
      <svg width={size} height={size} viewBox="0 0 100 100" className="-rotate-90">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--color-surface-secondary)" strokeWidth={stroke} />
        {slices.map(s => (
          <circle
            key={s.label}
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={stroke}
            strokeDasharray={`${s.dash} ${s.gap}`}
            strokeDashoffset={-s.offset}
            strokeLinecap="butt"
          />
        ))}
      </svg>
      <div className="w-full space-y-1.5">
        {segments.map(seg => {
          const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0
          return (
            <div key={seg.label} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-foreground font-medium">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                {seg.label}
              </span>
              <span className="text-foreground-muted tabular-nums">{seg.value.toLocaleString()} <span className="text-foreground-muted/60">({pct}%)</span></span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Tooltip bar chart helper ─────────────────────────────────────────────────
function TooltipBar({ label, value, color, maxValue, secondary, secondaryColor }: {
  label: string; value: number; color: string; maxValue: number
  secondary?: number; secondaryColor?: string
}) {
  const [hovered, setHovered] = useState(false)
  const pct = maxValue > 0 ? Math.max(4, Math.round((value / maxValue) * 100)) : 4
  const secPct = secondary !== undefined && maxValue > 0 ? Math.max(2, Math.round((secondary / maxValue) * 100)) : 0
  return (
    <div
      className="flex-1 flex flex-col items-center gap-0.5 group relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && (
        <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 z-10 text-[10px] rounded px-2 py-1.5 whitespace-nowrap pointer-events-none shadow-lg" style={{ backgroundColor: '#1e2030', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="font-semibold">{label}</div>
          <div>{value.toLocaleString()} {secondary !== undefined ? 'pageviews' : 'hits'}</div>
          {secondary !== undefined && <div style={{ color: 'rgba(148,163,184,0.8)' }}>{secondary.toLocaleString()} sessions</div>}
        </div>
      )}
      <div className="relative w-full flex items-end justify-center gap-0.5" style={{ height: '140px' }}>
        <div className="rounded-t transition-all duration-200" style={{ width: secondary !== undefined ? '45%' : '70%', height: `${pct}%`, backgroundColor: color }} />
        {secondary !== undefined && secondaryColor && (
          <div className="rounded-t transition-all duration-200" style={{ width: '45%', height: `${secPct}%`, backgroundColor: secondaryColor }} />
        )}
      </div>
    </div>
  )
}

// ─── Pagination ───────────────────────────────────────────────────────────────
function Pagination({ page, total, pageSize, onChange }: {
  page: number; total: number; pageSize: number; onChange: (p: number) => void
}) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between mt-4 pt-3 border-t border-border-default text-xs">
      <span className="text-foreground-muted">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onChange(page - 1)} disabled={page === 1} className="p-1.5 rounded border border-border-default text-foreground-muted hover:bg-surface-secondary disabled:opacity-40">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="px-2 text-foreground">
          {page} / {totalPages}
        </span>
        <button type="button" onClick={() => onChange(page + 1)} disabled={page >= totalPages} className="p-1.5 rounded border border-border-default text-foreground-muted hover:bg-surface-secondary disabled:opacity-40">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ─── Collapsible Section ──────────────────────────────────────────────────────
function CollapsibleSection({ title, children, defaultOpen = true, badge }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean; badge?: string | number
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-surface-elevated border border-border-default rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-surface-secondary/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">{title}</h2>
          {badge !== undefined && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-accent-500/15 text-accent-600 dark:text-accent-400">{badge}</span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-foreground-muted" /> : <ChevronDown className="w-4 h-4 text-foreground-muted" />}
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  )
}

type TrafficTab = 'overview' | 'funnel' | 'pages' | 'audience' | 'products'
const TRAFFIC_TABS: TrafficTab[] = ['overview', 'funnel', 'products', 'pages', 'audience']

export default function TrafficClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab') as TrafficTab | null
  const initialTab: TrafficTab = tabParam && TRAFFIC_TABS.includes(tabParam) ? tabParam : 'overview'

  const [days, setDays] = useState(7)
  const [data, setData] = useState<TrafficData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTabState] = useState<TrafficTab>(initialTab)

  // Pagination state
  const [productPage, setProductPage] = useState(1)
  const [laggardPage, setLaggardPage] = useState(1)
  const [searchPage, setSearchPage] = useState(1)
  const [noResultPage, setNoResultPage] = useState(1)
  const [pagesPage, setPagesPage] = useState(1)
  const [referrerPage, setReferrerPage] = useState(1)

  function setTab(next: TrafficTab) {
    setTabState(next)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', next)
    router.push(`/admin/traffic?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    setLoading(true)
    // reset pagination when period changes
    setProductPage(1); setLaggardPage(1); setSearchPage(1)
    setNoResultPage(1); setPagesPage(1); setReferrerPage(1)
    fetch(`/api/admin/traffic?days=${days}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [days])

  const convRate = data && data.totals.sessions > 0
    ? ((data.totals.conversions / data.totals.sessions) * 100).toFixed(1)
    : '0.0'

  const maxPageviews = data ? Math.max(...data.dailySessions.map(d => d.pageviews), 1) : 1
  const maxSessions = data ? Math.max(...data.dailySessions.map(d => d.sessions), 1) : 1
  const maxHour = data ? Math.max(...data.hourly.map(h => h.hits), 1) : 1

  const TABS = [
    { id: 'overview' as const, label: 'Overview', icon: BarChart2 },
    { id: 'funnel' as const, label: 'Funnel', icon: TrendingUp },
    { id: 'products' as const, label: 'Products', icon: Package },
    { id: 'pages' as const, label: 'Pages & Sources', icon: Eye },
    { id: 'audience' as const, label: 'Audience', icon: Smartphone },
  ]

  // Sliced data for pagination
  const pagedProducts = data ? data.topProducts.slice((productPage - 1) * PAGE_SIZE, productPage * PAGE_SIZE) : []
  const pagedLaggards = data ? data.conversionLaggards.slice((laggardPage - 1) * PAGE_SIZE, laggardPage * PAGE_SIZE) : []
  const pagedSearchTerms = data ? data.topSearchTerms.slice((searchPage - 1) * PAGE_SIZE, searchPage * PAGE_SIZE) : []
  const pagedNoResults = data ? data.noResultSearches.slice((noResultPage - 1) * PAGE_SIZE, noResultPage * PAGE_SIZE) : []
  const pagedPages = data ? data.topPages.slice((pagesPage - 1) * PAGE_SIZE, pagesPage * PAGE_SIZE) : []
  const pagedReferrers = data ? data.topReferrers.slice((referrerPage - 1) * PAGE_SIZE, referrerPage * PAGE_SIZE) : []

  const totalRevenue = data ? data.topProducts.reduce((s, p) => s + p.revenue, 0) : 0

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Traffic</h1>
          <p className="text-sm text-foreground-secondary mt-0.5">Visitor analytics · funnel · audience</p>
        </div>
        <div className="flex gap-1 p-1 bg-surface-elevated border border-border-default rounded-lg">
          {DAYS_OPTIONS.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => setDays(o.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                days === o.value ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-surface-elevated border border-border-default animate-pulse" />
            ))}
          </div>
          <div className="h-64 rounded-xl bg-surface-elevated border border-border-default animate-pulse" />
        </div>
      ) : !data ? (
        <div className="flex items-center justify-center h-64 text-foreground-muted text-sm">Failed to load data.</div>
      ) : (
        <>
          {/* KPI Row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard label="Sessions" value={data.totals.sessions.toLocaleString()} icon={BarChart2} />
            <KpiCard label="Pageviews" value={data.totals.pageviews.toLocaleString()} icon={Eye} />
            <KpiCard label="Avg Pages" value={String(data.totals.avgPages)} sub="Per session" />
            <KpiCard
              label="Bounce Rate"
              value={`${data.totals.bounceRate}%`}
              sub="Single-page sessions"
              trend={data.totals.bounceRate > 60 ? 'down' : data.totals.bounceRate < 30 ? 'up' : 'flat'}
            />
            <KpiCard label="Orders" value={data.totals.conversions.toLocaleString()} icon={ShoppingCart} />
            <KpiCard label="Conv. Rate" value={`${convRate}%`} highlight icon={TrendingUp}
              trend={parseFloat(convRate) >= 3 ? 'up' : parseFloat(convRate) >= 1 ? 'flat' : 'down'} />
          </div>

          {/* Tabs */}
          <div className="flex gap-0.5 border-b border-border-default overflow-x-auto">
            {TABS.map(t => {
              const Icon = t.icon
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors -mb-px whitespace-nowrap ${
                    tab === t.id
                      ? 'border-accent-500 text-accent-600 dark:text-accent-400'
                      : 'border-transparent text-foreground-muted hover:text-foreground'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              )
            })}
          </div>

          {/* ── OVERVIEW ── */}
          {tab === 'overview' && (
            <div className="space-y-5">
              <Section title="Daily Traffic">
                {data.dailySessions.length === 0 ? <Empty /> : (
                  <div className="space-y-3">
                    <div className="flex items-end gap-1 h-44">
                      {data.dailySessions.map(d => {
                        const label = new Date(d.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                        return (
                          <TooltipBar
                            key={d.date}
                            label={label}
                            value={d.pageviews}
                            color="#84cc16"
                            maxValue={maxPageviews}
                            secondary={d.sessions}
                            secondaryColor="rgba(148,163,184,0.6)"
                          />
                        )
                      })}
                    </div>
                    {data.dailySessions.length <= 14 && (
                      <div className="flex gap-1">
                        {data.dailySessions.map(d => (
                          <div key={d.date} className="flex-1 text-center">
                            <span className="text-[9px] text-foreground-muted">
                              {new Date(d.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-4 text-xs text-foreground-muted">
                      <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: '#84cc16' }} />Pageviews
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: 'rgba(148,163,184,0.6)' }} />Sessions
                      </span>
                    </div>
                  </div>
                )}
              </Section>

              <Section title="Activity by Hour (IST)">
                {data.hourly.every(h => h.hits === 0) ? <Empty /> : (
                  <div className="space-y-2">
                    {/* Heatmap */}
                    <div className="grid grid-cols-24 gap-1" style={{ gridTemplateColumns: 'repeat(24,1fr)' }}>
                      {data.hourly.map(h => {
                        const intensity = maxHour > 0 ? h.hits / maxHour : 0
                        const bg = intensity > 0.75 ? '#84cc16' : intensity > 0.5 ? 'rgba(132,204,22,0.7)' : intensity > 0.25 ? 'rgba(132,204,22,0.4)' : intensity > 0 ? 'rgba(132,204,22,0.15)' : undefined
                        return (
                          <div
                            key={h.hour}
                            title={`${h.hour}:00 — ${h.hits} hits`}
                            className="h-8 rounded cursor-default group relative bg-surface-secondary"
                            style={bg ? { backgroundColor: bg } : undefined}
                          >
                            <div className="absolute -top-7 left-1/2 -translate-x-1/2 z-10 hidden group-hover:block text-[10px] rounded px-1.5 py-0.5 whitespace-nowrap pointer-events-none shadow" style={{ backgroundColor: '#1e2030', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.08)' }}>
                              {h.hour}:00 · {h.hits}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <div className="flex justify-between text-[9px] text-foreground-muted px-0.5">
                      {[0, 3, 6, 9, 12, 15, 18, 21, 23].map(h => (
                        <span key={h}>{h}:00</span>
                      ))}
                    </div>
                    {/* Bar chart below heatmap */}
                    <div className="flex items-end gap-0.5 h-16 mt-2">
                      {data.hourly.map(h => {
                        const ht = maxHour > 0 ? Math.max(2, Math.round((h.hits / maxHour) * 100)) : 2
                        return (
                          <div key={h.hour} className="flex-1 flex flex-col items-center group">
                            <div className="w-full flex items-end justify-center" style={{ height: '64px' }}>
                              <div
                                className="w-full rounded-t transition-colors"
                                style={{ height: `${ht}%`, backgroundColor: 'rgba(132,204,22,0.6)' }}
                                title={`${h.hour}:00 — ${h.hits} hits`}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </Section>

              {/* Daily table summary */}
              {data.dailySessions.length > 0 && (
                <CollapsibleSection title="Daily Breakdown" defaultOpen={false} badge={data.dailySessions.length}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border-default text-xs uppercase tracking-wide text-foreground-muted">
                          <th className="text-left py-2 px-2 font-semibold">Date</th>
                          <th className="text-right py-2 px-2 font-semibold">Sessions</th>
                          <th className="text-right py-2 px-2 font-semibold">Pageviews</th>
                          <th className="text-right py-2 px-2 font-semibold">Pages/Session</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-default">
                        {data.dailySessions.map(d => (
                          <tr key={d.date} className="hover:bg-surface-secondary/50">
                            <td className="py-2 px-2 text-foreground">
                              {new Date(d.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </td>
                            <td className="py-2 px-2 text-right tabular-nums text-foreground">{d.sessions.toLocaleString()}</td>
                            <td className="py-2 px-2 text-right tabular-nums text-foreground">{d.pageviews.toLocaleString()}</td>
                            <td className="py-2 px-2 text-right tabular-nums text-foreground-muted">
                              {d.sessions > 0 ? (d.pageviews / d.sessions).toFixed(1) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CollapsibleSection>
              )}
            </div>
          )}

          {/* ── FUNNEL ── */}
          {tab === 'funnel' && (
            <div className="space-y-5">
              <Section title="Conversion Funnel">
                {data.totals.sessions === 0 ? (
                  <Empty msg="No traffic data yet — tracking is live and will populate as visitors arrive." />
                ) : (
                  <div className="space-y-1">
                    {data.funnel.map((step, i) => {
                      const prev = i > 0 ? data.funnel[i - 1].sessions : step.sessions
                      const dropPct = prev > 0 && i > 0 ? Math.round(((prev - step.sessions) / prev) * 100) : null
                      const lost = i > 0 ? prev - step.sessions : 0
                      const color = FUNNEL_FILL[step.page] || '#6b7280'
                      return (
                        <div key={step.page}>
                          {i > 0 && (
                            <div className="flex items-center gap-2 py-1.5 pl-5">
                              <svg className="w-3 h-3 text-foreground-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                              {dropPct !== null && dropPct > 0 ? (
                                <span className="text-xs text-red-500 dark:text-red-400 font-medium">
                                  −{dropPct}% drop · {lost.toLocaleString()} visitors lost
                                </span>
                              ) : (
                                <span className="text-xs text-green-600 dark:text-green-400 font-medium">No drop</span>
                              )}
                            </div>
                          )}
                          <div className="rounded-lg border border-border-default overflow-hidden">
                            <div className="flex items-center gap-3 px-4 py-3 bg-surface-secondary/50">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                              <span className="text-sm font-semibold text-foreground flex-1">{FUNNEL_LABELS[step.page]}</span>
                              <div className="flex items-center gap-4 text-sm text-right">
                                <span className="text-foreground-secondary tabular-nums">{step.sessions.toLocaleString()} sessions</span>
                                <span className="text-foreground-muted tabular-nums text-xs">{step.users.toLocaleString()} users</span>
                                <span className="font-bold text-foreground w-12 text-right tabular-nums">{step.pct}%</span>
                              </div>
                            </div>
                            {/* Dual bar: sessions vs users */}
                            <div className="px-4 py-2 space-y-1">
                              <div className="h-2.5 bg-surface-secondary rounded-full overflow-hidden">
                                <div className="h-full rounded-full transition-all" style={{ width: `${step.pct}%`, backgroundColor: color, opacity: 0.85 }} />
                              </div>
                              {step.users > 0 && step.users !== step.sessions && (
                                <div className="h-1.5 bg-surface-secondary rounded-full overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all opacity-50"
                                    style={{ width: `${Math.round((step.users / (data.funnel[0]?.sessions || 1)) * 100)}%`, backgroundColor: color }}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}

                    <div className="pt-4 border-t border-border-default mt-4 grid grid-cols-3 gap-3">
                      <div className="rounded-lg bg-surface-secondary p-3 text-center">
                        <p className="text-xs text-foreground-muted uppercase tracking-wide">Entry</p>
                        <p className="text-xl font-bold text-foreground mt-0.5">{data.funnel[0]?.sessions.toLocaleString() || 0}</p>
                        <p className="text-[10px] text-foreground-muted">sessions</p>
                      </div>
                      <div className="rounded-lg bg-surface-secondary p-3 text-center">
                        <p className="text-xs text-foreground-muted uppercase tracking-wide">Orders</p>
                        <p className="text-xl font-bold text-foreground mt-0.5">{data.totals.conversions.toLocaleString()}</p>
                        <p className="text-[10px] text-foreground-muted">completed</p>
                      </div>
                      <div className="rounded-lg bg-accent-500/10 border border-accent-500/30 p-3 text-center">
                        <p className="text-xs text-accent-600 dark:text-accent-400 uppercase tracking-wide">Conv. Rate</p>
                        <p className="text-xl font-bold text-accent-500 mt-0.5">{convRate}%</p>
                        <p className="text-[10px] text-foreground-muted">overall</p>
                      </div>
                    </div>
                  </div>
                )}
              </Section>

              {/* Drop analysis */}
              {data.funnel.length > 1 && (
                <CollapsibleSection title="Step-by-step drop analysis" defaultOpen={true}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border-default text-xs uppercase tracking-wide text-foreground-muted">
                          <th className="text-left py-2 px-2 font-semibold">Step</th>
                          <th className="text-right py-2 px-2 font-semibold">Sessions</th>
                          <th className="text-right py-2 px-2 font-semibold">Users</th>
                          <th className="text-right py-2 px-2 font-semibold">vs prev</th>
                          <th className="text-right py-2 px-2 font-semibold">From entry</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-default">
                        {data.funnel.map((step, i) => {
                          const prev = i > 0 ? data.funnel[i - 1].sessions : step.sessions
                          const dropPct = prev > 0 && i > 0 ? Math.round(((prev - step.sessions) / prev) * 100) : null
                          const color = FUNNEL_FILL[step.page]
                          return (
                            <tr key={step.page} className="hover:bg-surface-secondary/50">
                              <td className="py-2 px-2 flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                                <span className="font-medium text-foreground">{FUNNEL_LABELS[step.page]}</span>
                              </td>
                              <td className="py-2 px-2 text-right tabular-nums text-foreground">{step.sessions.toLocaleString()}</td>
                              <td className="py-2 px-2 text-right tabular-nums text-foreground-muted">{step.users.toLocaleString()}</td>
                              <td className="py-2 px-2 text-right tabular-nums">
                                {dropPct === null ? <span className="text-foreground-muted">—</span> :
                                  dropPct > 0
                                    ? <span className="text-red-500 font-medium">−{dropPct}%</span>
                                    : <span className="text-green-600 font-medium">0%</span>}
                              </td>
                              <td className="py-2 px-2 text-right tabular-nums font-bold text-foreground">{step.pct}%</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </CollapsibleSection>
              )}
            </div>
          )}

          {/* ── PRODUCTS ── */}
          {tab === 'products' && (
            <div className="space-y-5">
              {/* Revenue summary KPI */}
              {totalRevenue > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <KpiCard label="Total Revenue" value={`₹${totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} highlight icon={TrendingUp} />
                  <KpiCard label="Products Viewed" value={data.topProducts.length.toString()} icon={Eye} />
                  <KpiCard
                    label="Avg Conv. Rate"
                    value={`${data.topProducts.length > 0 ? (data.topProducts.reduce((s, p) => s + p.conversionRate, 0) / data.topProducts.length).toFixed(1) : 0}%`}
                  />
                  <KpiCard label="Cart Adds" value={data.topProducts.reduce((s, p) => s + p.cartAdds, 0).toLocaleString()} icon={ShoppingCart} />
                </div>
              )}

              <CollapsibleSection title="Top Products by Views" defaultOpen={true} badge={data.topProducts.length}>
                {data.topProducts.length === 0 ? (
                  <p className="text-sm text-foreground-muted">No product views in this period.</p>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="text-xs uppercase tracking-wide text-foreground-muted border-b border-border-default">
                            <th className="text-left py-2 px-2 font-semibold">#</th>
                            <th className="text-left py-2 px-2 font-semibold">Product</th>
                            <th className="text-right py-2 px-2 font-semibold">Views</th>
                            <th className="text-right py-2 px-2 font-semibold">Unique</th>
                            <th className="text-right py-2 px-2 font-semibold">Carts</th>
                            <th className="text-right py-2 px-2 font-semibold">Orders</th>
                            <th className="text-right py-2 px-2 font-semibold">Revenue</th>
                            <th className="text-right py-2 px-2 font-semibold">CR%</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border-default">
                          {pagedProducts.map((p, i) => {
                            const rank = (productPage - 1) * PAGE_SIZE + i + 1
                            const maxViews = data.topProducts[0]?.views || 1
                            return (
                              <tr key={p.productId} className="hover:bg-surface-secondary/50">
                                <td className="py-2 px-2 text-xs font-bold text-foreground-muted w-6">{rank}</td>
                                <td className="py-2 px-2 max-w-[180px]">
                                  <a href={`/admin/products/${p.productId}/analytics`} className="text-foreground hover:text-accent-600 truncate block text-xs font-medium">
                                    {p.name}
                                  </a>
                                  <div className="mt-1 h-1 bg-surface-secondary rounded-full">
                                    <div className="h-full rounded-full" style={{ width: `${Math.round((p.views / maxViews) * 100)}%`, backgroundColor: 'rgba(132,204,22,0.5)' }} />
                                  </div>
                                  {/* micro funnel */}
                                  <div className="flex items-center gap-1 mt-1">
                                    {[
                                      { v: p.views, color: 'bg-blue-400', label: 'views' },
                                      { v: p.cartAdds, color: 'bg-amber-400', label: 'carts' },
                                      { v: p.orders, color: 'bg-green-500', label: 'orders' },
                                    ].map(seg => (
                                      <span
                                        key={seg.label}
                                        className={`inline-block h-1 rounded-full ${seg.color}`}
                                        style={{ width: `${p.views > 0 ? Math.max(4, Math.round((seg.v / p.views) * 60)) : 0}px` }}
                                        title={`${seg.label}: ${seg.v}`}
                                      />
                                    ))}
                                  </div>
                                </td>
                                <td className="py-2 px-2 text-right tabular-nums text-foreground text-xs">{p.views.toLocaleString()}</td>
                                <td className="py-2 px-2 text-right tabular-nums text-foreground-muted text-xs">{p.uniqueViewers.toLocaleString()}</td>
                                <td className="py-2 px-2 text-right tabular-nums text-foreground-secondary text-xs">{p.cartAdds.toLocaleString()}</td>
                                <td className="py-2 px-2 text-right tabular-nums text-foreground-secondary text-xs">{p.orders.toLocaleString()}</td>
                                <td className="py-2 px-2 text-right tabular-nums text-foreground text-xs font-medium">
                                  {p.revenue > 0 ? `₹${p.revenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}
                                </td>
                                <td className={`py-2 px-2 text-right tabular-nums font-semibold text-xs ${p.conversionRate >= 5 ? 'text-green-600 dark:text-green-400' : p.conversionRate >= 1 ? 'text-foreground' : 'text-foreground-muted'}`}>
                                  {p.conversionRate}%
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <Pagination page={productPage} total={data.topProducts.length} pageSize={PAGE_SIZE} onChange={setProductPage} />
                  </>
                )}
              </CollapsibleSection>

              <CollapsibleSection title="Conversion Laggards — high views, 0 orders" defaultOpen={true} badge={data.conversionLaggards.length}>
                {data.conversionLaggards.length === 0 ? (
                  <p className="text-sm text-foreground-muted">No products with stuck-conversion patterns.</p>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="text-xs uppercase tracking-wide text-foreground-muted border-b border-border-default">
                            <th className="text-left py-2 px-2 font-semibold">#</th>
                            <th className="text-left py-2 px-2 font-semibold">Product</th>
                            <th className="text-right py-2 px-2 font-semibold">Views</th>
                            <th className="text-right py-2 px-2 font-semibold">Orders</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border-default">
                          {pagedLaggards.map((p, i) => {
                            const rank = (laggardPage - 1) * PAGE_SIZE + i + 1
                            return (
                              <tr key={p.productId} className="hover:bg-surface-secondary/50">
                                <td className="py-2 px-2 text-xs font-bold text-foreground-muted w-6">{rank}</td>
                                <td className="py-2 px-2 max-w-[240px]">
                                  <a href={`/admin/products/${p.productId}/analytics`} className="text-foreground hover:text-accent-600 truncate block text-xs font-medium">
                                    {p.name}
                                  </a>
                                </td>
                                <td className="py-2 px-2 text-right tabular-nums text-orange-600 dark:text-orange-400 font-semibold text-xs">{p.views.toLocaleString()}</td>
                                <td className="py-2 px-2 text-right tabular-nums text-foreground-muted text-xs">{p.orders}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-foreground-muted mt-3">20+ views with 0 paid orders — check pricing, images, or stock.</p>
                    <Pagination page={laggardPage} total={data.conversionLaggards.length} pageSize={PAGE_SIZE} onChange={setLaggardPage} />
                  </>
                )}
              </CollapsibleSection>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <CollapsibleSection title="Top Search Terms" defaultOpen={true} badge={data.topSearchTerms.length}>
                  {data.topSearchTerms.length === 0 ? (
                    <p className="text-sm text-foreground-muted">No search activity yet.</p>
                  ) : (
                    <>
                      <div className="space-y-2">
                        {pagedSearchTerms.map((t, i) => {
                          const rank = (searchPage - 1) * PAGE_SIZE + i + 1
                          const maxSearches = data.topSearchTerms[0]?.searches || 1
                          const pct = Math.round((t.searches / maxSearches) * 100)
                          const hitRate = t.searches > 0 ? Math.round((t.clicks / t.searches) * 100) : 0
                          return (
                            <div key={t.query}>
                              <div className="flex items-center justify-between text-xs mb-0.5">
                                <span className="font-medium text-foreground flex items-center gap-1.5">
                                  <span className="text-foreground-muted w-4 text-right">{rank}</span>
                                  <Search className="w-3 h-3 text-foreground-muted" />
                                  &quot;{t.query}&quot;
                                </span>
                                <span className="text-foreground-muted whitespace-nowrap ml-2">
                                  {t.searches.toLocaleString()} · <span className={hitRate >= 70 ? 'text-green-600' : hitRate >= 40 ? 'text-foreground' : 'text-red-500'}>{hitRate}% hit</span>
                                </span>
                              </div>
                              <div className="h-1 bg-surface-secondary rounded-full">
                                <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: 'rgba(132,204,22,0.6)' }} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      <Pagination page={searchPage} total={data.topSearchTerms.length} pageSize={PAGE_SIZE} onChange={setSearchPage} />
                    </>
                  )}
                </CollapsibleSection>

                <CollapsibleSection title="No-Results Searches — catalog gaps" defaultOpen={true} badge={data.noResultSearches.length}>
                  {data.noResultSearches.length === 0 ? (
                    <p className="text-sm text-foreground-muted">No &quot;no-results&quot; searches — catalog covers demand.</p>
                  ) : (
                    <>
                      <div className="space-y-2">
                        {pagedNoResults.map((t, i) => {
                          const rank = (noResultPage - 1) * PAGE_SIZE + i + 1
                          const maxS = data.noResultSearches[0]?.searches || 1
                          const pct = Math.round((t.searches / maxS) * 100)
                          return (
                            <div key={t.query}>
                              <div className="flex items-center justify-between text-xs mb-0.5">
                                <span className="font-medium text-foreground flex items-center gap-1.5">
                                  <span className="text-foreground-muted w-4 text-right">{rank}</span>
                                  <AlertCircle className="w-3 h-3 text-orange-500" />
                                  &quot;{t.query}&quot;
                                </span>
                                <span className="text-orange-600 dark:text-orange-400 font-semibold tabular-nums ml-2">{t.searches.toLocaleString()}×</span>
                              </div>
                              <div className="h-1 bg-surface-secondary rounded-full">
                                <div className="h-full bg-orange-500/60 rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      <p className="text-xs text-foreground-muted pt-3 border-t border-border-default mt-3">Customers searched these but found nothing — expansion opportunities.</p>
                      <Pagination page={noResultPage} total={data.noResultSearches.length} pageSize={PAGE_SIZE} onChange={setNoResultPage} />
                    </>
                  )}
                </CollapsibleSection>
              </div>
            </div>
          )}

          {/* ── PAGES & SOURCES ── */}
          {tab === 'pages' && (
            <div className="space-y-5">
              <CollapsibleSection title="Top Pages" defaultOpen={true} badge={data.topPages.length}>
                {data.topPages.length === 0 ? <Empty /> : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border-default text-xs uppercase tracking-wide text-foreground-muted">
                            <th className="text-left py-2 px-2 font-semibold">#</th>
                            <th className="text-left py-2 px-2 font-semibold">Path</th>
                            <th className="text-right py-2 px-2 font-semibold">Views</th>
                            <th className="text-right py-2 px-2 font-semibold">Sessions</th>
                            <th className="text-right py-2 px-2 font-semibold">Views/Session</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border-default">
                          {pagedPages.map((p, i) => {
                            const rank = (pagesPage - 1) * PAGE_SIZE + i + 1
                            const maxHits = data.topPages[0]?.hits || 1
                            return (
                              <tr key={p.path} className="hover:bg-surface-secondary/50">
                                <td className="py-2 px-2 text-xs font-bold text-foreground-muted w-6">{rank}</td>
                                <td className="py-2 px-2 max-w-[220px]">
                                  <p className="text-xs font-medium text-foreground truncate">{p.path}</p>
                                  <div className="mt-1 h-1 bg-surface-secondary rounded-full">
                                    <div className="h-full rounded-full" style={{ width: `${Math.round((p.hits / maxHits) * 100)}%`, backgroundColor: '#84cc16' }} />
                                  </div>
                                </td>
                                <td className="py-2 px-2 text-right text-xs font-semibold text-foreground tabular-nums">{p.hits.toLocaleString()}</td>
                                <td className="py-2 px-2 text-right text-xs text-foreground-secondary tabular-nums">{p.sessions.toLocaleString()}</td>
                                <td className="py-2 px-2 text-right text-xs text-foreground-muted tabular-nums">
                                  {p.sessions > 0 ? (p.hits / p.sessions).toFixed(1) : '—'}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <Pagination page={pagesPage} total={data.topPages.length} pageSize={PAGE_SIZE} onChange={setPagesPage} />
                  </>
                )}
              </CollapsibleSection>

              <CollapsibleSection title="Traffic Sources" defaultOpen={true} badge={data.topReferrers.length}>
                {data.topReferrers.length === 0 ? <Empty /> : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border-default text-xs uppercase tracking-wide text-foreground-muted">
                            <th className="text-left py-2 px-2 font-semibold">#</th>
                            <th className="text-left py-2 px-2 font-semibold">Source</th>
                            <th className="text-right py-2 px-2 font-semibold">Sessions</th>
                            <th className="text-right py-2 px-2 font-semibold">Share</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border-default">
                          {pagedReferrers.map((r, i) => {
                            const rank = (referrerPage - 1) * PAGE_SIZE + i + 1
                            const total = data.topReferrers.reduce((s, x) => s + x.sessions, 0)
                            const share = total > 0 ? Math.round((r.sessions / total) * 100) : 0
                            const label = r.referrer.length > 50 ? r.referrer.slice(0, 50) + '…' : r.referrer
                            const isDirect = r.referrer === 'Direct'
                            return (
                              <tr key={r.referrer} className="hover:bg-surface-secondary/50">
                                <td className="py-2 px-2 text-xs font-bold text-foreground-muted w-6">{rank}</td>
                                <td className="py-2 px-2 max-w-[220px]">
                                  <p className={`text-xs font-medium truncate ${isDirect ? 'text-foreground-muted italic' : 'text-foreground'}`}>{label}</p>
                                  <div className="mt-1 h-1 bg-surface-secondary rounded-full">
                                    <div className="h-full rounded-full" style={{ width: `${Math.round((r.sessions / (data.topReferrers[0]?.sessions || 1)) * 100)}%`, backgroundColor: 'rgba(148,163,184,0.7)' }} />
                                  </div>
                                </td>
                                <td className="py-2 px-2 text-right text-xs font-semibold text-foreground tabular-nums">{r.sessions.toLocaleString()}</td>
                                <td className="py-2 px-2 text-right text-xs text-foreground-secondary tabular-nums">{share}%</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <Pagination page={referrerPage} total={data.topReferrers.length} pageSize={PAGE_SIZE} onChange={setReferrerPage} />
                  </>
                )}
              </CollapsibleSection>
            </div>
          )}

          {/* ── AUDIENCE ── */}
          {tab === 'audience' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                <Section title="Devices">
                  {data.devices.length === 0 ? <Empty /> : (
                    <DonutChart
                      size={130}
                      segments={data.devices.map(d => ({
                        label: d.type,
                        value: d.sessions,
                        color: DEVICE_COLORS[d.type] || '#6b7280',
                      }))}
                    />
                  )}
                </Section>

                <Section title="Browsers">
                  {data.browsers.length === 0 ? <Empty /> : (
                    <DonutChart
                      size={130}
                      segments={data.browsers.map(b => ({
                        label: b.browser,
                        value: b.sessions,
                        color: BROWSER_COLORS_HEX[b.browser] || '#6b7280',
                      }))}
                    />
                  )}
                </Section>

                <Section title="Engagement">
                  <div className="space-y-4">
                    <div className="rounded-lg bg-surface-secondary p-4 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-foreground-muted uppercase tracking-wide">Avg Pages / Session</p>
                        <p className="text-3xl font-bold text-foreground mt-0.5">{data.totals.avgPages}</p>
                      </div>
                      <BarChart2 className="w-8 h-8 text-foreground-muted/40" />
                    </div>
                    <div className="rounded-lg bg-surface-secondary p-4 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-foreground-muted uppercase tracking-wide">Bounce Rate</p>
                        <p className={`text-3xl font-bold mt-0.5 ${data.totals.bounceRate > 60 ? 'text-red-500 dark:text-red-400' : data.totals.bounceRate > 40 ? 'text-yellow-600 dark:text-yellow-400' : 'text-green-600 dark:text-green-400'}`}>
                          {data.totals.bounceRate}%
                        </p>
                        <p className="text-xs text-foreground-muted mt-0.5">Single-page sessions</p>
                      </div>
                      {data.totals.bounceRate > 60
                        ? <TrendingDown className="w-8 h-8 text-red-400/40" />
                        : <TrendingUp className="w-8 h-8 text-green-500/40" />
                      }
                    </div>
                  </div>
                </Section>
              </div>

              {/* Detailed device/browser breakdown */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <CollapsibleSection title="Device Detail" defaultOpen={false}>
                  {data.devices.length === 0 ? <Empty /> : (
                    <div className="space-y-3">
                      {data.devices.map(d => {
                        const total = data.devices.reduce((s, x) => s + x.sessions, 0)
                        const pct = total > 0 ? Math.round((d.sessions / total) * 100) : 0
                        const DeviceIcon = DEVICE_ICONS[d.type] || Monitor
                        return (
                          <div key={d.type}>
                            <div className="flex justify-between items-center text-sm mb-1.5">
                              <span className="font-medium text-foreground flex items-center gap-2 text-xs">
                                <DeviceIcon className="w-4 h-4 text-foreground-muted" />
                                {d.type}
                              </span>
                              <span className="text-foreground-secondary text-xs tabular-nums">{d.sessions.toLocaleString()} <span className="text-foreground-muted">({pct}%)</span></span>
                            </div>
                            <div className="h-2 bg-surface-secondary rounded-full">
                              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: DEVICE_COLORS[d.type] || '#6b7280' }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </CollapsibleSection>

                <CollapsibleSection title="Browser Detail" defaultOpen={false}>
                  {data.browsers.length === 0 ? <Empty /> : (
                    <div className="space-y-3">
                      {data.browsers.map(b => {
                        const total = data.browsers.reduce((s, x) => s + x.sessions, 0)
                        const pct = total > 0 ? Math.round((b.sessions / total) * 100) : 0
                        const color = BROWSER_COLORS_HEX[b.browser] || '#6b7280'
                        return (
                          <div key={b.browser}>
                            <div className="flex justify-between items-center text-sm mb-1.5">
                              <span className="font-medium text-foreground text-xs">{b.browser}</span>
                              <span className="text-foreground-secondary text-xs tabular-nums">{b.sessions.toLocaleString()} <span className="text-foreground-muted">({pct}%)</span></span>
                            </div>
                            <div className="h-2 bg-surface-secondary rounded-full">
                              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </CollapsibleSection>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
