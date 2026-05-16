'use client'

import { useEffect, useState } from 'react'

const FUNNEL_LABELS: Record<string, string> = {
  home: 'Homepage',
  categories: 'Categories',
  category: 'Category Page',
  product: 'Product Page',
  cart: 'Cart',
  checkout: 'Checkout',
  order_placed: 'Order Placed',
}

const FUNNEL_COLORS: Record<string, string> = {
  home: 'bg-blue-500',
  categories: 'bg-indigo-500',
  category: 'bg-violet-500',
  product: 'bg-purple-500',
  cart: 'bg-amber-500',
  checkout: 'bg-orange-500',
  order_placed: 'bg-green-500',
}

interface FunnelStep { page: string; sessions: number; users: number; pct: number }
interface DayRow { date: string; sessions: number; pageviews: number }
interface RefRow { referrer: string; sessions: number }
interface PageRow { path: string; hits: number }
interface DeviceRow { type: string; sessions: number }
interface Totals { sessions: number; pageviews: number; conversions: number }

interface TrafficData {
  funnel: FunnelStep[]
  topPages: PageRow[]
  topReferrers: RefRow[]
  dailySessions: DayRow[]
  devices: DeviceRow[]
  totals: Totals
}

const DAYS_OPTIONS = [
  { label: '7 days', value: 7 },
  { label: '14 days', value: 14 },
  { label: '30 days', value: 30 },
]

