import Link from 'next/link'
import Pagination from '@/components/admin/Pagination'
import { getLoyaltyStats, listLoyaltyMembers, type LoyaltyStats } from '@/lib/loyalty/queries'
import { getLoyaltySettings } from '@/lib/loyalty/settings'
import { TIER_KEYS, TIER_NAMES, tierName } from '@/lib/loyalty/tiers'
import { ap } from '@/lib/shared/admin-path'
import { queryOne } from '@/lib/shared/db'
import { getHost } from '@/lib/tenancy/get-host'
import LoyaltySettingsForm from './_components/LoyaltySettingsForm'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 25
const NO_STATS: LoyaltyStats = { members: 0, outstandingPoints: 0, redeemedPoints: 0, byTier: {} }

const TIER_BADGE: Record<string, string> = {
  bronze: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  silver: 'bg-slate-200 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200',
  gold: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  platinum: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-surface-elevated rounded-lg border border-border-default p-4">
      <p className="text-xs font-medium text-foreground-muted uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-foreground-secondary">{hint}</p>}
    </div>
  )
}

export default async function LoyaltyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>
}) {
  const params = await searchParams
  const page = Math.max(1, parseInt(params.page || '1', 10) || 1)
  const tier = params.tier || ''
  const search = params.search || ''
  const host = await getHost()

  const [settings, stats, list, campaign] = await Promise.all([
    getLoyaltySettings(),
    getLoyaltyStats().catch(() => NO_STATS),
    listLoyaltyMembers({ page, pageSize: PAGE_SIZE, tier, search }).catch(() => ({ members: [], total: 0 })),
    queryOne<{ enabled: boolean }>(`SELECT enabled FROM campaigns WHERE kind = 'loyalty_tier_upgrade'`).catch(
      () => null
    ),
  ])

  const basePath = ap('/admin/loyalty', host)
  const buildUrl = (target: number) => {
    const query = new URLSearchParams()
    if (tier) query.set('tier', tier)
    if (search) query.set('search', search)
    if (target > 1) query.set('page', String(target))
    const text = query.toString()
    return text ? `${basePath}?${text}` : basePath
  }
  const number = (value: number) => value.toLocaleString('en-IN')
  const outstandingValue = Math.max(0, stats.outstandingPoints) * settings.pointValue

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Loyalty</h1>
          <p className="text-foreground-secondary mt-1 text-sm">
            Points on delivered orders, tiers, and reward coupons customers redeem from their account.
          </p>
        </div>
        <span
          className={`self-start sm:self-auto px-3 py-1 rounded-full text-xs font-semibold ${
            settings.enabled
              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
              : 'bg-surface-secondary text-foreground-secondary'
          }`}
        >
          {settings.enabled ? 'On' : 'Off'}
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Members" value={number(stats.members)} />
        <Stat
          label="Points outstanding"
          value={number(stats.outstandingPoints)}
          hint={`Worth ${outstandingValue.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })} in coupons`}
        />
        <Stat label="Points redeemed" value={number(stats.redeemedPoints)} />
        <Stat
          label="By tier"
          value={TIER_KEYS.map(key => stats.byTier[key] ?? 0).join(' / ')}
          hint={TIER_KEYS.map(key => TIER_NAMES[key]).join(' / ')}
        />
      </div>

      <p className="text-sm text-foreground-secondary">
        Tier-upgrade emails are sent by the Loyalty Tier Upgrade campaign, which is{' '}
        <span className="font-medium text-foreground">{campaign?.enabled ? 'on' : 'off'}</span>.{' '}
        <Link
          href={ap('/admin/campaigns/loyalty_tier_upgrade', host)}
          className="text-accent-600 hover:text-accent-700 dark:text-accent-400"
        >
          Open the campaign
        </Link>
      </p>

      <LoyaltySettingsForm initial={settings} />

      <div className="bg-surface-elevated rounded-lg border border-border-default">
        <div className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border-default">
          <h2 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide">Members</h2>
          <form method="get" action={basePath} className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              name="search"
              defaultValue={search}
              placeholder="Name, email or phone"
              className="px-3 py-1.5 text-sm border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
            <select
              name="tier"
              defaultValue={tier}
              className="px-3 py-1.5 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              <option value="">All tiers</option>
              {TIER_KEYS.map(key => (
                <option key={key} value={key}>
                  {TIER_NAMES[key]}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="px-4 py-1.5 text-sm font-medium border border-border-secondary rounded-lg text-foreground hover:bg-surface-secondary"
            >
              Filter
            </button>
          </form>
        </div>

        {list.members.length === 0 ? (
          <p className="p-8 text-center text-sm text-foreground-muted">
            {settings.enabled ? 'No members match.' : 'Members appear here once the program is switched on.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-foreground-muted">
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Tier</th>
                  <th className="px-4 py-3 font-medium text-right">Points</th>
                  <th className="px-4 py-3 font-medium text-right">Ever earned</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {list.members.map(member => (
                  <tr key={member.userId} className="border-t border-border-default">
                    <td className="px-4 py-3">
                      <Link
                        href={ap(`/admin/customers/${member.userId}`, host)}
                        className="font-medium text-foreground hover:text-accent-600"
                      >
                        {member.name}
                      </Link>
                      <p className="text-xs text-foreground-muted">{member.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${TIER_BADGE[member.tier] ?? TIER_BADGE.bronze}`}
                      >
                        {tierName(member.tier)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-foreground">{number(member.points)}</td>
                    <td className="px-4 py-3 text-right text-foreground-secondary">{number(member.lifetimePoints)}</td>
                    <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap">
                      {new Date(member.updatedAt).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="p-4">
          <Pagination page={page} total={list.total} pageSize={PAGE_SIZE} buildUrl={buildUrl} />
        </div>
      </div>
    </div>
  )
}
