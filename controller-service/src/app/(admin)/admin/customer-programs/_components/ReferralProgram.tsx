import Link from 'next/link'
import AdminSelect from '@/components/admin/AdminSelect'
import { ServerPagedItems } from '@/components/admin/kit/infinite'
import { getLoyaltySettings } from '@/lib/loyalty/settings'
import { getReferralStats, listReferralSignups, type ReferralStats, type ReferralStatus } from '@/lib/referrals/queries'
import { getReferralSettings } from '@/lib/referrals/settings'
import { ap } from '@/lib/shared/admin-path'
import { queryOne } from '@/lib/shared/db'
import ReferralSettingsForm from './ReferralSettingsForm'
import ProgramSection, { PROGRAMS_PATH, Stat, filterButtonClass, filterInputClass } from './ProgramSection'

const PAGE_SIZE = 25
const NO_STATS: ReferralStats = {
  signups: 0,
  byStatus: { joined: 0, rewarded: 0, reversed: 0, capped: 0, rejected: 0 },
  pointsPaid: 0,
  referrers: 0,
}

const STATUS: Record<ReferralStatus, { label: string; className: string }> = {
  joined: { label: 'Joined', className: 'bg-surface-secondary text-foreground-secondary' },
  rewarded: { label: 'Rewarded', className: 'bg-green-500/10 text-green-700 dark:text-green-400' },
  reversed: { label: 'Taken back', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  capped: { label: 'Yearly limit', className: 'bg-surface-secondary text-foreground-secondary' },
  rejected: { label: 'Rejected', className: 'bg-red-500/10 text-red-700 dark:text-red-400' },
}

const REJECT_REASON: Record<string, string> = {
  self: 'Referred themselves',
  same_phone: 'Same phone as referrer',
  same_email: 'Same email as referrer',
  same_device: "Signed up on the referrer's device",
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export interface ReferralQuery {
  page: number
  status: string
  search: string
}

export default async function ReferralProgram({ host, query }: { host: string; query: ReferralQuery }) {
  const { page, status, search } = query
  const [settings, loyalty, stats, list, campaign] = await Promise.all([
    getReferralSettings(),
    getLoyaltySettings(),
    getReferralStats().catch(() => NO_STATS),
    listReferralSignups({ page, pageSize: PAGE_SIZE, status, search }).catch(() => ({ rows: [], total: 0 })),
    queryOne<{ enabled: boolean }>(`SELECT enabled FROM campaigns WHERE kind = 'referral_invite'`).catch(() => null),
  ])
  const live = settings.enabled && loyalty.enabled

  const basePath = ap(PROGRAMS_PATH, host)
  const number = (value: number) => value.toLocaleString('en-IN')

  return (
    <ProgramSection
      title="Refer & Earn"
      description="Customers share a personal link and earn loyalty points when a friend's first order is delivered."
      on={live}
      offNote={
        settings.enabled
          ? 'Refer & Earn is switched on but loyalty is off, so no rewards can be paid. Turn loyalty on first.'
          : "Refer & Earn is switched off. Customers don't see their referral link."
      }
      siteControlsHref={ap('/admin/settings/site-controls', host)}
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          label="Friends joined"
          value={number(stats.signups - stats.byStatus.rejected)}
          hint={`${number(stats.referrers)} referrers`}
        />
        <Stat label="Rewarded" value={number(stats.byStatus.rewarded)} />
        <Stat label="Points paid" value={number(stats.pointsPaid)} hint="Net of rewards taken back" />
        <Stat label="Rejected" value={number(stats.byStatus.rejected)} hint="Self-referrals blocked" />
      </div>

      <p className="text-sm text-foreground-secondary">
        Invitation emails are sent by the Referral Invite campaign, which is{' '}
        <span className="font-medium text-foreground">{campaign?.enabled ? 'on' : 'off'}</span>.{' '}
        <Link href={ap('/admin/campaigns/referral_invite', host)} className="text-accent-600 hover:text-accent-700">
          Open the campaign
        </Link>
      </p>

      <ReferralSettingsForm initial={settings} />

      <div className="bg-surface-elevated rounded-xl border border-border-default">
        <div className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border-default">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">Referrals</h3>
          <form method="get" action={basePath} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="tab" value="referrals" />
            <input
              type="search"
              name="search"
              defaultValue={search}
              placeholder="Name or email"
              className={`${filterInputClass} min-w-0 flex-1 sm:flex-none`}
            />
            <AdminSelect
              name="status"
              defaultValue={status}
              sm
              className="w-40"
              options={[
                { value: '', label: 'All statuses' },
                ...(Object.keys(STATUS) as ReferralStatus[]).map(key => ({ value: key, label: STATUS[key].label })),
              ]}
            />
            <button type="submit" className={filterButtonClass}>
              Filter
            </button>
          </form>
        </div>

        {list.rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-foreground-muted">
            {live ? 'No referrals match.' : 'Referrals appear here once the program is switched on.'}
          </p>
        ) : (
          <>
            {/* Mobile card list */}
            <div className="md:hidden px-4 pb-4">
              <ServerPagedItems
                wrap="div"
                wrapClassName="space-y-3"
                page={page}
                total={list.total}
                noun="referrals"
                items={list.rows.map(row => ({
                  key: String(row.id),
                  node: (
                    <div
                      key={row.id}
                      className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span
                          className={`shrink-0 px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS[row.status].className}`}
                        >
                          {STATUS[row.status].label}
                        </span>
                        <span className="text-xs text-foreground-muted whitespace-nowrap">
                          {formatDate(row.signedUpAt)}
                        </span>
                      </div>
                      <div className="mt-3 space-y-2">
                        {[
                          { role: 'Referrer', person: row.referrer },
                          { role: 'Friend', person: row.friend },
                        ].map(({ role, person }) => (
                          <div key={role} className="min-w-0">
                            <p className="text-[10px] uppercase tracking-wide text-foreground-muted">{role}</p>
                            <Link
                              href={ap(`/admin/customers/${person.id}/view`, host)}
                              className="block font-medium text-foreground hover:text-accent-600 truncate"
                            >
                              {person.name}
                            </Link>
                            <p className="text-xs text-foreground-muted truncate">{person.email}</p>
                          </div>
                        ))}
                      </div>
                      {(row.rejectReason || row.points != null) && (
                        <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                          {row.rejectReason ? (
                            <span className="text-foreground-muted">
                              {REJECT_REASON[row.rejectReason] ?? row.rejectReason}
                            </span>
                          ) : (
                            <span />
                          )}
                          {row.points != null && (
                            <span className="font-medium text-foreground whitespace-nowrap">
                              {number(row.points)} pts
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ),
                }))}
              />
            </div>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-foreground-muted">
                    <th className="px-4 py-3 font-medium">Referrer</th>
                    <th className="px-4 py-3 font-medium">Friend</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Points</th>
                    <th className="px-4 py-3 font-medium">Joined</th>
                  </tr>
                </thead>
                <ServerPagedItems
                  wrap="tbody"
                  page={page}
                  total={list.total}
                  noun="referrals"
                  items={list.rows.map(row => ({
                    key: String(row.id),
                    node: (
                    <tr key={row.id} className="border-t border-border-default">
                      {[row.referrer, row.friend].map((person, i) => (
                        <td key={i} className="px-4 py-3">
                          <Link
                            href={ap(`/admin/customers/${person.id}/view`, host)}
                            className="font-medium text-foreground hover:text-accent-600"
                          >
                            {person.name}
                          </Link>
                          <p className="text-xs text-foreground-muted">{person.email}</p>
                        </td>
                      ))}
                      <td className="px-4 py-3">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS[row.status].className}`}
                        >
                          {STATUS[row.status].label}
                        </span>
                        {row.rejectReason && (
                          <p className="mt-1 text-xs text-foreground-muted">
                            {REJECT_REASON[row.rejectReason] ?? row.rejectReason}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-foreground">
                        {row.points != null ? number(row.points) : '—'}
                      </td>
                      <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap">
                        {formatDate(row.signedUpAt)}
                      </td>
                    </tr>
                    ),
                  }))}
                />
              </table>
            </div>
          </>
        )}
      </div>
    </ProgramSection>
  )
}
