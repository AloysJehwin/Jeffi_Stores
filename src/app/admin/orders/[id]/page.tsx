import { notFound } from 'next/navigation'
import Link from 'next/link'
import { headers } from 'next/headers'
import { getOrder, getReturnRequest } from '@/lib/queries'
import { ap } from '@/lib/admin-path'
import UpdateOrderStatus from '@/components/admin/UpdateOrderStatus'
import CancelReview from '@/components/admin/CancelReview'
import ReturnReview from '@/components/admin/ReturnReview'
import GenerateInvoiceButton from '@/components/admin/GenerateInvoiceButton'
import InitiateRefundButton from '@/components/admin/InitiateRefundButton'
import RetryPaymentEmailButton from '@/components/admin/RetryPaymentEmailButton'
import CreateShipmentButton from '@/components/admin/CreateShipmentButton'
import DelhiveryTracking from '@/components/DelhiveryTracking'
import CustomerMailPanel from '@/components/admin/CustomerMailPanel'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const RETURN_STATUSES = ['return_requested', 'return_approved', 'return_received', 'return_rejected', 'returned']

export default async function OrderDetailsPage({ params }: { params: { id: string } }) {
  const host = (await headers()).get('host') ?? ''
  const order = await getOrder(params.id).catch(() => null)

  if (!order) {
    notFound()
  }

  const returnRequest = await getReturnRequest(params.id).catch(() => null)
  const isReturnStatus = RETURN_STATUSES.includes(order.status)
  const showRetryEmailButton =
    (order.payment_status === 'failed' || order.payment_status === 'unpaid') &&
    (Date.now() - new Date(order.created_at).getTime()) / 3600000 < 24

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <Link
          href={ap('/admin/orders', host)}
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
              <a
                href={`/api/orders/${order.id}/invoice`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 text-sm font-semibold rounded-full bg-accent-100 dark:bg-accent-900/30 text-accent-800 dark:text-accent-300 hover:bg-accent-200 dark:hover:bg-accent-800/50 border border-accent-300 dark:border-accent-700 transition-colors inline-flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Invoice {order.invoice_number}
              </a>
            ) : (order.payment_status === 'paid' || order.status === 'confirmed' || order.status === 'processing' || order.status === 'shipped' || order.status === 'out_for_delivery' || order.status === 'delivered') && (
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
                    <div key={item.id} className="flex justify-between items-start pb-4 border-b border-border-default last:border-0">
                      <div className="flex-1">
                        <h3 className="font-medium text-foreground">{item.product_name || item.products?.name || 'Product'}</h3>
                        <p className="text-sm text-foreground-muted mt-1">SKU: {item.product_sku || item.products?.sku}</p>
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
                        <p className="text-sm text-foreground-secondary mt-1">
                          {(() => {
                            const isFractional = (item.buy_mode && item.buy_mode !== 'unit') || (item.buy_unit && item.buy_unit !== 'unit')
                            const displayUnit = (item.buy_unit && item.buy_unit !== 'unit') ? item.buy_unit : (item.buy_mode !== 'unit' ? item.buy_mode : null)
                            const qty = isFractional ? Number(item.quantity) : Math.round(Number(item.quantity))
                            const qtyStr = isFractional ? qty.toFixed(qty % 1 === 0 ? 0 : 3).replace(/\.?0+$/, '') : String(qty)
                            const priceStr = Number(item.unit_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })
                            return displayUnit
                              ? `${qtyStr} ${displayUnit} × Rs. ${priceStr}/${displayUnit}`
                              : `Quantity: ${qtyStr} × Rs. ${priceStr}`
                          })()}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-foreground">
                          Rs. {Number(item.total_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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
                  <span className="text-foreground">Rs. {Number(order.subtotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
                {order.discount_amount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground-secondary">Discount</span>
                    <span className="text-green-600 dark:text-green-400">-Rs. {Number(order.discount_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-foreground-secondary">GST (incl.)</span>
                  <span className="text-foreground">Rs. {Number(order.tax_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-foreground-secondary">Shipping</span>
                  <span className="text-foreground">Rs. {Number(order.shipping_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-lg font-bold pt-2 border-t border-border-default">
                  <span className="text-foreground">Total</span>
                  <span className="text-primary-500">Rs. {Number(order.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
            <div className="px-6 py-4 border-b border-border-default">
              <h2 className="text-lg font-semibold text-foreground">Inventory Status</h2>
            </div>
            <div className="divide-y divide-border-default">
              {order.order_items && order.order_items.length > 0 ? (
                order.order_items.map((item: any) => {
                  const inv = item.sub_variant?.inventory_quantity ?? item.variant?.inventory_quantity ?? item.products?.inventory_quantity ?? 0
                  const qty = Math.round(Number(item.quantity))
                  const isOut = inv <= 0
                  const isLow = inv > 0 && inv <= 5
                  return (
                    <div key={item.id} className="px-6 py-4 flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{item.product_name}</p>
                        <p className="text-xs text-foreground-muted mt-0.5">
                          SKU: {item.sub_variant?.sku || item.variant?.sku || item.product_sku}{' · '}Ordered: {qty}
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

          {order.status === 'cancel_requested' && (
            <div className="bg-surface-elevated rounded-lg shadow-sm border-2 border-orange-300 dark:border-orange-800">
              <div className="px-6 py-4 border-b border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/30">
                <h2 className="text-lg font-semibold text-orange-900 dark:text-orange-300">Cancellation Request</h2>
              </div>
              <div className="p-4 sm:p-6">
                <CancelReview orderId={order.id} />
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
                <ReturnReview
                  orderId={order.id}
                  returnRequest={returnRequest}
                  replacementOrderNumber={returnRequest.replacement_order_number || null}
                />
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

          {(order.status === 'cancelled' || order.status === 'returned') && order.payment_status === 'paid' && returnRequest?.type !== 'replacement' && (
            <InitiateRefundButton
              orderId={order.id}
              orderNumber={order.order_number || order.id.slice(0, 8)}
              amount={Number(order.total_amount)}
              isReturn={order.status === 'returned'}
            />
          )}

          {order.status !== 'cancelled' && !isReturnStatus && (
          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
            <div className="px-6 py-4 border-b border-border-default">
              <h2 className="text-lg font-semibold text-foreground">Update Order Status</h2>
            </div>
            <div className="p-4 sm:p-6">
              <UpdateOrderStatus orderId={order.id} currentStatus={order.status} currentPaymentStatus={order.payment_status} />
            </div>
          </div>
          )}

          {order.status === 'processing' && !['cancelled', 'cancel_requested', 'cancel_rejected', ...RETURN_STATUSES].includes(order.status) && (
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
                    <p className="text-foreground">+91 {order.users.phone}</p>
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
                  {order.billing_address.phone && <p className="mt-2">Phone: +91 {order.billing_address.phone}</p>}
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
                  {order.shipping_address.phone && <p className="mt-2">Phone: +91 {order.shipping_address.phone}</p>}
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
                {order.payments && order.payments.length > 0 && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-foreground-secondary">Method</span>
                      <span className="text-foreground capitalize">{order.payments[0].payment_method}</span>
                    </div>
                    {order.payments[0].transaction_id && (
                      <div className="flex justify-between">
                        <span className="text-foreground-secondary">Transaction ID</span>
                        <span className="text-foreground font-mono text-xs">{order.payments[0].transaction_id}</span>
                      </div>
                    )}
                    {order.payments[0].payment_gateway && (
                      <div className="flex justify-between">
                        <span className="text-foreground-secondary">Gateway</span>
                        <span className="text-foreground capitalize">{order.payments[0].payment_gateway}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-foreground-secondary">Amount</span>
                      <span className="text-foreground font-semibold">Rs. {Number(order.payments[0].amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