export default function TrafficClient() {
  const [days, setDays] = useState(7)
  const [data, setData] = useState<TrafficData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/admin/traffic?days=${days}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [days])

  const convRate = data && data.totals.sessions > 0
    ? ((data.totals.conversions / data.totals.sessions) * 100).toFixed(1)
    : '0.0'

  const maxPageviews = data ? Math.max(...data.dailySessions.map(d => d.pageviews), 1) : 1

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Traffic & Funnel</h1>
          <p className="text-sm text-foreground-muted mt-0.5">Visitor journey from landing to order</p>
        </div>
        <div className="flex gap-1 p-1 bg-surface-elevated border border-border-default rounded-lg">
          {DAYS_OPTIONS.map(o => (
            <button
              key={o.value}
              onClick={() => setDays(o.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${days === o.value ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-foreground-muted text-sm">Loading...</div>
      ) : !data ? (
        <div className="flex items-center justify-center h-64 text-foreground-muted text-sm">Failed to load data.</div>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Total Sessions', value: data.totals.sessions.toLocaleString() },
              { label: 'Total Pageviews', value: data.totals.pageviews.toLocaleString() },
              { label: 'Orders from Traffic', value: data.totals.conversions.toLocaleString() },
              { label: 'Conversion Rate', value: `${convRate}%` },
            ].map(k => (
              <div key={k.label} className="bg-surface-elevated border border-border-default rounded-xl p-4">
                <p className="text-xs text-foreground-muted uppercase tracking-wide font-medium">{k.label}</p>
                <p className="text-2xl font-bold text-foreground mt-1">{k.value}</p>
              </div>
            ))}
          </div>

          {/* Funnel */}
          <div className="bg-surface-elevated border border-border-default rounded-xl p-5">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-4">Conversion Funnel</h2>
            {data.totals.sessions === 0 ? (
              <p className="text-sm text-foreground-muted text-center py-8">No traffic data yet — tracking is live and will populate as visitors arrive.</p>
            ) : (
              <div className="space-y-3">
                {data.funnel.map((step, i) => {
                  const prev = i > 0 ? data.funnel[i - 1].sessions : step.sessions
                  const dropPct = prev > 0 && i > 0 ? Math.round(((prev - step.sessions) / prev) * 100) : null
                  return (
                    <div key={step.page} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${FUNNEL_COLORS[step.page]}`} />
                          <span className="font-medium text-foreground">{FUNNEL_LABELS[step.page]}</span>
                          {dropPct !== null && dropPct > 0 && (
                            <span className="text-red-500 font-medium">−{dropPct}% drop</span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-foreground-muted">
                          <span>{step.sessions.toLocaleString()} sessions</span>
                          <span className="font-semibold text-foreground w-10 text-right">{step.pct}%</span>
                        </div>
                      </div>
                      <div className="h-6 bg-surface-secondary rounded overflow-hidden">
                        <div
                          className={`h-full rounded transition-all ${FUNNEL_COLORS[step.page]} opacity-80`}
                          style={{ width: `${step.pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Daily chart + devices */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 bg-surface-elevated border border-border-default rounded-xl p-5">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-4">Daily Traffic</h2>
              {data.dailySessions.length === 0 ? (
                <p className="text-sm text-foreground-muted text-center py-8">No data yet</p>
              ) : (
                <div className="flex items-end gap-1 h-40">
                  {data.dailySessions.map(d => {
                    const h = Math.max(4, Math.round((d.pageviews / maxPageviews) * 100))
                    const label = new Date(d.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                    return (
                      <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group">
                        <div className="relative w-full flex items-end justify-center" style={{ height: '120px' }}>
                          <div
                            className="w-full bg-accent-500 rounded-t opacity-80 group-hover:opacity-100 transition-opacity"
                            style={{ height: `${h}%` }}
                            title={`${label}: ${d.pageviews} views, ${d.sessions} sessions`}
                          />
                        </div>
                        <span className="text-[9px] text-foreground-muted">{label}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="bg-surface-elevated border border-border-default rounded-xl p-5">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-4">Devices</h2>
              {data.devices.length === 0 ? (
                <p className="text-sm text-foreground-muted text-center py-8">No data yet</p>
              ) : (
                <div className="space-y-3">
                  {data.devices.map(d => {
                    const total = data.devices.reduce((s, x) => s + x.sessions, 0)
                    const pct = total > 0 ? Math.round((d.sessions / total) * 100) : 0
                    const color = d.type === 'Mobile' ? 'bg-blue-500' : d.type === 'Tablet' ? 'bg-violet-500' : 'bg-green-500'
                    return (
                      <div key={d.type}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-medium text-foreground">{d.type}</span>
                          <span className="text-foreground-muted">{d.sessions.toLocaleString()} ({pct}%)</span>
                        </div>
                        <div className="h-2 bg-surface-secondary rounded-full">
                          <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Top pages + referrers */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-surface-elevated border border-border-default rounded-xl p-5">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-4">Top Pages</h2>
              {data.topPages.length === 0 ? (
                <p className="text-sm text-foreground-muted text-center py-6">No data yet</p>
              ) : (
                <div className="space-y-2">
                  {data.topPages.map((p, i) => {
                    const maxHits = data.topPages[0]?.hits || 1
                    return (
                      <div key={p.path} className="flex items-center gap-3">
                        <span className="text-xs font-bold text-foreground-muted w-4 shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">{p.path}</p>
                          <div className="mt-0.5 h-1.5 bg-surface-secondary rounded-full">
                            <div className="h-full bg-accent-500 rounded-full" style={{ width: `${Math.round((p.hits / maxHits) * 100)}%` }} />
                          </div>
                        </div>
                        <span className="text-xs font-semibold text-foreground shrink-0">{p.hits.toLocaleString()}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="bg-surface-elevated border border-border-default rounded-xl p-5">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-4">Traffic Sources</h2>
              {data.topReferrers.length === 0 ? (
                <p className="text-sm text-foreground-muted text-center py-6">No data yet</p>
              ) : (
                <div className="space-y-2">
                  {data.topReferrers.map((r, i) => {
                    const maxSess = data.topReferrers[0]?.sessions || 1
                    const label = r.referrer.length > 50 ? r.referrer.slice(0, 50) + '…' : r.referrer
                    return (
                      <div key={r.referrer} className="flex items-center gap-3">
                        <span className="text-xs font-bold text-foreground-muted w-4 shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">{label}</p>
                          <div className="mt-0.5 h-1.5 bg-surface-secondary rounded-full">
                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.round((r.sessions / maxSess) * 100)}%` }} />
                          </div>
                        </div>
                        <span className="text-xs font-semibold text-foreground shrink-0">{r.sessions.toLocaleString()}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
