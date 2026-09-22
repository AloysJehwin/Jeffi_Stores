import { notFound } from 'next/navigation'
import Link from 'next/link'
import CopySku from '@/components/ui/CopySku'
import { headers } from 'next/headers'
import { getOrder, getReturnRequest } from '@/lib/queries'
import { resolveRequestTenant } from '@/lib/db'
import { controlPlanePool } from '@/lib/tenant-registry'
import { computeRefundableAmount } from '@/lib/refund'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import { hasScope, isPlatformOwner } from '@/lib/scopes'
import { getFeatureFlags } from '@/lib/site-controls'
import UpdateOrderStatus from '@/components/admin/UpdateOrderStatus'
import CancelReview from '@/components/admin/CancelReview'
import ReturnReview from '@/components/admin/ReturnReview'
import GenerateInvoiceButton from '@/components/admin/GenerateInvoiceButton'
import InitiateRefundButton from '@/components/admin/InitiateRefundButton'
import RetryPaymentEmailButton from '@/components/admin/RetryPaymentEmailButton'
import CreateShipmentButton from '@/components/admin/CreateShipmentButton'
import DelhiveryTracking from '@/components/DelhiveryTracking'
import VariantChangeRequest from '@/components/admin/VariantChangeRequest'
import AddressChangeReview from '@/components/admin/AddressChangeReview'
import { listAddressChangeRequests, addressChangeBlockReason } from '@/lib/address-change'
import CustomerMailPanel from '@/components/admin/CustomerMailPanel'
import MailLogsPanel from '@/components/admin/MailLogsPanel'
import ExtendEddButton from '@/components/admin/ExtendEddButton'
import CodRemittanceButton from '@/components/admin/CodRemittanceButton'
import ProductWarningBadges from '@/components/shared/ProductWarningBadges'

export const dynamic = 'force-dynamic'
export const revalidate = 0



function UnitLabel({ label }: { label: string | null | undefined }) {
  if (!label) return null
  const match = label.match(/^(.+?)2$/)
  if (match) return <>{match[1]}<sup>2</sup></>
  return <>{label}</>
}

const RETURN_STATUSES = ['return_requested', 'return_approved', 'return_received', 'return_rejected', 'returned']

