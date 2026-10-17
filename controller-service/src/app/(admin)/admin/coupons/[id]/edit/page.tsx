import { notFound } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { query, queryOne, queryMany, queryCount } from '@/lib/shared/db'
import CouponForm from '../../CouponForm'
import Pagination from '@/components/admin/Pagination'
import CouponEligibleUsersClient from './CouponEligibleUsersClient'
import MobileEditBlock from '@/components/admin/MobileEditBlock'
import { Badge, Card, FormPage, PageHeader } from '@/components/admin/kit'
import { updateCoupon } from './actions'

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
  valid_from: string | null
  valid_until: string | null
  is_active: boolean
  auto_generated: boolean
  generated_for_user_id: string | null
  generated_for_campaign: string | null
}

function toDatetimeLocal(val: string | null) {
  if (!val) return ''
  return new Date(val).toISOString().slice(0, 16)
}

export default async function EditCouponPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | undefined }>
}) {
  const { id } = await params
  const resolvedSearchParams = await searchParams
  const coupon = await queryOne<Coupon>('SELECT * FROM coupons WHERE id = $1', [id])
  if (!coupon) notFound()

  const host = await getHost()
  const back = resolvedSearchParams?.back
  const backUrl = back && back.startsWith('/admin/coupons') ? back : '/admin/coupons'
  const USERS_PAGE_SIZE = 10
  const usersPage = Math.max(1, parseInt(resolvedSearchParams.usersPage || '1', 10))
  const usersOffset = (usersPage - 1) * USERS_PAGE_SIZE

  const isPersonal = coupon.auto_generated && coupon.generated_for_user_id
  const isCampaign = coupon.auto_generated && !!coupon.generated_for_campaign && !coupon.generated_for_user_id

  // Count users assigned via coupon_eligible_users (mailer-assigned)
  const mailerEligibleCount = await queryCount(`SELECT COUNT(*) FROM coupon_eligible_users WHERE coupon_id = $1`, [
    coupon.id,
  ])
  const hasMailerEligible = mailerEligibleCount > 0

  const [eligibleUsers, usersTotal] = isPersonal
    ? [
        await queryMany<{
          id: string
          email: string
          first_name: string | null
          last_name: string | null
          times_used: number
        }>(
          `SELECT u.id, u.email, u.first_name, u.last_name,
             COALESCE((SELECT COUNT(*) FROM coupon_usage cu WHERE cu.coupon_id = $1 AND cu.user_id = u.id), 0)::int AS times_used
           FROM users u WHERE u.id = $2`,
          [coupon.id, coupon.generated_for_user_id]
        ),
        1,
      ]
    : isCampaign
      ? await Promise.all([
          queryMany<{
            id: string
            email: string
            first_name: string | null
            last_name: string | null
            times_used: number
          }>(
            `SELECT u.id, u.email, u.first_name, u.last_name,
             COALESCE((SELECT COUNT(*) FROM coupon_usage cu WHERE cu.coupon_id = $1 AND cu.user_id = u.id), 0)::int AS times_used
           FROM email_campaigns_sent ecs
           JOIN users u ON u.id = ecs.user_id
           WHERE ecs.campaign_kind = $2
           ORDER BY ecs.sent_at DESC
           LIMIT $3 OFFSET $4`,
            [coupon.id, coupon.generated_for_campaign, USERS_PAGE_SIZE, usersOffset]
          ),
          queryCount(`SELECT COUNT(DISTINCT user_id) FROM email_campaigns_sent WHERE campaign_kind = $1`, [
            coupon.generated_for_campaign,
          ]),
        ])
      : hasMailerEligible
        ? await Promise.all([
            queryMany<{
              id: string
              email: string
              first_name: string | null
              last_name: string | null
              times_used: number
            }>(
              `SELECT u.id, u.email, u.first_name, u.last_name,
             COALESCE((SELECT COUNT(*) FROM coupon_usage cu WHERE cu.coupon_id = $1 AND cu.user_id = u.id), 0)::int AS times_used
           FROM coupon_eligible_users ceu
           JOIN users u ON u.id = ceu.user_id
           WHERE ceu.coupon_id = $1
           ORDER BY ceu.added_at DESC
           LIMIT $2 OFFSET $3`,
              [coupon.id, USERS_PAGE_SIZE, usersOffset]
            ),
            queryCount(`SELECT COUNT(*) FROM coupon_eligible_users WHERE coupon_id = $1`, [coupon.id]),
          ])
        : await Promise.all([
            queryMany<{
              id: string
              email: string
              first_name: string | null
              last_name: string | null
              times_used: number
            }>(
              `SELECT u.id, u.email, u.first_name, u.last_name,
             COALESCE((SELECT COUNT(*) FROM coupon_usage cu WHERE cu.coupon_id = $1 AND cu.user_id = u.id), 0)::int AS times_used
           FROM users u
           WHERE u.is_active = TRUE AND u.is_guest = FALSE AND u.email IS NOT NULL
           ORDER BY u.first_name ASC
           LIMIT $2 OFFSET $3`,
              [coupon.id, USERS_PAGE_SIZE, usersOffset]
            ),
            queryCount(
              `SELECT COUNT(*) FROM users WHERE is_active = TRUE AND is_guest = FALSE AND email IS NOT NULL`,
              []
            ),
          ])

  // Draft system — auto-create on first edit
  let draftRow = await queryOne<{ coupon_id: string; fields: Record<string, unknown> }>(
    `SELECT coupon_id, fields FROM coupon_drafts WHERE coupon_id = $1`,
    [coupon.id]
  )
  if (!draftRow) {
    await query(
      `INSERT INTO coupon_drafts (coupon_id, fields)
       SELECT id, to_jsonb(c) - 'id' - 'created_at' - 'updated_at'
       FROM coupons c WHERE c.id = $1
       ON CONFLICT (coupon_id) DO NOTHING`,
      [coupon.id]
    )
    draftRow = await queryOne<{ coupon_id: string; fields: Record<string, unknown> }>(
      `SELECT coupon_id, fields FROM coupon_drafts WHERE coupon_id = $1`,
      [coupon.id]
    )
  }
  const isDraft = !!draftRow
  const df = (draftRow?.fields || {}) as any

  return (
    <MobileEditBlock>
      <FormPage
        header={
          <PageHeader
            back={{ href: ap(backUrl, host), label: 'Coupons' }}
            title={isDraft ? 'Edit Draft' : 'Edit Coupon'}
            description={<span className="font-mono">{coupon.code}</span>}
            badges={isDraft && <Badge tone="amber">Draft</Badge>}
          />
        }
      >
        {isDraft && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Draft pending</p>
              <p className="text-xs text-foreground-muted mt-0.5">
                Changes are saved to draft. The live coupon stays unchanged until you publish.
              </p>
            </div>
            <form action={updateCoupon.bind(null, id)}>
              <input type="hidden" name="intent" value="discard" />
              <button
                type="submit"
                className="control-sm border border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
              >
                Discard draft
              </button>
            </form>
          </div>
        )}

        <CouponForm
          action={updateCoupon.bind(null, id)}
          couponId={id}
          submitLabel={isDraft ? undefined : 'Save Changes'}
          isDraft={isDraft}
          backUrl={backUrl}
          defaultValues={{
            code: df.code ?? coupon.code,
            discount_type: df.discount_type ?? coupon.discount_type,
            discount_value: df.discount_value ?? coupon.discount_value,
            min_purchase_amount: df.min_purchase_amount ?? coupon.min_purchase_amount,
            max_discount_amount: df.max_discount_amount ?? coupon.max_discount_amount,
            usage_limit: df.usage_limit ?? coupon.usage_limit,
            usage_limit_per_user: df.usage_limit_per_user ?? coupon.usage_limit_per_user,
            valid_from: toDatetimeLocal(df.valid_from ?? coupon.valid_from),
            valid_until: toDatetimeLocal(df.valid_until ?? coupon.valid_until),
            description: df.description ?? coupon.description,
            is_active: df.is_active ?? coupon.is_active,
          }}
        />

        <Card
          title="Eligible Users"
          hint={
            isPersonal
              ? 'This coupon is personal — only the user below can redeem it'
              : isCampaign
                ? `${usersTotal} user${usersTotal === 1 ? '' : 's'} received this campaign — only they have this code`
                : hasMailerEligible
                  ? `${usersTotal} user${usersTotal === 1 ? '' : 's'} were granted this coupon via mailer — only they can redeem it`
                  : `${usersTotal} active app users can redeem this coupon`
          }
          action={
            <div className="flex flex-wrap gap-1.5">
              {!coupon.auto_generated && !hasMailerEligible && <Badge tone="blue">All Users</Badge>}
              {hasMailerEligible && !coupon.auto_generated && <Badge tone="amber">Mailer-assigned</Badge>}
              {coupon.generated_for_campaign && <Badge tone="blue">{coupon.generated_for_campaign}</Badge>}
            </div>
          }
          flush
        >
          {/* Interactive remove/add table — client component */}
          <CouponEligibleUsersClient
            couponId={coupon.id}
            initialUsers={eligibleUsers}
            canRemove={!isPersonal && !isCampaign}
            canAdd={!isPersonal && !isCampaign}
            allUsersMode={!isPersonal && !isCampaign && !hasMailerEligible}
          />

          {!isPersonal && usersTotal > USERS_PAGE_SIZE && (
            <div className="border-t border-border-default px-4 py-2">
              <Pagination
                page={usersPage}
                total={usersTotal}
                pageSize={USERS_PAGE_SIZE}
                buildUrl={p => {
                  const sp = new URLSearchParams()
                  if (p > 1) sp.set('usersPage', String(p))
                  return ap(`/admin/coupons/${id}/edit${sp.toString() ? `?${sp.toString()}` : ''}`, host)
                }}
              />
            </div>
          )}
        </Card>
      </FormPage>
    </MobileEditBlock>
  )
}
