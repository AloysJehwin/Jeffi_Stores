import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import { queryOne, queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface Coupon {
  id: string
  code: string
  description: string | null
  discount_type: string
  discount_value: number
  min_purchase_amount: number | null
  max_discount_amount: number | null
  usage_limit: number | null
  usage_limit_per_user: number | null
  times_used: number
  valid_from: string | null
  valid_until: string | null
  is_active: boolean
  auto_generated: boolean
  generated_for_user_id: string | null
  generated_for_campaign: string | null
  created_at: string
}

interface UsageRow {
  id: string
  user_id: string | null
  order_id: string | null
  discount_amount: number
  created_at: string
  user_email: string | null
  user_name: string | null
  order_display_id: string | null
}

interface EligibleUser {
  user_id: string
  email: string
  first_name: string | null
  last_name: string | null
  added_at: string
  times_used: number
}

export default async function CouponViewPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ back?: string }>
}) {
  const { id } = await params
  const { back } = await searchParams
  const host = await getHost()
  const backUrl = back && back.startsWith('/admin/coupons') ? back : '/admin/coupons'

  const coupon = await queryOne<Coupon>('SELECT * FROM coupons WHERE id = $1', [id])
  if (!coupon) notFound()

  const hasDraft = await queryOne<{ coupon_id: string }>(
    'SELECT coupon_id FROM coupon_drafts WHERE coupon_id = $1', [id]
  )

  const isExpired = coupon.valid_until && new Date(coupon.valid_until) < new Date()
  const isPersonal = coupon.auto_generated && coupon.generated_for_user_id
  const isCampaign = coupon.auto_generated && !!coupon.generated_for_campaign && !coupon.generated_for_user_id

  const [usageRows, eligibleUsers, campaignSentCount] = await Promise.all([
    queryMany<UsageRow>(`
      SELECT cu.id, cu.user_id, cu.order_id, cu.discount_amount, cu.created_at,
        u.email AS user_email,
        TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')) AS user_name,
        o.display_id AS order_display_id
      FROM coupon_usage cu
      LEFT JOIN users u ON u.id = cu.user_id
      LEFT JOIN orders o ON o.id = cu.order_id
      WHERE cu.coupon_id = $1
      ORDER BY cu.created_at DESC
      LIMIT 50`, [id]),

    isPersonal ? queryMany<EligibleUser>(`
      SELECT u.id AS user_id, u.email, u.first_name, u.last_name, c.created_at AS added_at,
        COALESCE((SELECT COUNT(*) FROM coupon_usage cu WHERE cu.coupon_id=$1 AND cu.user_id=u.id),0)::int AS times_used
      FROM coupons c JOIN users u ON u.id = c.generated_for_user_id
      WHERE c.id = $1`, [id])
    : isCampaign ? queryMany<EligibleUser>(`
      SELECT DISTINCT u.id AS user_id, u.email, u.first_name, u.last_name, ecs.sent_at AS added_at,
        COALESCE((SELECT COUNT(*) FROM coupon_usage cu WHERE cu.coupon_id=$1 AND cu.user_id=u.id),0)::int AS times_used
      FROM email_campaigns_sent ecs
      JOIN users u ON u.id = ecs.user_id
      WHERE ecs.campaign_kind = $2
      ORDER BY ecs.sent_at DESC LIMIT 100`, [id, coupon.generated_for_campaign])
    : queryMany<EligibleUser>(`
      SELECT u.id AS user_id, u.email, u.first_name, u.last_name, ceu.added_at,
        COALESCE((SELECT COUNT(*) FROM coupon_usage cu WHERE cu.coupon_id=$1 AND cu.user_id=u.id),0)::int AS times_used
      FROM coupon_eligible_users ceu
      JOIN users u ON u.id = ceu.user_id
      WHERE ceu.coupon_id = $1
      ORDER BY ceu.added_at DESC LIMIT 100`, [id]),

    isCampaign ? queryOne<{ count: string }>(`
      SELECT COUNT(DISTINCT user_id)::text AS count FROM email_campaigns_sent WHERE campaign_kind = $1`,
      [coupon.generated_for_campaign]) : Promise.resolve(null),
  ])

  const totalDiscount = usageRows.reduce((s, r) => s + Number(r.discount_amount), 0)
  const eligibleCount = isCampaign ? parseInt(campaignSentCount?.count || '0') : eligibleUsers.length

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <Link href={ap(backUrl, host)} className="text-foreground-muted hover:text-foreground transition-colors flex-shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold font-mono text-secondary-500 dark:text-foreground">{coupon.code}</h1>
              <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${coupon.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'}`}>
                {coupon.is_active ? 'Active' : 'Inactive'}
              </span>
              {isExpired && (
                <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">Expired</span>
              )}
              {coupon.generated_for_campaign && (
                <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">{coupon.generated_for_campaign}</span>
              )}
              {hasDraft && (
                <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Draft pending</span>
              )}
            </div>
            {coupon.description && <p className="text-sm text-foreground-secondary mt-1">{coupon.description}</p>}
            <p className="text-xs text-foreground-muted mt-0.5">Created {new Date(coupon.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
          </div>
        </div>
        <Link
          href={ap(`/admin/coupons/edit/${id}?back=${encodeURIComponent(backUrl)}`, host)}
          className="flex-shrink-0 px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold text-sm transition-colors"
        >
          {hasDraft ? 'Edit Draft' : 'Edit'}
        </Link>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-surface-elevated rounded-lg border border-border-default p-4">
          <p className="text-xs text-foreground-secondary">Times Used</p>
          <p className="text-2xl font-bold text-foreground mt-1">{coupon.times_used}{coupon.usage_limit ? <span className="text-sm font-normal text-foreground-muted">/{coupon.usage_limit}</span> : ''}</p>
        </div>
        <div className="bg-surface-elevated rounded-lg border border-border-default p-4">
          <p className="text-xs text-foreground-secondary">Total Discount Given</p>
          <p className="text-2xl font-bold text-foreground mt-1">₹{totalDiscount.toLocaleString('en-IN')}</p>
        </div>
        <div className="bg-surface-elevated rounded-lg border border-border-default p-4">
          <p className="text-xs text-foreground-secondary">Eligible Users</p>
          <p className="text-2xl font-bold text-foreground mt-1">{eligibleCount > 0 ? eligibleCount : 'All'}</p>
        </div>
        <div className="bg-surface-elevated rounded-lg border border-border-default p-4">
          <p className="text-xs text-foreground-secondary">Discount</p>
          <p className="text-2xl font-bold text-accent-500 mt-1">
            {coupon.discount_type === 'percentage' ? `${coupon.discount_value}%` : `₹${coupon.discount_value}`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: details */}
        <div className="space-y-6">
          <div className="bg-surface-elevated rounded-lg border border-border-default overflow-hidden">
            <div className="px-5 py-3 border-b border-border-default bg-surface-secondary">
              <h2 className="text-sm font-semibold text-foreground">Coupon Details</h2>
            </div>
            <div className="px-5 divide-y divide-border-default">
              {[
                ['Type', <span className="capitalize">{coupon.discount_type}</span>],
                ['Value', coupon.discount_type === 'percentage' ? `${coupon.discount_value}% off` : `₹${coupon.discount_value} off`],
                ['Min Purchase', coupon.min_purchase_amount ? `₹${coupon.min_purchase_amount}` : '—'],
                ['Max Discount', coupon.max_discount_amount ? `₹${coupon.max_discount_amount}` : '—'],
                ['Usage Limit', coupon.usage_limit ? `${coupon.usage_limit} total` : 'Unlimited'],
                ['Per-User Limit', coupon.usage_limit_per_user ? `${coupon.usage_limit_per_user} per user` : 'Unlimited'],
                ['Valid From', coupon.valid_from ? new Date(coupon.valid_from).toLocaleString('en-IN') : '—'],
                ['Valid Until', coupon.valid_until
                  ? <span className={isExpired ? 'text-red-500' : ''}>{new Date(coupon.valid_until).toLocaleString('en-IN')}</span>
                  : '—'],
                ['Auto Generated', coupon.auto_generated ? 'Yes' : 'No'],
                ['Source', coupon.generated_for_campaign || (isPersonal ? 'Personal' : 'Manual')],
              ].map(([label, value], i) => (
                <div key={i} className="flex items-center justify-between py-2.5 gap-4">
                  <span className="text-sm text-foreground-secondary flex-shrink-0">{label}</span>
                  <span className="text-sm text-foreground font-medium text-right">{value as ReactNode}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: usage + eligible */}
        <div className="lg:col-span-2 space-y-6">
          {/* Usage history */}
          <div className="bg-surface-elevated rounded-lg border border-border-default overflow-hidden">
            <div className="px-5 py-3 border-b border-border-default bg-surface-secondary flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Usage History</h2>
              <span className="text-xs text-foreground-muted">{usageRows.length} redemption{usageRows.length !== 1 ? 's' : ''}</span>
            </div>
            {usageRows.length === 0 ? (
              <p className="px-5 py-6 text-sm text-foreground-muted text-center">No one has used this coupon yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-secondary/50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-foreground-secondary">User</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-foreground-secondary">Order</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-foreground-secondary">Discount</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-foreground-secondary">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {usageRows.map(r => (
                      <tr key={r.id} className="hover:bg-surface-secondary/40">
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-foreground">{r.user_name || '—'}</p>
                          <p className="text-xs text-foreground-muted">{r.user_email || '—'}</p>
                        </td>
                        <td className="px-4 py-2.5">
                          {r.order_id ? (
                            <Link href={ap(`/admin/orders/${r.order_id}`, host)} className="text-accent-500 hover:underline font-mono text-xs">
                              #{r.order_display_id || r.order_id.slice(0, 8)}
                            </Link>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-2.5 font-semibold text-green-600">₹{Number(r.discount_amount).toLocaleString('en-IN')}</td>
                        <td className="px-4 py-2.5 text-foreground-muted text-xs">
                          {new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Eligible users */}
          <div className="bg-surface-elevated rounded-lg border border-border-default overflow-hidden">
            <div className="px-5 py-3 border-b border-border-default bg-surface-secondary flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  {isPersonal ? 'Assigned To' : isCampaign ? 'Campaign Recipients' : eligibleUsers.length > 0 ? 'Eligible Users' : 'Eligible Users'}
                </h2>
                <p className="text-xs text-foreground-muted mt-0.5">
                  {isPersonal ? 'This coupon is personal' :
                   isCampaign ? `${eligibleCount} users received this campaign` :
                   eligibleUsers.length > 0 ? `${eligibleUsers.length} users granted via mailer` :
                   'All active users can redeem'}
                </p>
              </div>
              {eligibleUsers.length > 0 && (
                <span className="text-xs text-foreground-muted">{eligibleUsers.length} user{eligibleUsers.length !== 1 ? 's' : ''}</span>
              )}
            </div>
            {eligibleUsers.length === 0 && !isCampaign ? (
              <p className="px-5 py-6 text-sm text-foreground-muted text-center">
                {isPersonal ? 'No user assigned.' : 'Open to all active users.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-secondary/50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-foreground-secondary">User</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-foreground-secondary">{isCampaign ? 'Sent At' : 'Added At'}</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-foreground-secondary">Used</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {eligibleUsers.map(u => (
                      <tr key={u.user_id} className="hover:bg-surface-secondary/40">
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-foreground">{[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}</p>
                          <p className="text-xs text-foreground-muted">{u.email}</p>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-foreground-muted">
                          {new Date(u.added_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="px-4 py-2.5">
                          {u.times_used > 0
                            ? <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">{u.times_used}×</span>
                            : <span className="text-xs text-foreground-muted">Not yet</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
