'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Smartphone, Tablet as TabletIcon, Monitor } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const FUNNEL_LABELS: Record<string, string> = {
  home: 'Homepage', categories: 'Categories', category: 'Category Page',
  product: 'Product Page', cart: 'Cart', checkout: 'Checkout', order_placed: 'Order Placed',
}

const FUNNEL_COLORS: Record<string, string> = {
  home: 'bg-blue-500', categories: 'bg-indigo-500', category: 'bg-violet-500',
  product: 'bg-purple-500', cart: 'bg-amber-500', checkout: 'bg-orange-500', order_placed: 'bg-green-500',
}

const DEVICE_ICONS: Record<string, LucideIcon> = {
  Mobile: Smartphone, Tablet: TabletIcon, Desktop: Monitor,
}

const BROWSER_COLORS: Record<string, string> = {
  Chrome: 'bg-yellow-500', Firefox: 'bg-orange-500', Safari: 'bg-blue-400',
  Edge: 'bg-blue-600', Opera: 'bg-red-500', Chromium: 'bg-teal-500', Other: 'bg-surface-secondary',
}

interface FunnelStep { page: string; sessions: number; users: number; pct: number }
interface DayRow { date: string; sessions: number; pageviews: number }
interface RefRow { referrer: string; sessions: number }
interface PageRow { path: string; hits: number; sessions: number }
interface DeviceRow { type: string; sessions: number }
interface BrowserRow { browser: string; sessions: number }
interface HourRow { hour: number; hits: number }
interface Totals { sessions: number; pageviews: number; conversions: number; bounceRate: number; avgPages: number }
interface TopProductRow { productId: string; name: string; slug: string; views: number; uniqueViewers: number; cartAdds: number; orders: number; revenue: number; conversionRate: number }
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

function KpiCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`bg-surface-elevated border rounded-xl p-4 ${highlight ? 'border-accent-500/50' : 'border-border-default'}`}>
      <p className="text-xs text-foreground-muted uppercase tracking-wide font-medium">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${highlight ? 'text-accent-500' : 'text-foreground'}`}>{value}</p>
      {sub && <p className="text-xs text-foreground-muted mt-0.5">{sub}</p>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-elevated border border-border-default rounded-xl p-5">
      <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-4">{title}</h2>
      {children}
    </div>
  )
}

function Empty({ msg = 'No data yet' }: { msg?: string }) {
  return <p className="text-sm text-foreground-muted text-center py-8">{msg}</p>
}

type TrafficTab = 'overview' | 'funnel' | 'pages' | 'audience' | 'products'
const TRAFFIC_TABS: TrafficTab[] = ['overview', 'funnel', 'pages', 'audience', 'products']

export default function TrafficClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab') as TrafficTab | null
  const initialTab: TrafficTab = tabParam && TRAFFIC_TABS.includes(tabParam) ? tabParam : 'overview'

  const [days, setDays] = useState(7)
  const [data, setData] = useState<TrafficData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTabState] = useState<TrafficTab>(initialTab)

  function setTab(next: TrafficTab) {
    setTabState(next)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', next)
    router.replace(`/admin/traffic?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    setLoading(true)
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
    { id: 'overview' as const, label: 'Overview' },
    { id: 'funnel' as const, label: 'Funnel' },
    { id: 'products' as const, label: 'Products' },
    { id: 'pages' as const, label: 'Pages & Sources' },
    { id: 'audience' as const, label: 'Audience' },
  ]

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Traffic</h1>
          <p className="text-sm text-foreground-secondary mt-0.5">Visitor analytics · funnel · audience</p>
        </div>
        <div className="flex gap-1 p-1 bg-surface-elevated border border-border-default rounded-lg">
          {DAYS_OPTIONS.map(o => (
            <button
              key={o.value}
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
        <div className="flex items-center justify-center h-64 text-foreground-muted text-sm animate-pulse">Loading…</div>
      ) : !data ? (
        <div className="flex items-center justify-center h-64 text-foreground-muted text-sm">Failed to load data.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard label="Sessions" value={data.totals.sessions.toLocaleString()} />
            <KpiCard label="Pageviews" value={data.totals.pageviews.toLocaleString()} />
            <KpiCard label="Avg Pages / Session" value={String(data.totals.avgPages)} />
            <KpiCard label="Bounce Rate" value={`${data.totals.bounceRate}%`} sub="Single-page sessions" />
            <KpiCard label="Orders" value={data.totals.conversions.toLocaleString()} />
            <KpiCard label="Conv. Rate" value={`${convRate}%`} highlight />
          </div>

          <div className="flex gap-1 border-b border-border-default">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  tab === t.id
                    ? 'border-b-2 border-accent-500 text-accent-500'
                    : 'text-foreground-secondary hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="space-y-5">
              <Section title="Daily Traffic">
                {data.dailySessions.length === 0 ? <Empty /> : (
                  <div className="space-y-3">
                    <div className="flex items-end gap-1 h-44">
                      {data.dailySessions.map(d => {
                        const pvH = Math.max(4, Math.round((d.pageviews / maxPageviews) * 100))
                        const sH = Math.max(2, Math.round((d.sessions / maxSessions) * 100))
                        const label = new Date(d.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                        return (
                          <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5 group">
                            <div className="relative w-full flex items-end justify-center gap-0.5" style={{ height: '140px' }}>
                              <div
                                className="w-[45%] bg-accent-500/80 group-hover:bg-accent-500 rounded-t transition-colors"
                                style={{ height: `${pvH}%` }}
                                title={`${label}: ${d.pageviews} pageviews`}
                              />
                              <div
                                className="w-[45%] bg-secondary-400/60 dark:bg-secondary-500/60 group-hover:bg-secondary-400 dark:group-hover:bg-secondary-500 rounded-t transition-colors"
                                style={{ height: `${sH}%` }}
                                title={`${label}: ${d.sessions} sessions`}
                              />
                            </div>
                            {data.dailySessions.length <= 14 && (
                              <span className="text-[9px] text-foreground-muted">{label}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    <div className="flex gap-4 text-xs text-foreground-muted">
                      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-accent-500/80 inline-block" />Pageviews</span>
                      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-secondary-400/60 dark:bg-secondary-500/60 inline-block" />Sessions</span>
                    </div>
                  </div>
                )}
              </Section>

              <Section title="Activity by Hour (IST)">
                {data.hourly.every(h => h.hits === 0) ? <Empty /> : (
                  <div className="space-y-2">
                    <div className="flex items-end gap-0.5 h-20">
                      {data.hourly.map(h => {
                        const ht = Math.max(2, Math.round((h.hits / maxHour) * 100))
                        return (
                          <div key={h.hour} className="flex-1 flex flex-col items-center group">
                            <div className="w-full flex items-end justify-center" style={{ height: '64px' }}>
                              <div
                                className="w-full bg-accent-500/60 group-hover:bg-accent-500 rounded-t transition-colors"
                                style={{ height: `${ht}%` }}
                                title={`${h.hour}:00 — ${h.hits} hits`}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <div className="flex justify-between text-[9px] text-foreground-muted px-0.5">
                      {[0, 3, 6, 9, 12, 15, 18, 21].map(h => (
                        <span key={h}>{h}:00</span>
                      ))}
                    </div>
                  </div>
                )}
              </Section>
            </div>
          )}

          {tab === 'funnel' && (
            <Section title="Conversion Funnel">
              {data.totals.sessions === 0 ? (
                <Empty msg="No traffic data yet — tracking is live and will populate as visitors arrive." />
              ) : (
                <div className="space-y-1">
                  {data.funnel.map((step, i) => {
                    const prev = i > 0 ? data.funnel[i - 1].sessions : step.sessions
                    const dropPct = prev > 0 && i > 0 ? Math.round(((prev - step.sessions) / prev) * 100) : null
                    return (
                      <div key={step.page}>
                        {i > 0 && (
                          <div className="flex items-center gap-2 py-1 pl-4">
                            <svg className="w-3 h-3 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            {dropPct !== null && dropPct > 0 && (
                              <span className="text-xs text-red-500 dark:text-red-400 font-medium">−{dropPct}% drop ({(prev - step.sessions).toLocaleString()} lost)</span>
                            )}
                            {dropPct === 0 && <span className="text-xs text-green-600 dark:text-green-400 font-medium">No drop</span>}
                          </div>
                        )}
                        <div className="rounded-lg border border-border-default overflow-hidden">
                          <div className="flex items-center gap-3 px-4 py-3 bg-surface-secondary/50">
                            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${FUNNEL_COLORS[step.page]}`} />
                            <span className="text-sm font-semibold text-foreground flex-1">{FUNNEL_LABELS[step.page]}</span>
                            <span className="text-sm text-foreground-secondary">{step.sessions.toLocaleString()} sessions</span>
                            <span className="text-sm font-bold text-foreground w-14 text-right">{step.pct}%</span>
                          </div>
                          <div className="h-3 bg-surface-secondary">
                            <div
                              className={`h-full ${FUNNEL_COLORS[step.page]} opacity-70 transition-all`}
                              style={{ width: `${step.pct}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  <div className="pt-4 border-t border-border-default mt-4 flex items-center justify-between text-sm">
                    <span className="text-foreground-secondary">Overall conversion</span>
                    <span className="font-bold text-accent-500 text-lg">{convRate}%</span>
                  </div>
                </div>
              )}
            </Section>
          )}

          {tab === 'products' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <Section title="Top Products by Views">
                  {data.topProducts.length === 0 ? (
                    <p className="text-sm text-foreground-muted">No product views in this period.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="text-xs uppercase tracking-wide text-foreground-muted border-b border-border-default">
                            <th className="text-left py-2 px-2 font-semibold">Product</th>
                            <th className="text-right py-2 px-2 font-semibold">Views</th>
                            <th className="text-right py-2 px-2 font-semibold">Carts</th>
                            <th className="text-right py-2 px-2 font-semibold">Orders</th>
                            <th className="text-right py-2 px-2 font-semibold">CR%</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border-default">
                          {data.topProducts.map(p => (
                            <tr key={p.productId} className="hover:bg-surface-secondary/50">
                              <td className="py-2 px-2 max-w-xs">
                                <a href={`/admin/products/${p.productId}/analytics`} className="text-foreground hover:text-accent-600 truncate block">
                                  {p.name}
                                </a>
                              </td>
                              <td className="py-2 px-2 text-right tabular-nums text-foreground">{p.views.toLocaleString()}</td>
                              <td className="py-2 px-2 text-right tabular-nums text-foreground-secondary">{p.cartAdds.toLocaleString()}</td>
                              <td className="py-2 px-2 text-right tabular-nums text-foreground-secondary">{p.orders.toLocaleString()}</td>
                              <td className={`py-2 px-2 text-right tabular-nums font-semibold ${p.conversionRate >= 5 ? 'text-green-600 dark:text-green-400' : p.conversionRate >= 1 ? 'text-foreground' : 'text-foreground-muted'}`}>
                                {p.conversionRate}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Section>

                <Section title="Conversion Laggards (high views, no orders)">
                  {data.conversionLaggards.length === 0 ? (
                    <p className="text-sm text-foreground-muted">No products with stuck-conversion patterns.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="text-xs uppercase tracking-wide text-foreground-muted border-b border-border-default">
                            <th className="text-left py-2 px-2 font-semibold">Product</th>
                            <th className="text-right py-2 px-2 font-semibold">Views</th>
                            <th className="text-right py-2 px-2 font-semibold">Orders</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border-default">
                          {data.conversionLaggards.map(p => (
                            <tr key={p.productId} className="hover:bg-surface-secondary/50">
                              <td className="py-2 px-2 max-w-xs">
                                <a href={`/admin/products/${p.productId}/analytics`} className="text-foreground hover:text-accent-600 truncate block">
                                  {p.name}
                                </a>
                              </td>
                              <td className="py-2 px-2 text-right tabular-nums text-orange-600 dark:text-orange-400 font-semibold">{p.views.toLocaleString()}</td>
                              <td className="py-2 px-2 text-right tabular-nums text-foreground-muted">{p.orders}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="text-xs text-foreground-muted mt-3">Items with 20+ views and 0 paid orders. Worth checking pricing, images, or stock.</p>
                    </div>
                  )}
                </Section>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <Section title="Top Search Terms">
                  {data.topSearchTerms.length === 0 ? (
                    <p className="text-sm text-foreground-muted">No search activity yet. (Search-term tracking starts logging after this deploy.)</p>
                  ) : (
                    <div className="space-y-2.5">
                      {data.topSearchTerms.map(t => (
                        <div key={t.query} className="flex items-center justify-between text-sm">
                          <span className="font-medium text-foreground truncate flex-1 mr-3">&quot;{t.query}&quot;</span>
                          <span className="text-foreground-secondary tabular-nums text-xs whitespace-nowrap">
                            {t.searches.toLocaleString()} searches · {t.clicks.toLocaleString()} with results
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                <Section title="No-Results Searches (catalog gaps)">
                  {data.noResultSearches.length === 0 ? (
                    <p className="text-sm text-foreground-muted">No &quot;no-results&quot; searches detected — catalog covers what people are looking for.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {data.noResultSearches.map(t => (
                        <div key={t.query} className="flex items-center justify-between text-sm">
                          <span className="font-medium text-foreground truncate flex-1 mr-3">&quot;{t.query}&quot;</span>
                          <span className="text-orange-600 dark:text-orange-400 tabular-nums text-xs font-semibold whitespace-nowrap">{t.searches.toLocaleString()}×</span>
                        </div>
                      ))}
                      <p className="text-xs text-foreground-muted pt-2 border-t border-border-default">Customers searched these but found nothing — opportunities to expand catalog.</p>
                    </div>
                  )}
                </Section>
              </div>
            </div>
          )}

          {tab === 'pages' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <Section title="Top Pages">
                {data.topPages.length === 0 ? <Empty /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border-default">
                          <th className="text-left text-xs text-foreground-muted font-medium pb-2 pr-3">#</th>
                          <th className="text-left text-xs text-foreground-muted font-medium pb-2">Path</th>
                          <th className="text-right text-xs text-foreground-muted font-medium pb-2 pl-3">Views</th>
                          <th className="text-right text-xs text-foreground-muted font-medium pb-2 pl-3">Sessions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-default">
                        {data.topPages.map((p, i) => (
                          <tr key={p.path} className="hover:bg-surface-secondary/50">
                            <td className="py-2 pr-3 text-xs font-bold text-foreground-muted">{i + 1}</td>
                            <td className="py-2 max-w-[200px]">
                              <p className="text-xs font-medium text-foreground truncate">{p.path}</p>
                              <div className="mt-1 h-1 bg-surface-secondary rounded-full">
                                <div className="h-full bg-accent-500 rounded-full" style={{ width: `${Math.round((p.hits / (data.topPages[0]?.hits || 1)) * 100)}%` }} />
                              </div>
                            </td>
                            <td className="py-2 pl-3 text-right text-xs font-semibold text-foreground">{p.hits.toLocaleString()}</td>
                            <td className="py-2 pl-3 text-right text-xs text-foreground-secondary">{p.sessions.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>

              <Section title="Traffic Sources">
                {data.topReferrers.length === 0 ? <Empty /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border-default">
                          <th className="text-left text-xs text-foreground-muted font-medium pb-2 pr-3">#</th>
                          <th className="text-left text-xs text-foreground-muted font-medium pb-2">Source</th>
                          <th className="text-right text-xs text-foreground-muted font-medium pb-2 pl-3">Sessions</th>
                          <th className="text-right text-xs text-foreground-muted font-medium pb-2 pl-3">Share</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-default">
                        {data.topReferrers.map((r, i) => {
                          const total = data.topReferrers.reduce((s, x) => s + x.sessions, 0)
                          const share = total > 0 ? Math.round((r.sessions / total) * 100) : 0
                          const label = r.referrer.length > 45 ? r.referrer.slice(0, 45) + '…' : r.referrer
                          const isDirect = r.referrer === 'Direct'
                          return (
                            <tr key={r.referrer} className="hover:bg-surface-secondary/50">
                              <td className="py-2 pr-3 text-xs font-bold text-foreground-muted">{i + 1}</td>
                              <td className="py-2 max-w-[200px]">
                                <p className={`text-xs font-medium truncate ${isDirect ? 'text-foreground-muted italic' : 'text-foreground'}`}>{label}</p>
                                <div className="mt-1 h-1 bg-surface-secondary rounded-full">
                                  <div className="h-full bg-secondary-400 dark:bg-secondary-500 rounded-full" style={{ width: `${Math.round((r.sessions / (data.topReferrers[0]?.sessions || 1)) * 100)}%` }} />
                                </div>
                              </td>
                              <td className="py-2 pl-3 text-right text-xs font-semibold text-foreground">{r.sessions.toLocaleString()}</td>
                              <td className="py-2 pl-3 text-right text-xs text-foreground-secondary">{share}%</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>
            </div>
          )}

          {tab === 'audience' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              <Section title="Devices">
                {data.devices.length === 0 ? <Empty /> : (
                  <div className="space-y-4">
                    {data.devices.map(d => {
                      const total = data.devices.reduce((s, x) => s + x.sessions, 0)
                      const pct = total > 0 ? Math.round((d.sessions / total) * 100) : 0
                      const DeviceIcon = DEVICE_ICONS[d.type] || Monitor
                      return (
                        <div key={d.type}>
                          <div className="flex justify-between items-center text-sm mb-1.5">
                            <span className="font-medium text-foreground flex items-center gap-2">
                              <DeviceIcon className="w-4 h-4 text-foreground-muted" />
                              {d.type}
                            </span>
                            <span className="text-foreground-secondary text-xs">{d.sessions.toLocaleString()} <span className="text-foreground-muted">({pct}%)</span></span>
                          </div>
                          <div className="h-2 bg-surface-secondary rounded-full">
                            <div
                              className={`h-full rounded-full transition-all ${d.type === 'Mobile' ? 'bg-blue-500' : d.type === 'Tablet' ? 'bg-violet-500' : 'bg-green-500'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </Section>

              <Section title="Browsers">
                {data.browsers.length === 0 ? <Empty /> : (
                  <div className="space-y-4">
                    {data.browsers.map(b => {
                      const total = data.browsers.reduce((s, x) => s + x.sessions, 0)
                      const pct = total > 0 ? Math.round((b.sessions / total) * 100) : 0
                      const color = BROWSER_COLORS[b.browser] || 'bg-surface-secondary'
                      return (
                        <div key={b.browser}>
                          <div className="flex justify-between items-center text-sm mb-1.5">
                            <span className="font-medium text-foreground">{b.browser}</span>
                            <span className="text-foreground-secondary text-xs">{b.sessions.toLocaleString()} <span className="text-foreground-muted">({pct}%)</span></span>
                          </div>
                          <div className="h-2 bg-surface-secondary rounded-full">
                            <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </Section>

              <Section title="Engagement">
                <div className="space-y-4">
                  <div className="rounded-lg bg-surface-secondary p-4">
                    <p className="text-xs text-foreground-muted uppercase tracking-wide">Avg Pages / Session</p>
                    <p className="text-3xl font-bold text-foreground mt-1">{data.totals.avgPages}</p>
                  </div>
                  <div className="rounded-lg bg-surface-secondary p-4">
                    <p className="text-xs text-foreground-muted uppercase tracking-wide">Bounce Rate</p>
                    <p className={`text-3xl font-bold mt-1 ${data.totals.bounceRate > 60 ? 'text-red-500 dark:text-red-400' : data.totals.bounceRate > 40 ? 'text-yellow-600 dark:text-yellow-400' : 'text-green-600 dark:text-green-400'}`}>
                      {data.totals.bounceRate}%
                    </p>
                    <p className="text-xs text-foreground-muted mt-0.5">Single-page sessions</p>
                  </div>
                </div>
              </Section>
            </div>
          )}
        </>
      )}
    </div>
  )
}
