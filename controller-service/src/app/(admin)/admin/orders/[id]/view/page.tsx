import { notFound } from 'next/navigation'
import CustomerNotes from '@/components/admin/CustomerNotes'
import { listNotes } from '@/lib/shared/customer-notes'
import Link from 'next/link'
import CopySku from '@/components/ui/CopySku'
import { headers } from 'next/headers'
import { getOrder, getReturnRequest } from '@/lib/queries'
import SubscriptionOrderBadge from '@/components/admin/SubscriptionOrderBadge'
import { resolveRequestTenant, queryMany } from '@/lib/shared/db'
import { controlPlanePool } from '@/lib/tenant-registry'
import { computeRefundableAmount } from '@/lib/payments/refund'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { hasScope, isPlatformOwner } from '@/lib/auth/scopes'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { unitConversion } from '@/lib/orders/unit-conversion'
import UpdateOrderStatus from '@/app/(admin)/admin/orders/[id]/_components/UpdateOrderStatus'
import CancelReview from '@/app/(admin)/admin/orders/[id]/_components/CancelReview'
import ReturnReview from '@/app/(admin)/admin/orders/[id]/_components/ReturnReview'
import GenerateInvoiceButton from '@/app/(admin)/admin/orders/[id]/_components/GenerateInvoiceButton'
import InitiateRefundButton from '@/app/(admin)/admin/orders/[id]/_components/InitiateRefundButton'
import { RecordRefundLink } from '@/app/(admin)/admin/orders/[id]/_components/ExternalRefundForm'
import { externalRefundLabel } from '@/lib/payments/external-refund'
import RetryPaymentEmailButton from '@/app/(admin)/admin/orders/[id]/_components/RetryPaymentEmailButton'
import CreateShipmentButton from '@/app/(admin)/admin/orders/[id]/_components/CreateShipmentButton'
import DelhiveryTracking from '@/components/DelhiveryTracking'
import ProductAdjustments from '@/app/(admin)/admin/orders/[id]/_components/ProductAdjustments'
import AddressChangeReview from '@/app/(admin)/admin/orders/[id]/_components/AddressChangeReview'
import RecordReplies from '@/components/admin/replies/RecordReplies'
import AskItemUnavailableButton from '@/app/(admin)/admin/orders/[id]/_components/AskItemUnavailableButton'
import { listAddressChangeRequests, addressChangeBlockReason } from '@/lib/orders/address-change'
import CustomerMailPanel from '@/app/(admin)/admin/orders/[id]/_components/CustomerMailPanel'
import MailLogsPanel from '@/app/(admin)/admin/orders/[id]/_components/MailLogsPanel'
import ExtendEddButton from '@/app/(admin)/admin/orders/[id]/_components/ExtendEddButton'
import CodRemittanceButton from '@/app/(admin)/admin/orders/[id]/_components/CodRemittanceButton'
import ProductWarningBadges from '@/components/shared/ProductWarningBadges'
import DigitalAccessCard, {
  type DigitalAccessLine,
} from '@/app/(admin)/admin/orders/[id]/_components/DigitalAccessCard'
import { Download, Eye, ImageIcon, Printer, Truck } from 'lucide-react'
import { Badge, Card, DetailHeader, EntityPage, Field, Fields, StatusBadge } from '@/components/admin/kit'
import { ChangeLog, OrderStatusHistory } from '@/components/admin/change-log'
import { ORDER_STATUS_FULL, PAYMENT_STATUS_FULL, inr } from '../../_components/status-maps'

const pill = 'control-md border border-border-default bg-surface-elevated text-foreground hover:bg-surface-secondary'
const pillIcon = 'control-md control-icon border border-border-default bg-surface-elevated text-foreground-muted hover:bg-surface-secondary hover:text-foreground'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function UnitLabel({ label }: { label: string | null | undefined }) {
  if (!label) return null
  const match = label.match(/^(.+?)2$/)
  if (match)
    return (
      <>
        {match[1]}
        <sup>2</sup>
      </>
    )
  return <>{label}</>
}

const RETURN_STATUSES = ['return_requested', 'return_approved', 'return_received', 'return_rejected', 'returned']

