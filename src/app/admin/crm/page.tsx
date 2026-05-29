import Link from 'next/link'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/jwt'
import { getCrmDashboardData } from '@/lib/admin-crm'
import HealthDistributionCard from './HealthDistributionCard'
import ChurnRisksCard from './ChurnRisksCard'
import BiggestDropsCard from './BiggestDropsCard'
import AtRiskCard from './AtRiskCard'
import DormantCard from './DormantCard'
import RecentNotesCard from './RecentNotesCard'
import RecentTagsCard from './RecentTagsCard'
import RecentSignupsCard from './RecentSignupsCard'

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
          <HealthDistributionCard distribution={data.health.distribution} />

          <ChurnRisksCard items={data.health.topChurnRisks} />

          <BiggestDropsCard items={data.health.biggestDrops} />
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
        <AtRiskCard items={data.crossingAtRisk} />
        <DormantCard items={data.crossingDormant} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <RecentNotesCard items={data.recentNotes} />

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
        <RecentTagsCard items={data.recentTags} />
        <RecentSignupsCard items={data.recentSignups} />
      </div>
    </div>
  )
}
