import Link from 'next/link'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/jwt'
import { getCrmDashboardData } from '@/lib/admin-crm'

export const dynamic = 'force-dynamic'

const SEGMENT_META: Record<string, { label: string; color: string; href: string }> = {
  vip:      { label: 'VIP',          color: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700',         href: '/admin/customers?segment=vip' },
  loyal:    { label: 'Loyal',        color: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700', href: '/admin/customers?segment=loyal' },
  repeat:   { label: 'Repeat',       color: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700',                href: '/admin/customers?segment=repeat' },
  one_time: { label: 'One-time',     color: 'bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700',                  href: '/admin/customers?segment=one_time' },
  new:      { label: 'New (<30d)',   color: 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700',  href: '/admin/customers?segment=new' },
  at_risk:  { label: 'At Risk',      color: 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700',  href: '/admin/customers?segment=at_risk' },
  dormant:  { label: 'Dormant',      color: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700',                    href: '/admin/customers?segment=dormant' },
  b2b:      { label: 'B2B',          color: 'bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-700',  href: '/admin/customers?segment=b2b' },
  lead:     { label: 'Lead',         color: 'bg-pink-100 text-pink-800 border-pink-300 dark:bg-pink-900/30 dark:text-pink-300 dark:border-pink-700',              href: '/admin/customers?segment=lead' },
}

function timeAgo(iso: string) {
  const d = new Date(iso).getTime()
  const diff = Math.floor((Date.now() - d) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default async function CrmDashboardPage() {
  const cookieStore = cookies()
  const token = cookieStore.get('admin_token')?.value
  let adminId = ''
  if (token) {
    try { adminId = (await verifyToken(token))?.adminId || '' } catch {}
  }

  let data: Awaited<ReturnType<typeof getCrmDashboardData>>
  try {
    data = await getCrmDashboardData(adminId)
  } catch {
    return (
      <div className="p-6">
        <p className="text-foreground-muted">Failed to load CRM dashboard.</p>
      </div>
    )
  }
  const s = data.segments

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">CRM</h1>
        <p className="text-foreground-secondary text-sm mt-1">{s.total.toLocaleString('en-IN')} customers · {data.leadsThisWeek} new this week without an order</p>
      </div>

      {/* Tasks summary */}
      {data.tasks && (data.tasks.open > 0 || data.tasks.mine > 0) && (
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Link
            href="/admin/tasks?scope=mine&status=open"
            className="bg-surface-elevated rounded-xl border border-border-default p-4 hover:shadow-md hover:-translate-y-0.5 transition-all"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">My Tasks</p>
            <p className="text-2xl font-bold text-foreground mt-1">{data.tasks.mine}</p>
          </Link>
          <Link
            href="/admin/tasks?scope=all&status=overdue"
            className={`rounded-xl border p-4 hover:shadow-md hover:-translate-y-0.5 transition-all ${
              data.tasks.overdue > 0
                ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                : 'bg-surface-elevated border-border-default'
            }`}
          >
            <p className={`text-xs font-semibold uppercase tracking-wide ${
              data.tasks.overdue > 0 ? 'text-red-700 dark:text-red-300' : 'text-foreground-muted'
            }`}>Overdue</p>
            <p className={`text-2xl font-bold mt-1 ${
              data.tasks.overdue > 0 ? 'text-red-700 dark:text-red-300' : 'text-foreground'
            }`}>{data.tasks.overdue}</p>
          </Link>
          <Link
            href="/admin/tasks?scope=all&status=open"
            className="bg-surface-elevated rounded-xl border border-border-default p-4 hover:shadow-md hover:-translate-y-0.5 transition-all"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Open (all)</p>
            <p className="text-2xl font-bold text-foreground mt-1">{data.tasks.open}</p>
          </Link>
        </div>
      )}

      {/* Health distribution + churn risks + biggest drops */}
      {data.health && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
            <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">Health Distribution</h2>
            {(() => {
              const d = data.health.distribution
              const max = Math.max(d.b0_20, d.b20_40, d.b40_60, d.b60_80, d.b80_100, 1)
              const buckets: { label: string; count: number; color: string }[] = [
                { label: '0-20',   count: d.b0_20,   color: 'bg-red-500' },
                { label: '20-40',  count: d.b20_40,  color: 'bg-orange-500' },
                { label: '40-60',  count: d.b40_60,  color: 'bg-yellow-500' },
                { label: '60-80',  count: d.b60_80,  color: 'bg-lime-500' },
                { label: '80-100', count: d.b80_100, color: 'bg-green-500' },
              ]
              return (
                <>
                  <div className="space-y-2">
                    {buckets.map(b => (
                      <div key={b.label} className="flex items-center gap-2 text-xs">
                        <span className="w-12 text-foreground-muted tabular-nums">{b.label}</span>
                        <div className="flex-1 h-4 bg-surface-secondary rounded overflow-hidden">
                          <div className={`h-full ${b.color}`} style={{ width: `${(b.count / max) * 100}%` }} />
                        </div>
                        <span className="w-10 text-right font-semibold tabular-nums">{b.count}</span>
                      </div>
                    ))}
                  </div>
                  {d.unscored > 0 && (
                    <p className="text-[10px] text-foreground-muted mt-3">
                      {d.unscored.toLocaleString('en-IN')} customer(s) not yet scored
                    </p>
                  )}
                </>
              )
            })()}
          </div>

          <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
            <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">Top Churn Risks</h2>
            {data.health.topChurnRisks.length === 0 ? (
              <p className="text-sm text-foreground-muted">No customers below health 40.</p>
            ) : (
              <div className="space-y-2">
                {data.health.topChurnRisks.map((c: any) => (
                  <Link key={c.id} href={`/admin/customers/${c.id}`} className="flex items-center justify-between text-sm py-1 hover:bg-surface-secondary/50 px-2 -mx-2 rounded transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate font-medium">{c.name}</p>
                      <p className="text-[10px] text-foreground-muted">
                        ₹{Math.round(c.ltv).toLocaleString('en-IN')} lifetime
                        {c.daysSinceLastOrder != null && ` · ${c.daysSinceLastOrder}d quiet`}
                      </p>
                    </div>
                    <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded shrink-0 ml-2 ${
                      c.score < 20 ? 'bg-red-200 text-red-800 dark:bg-red-900/60 dark:text-red-200' :
                      'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                    }`}>
                      {c.score}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
            <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">Biggest Drops (7d)</h2>
            {data.health.biggestDrops.length === 0 ? (
              <p className="text-sm text-foreground-muted">No sharp declines this week.</p>
            ) : (
              <div className="space-y-2">
                {data.health.biggestDrops.map((c: any) => (
                  <Link key={c.id} href={`/admin/customers/${c.id}`} className="flex items-center justify-between text-sm py-1 hover:bg-surface-secondary/50 px-2 -mx-2 rounded transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate font-medium">{c.name}</p>
                      <p className="text-[10px] text-foreground-muted">Now at {c.score}/100</p>
                    </div>
                    <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 shrink-0 ml-2">
                      ▼ {c.delta}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Segment chips */}
      <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
        <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">Segments</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {(['vip','loyal','b2b','repeat','new','at_risk','dormant','one_time','lead'] as const).map(key => {
            const meta = SEGMENT_META[key]
            const count = s[key] as number
            return (
              <Link
                key={key}
                href={meta.href}
                className={`group rounded-xl border px-4 py-3 transition-all hover:shadow-md hover:-translate-y-0.5 ${meta.color}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide opacity-80">{meta.label}</span>
                  <span className="text-2xl font-bold tabular-nums">{count.toLocaleString('en-IN')}</span>
                </div>
              </Link>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Crossing into At Risk */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest">Just Crossed Into At-Risk</h2>
            <Link href="/admin/customers?segment=at_risk" className="text-xs text-accent-500 hover:text-accent-600 font-medium">View all →</Link>
          </div>
          {data.crossingAtRisk.length === 0 ? (
            <p className="text-sm text-foreground-muted">No customers crossed into at-risk this week.</p>
          ) : (
            <div className="divide-y divide-border-default">
              {data.crossingAtRisk.map((c: any) => (
                <Link
                  key={c.id}
                  href={`/admin/customers/${c.id}`}
                  className="flex items-center justify-between gap-3 py-2.5 hover:bg-surface-secondary/50 -mx-2 px-2 rounded-lg transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                    <p className="text-[11px] text-foreground-muted">Last order {fmtDate(c.lastOrderAt)} · LTV ₹{Math.round(c.ltv).toLocaleString('en-IN')}</p>
                  </div>
                  <span className="text-xs text-orange-600 dark:text-orange-400 font-semibold whitespace-nowrap">Win back →</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Dormant — top LTV */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest">Dormant — Top by LTV</h2>
            <Link href="/admin/customers?segment=dormant" className="text-xs text-accent-500 hover:text-accent-600 font-medium">View all →</Link>
          </div>
          {data.crossingDormant.length === 0 ? (
            <p className="text-sm text-foreground-muted">No dormant customers.</p>
          ) : (
            <div className="divide-y divide-border-default">
              {data.crossingDormant.map((c: any) => (
                <Link
                  key={c.id}
                  href={`/admin/customers/${c.id}`}
                  className="flex items-center justify-between gap-3 py-2.5 hover:bg-surface-secondary/50 -mx-2 px-2 rounded-lg transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                    <p className="text-[11px] text-foreground-muted">Last order {fmtDate(c.lastOrderAt)} · LTV ₹{Math.round(c.ltv).toLocaleString('en-IN')}</p>
                  </div>
                  <span className="text-xs text-red-600 dark:text-red-400 font-semibold whitespace-nowrap">High value</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Recent Notes */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5 lg:col-span-2">
          <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">Recent Internal Notes</h2>
          {data.recentNotes.length === 0 ? (
            <p className="text-sm text-foreground-muted">No notes yet. Add one from any customer page to track conversations.</p>
          ) : (
            <div className="space-y-3">
              {data.recentNotes.map((n: any, i: number) => (
                <div key={i} className="border-l-2 border-accent-500 pl-3 py-1">
                  <p className="text-sm text-foreground whitespace-pre-wrap break-words line-clamp-3">{n.body}</p>
                  <p className="text-[10px] text-foreground-muted mt-1">
                    <Link href={`/admin/customers/${n.userId}`} className="text-accent-600 dark:text-accent-400 hover:underline">{n.customerName}</Link>
                    {' · '}{n.adminName}{' · '}{timeAgo(n.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tag cloud */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
          <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">Top Tags</h2>
          {data.topTags.length === 0 ? (
            <p className="text-sm text-foreground-muted">No tags applied yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.topTags.map((t: any) => (
                <Link
                  key={t.tag}
                  href={`/admin/customers?tag=${encodeURIComponent(t.tag)}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-300 rounded-full text-xs font-medium hover:bg-accent-200 dark:hover:bg-accent-900/50 transition-colors"
                >
                  {t.tag}
                  <span className="text-[10px] opacity-70 tabular-nums">{t.count}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Recent Tags applied */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
          <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">Recently Tagged</h2>
          {data.recentTags.length === 0 ? (
            <p className="text-sm text-foreground-muted">No recent tag activity.</p>
          ) : (
            <div className="divide-y divide-border-default">
              {data.recentTags.map((t: any, i: number) => (
                <Link
                  key={i}
                  href={`/admin/customers/${t.userId}`}
                  className="flex items-center justify-between gap-3 py-2 hover:bg-surface-secondary/50 -mx-2 px-2 rounded-lg transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{t.name}</p>
                    <span className="inline-block px-2 py-0.5 mt-0.5 bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-300 rounded-full text-[10px] font-medium">{t.tag}</span>
                  </div>
                  <span className="text-[10px] text-foreground-muted whitespace-nowrap">{timeAgo(t.createdAt)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent Signups */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest">Recent Signups</h2>
            <Link href="/admin/customers?segment=lead" className="text-xs text-accent-500 hover:text-accent-600 font-medium">View leads →</Link>
          </div>
          {data.recentSignups.length === 0 ? (
            <p className="text-sm text-foreground-muted">No new signups yet.</p>
          ) : (
            <div className="divide-y divide-border-default">
              {data.recentSignups.map((s: any) => (
                <Link
                  key={s.id}
                  href={`/admin/customers/${s.id}`}
                  className="flex items-center justify-between gap-3 py-2 hover:bg-surface-secondary/50 -mx-2 px-2 rounded-lg transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{s.name}</p>
                    <p className="text-[11px] text-foreground-muted truncate">{s.email}</p>
                  </div>
                  <span className="text-[10px] text-foreground-muted whitespace-nowrap">{timeAgo(s.createdAt)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