export default async function OrderDetailsPage({ params, searchParams }: { params: Promise<{ id: string }>, searchParams?: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { id } = await params
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const back = resolvedSearchParams?.back
  const backUrl = (typeof back === 'string' && back.startsWith('/admin/orders')) ? back : '/admin/orders'
  const host = await getHost()
  const order = await getOrder(id).catch(() => null)

  // Which Razorpay account collected this order's payments. Reflects the tenant's CURRENT mode, not
  // the mode at capture time — a post-capture toggle is an accepted edge case. Platform's own store
  // (no tenant) falls through to the platform label.
  const tenant = await resolveRequestTenant().catch(() => null)
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
  const refundableAmount = await computeRefundableAmount(order, returnRequest).catch(() => Number(order.total_amount))
  const showRetryEmailButton =
    (order.payment_status === 'failed' || order.payment_status === 'unpaid') &&
    (Date.now() - new Date(order.created_at).getTime()) / 3600000 < 24

  const eddDateStr = order.estimated_delivery_date
    ? (order.estimated_delivery_date instanceof Date
        ? order.estimated_delivery_date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
        : String(order.estimated_delivery_date).slice(0, 10))
    : null
  const edd = eddDateStr
    ? new Date(eddDateStr + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
    : null
  const rawEdd: string | null = eddDateStr ?? null

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
      if (diffDays === 0) { eddLabel = 'Arriving Today'; eddLabelColor = 'text-accent-500' }
      else if (diffDays === 1) { eddLabel = 'Arriving Tomorrow'; eddLabelColor = 'text-accent-500' }
      else if (diffDays < 0) { eddLabel = 'Delayed'; eddLabelColor = 'text-orange-500' }
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <Link
          href={ap(backUrl, host)}
          className="text-accent-500 hover:text-accent-600 text-sm mb-2 inline-block"
        >
          ← Back to Orders
        </Link>
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">
              Order #{order.order_number || order.id.slice(0, 8)}
            </h1>
            {order.original_order_id && order.original_order_number && (
              <p className="text-sm text-blue-600 dark:text-blue-400 mt-1">
                Replacement for{' '}
                <Link href={ap(`/admin/orders/${order.original_order_id}`, host)} className="underline hover:text-blue-800 dark:hover:text-blue-300">
                  #{order.original_order_number}
                </Link>
              </p>
            )}
            <p className="text-foreground-secondary mt-1">
              Placed on {new Date(order.created_at).toLocaleDateString('en-IN')} at{' '}
              {new Date(order.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:gap-3 items-center">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full border ${
              order.payment_status === 'paid'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800'
                : order.payment_status === 'pending'
                ? 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                order.payment_status === 'paid' ? 'bg-green-500' : order.payment_status === 'pending' ? 'bg-yellow-500' : 'bg-red-500'
              }`} />
              Payment: {order.payment_status}
            </span>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full border ${
              order.status === 'delivered'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800'
                : order.status === 'processing' || order.status === 'shipped'
                ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                : order.status === 'out_for_delivery'
                ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800'
                : order.status === 'cancelled' || order.status === 'return_rejected'
                ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'
                : order.status === 'cancel_requested' || order.status === 'return_requested'
                ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800'
                : order.status === 'cancel_rejected'
                ? 'bg-gray-100 dark:bg-gray-800/50 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700'
                : order.status === 'returned'
                ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800'
                : order.status === 'return_approved' || order.status === 'return_received'
                ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                : 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                order.status === 'delivered' ? 'bg-green-500'
                : order.status === 'processing' || order.status === 'shipped' || order.status === 'return_approved' || order.status === 'return_received' ? 'bg-blue-500'
                : order.status === 'out_for_delivery' ? 'bg-indigo-500'
                : order.status === 'cancelled' || order.status === 'return_rejected' ? 'bg-red-500'
                : order.status === 'cancel_requested' || order.status === 'return_requested' ? 'bg-orange-500'
                : order.status === 'cancel_rejected' ? 'bg-gray-400'
                : order.status === 'returned' ? 'bg-purple-500'
                : 'bg-yellow-500'
              }`} />
              {order.status === 'cancel_requested' ? 'Cancellation Requested' : order.status === 'cancel_rejected' ? 'Cancellation Rejected' : order.status.replace(/_/g, ' ')}
            </span>
            {/* Divider between status pills and action buttons */}
            <span className="w-px h-6 bg-border-default hidden sm:block" />
            {/* Packing Slip — download + print combined pill */}
            {canPackingSlips && (
            <div className="inline-flex rounded-full overflow-hidden border border-secondary-300 dark:border-secondary-700 text-sm font-semibold">
              <a
                href={`/api/admin/packing-slips/${order.id}`}
                download
                title="Download Packing Slip"
                className="px-3 py-2 bg-secondary-100 dark:bg-secondary-900/30 text-secondary-700 dark:text-secondary-300 hover:bg-secondary-200 dark:hover:bg-secondary-800/50 transition-colors inline-flex items-center gap-1.5 border-r border-secondary-300 dark:border-secondary-700"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Packing Slip
              </a>
              <a
                href={`/api/admin/packing-slips/${order.id}?inline=1`}
                target="_blank"
                rel="noopener noreferrer"
                title="Print Packing Slip"
                className="px-3 py-2 bg-secondary-100 dark:bg-secondary-900/30 text-secondary-700 dark:text-secondary-300 hover:bg-secondary-200 dark:hover:bg-secondary-800/50 transition-colors inline-flex items-center"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
              </a>
            </div>
            )}
            {/* Shipping Label — download + print combined pill */}
            {order.awb_number && (
              <div className="inline-flex rounded-full overflow-hidden border border-blue-300 dark:border-blue-700 text-sm font-semibold">
                <a
                  href={`/api/admin/orders/${order.id}/shipping-label?size=4R`}
                  download
                  title="Download Shipping Label"
                  className="px-3 py-2 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800/50 transition-colors inline-flex items-center gap-1.5 border-r border-blue-300 dark:border-blue-700"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Shipping Label
                </a>
                <a
                  href={`/api/admin/orders/${order.id}/shipping-label?size=4R&print=1`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Print Shipping Label"
                  className="px-3 py-2 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800/50 transition-colors inline-flex items-center"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                </a>
              </div>
            )}
            {!order.original_order_id && (order.invoice_number ? (
              <div className="inline-flex rounded-full overflow-hidden border border-accent-300 dark:border-accent-700 text-sm font-semibold">
                {order.view_token && (
                  <a
                    href={`/invoice/${order.view_token}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View Invoice"
                    className="px-3 py-2 bg-accent-100 dark:bg-accent-900/30 text-accent-800 dark:text-accent-300 hover:bg-accent-200 dark:hover:bg-accent-800/50 transition-colors inline-flex items-center gap-1.5 border-r border-accent-300 dark:border-accent-700"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    Invoice {order.invoice_number}
                  </a>
                )}
                <a
                  href={`/api/orders/${order.id}/invoice`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Download PDF"
                  className="px-3 py-2 bg-accent-100 dark:bg-accent-900/30 text-accent-800 dark:text-accent-300 hover:bg-accent-200 dark:hover:bg-accent-800/50 transition-colors inline-flex items-center"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </a>
              </div>
            ) : canWrite && (order.payment_status === 'paid' || order.status === 'confirmed' || order.status === 'processing' || order.status === 'shipped' || order.status === 'out_for_delivery' || order.status === 'delivered') && (
              <GenerateInvoiceButton orderId={order.id} />
            ))}
            {showRetryEmailButton && <RetryPaymentEmailButton orderId={order.id} />}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
            <div className="px-6 py-4 border-b border-border-default">
              <h2 className="text-lg font-semibold text-foreground">Order Items</h2>
            </div>
            <div className="p-4 sm:p-6">
              <div className="space-y-4">
                {order.order_items && order.order_items.length > 0 ? (
                  order.order_items.map((item: any) => (
                    <div key={item.id} className="flex gap-3 items-start pb-4 border-b border-border-default last:border-0">
                      {item.products?.image_url ? (
                        <img
                          src={item.products.image_url}
                          alt={item.product_name || item.products?.name || ''}
                          className="w-14 h-14 rounded-lg object-cover border border-border-default shrink-0"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-lg bg-surface-secondary border border-border-default shrink-0 flex items-center justify-center">
                          <svg className="w-6 h-6 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M9 9.75a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5z" />
                          </svg>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-foreground">
                          {item.product_id ? (
                            <Link href={ap(`/admin/products/${item.product_id}`, host)} target="_blank" className="hover:underline text-orange-600 dark:text-orange-400">
                              {item.product_name || item.products?.name || 'Product'}
                            </Link>
                          ) : (item.product_name || item.products?.name || 'Product')}
                        </h3>
                        <p className="text-sm text-foreground-muted mt-1">SKU: {item.product_sku || item.products?.sku}{(item.product_sku || item.products?.sku) && <CopySku sku={item.product_sku || item.products?.sku} className="ml-1" />}</p>
                        {item.variant_name && (
                          <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-xs font-medium bg-accent-50 dark:bg-accent-900/30 text-accent-700 dark:text-accent-300 border border-accent-200 dark:border-accent-700">
                            {item.variant_name}
                          </span>
                        )}
                        {item.sub_variant?.sub_variant_name && (
                          <span className="inline-flex items-center mt-1 ml-1 px-2 py-0.5 rounded-full text-xs font-medium bg-surface-secondary text-foreground-secondary border border-border-default">
                            {item.sub_variant.sub_variant_name}
                          </span>
                        )}
                        <div className="mt-1">
                          <ProductWarningBadges fragile={item.fragile} hazardous={item.hazardous} flammable={item.flammable} size="xs" />
                        </div>
                        <p className="text-sm text-foreground-secondary mt-1">
                          {(() => {
                            const isFractional = (item.buy_mode && item.buy_mode !== 'unit') || (item.buy_unit && item.buy_unit !== 'unit')
                            const displayUnit = (item.buy_unit && item.buy_unit !== 'unit') ? item.buy_unit : (item.buy_mode !== 'unit' ? item.buy_mode : null)
                            const qty = isFractional ? Number(item.quantity) : Math.round(Number(item.quantity))
                            const qtyStr = isFractional ? (qty % 1 === 0 ? String(Math.round(qty)) : qty.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')) : String(qty)
                            const priceStr = Number(item.unit_price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            return displayUnit
                              ? <>{qtyStr} <UnitLabel label={displayUnit} /> × Rs. {priceStr}/<UnitLabel label={displayUnit} /></>
                              : <>Quantity: {qtyStr} × Rs. {priceStr}</>
                          })()}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-semibold text-foreground">
                          Rs. {Number(item.total_price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
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
                  <span className="text-foreground">Rs. {Number(order.subtotal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                {order.discount_amount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground-secondary">Discount</span>
                    <span className="text-green-600 dark:text-green-400">-Rs. {Number(order.discount_amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-foreground-secondary">GST (incl.)</span>
                  <span className="text-foreground">Rs. {Number(order.tax_amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-foreground-secondary">Shipping</span>
                  <span className="text-foreground">Rs. {Number(order.shipping_amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                {Number(order.cod_fee_amount) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground-secondary">COD handling fee</span>
                    <span className="text-foreground">Rs. {Number(order.cod_fee_amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold pt-2 border-t border-border-default">
                  <span className="text-foreground">Total</span>
                  <span className="text-primary-500">Rs. {Number(order.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
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
            </div>
          </div>

          {!['processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'return_requested', 'return_approved', 'return_received', 'returned', 'return_rejected'].includes(order.status) && (
          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
            <div className="px-6 py-4 border-b border-border-default">
              <h2 className="text-lg font-semibold text-foreground">Inventory Status</h2>
            </div>
            <div className="divide-y divide-border-default">
              {order.order_items && order.order_items.length > 0 ? (
                order.order_items.map((item: any) => {
                  const inv = item.sub_variant?.inventory_quantity ?? item.variant?.inventory_quantity ?? item.products?.inventory_quantity ?? 0
                  const orderedQty = Number(item.quantity)
                  const isCount = item.sell_unit_dimension === 'count' || (!item.buy_mode || item.buy_mode === 'unit')
                  const factor = item.sell_unit_factor ? Number(item.sell_unit_factor) : 1
                  // For count dimension: inventory is in individual pieces; ordered qty is in selling units (e.g. boxes)
                  // Show both: "5 box (250 pcs)" where factor=50
                  const deductedQty = isCount ? orderedQty * factor : orderedQty
                  const unitLabel = (item.buy_unit && item.buy_unit !== 'unit') ? item.buy_unit : null
                  const isOut = inv < deductedQty
                  const isLow = !isOut && inv < deductedQty * 2
                  return (
                    <div key={item.id} className="px-6 py-4 flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">
                          {item.product_id ? (
                            <Link href={ap(`/admin/products/${item.product_id}`, host)} target="_blank" className="hover:underline text-orange-600 dark:text-orange-400">
                              {item.product_name}
                            </Link>
                          ) : item.product_name}
                        </p>
                        <p className="text-xs text-foreground-muted mt-0.5">
                          SKU: {item.sub_variant?.sku || item.variant?.sku || item.product_sku}{(item.sub_variant?.sku || item.variant?.sku || item.product_sku) && <CopySku sku={item.sub_variant?.sku || item.variant?.sku || item.product_sku} className="ml-1" />}{' · '}
                          Ordered: {isCount && unitLabel
                            ? `${orderedQty} ${unitLabel}${factor > 1 ? ` (${deductedQty} pcs)` : ''}`
                            : `${orderedQty}${unitLabel ? ` ${unitLabel}` : ''}`}
                        </p>
                        {item.variant_name && (
                          <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-xs font-medium bg-accent-50 dark:bg-accent-900/30 text-accent-700 dark:text-accent-300 border border-accent-200 dark:border-accent-700">
                            {item.variant_name}
                          </span>
                        )}
                        {item.sub_variant?.sub_variant_name && (
                          <span className="inline-flex items-center mt-1 ml-1 px-2 py-0.5 rounded-full text-xs font-medium bg-surface-secondary text-foreground-secondary border border-border-default">
                            {item.sub_variant.sub_variant_name}
                          </span>
                        )}
                        <div className="mt-1">
                          <ProductWarningBadges fragile={item.fragile} hazardous={item.hazardous} flammable={item.flammable} size="xs" />
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-semibold ${isOut ? 'text-red-500' : isLow ? 'text-yellow-500' : 'text-green-600 dark:text-green-400'}`}>
                          {inv} in stock
                        </p>
                        <span className={`inline-block mt-0.5 px-2 py-0.5 text-xs font-medium rounded-full ${
                          isOut
                            ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                            : isLow
                            ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                            : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                        }`}>
                          {isOut ? 'Out of stock' : isLow ? 'Low stock' : 'In stock'}
                        </span>
                      </div>
                    </div>
                  )
                })
              ) : (
                <p className="px-6 py-4 text-sm text-foreground-muted">No items</p>
              )}
            </div>
          </div>
          )}

          {order.status === 'cancel_requested' && (
            <div className="bg-surface-elevated rounded-lg shadow-sm border-2 border-orange-300 dark:border-orange-800">
              <div className="px-6 py-4 border-b border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/30">
                <h2 className="text-lg font-semibold text-orange-900 dark:text-orange-300">Cancellation Request</h2>
              </div>
              <div className="p-4 sm:p-6">
                {canWrite ? <CancelReview orderId={order.id} /> : <p className="text-sm text-foreground-muted">Read-only access — cannot approve or reject.</p>}
              </div>
            </div>
          )}

          {order.status === 'cancel_rejected' && order.cancellation_note && (
            <div className="bg-surface-elevated rounded-lg shadow-sm border-2 border-gray-200 dark:border-gray-700">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30">
                <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Cancellation Rejected</h2>
              </div>
              <div className="p-4 sm:p-6">
                <p className="text-sm text-foreground-secondary mb-1">Reason given to customer:</p>
                <p className="text-sm text-foreground bg-surface rounded-lg border border-border-default px-4 py-3">{order.cancellation_note}</p>
              </div>
            </div>
          )}

          {isReturnStatus && returnRequest && (
            <div className={`bg-surface-elevated rounded-lg shadow-sm border-2 ${
              order.status === 'return_rejected' || order.status === 'returned'
                ? 'border-gray-200 dark:border-gray-700'
                : 'border-orange-300 dark:border-orange-800'
            }`}>
              <div className={`px-6 py-4 border-b ${
                order.status === 'return_rejected' || order.status === 'returned'
                  ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30'
                  : 'border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/30'
              }`}>
                <h2 className={`text-lg font-semibold ${
                  order.status === 'return_rejected' || order.status === 'returned'
                    ? 'text-gray-700 dark:text-gray-300'
                    : 'text-orange-900 dark:text-orange-300'
                }`}>
                  Return / {returnRequest.type === 'refund' ? 'Refund' : 'Replacement'} Request
                </h2>
              </div>
              <div className="p-4 sm:p-6">
                {canWrite ? (
                  <ReturnReview
                    orderId={order.id}
                    returnRequest={returnRequest}
                    replacementOrderNumber={returnRequest.replacement_order_number || null}
                  />
                ) : <p className="text-sm text-foreground-muted">Read-only access — cannot approve or reject.</p>}
              </div>
            </div>
          )}

          {isReturnStatus && returnRequest?.rvp_awb_number && (
          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
            <div className="px-6 py-4 border-b border-border-default flex items-center gap-2">
              <svg className="w-5 h-5 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              <h2 className="text-lg font-semibold text-foreground">Return Shipment Tracking</h2>
            </div>
            <div className="p-4 sm:p-6">
              <DelhiveryTracking orderId={order.id} apiBase="/api/admin/orders" variant="admin" trackPath="track-rvp" />
            </div>
          </div>
          )}

          {(order.status === 'cancelled' || order.status === 'returned' || order.status === 'cancel_requested') && order.payment_status === 'paid' && returnRequest?.type !== 'replacement' && refundableAmount > 0 && canWrite && (
            <InitiateRefundButton
              orderId={order.id}
              orderNumber={order.order_number || order.id.slice(0, 8)}
              amount={refundableAmount}
              isReturn={order.status === 'returned'}
            />
          )}

          {order.status !== 'cancelled' && !isReturnStatus && (
          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
            <div className="px-6 py-4 border-b border-border-default">
              <h2 className="text-lg font-semibold text-foreground">Update Order Status</h2>
            </div>
            <div className="p-4 sm:p-6">
              {canWrite ? (
                <UpdateOrderStatus orderId={order.id} currentStatus={order.status} currentPaymentStatus={order.payment_status} canOverride={canOverrideStatus} inventoryValidationEnabled={inventoryValidationEnabled} />
              ) : (
                <p className="text-sm text-foreground-muted">Read-only access — cannot update status.</p>
              )}
            </div>
          </div>
          )}

          <AddressChangeReview
            orderId={order.id}
            requests={addressChangeRequests}
            canWrite={canWrite}
            blockReason={addressChangeBlockReason(order)}
          />

          {order.status === 'confirmed' && !order.awb_number && canWrite && (
            <VariantChangeRequest
              orderId={order.id}
              items={(order.order_items || []).map((it: any) => ({
                id: it.id,
                productId: it.product_id,
                productName: it.product_name,
                variantName: it.variant_name,
                unitPrice: Number(it.unit_price),
                quantity: Number(it.quantity),
              }))}
            />
          )}

          {order.status === 'processing' && !['cancelled', 'cancel_requested', 'cancel_rejected', ...RETURN_STATUSES].includes(order.status) && canWrite && (
          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
            <div className="px-6 py-4 border-b border-border-default">
              <h2 className="text-lg font-semibold text-foreground">Delhivery Shipment</h2>
            </div>
            <div className="p-4 sm:p-6">
              <CreateShipmentButton orderId={order.id} awbNumber={order.awb_number} />
            </div>
          </div>
          )}

          {order.awb_number && (
          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
            <div className="px-6 py-4 border-b border-border-default">
              <h2 className="text-lg font-semibold text-foreground">Shipment Tracking</h2>
            </div>
            <div className="p-4 sm:p-6">
              <DelhiveryTracking orderId={order.id} apiBase="/api/admin/orders" variant="admin" />
            </div>
          </div>
          )}

          {canMail && (
          <CustomerMailPanel
            orderId={order.id}
            orderNumber={order.order_number || order.id.slice(0, 8)}
            customerName={
              order.users
                ? `${order.users.first_name || ''} ${order.users.last_name || ''}`.trim() || order.customer_name || 'Customer'
                : order.customer_name || 'Customer'
            }
            customerEmail={order.users?.email || order.billing_email || ''}
          />
          )}

          <MailLogsPanel orderId={order.id} />
        </div>

        <div className="space-y-4 sm:space-y-6">
          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
            <div className="px-6 py-4 border-b border-border-default">
              <h2 className="text-lg font-semibold text-foreground">Customer</h2>
            </div>
            <div className="p-4 sm:p-6">
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-foreground-secondary">Name</p>
                  <p className="font-medium text-foreground">
                    {order.users ? `${order.users.first_name || ''} ${order.users.last_name || ''}`.trim() || order.customer_name || 'Guest' : order.customer_name || 'Guest'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-foreground-secondary">Email</p>
                  <p className="text-foreground">{order.users?.email || order.billing_email}</p>
                </div>
                {order.users?.phone && (
                  <div>
                    <p className="text-sm text-foreground-secondary">Phone</p>
                    <p className="text-foreground">+91 {order.users.phone.replace(/^\+91|^91/, '')}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
            <div className="px-6 py-4 border-b border-border-default">
              <h2 className="text-lg font-semibold text-foreground">Billing Address</h2>
            </div>
            <div className="p-4 sm:p-6">
              {order.billing_address ? (
                <div className="text-sm text-foreground">
                  <p className="font-medium">{order.billing_address.full_name}</p>
                  <p className="mt-2">{order.billing_address.address_line1}</p>
                  {order.billing_address.address_line2 && <p>{order.billing_address.address_line2}</p>}
                  {order.billing_address.landmark && <p className="text-foreground-secondary">Landmark: {order.billing_address.landmark}</p>}
                  <p>{order.billing_address.city}, {order.billing_address.state} {order.billing_address.postal_code}</p>
                  <p>{order.billing_address.country || 'India'}</p>
                  {order.billing_address.phone && <p className="mt-2">Phone: +91 {order.billing_address.phone.replace(/^\+91|^91/, '')}</p>}
                </div>
              ) : (
                <p className="text-sm text-foreground-muted">No billing address</p>
              )}
            </div>
          </div>

          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
            <div className="px-6 py-4 border-b border-border-default">
              <h2 className="text-lg font-semibold text-foreground">Shipping Address</h2>
            </div>
            <div className="p-4 sm:p-6">
              {order.shipping_address ? (
                <div className="text-sm text-foreground">
                  <p className="font-medium">{order.shipping_address.full_name}</p>
                  <p className="mt-2">{order.shipping_address.address_line1}</p>
                  {order.shipping_address.address_line2 && <p>{order.shipping_address.address_line2}</p>}
                  {order.shipping_address.landmark && <p className="text-foreground-secondary">Landmark: {order.shipping_address.landmark}</p>}
                  <p>{order.shipping_address.city}, {order.shipping_address.state} {order.shipping_address.postal_code}</p>
                  <p>{order.shipping_address.country || 'India'}</p>
                  {order.shipping_address.phone && <p className="mt-2">Phone: +91 {order.shipping_address.phone.replace(/^\+91|^91/, '')}</p>}
                  <div className="mt-4 px-4 py-3 rounded-xl border border-border-default bg-surface">
                    {edd ? (
                      <div className="flex items-center gap-3">
                        <svg className="w-8 h-8 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z"/>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16V5a1 1 0 00-1-1H4a1 1 0 00-1 1v11m10 0h-3M6 16H3m4-7h6l3 5"/>
                        </svg>
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-medium ${eddLabelColor}`}>{eddLabel}</p>
                          <p className="font-bold text-foreground">{edd}</p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-foreground-muted">No expected delivery date set</p>
                    )}
                    {order.status !== 'delivered' && canWrite && <ExtendEddButton orderId={order.id} currentEdd={rawEdd} />}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-foreground-muted">No shipping address</p>
              )}
            </div>
          </div>

          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
            <div className="px-6 py-4 border-b border-border-default">
              <h2 className="text-lg font-semibold text-foreground">Payment</h2>
            </div>
            <div className="p-4 sm:p-6">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-foreground-secondary">Status</span>
                  <span className={`font-semibold ${
                    order.payment_status === 'paid' ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'
                  }`}>
                    {order.payment_status}
                  </span>
                </div>
              </div>

              {/* All payment transactions on this order (initial charge, variant-change
                  top-ups, etc.) — the transaction IDs feed the refund flow. */}
              {order.payments && order.payments.length > 0 && (
                <div className="mt-3 space-y-3">
                  {order.payments.map((p: any, idx: number) => {
                    const resp = typeof p.gateway_response === 'string' ? (() => { try { return JSON.parse(p.gateway_response) } catch { return {} } })() : (p.gateway_response || {})
                    const isVariantChange = resp?.purpose === 'variant_change'
                    const refunded = resp?.refund || resp?.variantChangeRefund
                    const returnCharge = resp?.returnCharge
                    return (
                      <div key={p.id || idx} className="rounded-lg border border-border-default p-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-foreground">
                            {isVariantChange ? 'Variant-change top-up' : idx === 0 ? 'Order payment' : 'Payment'}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            p.status === 'completed' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                            : p.status === 'refunded' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                            : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
                          }`}>{p.status}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-foreground-secondary">Method</span>
                          <span className="text-foreground capitalize">{p.payment_method}</span>
                        </div>
                        {p.transaction_id && (
                          <div className="flex justify-between text-sm">
                            <span className="text-foreground-secondary">Transaction ID</span>
                            <span className="text-foreground font-mono text-xs">{p.transaction_id}</span>
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
                          <span className="text-foreground font-semibold">Rs. {Number(p.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        {refunded?.id && (
                          <div className="flex justify-between text-sm">
                            <span className="text-foreground-secondary">Refund</span>
                            <span className="text-foreground font-mono text-xs">{refunded.id}{refunded.amount ? ` · Rs. ${(Number(refunded.amount) / 100).toFixed(2)}` : ''}</span>
                          </div>
                        )}
                        {!refunded?.id && returnCharge && Number(returnCharge.netRefund) <= 0 && (
                          <div className="flex justify-between text-sm gap-3">
                            <span className="text-foreground-secondary">Refund</span>
                            <span className="text-right text-foreground-muted">
                              Waived — Rs. {Number(returnCharge.charge).toFixed(2)} return charge covers the Rs. {Number(returnCharge.grossRefund).toFixed(2)} returnable
                            </span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
