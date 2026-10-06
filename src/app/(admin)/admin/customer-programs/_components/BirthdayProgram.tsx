import Link from 'next/link'
import { getBirthdayProgramStats, type BirthdayProgramStats } from '@/lib/campaigns/birthday-stats'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { ap } from '@/lib/shared/admin-path'
import { queryMany } from '@/lib/shared/db'
import ProgramSection, { Stat } from './ProgramSection'

const NO_STATS: BirthdayProgramStats = { customers: 0, withBirthday: 0, next30Days: 0, upcoming: [] }

const CAMPAIGNS = [
  { kind: 'birthday', name: 'Birthday', does: 'Greets customers on their birthday, with a coupon if one is set' },
  { kind: 'birthday_collect', name: 'Birthday Collection', does: 'Asks customers without a birthday to add one' },
]

function formatDay(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export default async function BirthdayProgram({ host }: { host: string }) {
  const [flags, stats, campaigns] = await Promise.all([
    getFeatureFlags(),
    getBirthdayProgramStats().catch(() => NO_STATS),
    queryMany<{ kind: string; enabled: boolean }>(`SELECT kind, enabled FROM campaigns WHERE kind = ANY($1::text[])`, [
      CAMPAIGNS.map(c => c.kind),
    ]).catch(() => []),
  ])
  const enabledByKind = new Map(campaigns.map(c => [c.kind, c.enabled]))
  const number = (value: number) => value.toLocaleString('en-IN')
  const coverage = stats.customers > 0 ? Math.round((stats.withBirthday / stats.customers) * 100) : 0

  return (
    <ProgramSection
      title="Birthday rewards"
      description="Collects customers' birthdays and sends a treat on the day."
      on={flags.birthdayEnabled}
      offNote="Birthday rewards are switched off. Customers aren't asked for a birthday and no birthday emails go out."
      siteControlsHref={ap('/admin/settings/site-controls', host)}
    >
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <Stat
          label="Birthdays on file"
          value={number(stats.withBirthday)}
          hint={`${coverage}% of ${number(stats.customers)} customers`}
        />
        <Stat label="Next 30 days" value={number(stats.next30Days)} />
        <Stat label="Still to collect" value={number(stats.customers - stats.withBirthday)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-surface-elevated rounded-lg border border-border-default p-4 min-w-0">
          <h3 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide mb-3">Campaigns</h3>
          <ul className="space-y-3">
            {CAMPAIGNS.map(campaign => {
              const enabled = enabledByKind.get(campaign.kind) ?? false
              return (
                <li key={campaign.kind} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={ap(`/admin/campaigns/${campaign.kind}`, host)}
                      className="text-sm font-medium text-foreground hover:text-accent-600"
                    >
                      {campaign.name}
                    </Link>
                    <p className="text-xs text-foreground-muted">{campaign.does}</p>
                  </div>
                  <span
                    className={`shrink-0 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      enabled
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                        : 'bg-surface-secondary text-foreground-secondary'
                    }`}
                  >
                    {enabled ? 'On' : 'Off'}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="bg-surface-elevated rounded-lg border border-border-default p-4 min-w-0">
          <h3 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide mb-3">
            Coming up
          </h3>
          {stats.upcoming.length === 0 ? (
            <p className="text-sm text-foreground-muted">No birthdays in the next 30 days.</p>
          ) : (
            <ul className="divide-y divide-border-default">
              {stats.upcoming.map(person => (
                <li key={person.userId} className="flex items-center justify-between gap-3 py-2">
                  <Link
                    href={ap(`/admin/customers/${person.userId}`, host)}
                    className="min-w-0 truncate text-sm font-medium text-foreground hover:text-accent-600"
                  >
                    {person.name}
                  </Link>
                  <span className="shrink-0 text-sm text-foreground-secondary">{formatDay(person.nextBirthday)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ProgramSection>
  )
}