export default async function OrderDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { id } = await params
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const back = resolvedSearchParams?.back
  const backUrl = typeof back === 'string' && back.startsWith('/admin/orders') ? back : '/admin/orders'
  const host = await getHost()
  const order = await getOrder(id).catch(() => null)

  // Which Razorpay account collected this order's payments. Reflects the tenant's CURRENT mode, not
  // the mode at capture time — a post-capture toggle is an accepted edge case. Platform's own store
  // (no tenant) falls through to the platform label.
  const tenant = await resolveRequestTenant().catch(() => null)
  // Refunds owed by changes the customer approved — issued only when an admin clicks.
  const pendingChangeRefunds = order
    ? await queryMany<{ id: string; amount: string; legacy: boolean }>(
        `SELECT id, abs(net_diff) AS amount, false AS legacy FROM order_adjustments WHERE order_id = $1 AND refund_status = 'pending'
         UNION ALL
         SELECT id, abs(price_diff), true FROM variant_change_requests
          WHERE order_id = $1 AND settlement_type = 'refund' AND status = 'applied' AND refund_id IS NULL`,
        [order.id]
      ).catch(() => [])
    : []
  const ownRazorpay = tenant?.tenantId
    ? await controlPlanePool()
        .query(`SELECT own_razorpay FROM tenants WHERE id=$1`, [tenant.tenantId])
        .then(r => r.rows[0]?.own_razorpay === true)
        .catch(() => false)
    : false
  const collectedViaLabel = ownRazorpay ? "Tenant's own Razorpay" : 'Platform (jeffistores)'

  if (!order) {
    notFound()
  }

  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes: string[] = JSON.parse(h.get('x-user-scopes') || '[]')
  const canWrite = hasScope(role, scopes, 'orders:write')
  const canOverrideStatus = isPlatformOwner(role)
  // Session scopes are already narrowed to the tenant's plan, so these hide modules the plan
  // does not include instead of showing controls whose API would refuse them.
  const canMail = hasScope(role, scopes, 'mailer:write')
  const canPackingSlips = hasScope(role, scopes, 'packing_slips:read')
  const canRemitCod = hasScope(role, scopes, 'financial:write')
  const { inventoryValidationEnabled: inventoryFlag } = await getFeatureFlags()
  const inventoryValidationEnabled = inventoryFlag && hasScope(role, scopes, 'inventory:read')

  const returnRequest = await getReturnRequest(id).catch(() => null)
  const addressChangeRequests = (await listAddressChangeRequests(id)).map(r => ({
    id: r.id,
    status: r.status,
    oldAddress: r.old_address_snapshot,
    newAddress: r.new_address_snapshot,
    adminNotes: r.admin_notes,
    createdAt: new Date(r.created_at).toISOString(),
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
  }))
  const isReturnStatus = RETURN_STATUSES.includes(order.status)
  const digitalLines = await queryMany<DigitalAccessLine & { access_revoked_at: string | null }>(
    `SELECT oi.id AS order_item_id, oi.product_name, oi.access_revoked_at,
            ve.status, COALESCE(ve.granted_at, oi.granted_at) AS granted_at, ve.revoked_at, ve.revoke_reason,
            ve.access_expires_at
       FROM order_items oi
       LEFT JOIN vault_entitlements ve ON ve.order_item_id = oi.id
      WHERE oi.order_id = $1 AND oi.is_digital = TRUE
      ORDER BY oi.created_at`,
    [id]
  ).catch(() => [])
  const digitalItemIds = new Set(digitalLines.map(l => l.order_item_id))
  const isAllDigital =
    digitalLines.length > 0 &&
    (order.order_items?.length ?? 0) > 0 &&
    order.order_items.every((i: any) => digitalItemIds.has(i.id))
  const refundableAmount = await computeRefundableAmount(order, returnRequest).catch(() => Number(order.total_amount))
  const moneyIn = order.payment_status === 'paid' || order.payment_status === 'cod_collected'
  // Razorpay can only refund a captured Razorpay payment; COD, cash and hand-marked payments are recorded.
  // A replacement order's payments sit on the original, which the refund route resolves.
  const razorpayPaid =
    !!order.original_order_id ||
    (order.payments ?? []).some((p: any) => p.payment_gateway === 'razorpay' && p.status === 'completed' && p.transaction_id)
  const showRetryEmailButton =
    (order.payment_status === 'failed' || order.payment_status === 'unpaid') &&
    (Date.now() - new Date(order.created_at).getTime()) / 3600000 < 24

  const eddDateStr = order.estimated_delivery_date
    ? order.estimated_delivery_date instanceof Date
      ? order.estimated_delivery_date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      : String(order.estimated_delivery_date).slice(0, 10)
    : null
  const edd = eddDateStr
    ? new Date(eddDateStr + 'T00:00:00Z').toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      })
    : null
  const rawEdd: string | null = eddDateStr ?? null
  const courierEddStr: string | null = order.courier_edd
    ? order.courier_edd instanceof Date
      ? order.courier_edd.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      : String(order.courier_edd).slice(0, 10)
    : null
  const courierEddNote = courierEddStr
    ? courierEddStr === eddDateStr
      ? 'Courier estimate (Delhivery)'
      : `Delhivery estimate: ${new Date(courierEddStr + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}`
    : null

  let eddLabel = 'Expected Delivery'
  let eddLabelColor = 'text-foreground-muted'
  if (eddDateStr) {
    if (order.status === 'delivered') {
      eddLabel = 'Delivered'
      eddLabelColor = 'text-green-500'
    } else if (order.status === 'out_for_delivery') {
      eddLabel = 'Arriving Today'
      eddLabelColor = 'text-accent-500'
    } else {
      const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
      todayIST.setHours(0, 0, 0, 0)
      const eddDate = new Date(eddDateStr + 'T00:00:00Z')
      const diffDays = Math.round((eddDate.getTime() - todayIST.getTime()) / 86400000)
      if (diffDays === 0) {
        eddLabel = 'Arriving Today'
        eddLabelColor = 'text-accent-500'
      } else if (diffDays === 1) {
        eddLabel = 'Arriving Tomorrow'
        eddLabelColor = 'text-accent-500'
      } else if (diffDays < 0) {
        eddLabel = 'Delayed'
        eddLabelColor = 'text-amber-600 dark:text-amber-400'
      }
    }
  }

  const customerName = order.users
    ? `${order.users.first_name || ''} ${order.users.last_name || ''}`.trim() || order.customer_name || 'Guest'
    : order.customer_name || 'Guest'
  const changeVersion = order.updated_at ? new Date(order.updated_at).toISOString() : null
  const placedAt = `${new Date(order.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} ${new Date(order.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`
  const canGenerateInvoice =
    canWrite &&
    (order.payment_status === 'paid' ||
      order.status === 'confirmed' ||
      order.status === 'processing' ||
      order.status === 'shipped' ||
      order.status === 'out_for_delivery' ||
      order.status === 'delivered' ||
      order.status === 'granted')

  const header = (
    <DetailHeader
      back={{ href: ap(backUrl, host), label: 'Orders' }}
      title={<>Order #{order.order_number || order.id.slice(0, 8)}</>}
      status={
        <>
          <StatusBadge status={order.status} map={ORDER_STATUS_FULL} />
          <StatusBadge status={order.payment_status} map={PAYMENT_STATUS_FULL} label={`Payment: ${PAYMENT_STATUS_FULL[order.payment_status]?.label ?? order.payment_status}`} />
          {order.subscription_id && (
            <Link href={ap(`/admin/subscriptions/${order.subscription_id}`, host)}>
              <SubscriptionOrderBadge subscriptionId={order.subscription_id} cycle={order.subscription_cycle} />
            </Link>
          )}
        </>
      }
      subtitle={
        order.original_order_id && order.original_order_number ? (
          <>
            Replacement for{' '}
            <Link href={ap(`/admin/orders/${order.original_order_id}`, host)} className="text-accent-500 underline hover:text-accent-600">
              #{order.original_order_number}
            </Link>
          </>
        ) : undefined
      }
      identifiers={[{ label: 'Placed', value: placedAt }, ...(order.invoice_number ? [{ label: 'Invoice', value: String(order.invoice_number), copy: true }] : [])]}
      actions={
        <>
          {canPackingSlips && !isAllDigital && (
            <span className="inline-flex w-full sm:w-auto items-center gap-1">
              <a href={`/api/admin/packing-slips/${order.id}`} download title="Download Packing Slip" className={`${pill} flex-1 sm:flex-none`}>
                <Download className="h-4 w-4" /> Packing Slip
              </a>
              <a href={`/api/admin/packing-slips/${order.id}?inline=1`} target="_blank" rel="noopener noreferrer" title="Print Packing Slip" aria-label="Print Packing Slip" className={pillIcon}>
                <Printer className="h-4 w-4" />
              </a>
            </span>
          )}
          {order.awb_number && (
            <span className="inline-flex w-full sm:w-auto items-center gap-1">
              <a href={`/api/admin/orders/${order.id}/shipping-label?size=4R`} download title="Download Shipping Label" className={`${pill} flex-1 sm:flex-none`}>
                <Truck className="h-4 w-4" /> Shipping Label
              </a>
              <a href={`/api/admin/orders/${order.id}/shipping-label?size=4R&print=1`} target="_blank" rel="noopener noreferrer" title="Print Shipping Label" aria-label="Print Shipping Label" className={pillIcon}>
                <Printer className="h-4 w-4" />
              </a>
            </span>
          )}
          {!order.original_order_id &&
            (order.invoice_number ? (
              <span className="inline-flex w-full sm:w-auto items-center gap-1">
                <a
                  href={order.view_token ? `/invoice/${order.view_token}` : `/api/orders/${order.id}/invoice`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`View Invoice ${order.invoice_number}`}
                  className={`${pill} flex-1 sm:flex-none`}
                >
                  <Eye className="h-4 w-4" /> Invoice
                </a>
                <a href={`/api/orders/${order.id}/invoice`} target="_blank" rel="noopener noreferrer" title="Download PDF" aria-label="Download invoice PDF" className={pillIcon}>
                  <Download className="h-4 w-4" />
                </a>
              </span>
            ) : (
              canGenerateInvoice && <GenerateInvoiceButton orderId={order.id} />
            ))}
          {showRetryEmailButton && <RetryPaymentEmailButton orderId={order.id} />}
        </>
      }
    />
  )

  const main = (
    <>
          <Card title="Order Items">
              <div className="space-y-4">
                {order.order_items && order.order_items.length > 0 ? (
                  order.order_items.map((item: any) => (
                    <div
                      key={item.id}
                      className="flex gap-3 items-start pb-4 border-b border-border-default last:border-0"
                    >
                      {item.products?.image_url ? (
                        <img
                          src={item.products.image_url}
                          alt={item.product_name || item.products?.name || ''}
                          className="w-14 h-14 rounded-lg object-cover border border-border-default shrink-0"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-lg bg-surface-secondary border border-border-default shrink-0 flex items-center justify-center"><ImageIcon className="h-6 w-6 text-foreground-muted" /></div>
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-foreground break-words">
                          {item.product_id ? (
                            <Link
                              href={ap(`/admin/products/${item.product_id}`, host)}
                              target="_blank"
                              className="hover:underline text-accent-500"
                            >
                              {item.product_name || item.products?.name || 'Product'}
                            </Link>
                          ) : (
                            item.product_name || item.products?.name || 'Product'
                          )}
                        </h3>
                        <p className="text-sm text-foreground-muted mt-1 break-words">
                          SKU: {item.product_sku || item.products?.sku}
                          {(item.product_sku || item.products?.sku) && (
                            <CopySku sku={item.product_sku || item.products?.sku} className="ml-1" />
                          )}
                        </p>
                        {item.variant_name && (
                          <span className="mt-1 inline-block rounded bg-accent-500/10 px-1.5 py-0.5 text-[11px] font-medium text-accent-600">
                            {item.variant_name}
                          </span>
                        )}
                        {item.sub_variant?.sub_variant_name && (
                          <span className="ml-1 mt-1 inline-block rounded bg-surface-secondary px-1.5 py-0.5 text-[11px] font-medium text-foreground-secondary">
                            {item.sub_variant.sub_variant_name}
                          </span>
                        )}
                        <div className="mt-1">
                          <ProductWarningBadges
                            fragile={item.fragile}
                            hazardous={item.hazardous}
                            flammable={item.flammable}
                            size="xs"
                          />
                          {digitalItemIds.has(item.id) && (
                            <Badge tone="green">Digital</Badge>
                          )}
                        </div>
                        <p className="text-sm text-foreground-secondary mt-1">
                          {(() => {
                            const isFractional =
                              (item.buy_mode && item.buy_mode !== 'unit') || (item.buy_unit && item.buy_unit !== 'unit')
                            const displayUnit =
                              item.buy_unit && item.buy_unit !== 'unit'
                                ? item.buy_unit
                                : item.buy_mode !== 'unit'
                                  ? item.buy_mode
                                  : null
                            const qty = isFractional ? Number(item.quantity) : Math.round(Number(item.quantity))
                            const qtyStr = isFractional
                              ? qty % 1 === 0
                                ? String(Math.round(qty))
                                : qty.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
                              : String(qty)
                            const priceStr = Number(item.unit_price).toLocaleString('en-IN', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })
                            return displayUnit ? (
                              <>
                                {qtyStr} <UnitLabel label={displayUnit} /> × Rs. {priceStr}/
                                <UnitLabel label={displayUnit} />
                              </>
                            ) : (
                              <>
                                Quantity: {qtyStr} × Rs. {priceStr}
                              </>
                            )
                          })()}
                        </p>
                        {(() => {
                          const conv = unitConversion(
                            item.quantity,
                            item.sell_unit || item.buy_unit,
                            item.sell_unit_factor
                          )
                          return conv ? (
                            <p className="mt-1 inline-flex items-center gap-1.5 rounded bg-surface-secondary px-2 py-0.5 text-xs font-medium text-foreground-secondary">
                              {conv.perUnit}
                              <span className="text-foreground-muted">·</span>
                              {conv.total} total
                            </p>
                          ) : null
                        })()}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-semibold text-foreground">
                          Rs.{' '}
                          {Number(item.total_price).toLocaleString('en-IN', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </p>
                        {canWrite && ['pending', 'confirmed', 'processing'].includes(order.status) && !digitalItemIds.has(item.id) && (
                          <AskItemUnavailableButton
                            orderId={order.id}
                            itemId={item.id}
                            itemName={`${item.product_name || item.products?.name || 'this item'}${item.variant_name ? ` (${item.variant_name})` : ''}`}
                          />
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-foreground-muted">No items in this order</p>
                )}
              </div>

              <div className="mt-6 pt-6 border-t border-border-default space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-foreground-secondary">Subtotal</span>
                  <span className="text-foreground">
                    Rs.{' '}
                    {Number(order.subtotal).toLocaleString('en-IN', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
                {order.discount_amount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground-secondary">Discount</span>
                    <span className="text-green-600 dark:text-green-400 tabular-nums">
                      -Rs.{' '}
                      {Number(order.discount_amount).toLocaleString('en-IN', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-foreground-secondary">GST (incl.)</span>
                  <span className="text-foreground">
                    Rs.{' '}
                    {Number(order.tax_amount).toLocaleString('en-IN', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-foreground-secondary">Shipping</span>
                  <span className="text-foreground">
                    Rs.{' '}
                    {Number(order.shipping_amount).toLocaleString('en-IN', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
                {Number(order.cod_fee_amount) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground-secondary">COD handling fee</span>
                    <span className="text-foreground">
                      Rs.{' '}
                      {Number(order.cod_fee_amount).toLocaleString('en-IN', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold pt-2 border-t border-border-default">
                  <span className="text-foreground">Total</span>
                  <span className="text-foreground tabular-nums">
                    Rs.{' '}
                    {Number(order.total_amount).toLocaleString('en-IN', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              </div>

              {/* COD remittance — shown once a COD order is delivered & cash collected */}
              {canRemitCod && order.payment_mode === 'cod' && order.payment_status === 'cod_collected' && (
                <div className="mt-4">
                  <CodRemittanceButton
                    orderId={order.id}
                    remittedAt={order.cod_remitted_at ?? null}
                    codAmount={Number(order.total_amount)}
                  />
                </div>
              )}
            </Card>

          {!isAllDigital &&
            ![
              'processing',
              'shipped',
              'out_for_delivery',
              'delivered',
              'granted',
              'cancelled',
              'return_requested',
              'return_approved',
              'return_received',
              'returned',
              'return_rejected',
            ].includes(order.status) && (
              <Card title="Inventory Status" flush><div className="divide-y divide-border-default border-t border-border-default">
                  {order.order_items && order.order_items.length > 0 ? (
                    order.order_items.map((item: any) => {
                      const inv =
                        item.sub_variant?.inventory_quantity ??
                        item.variant?.inventory_quantity ??
                        item.products?.inventory_quantity ??
                        0
                      const orderedQty = Number(item.quantity)
                      const isCount = item.sell_unit_dimension === 'count' || !item.buy_mode || item.buy_mode === 'unit'
                      const factor = item.sell_unit_factor ? Number(item.sell_unit_factor) : 1
                      // For count dimension: inventory is in individual pieces; ordered qty is in selling units (e.g. boxes)
                      // Show both: "5 box (250 pcs)" where factor=50
                      const deductedQty = isCount ? orderedQty * factor : orderedQty
                      const unitLabel = item.buy_unit && item.buy_unit !== 'unit' ? item.buy_unit : null
                      const isOut = inv < deductedQty
                      const isLow = !isOut && inv < deductedQty * 2
                      return (
                        <div key={item.id} className="px-6 py-4 flex items-center justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground truncate">
                              {item.product_id ? (
                                <Link
                                  href={ap(`/admin/products/${item.product_id}`, host)}
                                  target="_blank"
                                  className="hover:underline text-accent-500"
                                >
                                  {item.product_name}
                                </Link>
                              ) : (
                                item.product_name
                              )}
                            </p>
                            <p className="text-xs text-foreground-muted mt-0.5 break-words">
                              SKU: {item.sub_variant?.sku || item.variant?.sku || item.product_sku}
                              {(item.sub_variant?.sku || item.variant?.sku || item.product_sku) && (
                                <CopySku
                                  sku={item.sub_variant?.sku || item.variant?.sku || item.product_sku}
                                  className="ml-1"
                                />
                              )}
                              {' · '}
                              Ordered:{' '}
                              {isCount && unitLabel
                                ? `${orderedQty} ${unitLabel}${factor > 1 ? ` (${deductedQty} pcs)` : ''}`
                                : `${orderedQty}${unitLabel ? ` ${unitLabel}` : ''}`}
                            </p>
                            {item.variant_name && (
                              <span className="mt-1 inline-block rounded bg-accent-500/10 px-1.5 py-0.5 text-[11px] font-medium text-accent-600">
                                {item.variant_name}
                              </span>
                            )}
                            {item.sub_variant?.sub_variant_name && (
                              <span className="ml-1 mt-1 inline-block rounded bg-surface-secondary px-1.5 py-0.5 text-[11px] font-medium text-foreground-secondary">
                                {item.sub_variant.sub_variant_name}
                              </span>
                            )}
                            <div className="mt-1">
                              <ProductWarningBadges
                                fragile={item.fragile}
                                hazardous={item.hazardous}
                                flammable={item.flammable}
                                size="xs"
                              />
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p
                              className={`text-sm font-semibold tabular-nums ${isOut ? 'text-red-500' : isLow ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}
                            >
                              {inv} in stock
                            </p>
                            <span className="mt-0.5 inline-block">
                              <Badge tone={isOut ? 'red' : isLow ? 'amber' : 'green'}>{isOut ? 'Out of stock' : isLow ? 'Low stock' : 'In stock'}</Badge>
                            </span>
                          </div>
                        </div>
                      )
                    })
                  ) : (
                    <p className="px-6 py-4 text-sm text-foreground-muted">No items</p>
                  )}
                </div></Card>
            )}

          {order.status === 'cancel_requested' && (
            <Card title={<span className="text-amber-600 dark:text-amber-400">Cancellation Request</span>}>
                {canWrite ? (
                  <CancelReview orderId={order.id} />
                ) : (
                  <p className="text-sm text-foreground-muted">Read-only access — cannot approve or reject.</p>
                )}
              </Card>
          )}

          {order.status === 'cancel_rejected' && order.cancellation_note && (
            <Card title="Cancellation Rejected">
                <p className="text-sm text-foreground-secondary mb-1">Reason given to customer:</p>
                <p className="rounded-lg border border-border-default bg-surface px-4 py-3 text-sm text-foreground">
                  {order.cancellation_note}
                </p>
              </Card>
          )}

          {isReturnStatus && returnRequest && (
            <Card
              title={
                <span className={order.status === 'return_rejected' || order.status === 'returned' ? '' : 'text-amber-600 dark:text-amber-400'}>
                  Return / {returnRequest.type === 'refund' ? 'Refund' : 'Replacement'} Request
                </span>
              }
            >
                {canWrite ? (
                  <ReturnReview
                    orderId={order.id}
                    returnRequest={returnRequest}
                    replacementOrderNumber={returnRequest.replacement_order_number || null}
                  />
                ) : (
                  <p className="text-sm text-foreground-muted">Read-only access — cannot approve or reject.</p>
                )}
              </Card>
          )}

          {isReturnStatus && returnRequest?.rvp_awb_number && (
            <Card title="Return Shipment Tracking">
                <DelhiveryTracking
                  orderId={order.id}
                  apiBase="/api/admin/orders"
                  variant="admin"
                  trackPath="track-rvp"
                />
              </Card>
          )}

          {(order.status === 'cancelled' || order.status === 'returned') &&
            moneyIn &&
            returnRequest?.type !== 'replacement' &&
            refundableAmount > 0 &&
            canWrite && (
              <InitiateRefundButton
                orderId={order.id}
                orderNumber={order.order_number || order.id.slice(0, 8)}
                amount={refundableAmount}
                isReturn={order.status === 'returned'}
                gateway={order.payment_status === 'paid' && razorpayPaid}
              />
            )}

          {canWrite &&
            pendingChangeRefunds.map(r => (
              <InitiateRefundButton
                key={r.id}
                orderId={order.id}
                orderNumber={order.order_number || order.id.slice(0, 8)}
                amount={Number(r.amount)}
                endpoint={`/api/admin/orders/${order.id}/adjustments/${r.id}/refund${r.legacy ? '?legacy=1' : ''}`}
                heading="Refund for approved changes"
                description="The customer approved the product changes on this order. Refund the difference to their original payment:"
                gateway={razorpayPaid}
              />
            ))}

          {order.status !== 'cancelled' && !isReturnStatus && (
            <Card title="Update Order Status">
                {canWrite ? (
                  <UpdateOrderStatus
                    orderId={order.id}
                    currentStatus={order.status}
                    currentPaymentStatus={order.payment_status}
                    canOverride={canOverrideStatus}
                    inventoryValidationEnabled={inventoryValidationEnabled}
                  />
                ) : (
                  <p className="text-sm text-foreground-muted">Read-only access — cannot update status.</p>
                )}
              </Card>
          )}

          <AddressChangeReview
            orderId={order.id}
            requests={addressChangeRequests}
            canWrite={canWrite}
            blockReason={addressChangeBlockReason(order)}
          />

          <RecordReplies entityType="orders" entityId={order.id} canWrite={canWrite} />

          {order.status === 'confirmed' && !order.awb_number && canWrite && (
            <ProductAdjustments
              orderId={order.id}
              items={(order.order_items || []).map((it: any) => ({
                id: it.id,
                productId: it.product_id,
                productName: it.product_name,
                quantity: Number(it.quantity),
                unit: it.sold_unit || (it.buy_unit && it.buy_unit !== 'unit' ? it.buy_unit : null),
                unitPrice: Number(it.unit_price),
                totalPrice: Number(it.total_price),
                isDigital: !!it.is_digital,
              }))}
            />
          )}

          {order.status === 'processing' &&
            !isAllDigital &&
            !['cancelled', 'cancel_requested', 'cancel_rejected', ...RETURN_STATUSES].includes(order.status) &&
            canWrite && (
              <Card title="Delhivery Shipment">
                  <CreateShipmentButton orderId={order.id} awbNumber={order.awb_number} />
                </Card>
            )}

          {digitalLines.length > 0 && <DigitalAccessCard orderId={order.id} initial={digitalLines} />}

          {order.awb_number && (
            <Card title="Shipment Tracking">
                <DelhiveryTracking orderId={order.id} apiBase="/api/admin/orders" variant="admin" />
              </Card>
          )}

          {order.user_id && (
            <Card title="Order Notes">
              <CustomerNotes
                customerId={order.user_id}
                orderId={order.id}
                returnRequestId={returnRequest?.id ?? null}
                initialNotes={await listNotes({ userId: order.user_id, orderId: order.id })}
                canWrite={canWrite}
              />
            </Card>
          )}

          {canMail && (
            <CustomerMailPanel
              orderId={order.id}
              orderNumber={order.order_number || order.id.slice(0, 8)}
              customerName={
                order.users
                  ? `${order.users.first_name || ''} ${order.users.last_name || ''}`.trim() ||
                    order.customer_name ||
                    'Customer'
                  : order.customer_name || 'Customer'
              }
              customerEmail={order.users?.email || order.billing_email || ''}
            />
          )}

          <ChangeLog kind="order" id={order.id} preset="order" version={changeVersion} />

          <MailLogsPanel orderId={order.id} />
    </>
  )

  const aside = (
    <>
          <OrderStatusHistory orderId={order.id} placedAt={new Date(order.created_at).toISOString()} version={changeVersion} />
          <Card title="Customer">
              <Fields cols={1}>
                <Field label="Name" value={<span className="font-medium">{customerName}</span>} />
                <Field label="Email" value={order.users?.email || order.billing_email} copy={order.users?.email || order.billing_email || undefined} />
                {order.users?.phone && <Field label="Phone" value={`+91 ${order.users.phone.replace(/^\+91|^91/, '')}`} />}
              </Fields>
            </Card>

          <Card title="Billing Address">
              {order.billing_address ? (
                <div className="text-sm text-foreground">
                  <p className="font-medium">{order.billing_address.full_name}</p>
                  <p className="mt-2">{order.billing_address.address_line1}</p>
                  {order.billing_address.address_line2 && <p>{order.billing_address.address_line2}</p>}
                  {order.billing_address.landmark && (
                    <p className="text-foreground-secondary">Landmark: {order.billing_address.landmark}</p>
                  )}
                  <p>
                    {order.billing_address.city}, {order.billing_address.state} {order.billing_address.postal_code}
                  </p>
                  <p>{order.billing_address.country || 'India'}</p>
                  {order.billing_address.phone && (
                    <p className="mt-2">Phone: +91 {order.billing_address.phone.replace(/^\+91|^91/, '')}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-foreground-muted">No billing address</p>
              )}
            </Card>

          <Card title="Shipping Address">
              {order.shipping_address ? (
                <div className="text-sm text-foreground">
                  <p className="font-medium">{order.shipping_address.full_name}</p>
                  <p className="mt-2">{order.shipping_address.address_line1}</p>
                  {order.shipping_address.address_line2 && <p>{order.shipping_address.address_line2}</p>}
                  {order.shipping_address.landmark && (
                    <p className="text-foreground-secondary">Landmark: {order.shipping_address.landmark}</p>
                  )}
                  <p>
                    {order.shipping_address.city}, {order.shipping_address.state} {order.shipping_address.postal_code}
                  </p>
                  <p>{order.shipping_address.country || 'India'}</p>
                  {order.shipping_address.phone && (
                    <p className="mt-2">Phone: +91 {order.shipping_address.phone.replace(/^\+91|^91/, '')}</p>
                  )}
                  {!isAllDigital && (
                    <div className="mt-4 px-4 py-3 rounded-xl border border-border-default bg-surface">
                      {edd ? (
                        <div className="flex items-center gap-3">
                          <Truck className="h-7 w-7 shrink-0 text-green-600 dark:text-green-400" />
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-medium ${eddLabelColor}`}>{eddLabel}</p>
                            <p className="font-bold text-foreground">{edd}</p>
                            {courierEddNote && <p className="text-xs text-foreground-muted">{courierEddNote}</p>}
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-foreground-muted">No expected delivery date set</p>
                      )}
                      {order.status !== 'delivered' && canWrite && (
                        <ExtendEddButton orderId={order.id} currentEdd={rawEdd} />
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-foreground-muted">No shipping address</p>
              )}
            </Card>

          <Card title="Payment">
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground-secondary">Status</span>
                <StatusBadge status={order.payment_status} map={PAYMENT_STATUS_FULL} />
              </div>

              {/* All payment transactions on this order (initial charge, variant-change
                  top-ups, etc.) — the transaction IDs feed the refund flow. */}
              {order.payments && order.payments.length > 0 && (
                <div className="mt-3 space-y-3">
                  {order.payments.map((p: any, idx: number) => {
                    const resp =
                      typeof p.gateway_response === 'string'
                        ? (() => {
                            try {
                              return JSON.parse(p.gateway_response)
                            } catch {
                              return {}
                            }
                          })()
                        : p.gateway_response || {}
                    const isVariantChange = resp?.purpose === 'variant_change'
                    const isAdjustment = resp?.purpose === 'order_adjustment'
                    const isRecordedRefund = resp?.purpose === 'external_refund'
                    const partial: Array<{ id: string; amount: number; purpose?: string; at?: string; method?: string; reference?: string | null; note?: string | null }> = Array.isArray(resp?.partial_refunds) ? resp.partial_refunds : []
                    const partialTotal = partial.reduce((s2, r) => s2 + (Number(r.amount) || 0), 0)
                    const refunded = resp?.refund || resp?.variantChangeRefund
                    const external = resp?.external_refund
                    const returnCharge = resp?.returnCharge
                    return (
                      <div key={p.id || idx} className="rounded-lg border border-border-default p-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-foreground">
                            {isRecordedRefund ? 'Refund (recorded)' : isVariantChange ? 'Variant-change top-up' : isAdjustment ? 'Order-changes top-up' : idx === 0 ? 'Order payment' : 'Payment'}
                          </span>
                          <Badge tone={p.status === 'completed' ? 'green' : p.status === 'refunded' ? 'red' : 'amber'}>{p.status}</Badge>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-foreground-secondary">Method</span>
                          <span className="text-foreground capitalize">{isRecordedRefund ? externalRefundLabel(p.payment_method) : p.payment_method}</span>
                        </div>
                        {p.transaction_id && (
                          <div className="flex justify-between gap-3 text-sm">
                            <span className="text-foreground-secondary">Transaction ID</span>
                            <span className="min-w-0 text-right text-foreground font-mono text-xs [overflow-wrap:anywhere]">{p.transaction_id}</span>
                          </div>
                        )}
                        {p.payment_gateway && (
                          <div className="flex justify-between text-sm">
                            <span className="text-foreground-secondary">Gateway</span>
                            <span className="text-foreground capitalize">{p.payment_gateway}</span>
                          </div>
                        )}
                        {p.payment_gateway === 'razorpay' && (
                          <div className="flex justify-between text-sm">
                            <span className="text-foreground-secondary">Collected via</span>
                            <span className="text-foreground">{collectedViaLabel}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-sm">
                          <span className="text-foreground-secondary">Amount</span>
                          <span className="text-foreground font-semibold">
                            Rs.{' '}
                            {Number(p.amount).toLocaleString('en-IN', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        </div>
                        {partial.map(r => (
                          <div key={r.id} className="flex justify-between gap-3 text-sm">
                            <span className="text-foreground-secondary">
                              Partial refund{r.purpose === 'order_adjustment' ? ' · order changes' : r.purpose === 'variant_change' ? ' · variant change' : r.purpose === 'dispute' ? ' · dispute' : ''}
                              {r.method ? <span className="block text-[11px] text-foreground-muted">via {externalRefundLabel(r.method)}{r.note ? ` — ${r.note}` : ''}</span> : null}
                              {r.at ? <span className="block text-[11px] text-foreground-muted">{new Date(r.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span> : null}
                            </span>
                            <span className="min-w-0 text-right">
                              <span className="block font-semibold tabular-nums text-red-600 dark:text-red-400">− Rs. {Number(r.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              {!r.method || r.reference ? (
                                <span className="block text-foreground-muted font-mono text-[11px] [overflow-wrap:anywhere]">{r.method ? r.reference : r.id}</span>
                              ) : null}
                            </span>
                          </div>
                        ))}
                        {partialTotal > 0 && (
                          <div className="flex justify-between text-sm border-t border-border-default pt-1.5">
                            <span className="text-foreground-secondary">Net received</span>
                            <span className="text-foreground font-semibold">
                              Rs. {(Number(p.amount) - partialTotal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        )}
                        {external && (
                          <div className="flex justify-between gap-3 text-sm">
                            <span className="text-foreground-secondary">
                              Refunded via {externalRefundLabel(external.method)}
                              {external.note ? <span className="block text-[11px] text-foreground-muted">{external.note}</span> : null}
                              {external.at ? <span className="block text-[11px] text-foreground-muted">{new Date(external.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span> : null}
                            </span>
                            <span className="min-w-0 text-right">
                              <span className="block font-semibold tabular-nums text-red-600 dark:text-red-400">− Rs. {Number(external.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              {external.reference ? <span className="block text-foreground-muted font-mono text-[11px] [overflow-wrap:anywhere]">{external.reference}</span> : null}
                            </span>
                          </div>
                        )}
                        {refunded?.id && (
                          <div className="flex justify-between gap-3 text-sm">
                            <span className="text-foreground-secondary">Refund</span>
                            <span className="min-w-0 text-right text-foreground font-mono text-xs [overflow-wrap:anywhere]">
                              {refunded.id}
                              {refunded.amount ? ` · Rs. ${(Number(refunded.amount) / 100).toFixed(2)}` : ''}
                            </span>
                          </div>
                        )}
                        {!refunded?.id && returnCharge && Number(returnCharge.netRefund) <= 0 && (
                          <div className="flex justify-between text-sm gap-3">
                            <span className="text-foreground-secondary">Refund</span>
                            <span className="text-right text-foreground-muted">
                              Waived — Rs. {Number(returnCharge.charge).toFixed(2)} return charge covers the Rs.{' '}
                              {Number(returnCharge.grossRefund).toFixed(2)} returnable
                            </span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {canWrite && moneyIn && order.status !== 'cancelled' && order.status !== 'returned' && Number(order.total_amount) > 0 && (
                <RecordRefundLink orderId={order.id} amount={Number(order.total_amount)} razorpayPaid={razorpayPaid} />
              )}
            </Card>
    </>
  )

  return <EntityPage header={header} main={main} aside={aside} />
}
