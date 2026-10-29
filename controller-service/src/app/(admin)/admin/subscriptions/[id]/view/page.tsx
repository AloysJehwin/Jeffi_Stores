import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { getAdminSubscriptionDetail } from '@/lib/queries/subscriptions'
import { Badge, Card, DetailHeader, EmptyState, EntityPage, Field, Fields, StatusBadge } from '@/components/admin/kit'
import { headers } from 'next/headers'
import { ChangeLog } from '@/components/admin/change-log'
import RecordReplies from '@/components/admin/replies/RecordReplies'
import { hasScope } from '@/lib/auth/scopes'
import { SUBSCRIPTION_STATUS, fmtDate, inr } from '../../_status'
import SubscriptionActions from '../SubscriptionActions'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type Sub = Record<string, unknown>
const str = (v: unknown) => (v == null ? null : String(v))

export default async function SubscriptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [detail, host] = await Promise.all([getAdminSubscriptionDetail(id), getHost()])
  if (!detail) notFound()
  const h = await headers()
  const canWrite = hasScope(h.get('x-user-role') || '', JSON.parse(h.get('x-user-scopes') || '[]'), 'subscriptions:write')
  const { subscription: s, customer, product, cycles } = detail
  const sub = s as Sub & typeof s
  const status = String(sub.status)
  const snap = (sub.address_snapshot ?? null) as Record<string, string | undefined> | null
  const address = snap
    ? {
        name: snap.full_name ?? snap.name,
        line1: snap.address_line1 ?? snap.line1,
        city: snap.city,
        state: snap.state,
        pincode: snap.postal_code ?? snap.pincode,
      }
    : null

  const fields: [string, React.ReactNode][] = [
    ['Plan', `${sub.intervalLabel}${Number(sub.quantity) > 1 ? ` × ${Number(sub.quantity)}` : ''}`],
    ['Per cycle', inr(sub.amount)],
    ['Shipping / cycle', inr(Number(sub.shipping_paise || 0) / 100)],
    ['Type', sub.is_digital ? 'Digital' : 'Physical'],
    ['Cycles paid', `${sub.current_cycle}${sub.totalCycles ? ` of ${sub.totalCycles}` : ' (until cancelled)'}`],
    [
      'Commitment',
      sub.min_cycles ? `Minimum ${sub.min_cycles} charges (customer can't cancel or pause before)` : 'None',
    ],
    ['Current period', `${fmtDate(str(sub.current_start))} – ${fmtDate(str(sub.current_end))}`],
    ['Access until', fmtDate(str(sub.access_expires_at))],
    ['Collected by', sub.collecting_account === 'own' ? 'Store Razorpay account' : 'Platform (Jeffi)'],
    ['Razorpay ID', str(sub.razorpay_subscription_id) || '—'],
    ['Consent', sub.consent_at ? `${sub.consent_version ?? ''} · ${fmtDate(str(sub.consent_at))}` : '—'],
    ['Started', fmtDate(str(sub.created_at))],
  ]
  if (sub.paused_at) fields.push(['Paused', fmtDate(str(sub.paused_at))])
  if (sub.cancelled_at) fields.push(['Cancelled', fmtDate(str(sub.cancelled_at))])

  const th = 'px-5 py-2.5 text-left text-xs font-medium'
  return (
    <EntityPage
      header={
        <DetailHeader
          back={{ href: ap('/admin/subscriptions', host), label: 'Subscriptions' }}
          title={product?.name ?? 'Subscription'}
          status={
            <>
              <StatusBadge status={status} map={SUBSCRIPTION_STATUS} label={String(sub.statusLabel)} />
              {sub.cancel_at_cycle_end && status !== 'cancelled' ? <Badge tone="red">Cancels at cycle end</Badge> : null}
            </>
          }
          actions={<SubscriptionActions id={id} status={status} cancelAtCycleEnd={!!sub.cancel_at_cycle_end} />}
        />
      }
      main={
        <>
          <Card title="Details">
            <Fields>
              {fields.map(([k, v]) => (
                <Field key={k} label={k} value={v} />
              ))}
            </Fields>
          </Card>
          <Card title="Cycles" flush>
            {cycles.length === 0 ? (
              <EmptyState bare title="No cycles charged yet" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-border-default bg-surface-secondary/50 text-xs text-foreground-muted">
                      <th className={th}>Cycle</th>
                      <th className={th}>Charged</th>
                      <th className={`${th} text-right`}>Amount</th>
                      <th className={th}>Payment</th>
                      <th className={th}>Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cycles.map(c => (
                      <tr key={c.id} className="border-b border-border-default/60 last:border-0">
                        <td className="px-5 py-2.5">#{c.cycleNumber}</td>
                        <td className="px-5 py-2.5">{fmtDate(c.createdAt)}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums">{inr(c.amount)}</td>
                        <td className="px-5 py-2.5 font-mono text-xs">{c.razorpayPaymentId}</td>
                        <td className="px-5 py-2.5">
                          {c.order ? (
                            <Link href={ap(`/admin/orders/${c.order.id}`, host)} className="text-accent-500 hover:underline">
                              {c.order.orderNumber}
                            </Link>
                          ) : (
                            <span className="text-foreground-muted">{c.status}</span>
                          )}
                          {c.order && <span className="ml-2 text-xs text-foreground-muted">{c.order.status}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      }
      aside={
        <>
          <Card title="Customer">
            {customer ? (
              <div className="text-sm">
                <Link href={ap(`/admin/customers/${customer.id}`, host)} className="font-medium text-accent-500 hover:underline">
                  {customer.name}
                </Link>
                {customer.email && <p className="text-foreground-secondary break-words">{customer.email}</p>}
                {customer.phone && <p className="text-foreground-secondary">{customer.phone}</p>}
              </div>
            ) : (
              <p className="text-sm text-foreground-muted">Unknown customer</p>
            )}
          </Card>
          {address && (
            <Card title="Delivery address">
              <p className="text-sm text-foreground">{address.name}</p>
              <p className="text-sm text-foreground-secondary">{[address.line1, address.city, address.state, address.pincode].filter(Boolean).join(', ')}</p>
            </Card>
          )}
          <RecordReplies entityType="subscriptions" entityId={id} canWrite={canWrite} />
          <ChangeLog kind="subscription" id={id} variant="compact" />
        </>
      }
    />
  )
}
