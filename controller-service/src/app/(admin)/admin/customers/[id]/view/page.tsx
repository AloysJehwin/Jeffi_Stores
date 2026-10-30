import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, Tag } from 'lucide-react'
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
  badgeCls,
  type StatusMap,
  type Tone,
} from '@/components/admin/kit'
import { businessLabel, businessTone } from '../../_components/status-maps'
import { ChangeLog } from '@/components/admin/change-log'
import { headers } from 'next/headers'
import { getCustomerById } from '@/lib/queries'
import { ap } from '@/lib/shared/admin-path'
import { isFulfilledStatus } from '@/lib/orders/fulfilled-status'
import { getHost } from '@/lib/tenancy/get-host'
import { hasScope } from '@/lib/auth/scopes'
import CustomerActionButton from '@controller/app/(admin)/admin/customers/[id]/_components/CustomerActionButton'
import EraseCustomerButton from '@controller/app/(admin)/admin/customers/[id]/_components/EraseCustomerButton'
import CustomerMailerPanel from '@controller/app/(admin)/admin/customers/[id]/_components/CustomerMailerPanel'
import CustomerEngagementChips from '@controller/app/(admin)/admin/customers/[id]/_components/CustomerEngagementChips'
import CustomerTags from '@controller/app/(admin)/admin/customers/[id]/_components/CustomerTags'
import CustomerNotes from '@/components/admin/CustomerNotes'
import { listNotes } from '@/lib/shared/customer-notes'
import CustomerTasks from '@controller/app/(admin)/admin/customers/[id]/_components/CustomerTasks'
import CustomerTimeline from '@controller/app/(admin)/admin/customers/[id]/_components/CustomerTimeline'
import CustomerAiSummary from '@controller/app/(admin)/admin/customers/[id]/_components/CustomerAiSummary'
import CustomerConversations from '@controller/app/(admin)/admin/customers/[id]/_components/CustomerConversations'
import HealthScoreCard from '@controller/app/(admin)/admin/customers/[id]/_components/HealthScoreCard'
import CustomerLoyaltyCard from '@controller/app/(admin)/admin/customers/[id]/_components/CustomerLoyaltyCard'
import CustomerReferralsCard from '@controller/app/(admin)/admin/customers/[id]/_components/CustomerReferralsCard'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function formatOrderStatus(status: string) {
  const map: Record<string, string> = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    processing: 'Processing',
    dispatched: 'Dispatched',
    shipped: 'Shipped',
    out_for_delivery: 'Out for Delivery',
    delivered: 'Delivered',
    granted: 'Access granted',
    cancelled: 'Cancelled',
    return_requested: 'Return Requested',
    return_approved: 'Return Approved',
    return_rejected: 'Return Rejected',
    return_picked_up: 'Picked Up',
    refunded: 'Refunded',
    replaced: 'Replaced',
  }
  return map[status] || status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function formatPaymentStatus(status: string) {
  const map: Record<string, string> = {
    paid: 'Paid',
    pending: 'Pending',
    failed: 'Failed',
    refunded: 'Refunded',
    partial_refund: 'Part Refunded',
    cod: 'COD',
  }
  return map[status] || status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function orderTone(status: string): Tone {
  if (isFulfilledStatus(status) || status === 'replaced') return 'green'
  if (['cancelled', 'return_rejected'].includes(status)) return 'red'
  if (['shipped', 'dispatched', 'out_for_delivery'].includes(status)) return 'blue'
  if (['return_requested', 'return_approved', 'return_picked_up', 'refunded'].includes(status)) return 'muted'
  return 'amber'
}

function paymentTone(status: string): Tone {
  if (status === 'paid') return 'green'
  if (status === 'refunded' || status === 'partial_refund') return 'blue'
  if (status === 'failed') return 'red'
  return 'amber'
}

const SEGMENTS: StatusMap = {
  vip: { label: 'VIP', tone: 'amber' },
  loyal: { label: 'Loyal', tone: 'green' },
  repeat: { label: 'Repeat Buyer', tone: 'blue' },
  one_time: { label: 'One-time', tone: 'muted' },
  new: { label: 'New', tone: 'blue' },
  at_risk: { label: 'At Risk', tone: 'amber' },
  dormant: { label: 'Dormant', tone: 'red' },
  b2b: { label: 'B2B', tone: 'blue' },
  lead: { label: 'Lead', tone: 'muted' },
}

const CUSTOMER_STATUS: StatusMap = {
  active: { label: 'Active', tone: 'green' },
  inactive: { label: 'Inactive', tone: 'muted' },
  flagged: { label: 'Flagged', tone: 'red' },
}

const BP_STATUS: StatusMap = {
  approved: { label: 'Approved', tone: 'blue' },
  rejected: { label: 'Rejected', tone: 'red' },
  pending: { label: 'Pending', tone: 'amber' },
}

const day = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ chat?: string; back?: string }>
}) {
  const { id } = await params
  const resolvedSearchParams = await searchParams
  const host = await getHost()
  const back = resolvedSearchParams?.back
  const backUrl = back && back.startsWith('/admin/customers') ? back : '/admin/customers'
  let customer: any
  try {
    customer = await getCustomerById(id)
  } catch {
    notFound()
  }

  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes: string[] = JSON.parse(h.get('x-user-scopes') || '[]')
  const canWrite = hasScope(role, scopes, 'customers:write')
  const hasCrm = hasScope(role, scopes, 'crm:read')
  const canMail = hasScope(role, scopes, 'mailer:write')

  const fullName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Unknown'
  const initials = [customer.first_name?.[0], customer.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?'
  const currentStatus: 'active' | 'inactive' | 'flagged' = customer.is_flagged
    ? 'flagged'
    : customer.is_active
      ? 'active'
      : 'inactive'

  const notes = await listNotes({ userId: customer.id })
  const totalOrders = Number(customer.total_orders)
  const lifetime = Number(customer.lifetime_value)

  const aside = (
    <>
      {hasCrm && (
        <div id="engagement" className="rounded-xl border border-border-default bg-surface-elevated p-5">
          <CustomerEngagementChips
            customerId={customer.id}
            phone={customer.phone}
            marketingOptOut={customer.marketing_opt_out}
            autoOpenChat={resolvedSearchParams.chat === 'true'}
          />
          <HealthScoreCard customerId={customer.id} initial={customer.health || null} />
        </div>
      )}

      <Card title="Account actions">
        {canWrite ? (
          <>
            <CustomerActionButton
              customerId={customer.id}
              customerName={fullName}
              isActive={customer.is_active}
              isFlagged={customer.is_flagged}
            />
            <EraseCustomerButton customerId={customer.id} customerName={fullName} />
          </>
        ) : (
          <p className="text-xs text-foreground-muted">Read-only access — cannot modify account.</p>
        )}
      </Card>

      <div className="rounded-xl border border-border-default bg-surface-elevated p-5">
        <CustomerTags customerId={customer.id} initialTags={customer.tags || []} canWrite={canWrite} />
      </div>

      <div className="rounded-xl border border-border-default bg-surface-elevated p-5">
        <CustomerNotes customerId={customer.id} initialNotes={notes} canWrite={canWrite} />
      </div>

      <div className="rounded-xl border border-border-default bg-surface-elevated p-5">
        <CustomerTasks customerId={customer.id} canWrite={canWrite} />
      </div>

      <CustomerLoyaltyCard customerId={customer.id} />

      <CustomerReferralsCard customerId={customer.id} email={customer.email} host={host} />

      {(customer.company_name || customer.gst_number || customer.credit_limit) && (
        <Card title="Business details">
          <Fields cols={1}>
            {customer.company_name && <Field label="Company" value={customer.company_name} />}
            {customer.gst_number && (
              <Field label="GST Number" value={customer.gst_number} mono copy={customer.gst_number} />
            )}
            {customer.credit_limit && (
              <Field label="Credit Limit" value={`₹${Number(customer.credit_limit).toLocaleString('en-IN')}`} />
            )}
          </Fields>
        </Card>
      )}

      {customer.user_type === 'business' && customer.bp_company_name && (
        <Card
          title="Business partner"
          action={<StatusBadge status={customer.bp_approval_status || 'pending'} map={BP_STATUS} />}
        >
          <Fields cols={1}>
            <Field label="Company" value={customer.bp_company_name} />
            {customer.bp_gst_number && (
              <Field label="GST Number" value={customer.bp_gst_number} mono copy={customer.bp_gst_number} />
            )}
            {customer.bp_industry && <Field label="Industry" value={customer.bp_industry} />}
            {customer.bp_business_address && <Field label="Business Address" value={customer.bp_business_address} />}
            {customer.bp_created_at && <Field label="Applied" value={day(customer.bp_created_at)} />}
            {customer.bp_approved_at && customer.bp_approval_status === 'approved' && (
              <Field label="Approved On" value={day(customer.bp_approved_at)} />
            )}
            {customer.bp_rejection_note && customer.bp_approval_status === 'rejected' && (
              <Field
                label="Rejection Note"
                value={<span className="text-red-600 dark:text-red-400">{customer.bp_rejection_note}</span>}
              />
            )}
          </Fields>
          <div className="mt-4 border-t border-border-default pt-3">
            <Link
              href={ap(`/admin/business/customers/${customer.id}`, host)}
              className="text-xs font-medium text-accent-500 hover:text-accent-600"
            >
              Manage in Business Customers →
            </Link>
          </div>
        </Card>
      )}

      <ChangeLog kind="customer" id={customer.id} variant="compact" title="Profile changes" version={customer.updated_at ? String(customer.updated_at) : undefined} />
    </>
  )

  const main = (
    <>
      <div className="rounded-xl border border-border-default bg-surface-elevated p-5">
        <CustomerAiSummary customerId={customer.id} canWrite={canWrite} />
      </div>
      <div className="rounded-xl border border-border-default bg-surface-elevated p-5">
        <CustomerConversations
          customerId={customer.id}
          email={customer.email}
          phone={customer.phone}
          canWrite={canWrite}
          isBusiness={customer.user_type === 'business'}
        />
      </div>
      <div className="rounded-xl border border-border-default bg-surface-elevated p-5">
        <CustomerTimeline customerId={customer.id} />
      </div>

      <Card
        title="Orders"
        flush
        action={
          totalOrders > 10 && (
            <Link
              href={ap(`/admin/orders?customer=${customer.id}`, host)}
              className="text-xs font-medium text-accent-500 hover:text-accent-600"
            >
              View all {totalOrders} →
            </Link>
          )
        }
      >
        {customer.recent_orders && customer.recent_orders.length > 0 ? (
          <>
            {/* Mobile card list */}
            <div className="md:hidden px-4 pb-4 pt-3 space-y-3">
              {customer.recent_orders.map((order: any) => (
                <Link
                  key={order.id}
                  href={ap(`/admin/orders/${order.id}`, host)}
                  className="block rounded-lg border border-border-default bg-surface-elevated p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-semibold text-foreground truncate">
                        #{order.order_number || order.id.slice(0, 8)}
                      </p>
                      <p className="text-xs text-foreground-muted">{day(order.created_at)}</p>
                    </div>
                    <p className="font-semibold tabular-nums text-foreground whitespace-nowrap">
                      ₹
                      {Number(order.total_amount).toLocaleString('en-IN', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={badgeCls(paymentTone(order.payment_status))}>
                        {formatPaymentStatus(order.payment_status)}
                      </span>
                      <span className={badgeCls(orderTone(order.status))}>{formatOrderStatus(order.status)}</span>
                    </div>
                    <span className="text-xs font-medium text-accent-500">View →</span>
                  </div>
                </Link>
              ))}
            </div>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-border-default bg-surface-secondary/50 text-xs text-foreground-muted">
                    <th className="px-5 py-2.5 text-left font-medium">Order #</th>
                    <th className="px-3 py-2.5 text-left font-medium">Date</th>
                    <th className="px-3 py-2.5 text-right font-medium">Total</th>
                    <th className="px-3 py-2.5 text-left font-medium">Payment</th>
                    <th className="px-3 py-2.5 text-left font-medium">Status</th>
                    <th className="px-5 py-2.5 text-right font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {customer.recent_orders.map((order: any) => (
                    <tr
                      key={order.id}
                      className="border-b border-border-default/60 last:border-0 hover:bg-surface-secondary/40"
                    >
                      <td className="whitespace-nowrap px-5 py-2.5 font-mono text-xs font-semibold text-foreground">
                        #{order.order_number || order.id.slice(0, 8)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-foreground-secondary">{day(order.created_at)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-foreground">
                        ₹
                        {Number(order.total_amount).toLocaleString('en-IN', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={badgeCls(paymentTone(order.payment_status))}>
                          {formatPaymentStatus(order.payment_status)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={badgeCls(orderTone(order.status))}>{formatOrderStatus(order.status)}</span>
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        <Link
                          href={ap(`/admin/orders/${order.id}`, host)}
                          className="text-xs font-medium text-accent-500 hover:text-accent-600"
                        >
                          View →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <EmptyState bare title="No orders yet." />
        )}
      </Card>

      {canMail && (
        <div id="mailer">
          <Card title="Send message">
            <CustomerMailerPanel
              customerId={customer.id}
              customerName={fullName}
              customerEmail={customer.email}
              segments={customer.segments}
              healthScore={customer.health?.score ?? null}
              totalOrders={customer.total_orders}
              lifetimeValue={customer.lifetime_value}
              daysSinceLastOrder={customer.days_since_last_order}
              lastOrderAt={customer.last_order_at}
              recentOrders={customer.recent_orders ?? []}
            />
          </Card>
        </div>
      )}
    </>
  )

  return (
    <EntityPage
      header={
        <DetailHeader
          back={{ href: ap(backUrl, host), label: 'Customers' }}
          media={
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border-default bg-surface-secondary text-lg font-bold text-foreground">
              {initials}
            </div>
          }
          title={fullName}
          status={
            <>
              <StatusBadge status={currentStatus} map={CUSTOMER_STATUS} />
              {customer.user_type === 'business' && (
                <span className={badgeCls(businessTone(customer.bp_approval_status))}>
                  {businessLabel(customer.bp_approval_status).replace('Business', 'Business Partner')}
                </span>
              )}
              {customer.customer_type && customer.customer_type !== 'retail' && (
                <Badge>
                  <span className="capitalize">{customer.customer_type}</span>
                </Badge>
              )}
              {customer.segments?.map((seg: string) => (
                <StatusBadge key={seg} status={seg} map={SEGMENTS} />
              ))}
            </>
          }
          subtitle={customer.email}
          identifiers={customer.phone ? [{ label: 'Phone', value: `+91 ${customer.phone}`, copy: true }] : undefined}
        />
      }
      notices={
        <>
          {customer.is_flagged && customer.flag_reason && (
            <div className="flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-red-600 dark:text-red-400">Account Flagged</p>
                <p className="mt-0.5 text-sm text-foreground break-words">{customer.flag_reason}</p>
              </div>
            </div>
          )}
          {customer.assigned_coupons && customer.assigned_coupons.length > 0 && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3">
              <div className="mb-2 flex items-center gap-2">
                <Tag className="h-4 w-4 shrink-0 text-amber-500" />
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                  {customer.assigned_coupons.length} Personal Coupon{customer.assigned_coupons.length > 1 ? 's' : ''}{' '}
                  Assigned
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {customer.assigned_coupons.map(
                  (c: {
                    id: string
                    code: string
                    discount_type: string
                    discount_value: number
                    valid_until: string | null
                    times_used: number
                  }) => (
                    <div
                      key={c.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-border-default bg-surface-elevated px-3 py-1.5 text-xs"
                    >
                      <span className="font-mono font-bold text-foreground">{c.code}</span>
                      <span className="text-foreground-muted">
                        {c.discount_type === 'percentage' ? `${c.discount_value}% off` : `₹${c.discount_value} off`}
                      </span>
                      {c.times_used > 0 && <span className={badgeCls('green')}>Used</span>}
                      {c.valid_until && (
                        <span className="text-foreground-muted">
                          until{' '}
                          {new Date(c.valid_until).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                        </span>
                      )}
                    </div>
                  )
                )}
              </div>
            </div>
          )}
        </>
      }
      kpis={
        <KpiGrid>
          <Kpi label="Total orders" value={totalOrders.toLocaleString('en-IN')} highlight />
          <Kpi label="Lifetime spend" value={`₹${lifetime.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} />
          <Kpi
            label="Avg. order"
            value={totalOrders > 0 ? `₹${Math.round(lifetime / totalOrders).toLocaleString('en-IN')}` : '-'}
          />
          <Kpi label="Member since" value={day(customer.created_at)} />
        </KpiGrid>
      }
      main={main}
      aside={aside}
    />
  )
}
