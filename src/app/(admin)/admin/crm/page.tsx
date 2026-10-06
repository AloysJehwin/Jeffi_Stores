import Link from 'next/link'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth/jwt'
import { getCrmDashboardData } from '@/lib/shared/admin-crm'
import { getCrmInsights } from '@/lib/shared/crm-insights'
import CrmInsights from './CrmInsights'
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
import LoyaltyProgram from './programs/LoyaltyProgram'
import ReferralProgram from './programs/ReferralProgram'
import BirthdayProgram from './programs/BirthdayProgram'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { adminCookieName } from '@/lib/auth/admin-cookie'

export const dynamic = 'force-dynamic'

function pageNumber(value: string | undefined): number {
  return Math.max(1, parseInt(value || '1', 10) || 1)
}

const PROGRAM_LINKS = [
  { id: 'loyalty', label: 'Loyalty' },
  { id: 'referrals', label: 'Refer & Earn' },
  { id: 'birthday', label: 'Birthday rewards' },
]

export default async function CrmDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>
}) {
  const params = await searchParams
  const host = await getHost()
  const cookieStore = await cookies()
  const token = cookieStore.get(await adminCookieName())?.value
  let adminId = ''
  if (token) {
    try {
      adminId = (await verifyToken(token))?.adminId || ''
    } catch {}
  }

  let data: Awaited<ReturnType<typeof getCrmDashboardData>>
  let insights: Awaited<ReturnType<typeof getCrmInsights>> | null = null
  try {
    ;[data, insights] = await Promise.all([
      getCrmDashboardData(adminId),
      getCrmInsights({ range: '30d', segment: 'all' }).catch(err => {
        console.error('getCrmInsights failed', err)
        return null
      }),
    ])
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
        <p className="text-foreground-secondary text-sm mt-1">
          {s.total.toLocaleString('en-IN')} customers · {data.leadsThisWeek} new this week without an order
        </p>
      </div>

      {insights && <AttentionQueueCard items={insights.attention} />}

      {/* Tasks summary */}
      {data.tasks && (data.tasks.open > 0 || data.tasks.mine > 0) && (
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Link
            href={ap('/admin/tasks?scope=mine&status=open', host)}
            className="bg-surface-elevated rounded-xl border border-border-default p-4 hover:shadow-md hover:-translate-y-0.5 transition-all"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">My Tasks</p>
            <p className="text-2xl font-bold text-foreground mt-1">{data.tasks.mine}</p>
          </Link>
          <Link
            href={ap('/admin/tasks?scope=all&status=overdue', host)}
            className={`rounded-xl border p-4 hover:shadow-md hover:-translate-y-0.5 transition-all ${
              data.tasks.overdue > 0
                ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                : 'bg-surface-elevated border-border-default'
            }`}
          >
            <p
              className={`text-xs font-semibold uppercase tracking-wide ${
                data.tasks.overdue > 0 ? 'text-red-700 dark:text-red-300' : 'text-foreground-muted'
              }`}
            >
              Overdue
            </p>
            <p
              className={`text-2xl font-bold mt-1 ${
                data.tasks.overdue > 0 ? 'text-red-700 dark:text-red-300' : 'text-foreground'
              }`}
            >
              {data.tasks.overdue}
            </p>
          </Link>
          <Link
            href={ap('/admin/tasks?scope=all&status=open', host)}
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
      <SegmentsCard segments={s} />

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
                  href={ap(`/admin/customers?tag=${encodeURIComponent(t.tag)}`, host)}
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

      {insights && <CrmInsights initial={insights} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <RecentTagsCard items={data.recentTags} />
        <RecentSignupsCard items={data.recentSignups} />
      </div>

      {/* Customer programs. Each is switched on or off in Site Controls; an off program stays here, greyed out. */}
      <div className="pt-4 border-t border-border-default space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-foreground">Customer programs</h2>
            <p className="text-sm text-foreground-secondary">
              Rewards that keep customers coming back. Switch them on or off in Site Controls.
            </p>
          </div>
          <nav className="flex flex-wrap gap-2">
            {PROGRAM_LINKS.map(link => (
              <a
                key={link.id}
                href={`#${link.id}`}
                className="px-3 py-1 rounded-full border border-border-default text-xs font-medium text-foreground-secondary hover:bg-surface-secondary"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>
        <LoyaltyProgram
          host={host}
          query={{ page: pageNumber(params.lpage), tier: params.ltier || '', search: params.lsearch || '' }}
        />
        <ReferralProgram
          host={host}
          query={{ page: pageNumber(params.rpage), status: params.rstatus || '', search: params.rsearch || '' }}
        />
        <BirthdayProgram host={host} />
      </div>
    </div>
  )
}
