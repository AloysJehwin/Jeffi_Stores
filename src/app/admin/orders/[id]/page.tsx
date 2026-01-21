import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getOrder } from '@/lib/queries'
import UpdateOrderStatus from '@/components/admin/UpdateOrderStatus'

export default async function OrderDetailsPage({ params }: { params: { id: string } }) {
  const order = await getOrder(params.id).catch(() => null)

  if (!order) {
    notFound()
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/admin/orders"
          className="text-accent-500 hover:text-accent-600 text-sm mb-2 inline-block"
        >
          ← Back to Orders
        </Link>
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-secondary-500">
              Order #{order.order_number || order.id.slice(0, 8)}
            </h1>
            <p className="text-gray-600 mt-1">
              Placed on {new Date(order.created_at).toLocaleDateString('en-IN')} at{' '}
              {new Date(order.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <div className="flex gap-4">
            <span className={`px-4 py-2 text-sm font-semibold rounded-full ${
              order.payment_status === 'paid'
                ? 'bg-green-100 text-green-800'
                : order.payment_status === 'pending'
                ? 'bg-yellow-100 text-yellow-800'
                : 'bg-red-100 text-red-800'
            }`}>
              Payment: {order.payment_status}
            </span>
            <span className={`px-4 py-2 text-sm font-semibold rounded-full ${
              order.status === 'delivered'
                ? 'bg-green-100 text-green-800'
                : order.status === 'processing' || order.status === 'shipped'
                ? 'bg-blue-100 text-blue-800'
                : order.status === 'cancelled'
                ? 'bg-red-100 text-red-800'
                : 'bg-yellow-100 text-yellow-800'
            }`}>
              Status: {order.status}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Order Items */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Order Items</h2>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                {order.order_items && order.order_items.length > 0 ? (
                  order.order_items.map((item: any) => (
                    <div key={item.id} className="flex justify-between items-start pb-4 border-b border-gray-100 last:border-0">
                      <div className="flex-1">
                        <h3 className="font-medium text-gray-900">{item.products?.name || 'Product'}</h3>
                        <p className="text-sm text-gray-500 mt-1">SKU: {item.products?.sku}</p>
                        <p className="text-sm text-gray-600 mt-1">
                          Quantity: {item.quantity} × Rs. {Number(item.unit_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-gray-900">
                          Rs. {Number(item.subtotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500">No items in this order</p>
                )}
              </div>

              {/* Order Summary */}
              <div className="mt-6 pt-6 border-t border-gray-200 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Subtotal</span>
                  <span className="text-gray-900">Rs. {Number(order.subtotal_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
                {order.discount_amount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Discount</span>
                    <span className="text-green-600">-Rs. {Number(order.discount_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Tax</span>
                  <span className="text-gray-900">Rs. {Number(order.tax_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Shipping</span>
                  <span className="text-gray-900">Rs. {Number(order.shipping_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-lg font-bold pt-2 border-t border-gray-200">
                  <span className="text-gray-900">Total</span>
                  <span className="text-primary-500">Rs. {Number(order.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Update Order Status */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Update Order Status</h2>
            </div>
            <div className="p-6">
              <UpdateOrderStatus orderId={order.id} currentStatus={order.status} currentPaymentStatus={order.payment_status} />
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Customer Information */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Customer</h2>
            </div>
            <div className="p-6">
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-600">Name</p>
                  <p className="font-medium text-gray-900">
                    {order.users ? `${order.users.first_name || ''} ${order.users.last_name || ''}`.trim() || 'Guest' : 'Guest'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Email</p>
                  <p className="text-gray-900">{order.users?.email || order.billing_email}</p>
                </div>
                {order.users?.phone && (
                  <div>
                    <p className="text-sm text-gray-600">Phone</p>
                    <p className="text-gray-900">{order.users.phone}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Billing Address */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Billing Address</h2>
            </div>
            <div className="p-6">
              <div className="text-sm text-gray-900">
                <p>{order.billing_full_name}</p>
                <p className="mt-2">{order.billing_address_line1}</p>
                {order.billing_address_line2 && <p>{order.billing_address_line2}</p>}
                <p>{order.billing_city}, {order.billing_state} {order.billing_postal_code}</p>
                <p>{order.billing_country}</p>
                {order.billing_phone && <p className="mt-2">Phone: {order.billing_phone}</p>}
              </div>
            </div>
          </div>

          {/* Shipping Address */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Shipping Address</h2>
            </div>
            <div className="p-6">
              <div className="text-sm text-gray-900">
                <p>{order.shipping_full_name}</p>
                <p className="mt-2">{order.shipping_address_line1}</p>
                {order.shipping_address_line2 && <p>{order.shipping_address_line2}</p>}
                <p>{order.shipping_city}, {order.shipping_state} {order.shipping_postal_code}</p>
                <p>{order.shipping_country}</p>
                {order.shipping_phone && <p className="mt-2">Phone: {order.shipping_phone}</p>}
              </div>
            </div>
          </div>

          {/* Payment Information */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Payment</h2>
            </div>
            <div className="p-6">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Method</span>
                  <span className="text-gray-900 capitalize">{order.payment_method}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Status</span>
                  <span className={`font-semibold ${
                    order.payment_status === 'paid' ? 'text-green-600' : 'text-yellow-600'
                  }`}>
                    {order.payment_status}
                  </span>
                </div>
                {order.transaction_id && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Transaction ID</span>
                    <span className="text-gray-900 font-mono text-xs">{order.transaction_id}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
