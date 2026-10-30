import Link from 'next/link'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth/jwt'
import { getCrmDashboardData } from '@/lib/shared/admin-crm'
import { getCrmInsights } from '@/lib/shared/crm-insights'
import CrmOverview from './CrmOverview'
import { getCrmOverview } from '@admin/app/api/(admin)/admin/crm/overview/summary'
import { insightsRangeFor, istToday, matchPreset, parsePeriod } from './_lib/period'
import AttentionQueueCard from './AttentionQueueCard'
import HealthDistributionCard from './HealthDistributionCard'
import ChurnRisksCard from './ChurnRisksCard'
import BiggestDropsCard from './BiggestDropsCard'
import AtRiskCard from './AtRiskCard'
import DormantCard from './DormantCard'
import RecentNotesCard from './RecentNotesCard'
import RecentTagsCard from './RecentTagsCard'
import RecentSignupsCard from './RecentSignupsCard'
import SegmentsCard from './SegmentsCard'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { adminCookieName } from '@/lib/auth/admin-cookie'
import { ErrorState, PageBody } from '@/components/admin/kit'

export const dynamic = 'force-dynamic'

export default async function CrmDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const host = await getHost()
  const sp = await searchParams
  const today = istToday()
  const period = parsePeriod(sp.from, sp.to, today)
  const cookieStore = await cookies()
  const token = cookieStore.get(await adminCookieName())?.value
  let adminId = ''
  if (token) {
    try {
      adminId = (await verifyToken(token))?.adminId || ''
    } catch {}
  }

  let data: Awaited<ReturnType<typeof getCrmDashboardData>>
  let overview: Awaited<ReturnType<typeof getCrmOverview>>
  let insights: Awaited<ReturnType<typeof getCrmInsights>> | null = null
  try {
    ;[data, overview, insights] = await Promise.all([
      getCrmDashboardData(adminId),
      getCrmOverview(period),
      getCrmInsights({ range: insightsRangeFor(matchPreset(period, today)) ?? '30d', segment: 'all' }).catch(err => {
        console.error('getCrmInsights failed', err)
        return null
      }),
    ])
  } catch (err) {
    console.error('CRM dashboard failed', err)
    return (
      <PageBody>
        <ErrorState title="Failed to load CRM dashboard." />
      </PageBody>
    )
  }
  const s = data.segments

  const tasks =
    data.tasks && (data.tasks.open > 0 || data.tasks.mine > 0) ? (
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Link
          href={ap('/admin/tasks?scope=mine&status=open', host)}
          className="bg-surface-elevated rounded-xl border border-border-default p-4 hover:border-accent-500/50 transition-colors"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">My Tasks</p>
          <p className="text-2xl font-bold text-foreground mt-1">{data.tasks.mine}</p>
        </Link>
        <Link
          href={ap('/admin/tasks?status=overdue', host)}
          className={`rounded-xl border p-4 hover:border-accent-500/50 transition-colors ${
            data.tasks.overdue > 0 ? 'bg-red-500/5 border-red-500/40' : 'bg-surface-elevated border-border-default'
          }`}
        >
          <p
            className={`text-xs font-semibold uppercase tracking-wide ${
              data.tasks.overdue > 0 ? 'text-red-700 dark:text-red-400' : 'text-foreground-muted'
            }`}
          >
            Overdue
          </p>
          <p
            className={`text-2xl font-bold mt-1 ${
              data.tasks.overdue > 0 ? 'text-red-700 dark:text-red-400' : 'text-foreground'
            }`}
          >
            {data.tasks.overdue}
          </p>
        </Link>
        <Link
          href={ap('/admin/tasks?status=open', host)}
          className="bg-surface-elevated rounded-xl border border-border-default p-4 hover:border-accent-500/50 transition-colors"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Open (all)</p>
          <p className="text-2xl font-bold text-foreground mt-1">{data.tasks.open}</p>
        </Link>
      </div>
    ) : null

  const health = (
    <div className="space-y-5">
      {data.health && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <HealthDistributionCard distribution={data.health.distribution} />
          <ChurnRisksCard items={data.health.topChurnRisks} />
          <BiggestDropsCard items={data.health.biggestDrops} />
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AtRiskCard items={data.crossingAtRisk} />
        <DormantCard items={data.crossingDormant} />
      </div>
    </div>
  )

  const segments = (
    <div className="space-y-5">
      <p className="text-sm text-foreground-secondary -mt-3">
        {s.total.toLocaleString('en-IN')} customers · {data.leadsThisWeek} new this week without an order
      </p>
      <SegmentsCard segments={s} />
      <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground mb-4">Top Tags</h2>
        {data.topTags.length === 0 ? (
          <p className="text-sm text-foreground-muted">No tags applied yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {data.topTags.map((t: any) => (
              <Link
                key={t.tag}
                href={ap(`/admin/customers?tag=${encodeURIComponent(t.tag)}`, host)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-accent-500/10 text-accent-500 rounded-full text-xs font-medium hover:bg-accent-500/20 transition-colors"
              >
                {t.tag}
                <span className="text-[10px] opacity-70 tabular-nums">{t.count}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  const activity = (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <RecentNotesCard items={data.recentNotes} />
      <RecentTagsCard items={data.recentTags} />
      <RecentSignupsCard items={data.recentSignups} />
    </div>
  )

  return (
    <PageBody>
      <CrmOverview
        initial={overview}
        today={today}
        host={host}
        insights={insights}
        attentionQueue={insights ? <AttentionQueueCard items={insights.attention} /> : null}
        tasks={tasks}
        health={health}
        segments={segments}
        activity={activity}
      />
    </PageBody>
  )
}
