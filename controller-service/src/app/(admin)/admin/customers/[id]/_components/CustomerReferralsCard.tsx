import Link from 'next/link'
import { queryMany, queryOne } from '@/lib/shared/db'
import { ap } from '@/lib/shared/admin-path'

const STATUS_LABEL: Record<string, string> = {
  joined: 'Joined',
  rewarded: 'Rewarded',
  reversed: 'Taken back',
  capped: 'Yearly limit',
  rejected: 'Rejected',
}

// Server-rendered: shows this customer's referral code, who referred them, and the friends they
// referred. Renders nothing for a customer with no referral activity.
export default async function CustomerReferralsCard({
  customerId,
  email,
  host,
}: {
  customerId: string
  email: string
  host: string
}) {
  const [code, referredBy, friends, total] = await Promise.all([
    queryOne<{ referral_code: string }>(`SELECT referral_code FROM referrals WHERE referrer_user_id = $1`, [
      customerId,
    ]),
    queryOne<{ id: string; name: string; status: string }>(
      `SELECT r.id::text AS id, COALESCE(NULLIF(TRIM(CONCAT(r.first_name, ' ', r.last_name)), ''), r.email) AS name, s.status
       FROM referral_signups s JOIN users r ON r.id = s.referrer_user_id
       WHERE s.referred_user_id = $1`,
      [customerId]
    ),
    queryMany<{ id: string; name: string; status: string; points: number | null }>(
      `SELECT f.id::text AS id, COALESCE(NULLIF(TRIM(CONCAT(f.first_name, ' ', f.last_name)), ''), f.email) AS name,
              s.status, s.points
       FROM referral_signups s JOIN users f ON f.id = s.referred_user_id
       WHERE s.referrer_user_id = $1
       ORDER BY s.signed_up_at DESC
       LIMIT 5`,
      [customerId]
    ),
    queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM referral_signups WHERE referrer_user_id = $1`, [
      customerId,
    ]),
  ]).catch(() => [null, null, [], null] as const)

  const count = total?.n ?? 0
  if (!code && !referredBy && count === 0) return null

  return (
    <div className="bg-surface-elevated rounded-lg border border-border-default p-4 space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">Referrals</h3>
      {code && (
        <p className="text-sm text-foreground-secondary">
          Code <span className="font-mono font-semibold text-foreground">{code.referral_code}</span>
        </p>
      )}
      {referredBy && (
        <p className="text-sm text-foreground-secondary">
          Referred by{' '}
          <Link
            href={ap(`/admin/customers/${referredBy.id}/view`, host)}
            className="font-medium text-foreground hover:text-accent-600"
          >
            {referredBy.name}
          </Link>{' '}
          ({STATUS_LABEL[referredBy.status] ?? referredBy.status})
        </p>
      )}
      {count > 0 && (
        <div>
          <p className="text-sm text-foreground-secondary">
            Referred {count.toLocaleString('en-IN')} {count === 1 ? 'friend' : 'friends'}
          </p>
          <ul className="mt-2 divide-y divide-border-default">
            {friends.map(friend => (
              <li key={friend.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link
                  href={ap(`/admin/customers/${friend.id}/view`, host)}
                  className="truncate text-foreground hover:text-accent-600"
                >
                  {friend.name}
                </Link>
                <span className="shrink-0 text-xs text-foreground-muted">
                  {STATUS_LABEL[friend.status] ?? friend.status}
                  {friend.points ? ` · +${friend.points}` : ''}
                </span>
              </li>
            ))}
          </ul>
          {count > friends.length && (
            <Link
              href={`${ap('/admin/customer-programs', host)}?tab=referrals&search=${encodeURIComponent(email)}`}
              className="mt-2 inline-block text-xs text-accent-600 hover:text-accent-700"
            >
              See all in Referrals
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
