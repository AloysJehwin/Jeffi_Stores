import Link from 'next/link'
import Pagination from '@/components/admin/Pagination'
import { getLoyaltySettings } from '@/lib/loyalty/settings'
import { getReferralStats, listReferralSignups, type ReferralStats, type ReferralStatus } from '@/lib/referrals/queries'
import { getReferralSettings } from '@/lib/referrals/settings'
import { ap } from '@/lib/shared/admin-path'
import { queryOne } from '@/lib/shared/db'
import { getHost } from '@/lib/tenancy/get-host'
import ReferralSettingsForm from './_components/ReferralSettingsForm'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 25
const NO_STATS: ReferralStats = {
  signups: 0,
  byStatus: { joined: 0, rewarded: 0, reversed: 0, capped: 0, rejected: 0 },
  pointsPaid: 0,
  referrers: 0,
}

const STATUS: Record<ReferralStatus, { label: string; className: string }> = {
  joined: { label: 'Joined', className: 'bg-surface-secondary text-foreground-secondary' },
  rewarded: { label: 'Rewarded', className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  reversed: { label: 'Taken back', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  capped: { label: 'Yearly limit', className: 'bg-surface-secondary text-foreground-secondary' },
  rejected: { label: 'Rejected', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
}

const REJECT_REASON: Record<string, string> = {
  self: 'Referred themselves',
  same_phone: 'Same phone as referrer',
  same_email: 'Same email as referrer',
  same_device: "Signed up on the referrer's device",
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

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default async function ReferralsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>
}) {
  const params = await searchParams
  const page = Math.max(1, parseInt(params.page || '1', 10) || 1)
  const status = params.status || ''
  const search = params.search || ''
  const host = await getHost()

  const [settings, loyalty, stats, list, campaign] = await Promise.all([
    getReferralSettings(),
    getLoyaltySettings(),
    getReferralStats().catch(() => NO_STATS),
    listReferralSignups({ page, pageSize: PAGE_SIZE, status, search }).catch(() => ({ rows: [], total: 0 })),
    queryOne<{ enabled: boolean }>(`SELECT enabled FROM campaigns WHERE kind = 'referral_invite'`).catch(() => null),
  ])
  const live = settings.enabled && loyalty.enabled

  const basePath = ap('/admin/referrals', host)
  const buildUrl = (target: number) => {
    const query = new URLSearchParams()
    if (status) query.set('status', status)
    if (search) query.set('search', search)
    if (target > 1) query.set('page', String(target))
    const text = query.toString()
    return text ? `${basePath}?${text}` : basePath
  }
  const number = (value: number) => value.toLocaleString('en-IN')

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Referrals</h1>
          <p className="text-foreground-secondary mt-1 text-sm">
            Customers share a personal link and earn loyalty points when a friend&apos;s first order is delivered.
          </p>
        </div>
        <span
          className={`self-start sm:self-auto px-3 py-1 rounded-full text-xs font-semibold ${
            live
              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
              : 'bg-surface-secondary text-foreground-secondary'
          }`}
        >
          {live ? 'On' : 'Off'}
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Friends joined" value={number(stats.signups - stats.byStatus.rejected)} hint={`${number(stats.referrers)} referrers`} />
        <Stat label="Rewarded" value={number(stats.byStatus.rewarded)} />
        <Stat label="Points paid" value={number(stats.pointsPaid)} hint="Net of rewards taken back" />
        <Stat label="Rejected" value={number(stats.byStatus.rejected)} hint="Self-referrals blocked" />
      </div>

      <p className="text-sm text-foreground-secondary">
        Invitation emails are sent by the Referral Invite campaign, which is{' '}
        <span className="font-medium text-foreground">{campaign?.enabled ? 'on' : 'off'}</span>.{' '}
        <Link
          href={ap('/admin/campaigns/referral_invite', host)}
          className="text-accent-600 hover:text-accent-700 dark:text-accent-400"
        >
          Open the campaign
        </Link>
      </p>

      <ReferralSettingsForm initial={settings} loyaltyEnabled={loyalty.enabled} />

      <div className="bg-surface-elevated rounded-lg border border-border-default">
        <div className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border-default">
          <h2 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide">Referrals</h2>
          <form method="get" action={basePath} className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              name="search"
              defaultValue={search}
              placeholder="Name or email"
              className="px-3 py-1.5 text-sm border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
            <select
              name="status"
              defaultValue={status}
              className="px-3 py-1.5 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              <option value="">All statuses</option>
              {(Object.keys(STATUS) as ReferralStatus[]).map(key => (
                <option key={key} value={key}>
                  {STATUS[key].label}
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

        {list.rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-foreground-muted">
            {live ? 'No referrals match.' : 'Referrals appear here once the program is switched on.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
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
              <tbody>
                {list.rows.map(row => (
                  <tr key={row.id} className="border-t border-border-default">
                    {[row.referrer, row.friend].map((person, i) => (
                      <td key={i} className="px-4 py-3">
                        <Link
                          href={ap(`/admin/customers/${person.id}`, host)}
                          className="font-medium text-foreground hover:text-accent-600"
                        >
                          {person.name}
                        </Link>
                        <p className="text-xs text-foreground-muted">{person.email}</p>
                      </td>
                    ))}
                    <td className="px-4 py-3">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS[row.status].className}`}>
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
                    <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap">{formatDate(row.signedUpAt)}</td>
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
