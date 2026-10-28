import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  Badge,
  Card,
  DetailHeader,
  EmptyState,
  EntityPage,
  Field,
  Fields,
  Kpi,
  KpiGrid,
  StatusBadge,
  ACTIVE_STATUS,
  badgeCls,
} from '@/components/admin/kit'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { queryOne, queryMany } from '@/lib/shared/db'
import { getAdminSession } from '@/lib/auth/admin-auth'
import { draftsForView } from '@/lib/admin/draft-branches'
import { couponDrafts } from '@/lib/catalog/coupon-draft'
import EntityDrafts from '@/components/admin/drafts/EntityDrafts'
import { startCouponDraft } from './actions'

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

export default async function CouponViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ back?: string }>
}) {
  const { id } = await params
  const { back } = await searchParams
  const host = await getHost()
  const backUrl = back && back.startsWith('/admin/coupons') ? back : '/admin/coupons'

  const coupon = await queryOne<Coupon>('SELECT * FROM coupons WHERE id = $1', [id])
  if (!coupon) notFound()

  const session = await getAdminSession()
  const me = session?.adminId ?? null
  const drafts = await draftsForView(couponDrafts, id, me)
  const myDraft = drafts.find(d => d.authorId === me)

  const isExpired = coupon.valid_until && new Date(coupon.valid_until) < new Date()
  const isPersonal = coupon.auto_generated && coupon.generated_for_user_id
  const isCampaign = coupon.auto_generated && !!coupon.generated_for_campaign && !coupon.generated_for_user_id

  const [usageRows, eligibleUsers, campaignSentCount] = await Promise.all([
    queryMany<UsageRow>(
      `
      SELECT cu.id, cu.user_id, cu.order_id, cu.discount_amount, cu.created_at,
        u.email AS user_email,
        TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')) AS user_name,
        o.order_number AS order_display_id
      FROM coupon_usage cu
      LEFT JOIN users u ON u.id = cu.user_id
      LEFT JOIN orders o ON o.id = cu.order_id
      WHERE cu.coupon_id = $1
      ORDER BY cu.created_at DESC
      LIMIT 50`,
      [id]
    ),

    isPersonal
      ? queryMany<EligibleUser>(
          `
      SELECT u.id AS user_id, u.email, u.first_name, u.last_name, c.created_at AS added_at,
        COALESCE((SELECT COUNT(*) FROM coupon_usage cu WHERE cu.coupon_id=$1 AND cu.user_id=u.id),0)::int AS times_used
      FROM coupons c JOIN users u ON u.id = c.generated_for_user_id
      WHERE c.id = $1`,
          [id]
        )
      : isCampaign
        ? queryMany<EligibleUser>(
            `
      SELECT DISTINCT u.id AS user_id, u.email, u.first_name, u.last_name, ecs.sent_at AS added_at,
        COALESCE((SELECT COUNT(*) FROM coupon_usage cu WHERE cu.coupon_id=$1 AND cu.user_id=u.id),0)::int AS times_used
      FROM email_campaigns_sent ecs
      JOIN users u ON u.id = ecs.user_id
      WHERE ecs.campaign_kind = $2
      ORDER BY ecs.sent_at DESC LIMIT 100`,
            [id, coupon.generated_for_campaign]
          )
        : queryMany<EligibleUser>(
            `
      SELECT u.id AS user_id, u.email, u.first_name, u.last_name, ceu.added_at,
        COALESCE((SELECT COUNT(*) FROM coupon_usage cu WHERE cu.coupon_id=$1 AND cu.user_id=u.id),0)::int AS times_used
      FROM coupon_eligible_users ceu
      JOIN users u ON u.id = ceu.user_id
      WHERE ceu.coupon_id = $1
      ORDER BY ceu.added_at DESC LIMIT 100`,
            [id]
          ),

    isCampaign
      ? queryOne<{ count: string }>(
          `
      SELECT COUNT(DISTINCT user_id)::text AS count FROM email_campaigns_sent WHERE campaign_kind = $1`,
          [coupon.generated_for_campaign]
        )
      : Promise.resolve(null),
  ])

  const totalDiscount = usageRows.reduce((s, r) => s + Number(r.discount_amount), 0)
  const eligibleCount = isCampaign ? parseInt(campaignSentCount?.count || '0') : eligibleUsers.length

  const day = (d: string) =>
    new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  const thead = 'border-y border-border-default bg-surface-secondary/50 text-xs text-foreground-muted'
  const row = 'border-b border-border-default/60 last:border-0 hover:bg-surface-secondary/40'

  return (
    <EntityPage
      header={
        <DetailHeader
          back={{ href: ap(backUrl, host), label: 'Coupons' }}
          title={<span className="font-mono">{coupon.code}</span>}
          status={
            <>
              <StatusBadge status={String(coupon.is_active)} map={ACTIVE_STATUS} />
              {isExpired && <Badge tone="amber">Expired</Badge>}
              {coupon.generated_for_campaign && <Badge tone="blue">{coupon.generated_for_campaign}</Badge>}
              {drafts.length > 0 && <Badge tone="amber">{drafts.length === 1 ? 'Draft pending' : `${drafts.length} drafts`}</Badge>}
            </>
          }
          subtitle={coupon.description || undefined}
          identifiers={[{ label: 'Created', value: day(coupon.created_at) }]}
          actions={
            <form action={startCouponDraft.bind(null, id)}>
              <input type="hidden" name="_back" value={backUrl} />
              <button type="submit" className="control-md bg-accent-500 font-semibold text-white hover:bg-accent-600">
                {myDraft ? 'Edit my draft' : 'Edit'}
              </button>
            </form>
          }
        />
      }
      notices={drafts.length > 0 && <EntityDrafts drafts={drafts} start={startCouponDraft.bind(null, id)} back={backUrl} me={me} noun="coupon" />}
      kpis={
        <KpiGrid>
          <Kpi label="Times used" value={`${coupon.times_used}${coupon.usage_limit ? `/${coupon.usage_limit}` : ''}`} />
          <Kpi
            label="Total discount given"
            value={`₹${totalDiscount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
          />
          <Kpi label="Eligible users" value={eligibleCount > 0 ? String(eligibleCount) : 'All'} />
          <Kpi
            label="Discount"
            value={coupon.discount_type === 'percentage' ? `${coupon.discount_value}%` : `₹${coupon.discount_value}`}
            highlight
          />
        </KpiGrid>
      }
      aside={
        <Card title="Coupon details">
          <Fields cols={1}>
            <Field label="Type" value={<span className="capitalize">{coupon.discount_type}</span>} />
            <Field
              label="Value"
              value={
                coupon.discount_type === 'percentage'
                  ? `${coupon.discount_value}% off`
                  : `₹${coupon.discount_value} off`
              }
            />
            <Field label="Min Purchase" value={coupon.min_purchase_amount ? `₹${coupon.min_purchase_amount}` : null} />
            <Field label="Max Discount" value={coupon.max_discount_amount ? `₹${coupon.max_discount_amount}` : null} />
            <Field label="Usage Limit" value={coupon.usage_limit ? `${coupon.usage_limit} total` : 'Unlimited'} />
            <Field
              label="Per-User Limit"
              value={coupon.usage_limit_per_user ? `${coupon.usage_limit_per_user} per user` : 'Unlimited'}
            />
            <Field
              label="Valid From"
              value={coupon.valid_from ? new Date(coupon.valid_from).toLocaleString('en-IN') : null}
            />
            <Field
              label="Valid Until"
              value={
                coupon.valid_until ? (
                  <span className={isExpired ? 'text-red-500' : ''}>
                    {new Date(coupon.valid_until).toLocaleString('en-IN')}
                  </span>
                ) : null
              }
            />
            <Field label="Auto Generated" value={coupon.auto_generated ? 'Yes' : 'No'} />
            <Field label="Source" value={coupon.generated_for_campaign || (isPersonal ? 'Personal' : 'Manual')} />
          </Fields>
        </Card>
      }
      main={
        <>
          <Card title="Usage history" hint={`${usageRows.length} redemption${usageRows.length !== 1 ? 's' : ''}`} flush>
            {usageRows.length === 0 ? (
              <EmptyState bare title="No one has used this coupon yet." />
            ) : (
              <>
                {/* Mobile card list */}
                <div className="md:hidden px-4 pb-4 pt-3 space-y-3">
                  {usageRows.map(r => (
                    <div
                      key={r.id}
                      className="rounded-lg border border-border-default bg-surface-elevated p-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">{r.user_name || '—'}</p>
                          <p className="text-xs text-foreground-muted truncate">{r.user_email || '—'}</p>
                        </div>
                        <p className="font-semibold tabular-nums text-green-600 dark:text-green-400 whitespace-nowrap">
                          ₹{Number(r.discount_amount).toLocaleString('en-IN')}
                        </p>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-foreground-muted">
                        {r.order_id ? (
                          <Link
                            href={ap(`/admin/orders/${r.order_id}`, host)}
                            className="font-mono text-accent-500 hover:underline"
                          >
                            #{r.order_display_id || r.order_id.slice(0, 8)}
                          </Link>
                        ) : (
                          <span>—</span>
                        )}
                        <span>{day(r.created_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={thead}>
                        <th className="px-5 py-2.5 text-left font-medium">User</th>
                        <th className="px-3 py-2.5 text-left font-medium">Order</th>
                        <th className="px-3 py-2.5 text-right font-medium">Discount</th>
                        <th className="px-5 py-2.5 text-left font-medium">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usageRows.map(r => (
                        <tr key={r.id} className={row}>
                          <td className="px-5 py-2.5">
                            <p className="font-medium text-foreground">{r.user_name || '—'}</p>
                            <p className="text-xs text-foreground-muted">{r.user_email || '—'}</p>
                          </td>
                          <td className="px-3 py-2.5">
                            {r.order_id ? (
                              <Link
                                href={ap(`/admin/orders/${r.order_id}`, host)}
                                className="font-mono text-xs text-accent-500 hover:underline"
                              >
                                #{r.order_display_id || r.order_id.slice(0, 8)}
                              </Link>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-green-600 dark:text-green-400">
                            ₹{Number(r.discount_amount).toLocaleString('en-IN')}
                          </td>
                          <td className="px-5 py-2.5 text-xs text-foreground-muted">{day(r.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>

          <Card
            title={isPersonal ? 'Assigned To' : isCampaign ? 'Campaign Recipients' : 'Eligible Users'}
            hint={
              isPersonal
                ? 'This coupon is personal'
                : isCampaign
                  ? `${eligibleCount} users received this campaign`
                  : eligibleUsers.length > 0
                    ? `${eligibleUsers.length} users granted via mailer`
                    : 'All active users can redeem'
            }
            action={
              eligibleUsers.length > 0 && (
                <span className="text-xs text-foreground-muted">
                  {eligibleUsers.length} user{eligibleUsers.length !== 1 ? 's' : ''}
                </span>
              )
            }
            flush
          >
            {eligibleUsers.length === 0 && !isCampaign ? (
              <EmptyState bare title={isPersonal ? 'No user assigned.' : 'Open to all active users.'} />
            ) : (
              <>
                {/* Mobile card list */}
                <div className="md:hidden px-4 pb-4 pt-3 space-y-3">
                  {eligibleUsers.map(u => (
                    <div
                      key={u.user_id}
                      className="rounded-lg border border-border-default bg-surface-elevated p-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">
                            {[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}
                          </p>
                          <p className="text-xs text-foreground-muted truncate">{u.email}</p>
                        </div>
                        {u.times_used > 0 ? (
                          <span className={badgeCls('green')}>{u.times_used}×</span>
                        ) : (
                          <span className="text-xs text-foreground-muted whitespace-nowrap">Not yet</span>
                        )}
                      </div>
                      <p className="mt-2 text-xs text-foreground-muted">
                        {isCampaign ? 'Sent' : 'Added'}: {day(u.added_at)}
                      </p>
                    </div>
                  ))}
                </div>
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={thead}>
                        <th className="px-5 py-2.5 text-left font-medium">User</th>
                        <th className="px-3 py-2.5 text-left font-medium">{isCampaign ? 'Sent At' : 'Added At'}</th>
                        <th className="px-5 py-2.5 text-left font-medium">Used</th>
                      </tr>
                    </thead>
                    <tbody>
                      {eligibleUsers.map(u => (
                        <tr key={u.user_id} className={row}>
                          <td className="px-5 py-2.5">
                            <p className="font-medium text-foreground">
                              {[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}
                            </p>
                            <p className="text-xs text-foreground-muted">{u.email}</p>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-foreground-muted">{day(u.added_at)}</td>
                          <td className="px-5 py-2.5">
                            {u.times_used > 0 ? (
                              <span className={badgeCls('green')}>{u.times_used}×</span>
                            ) : (
                              <span className="text-xs text-foreground-muted">Not yet</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        </>
      }
    />
  )
}
