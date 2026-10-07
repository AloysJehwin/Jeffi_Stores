import Link from 'next/link'
import AdminSelect from '@/components/admin/AdminSelect'
import Pagination from '@/components/admin/Pagination'
import { getLoyaltyStats, listLoyaltyMembers, type LoyaltyStats } from '@/lib/loyalty/queries'
import { getLoyaltySettings } from '@/lib/loyalty/settings'
import { TIER_KEYS, TIER_NAMES, tierName } from '@/lib/loyalty/tiers'
import { ap } from '@/lib/shared/admin-path'
import { queryOne } from '@/lib/shared/db'
import LoyaltySettingsForm from './LoyaltySettingsForm'
import ProgramSection, { PROGRAMS_PATH, Stat, filterButtonClass, filterInputClass } from './ProgramSection'

const PAGE_SIZE = 25
const NO_STATS: LoyaltyStats = { members: 0, outstandingPoints: 0, redeemedPoints: 0, byTier: {} }

const TIER_BADGE: Record<string, string> = {
  bronze: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  silver: 'bg-slate-200 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200',
  gold: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  platinum: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
}

export interface LoyaltyQuery {
  page: number
  tier: string
  search: string
}

export default async function LoyaltyProgram({ host, query }: { host: string; query: LoyaltyQuery }) {
  const { page, tier, search } = query
  const [settings, stats, list, campaign] = await Promise.all([
    getLoyaltySettings(),
    getLoyaltyStats().catch(() => NO_STATS),
    listLoyaltyMembers({ page, pageSize: PAGE_SIZE, tier, search }).catch(() => ({ members: [], total: 0 })),
    queryOne<{ enabled: boolean }>(`SELECT enabled FROM campaigns WHERE kind = 'loyalty_tier_upgrade'`).catch(
      () => null
    ),
  ])

  const basePath = ap(PROGRAMS_PATH, host)
  const buildUrl = (target: number) => {
    const params = new URLSearchParams({ tab: 'loyalty' })
    if (tier) params.set('tier', tier)
    if (search) params.set('search', search)
    if (target > 1) params.set('page', String(target))
    return `${basePath}?${params}`
  }
  const number = (value: number) => value.toLocaleString('en-IN')
  const outstandingValue = Math.max(0, stats.outstandingPoints) * settings.pointValue

  return (
    <ProgramSection
      title="Loyalty"
      description="Points on delivered online orders, tiers, and reward coupons customers redeem from their account."
      on={settings.enabled}
      offNote="Loyalty is switched off. Customers don't earn points or see the Rewards page. The first time it's switched on, past orders are counted without emailing anyone."
      siteControlsHref={ap('/admin/settings/site-controls', host)}
    >
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

      {settings.enabled && !campaign?.enabled ? (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          <span className="flex-1">
            Tier-upgrade emails are off, so customers who move up a tier aren&apos;t told. They&apos;re sent by the
            Loyalty Tier Upgrade campaign.
          </span>
          <Link
            href={ap('/admin/campaigns/loyalty_tier_upgrade', host)}
            className="font-medium text-amber-900 underline hover:no-underline dark:text-amber-200"
          >
            Turn it on
          </Link>
        </div>
      ) : (
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
      )}

      <LoyaltySettingsForm initial={settings} />

      <div className="bg-surface-elevated rounded-lg border border-border-default">
        <div className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border-default">
          <h3 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide">Members</h3>
          <form method="get" action={basePath} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="tab" value="loyalty" />
            <input
              type="search"
              name="search"
              defaultValue={search}
              placeholder="Name, email or phone"
              className={`${filterInputClass} min-w-0 flex-1 sm:flex-none`}
            />
            <AdminSelect
              name="tier"
              defaultValue={tier}
              sm
              className="w-36"
              options={[{ value: '', label: 'All tiers' }, ...TIER_KEYS.map(key => ({ value: key, label: TIER_NAMES[key] }))]}
            />
            <button type="submit" className={filterButtonClass}>
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
    </ProgramSection>
  )
}
