'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import AccountSidebar, { navItems } from '@/components/visitor/AccountSidebar'

const CANCELLABLE_STATUSES = ['pending', 'confirmed', 'processing']
const isRazorpayEnabled = process.env.NEXT_PUBLIC_ENABLE_RAZORPAY === 'true'

interface OrderItem {
  id: string
  productId: string
  productName: string
  variantName: string | null
  quantity: number
  unitPrice: number
  totalPrice: number
  products: {
    slug: string
    product_images: Array<{
      thumbnail_url: string
      image_url: string
      is_primary: boolean
    }>
  }
}

interface OrderDetails {
  id: string
  orderNumber: string
  invoiceNumber: string | null
  totalAmount: number
  subtotal: number
  taxAmount: number
  status: string
  paymentStatus: string
  createdAt: string
  notes: string | null
  shippingAddress: {
    full_name: string
    address_line1: string
    address_line2?: string
    landmark?: string
    city: string
    state: string
    postal_code: string
    phone: string
  } | null
  items: OrderItem[]
}

function getStatusColor(status: string) {
  switch (status) {
    case 'pending':
      return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
    case 'confirmed':
      return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
    case 'processing':
      return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
    case 'shipped':
      return 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300'
    case 'delivered':
      return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
    case 'cancel_requested':
      return 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300'
    case 'cancelled':
      return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
    default:
      return 'bg-surface-secondary text-foreground'
  }
}

function getPaymentStatusColor(status: string) {
  switch (status) {
    case 'paid':
      return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
    case 'pending':
    case 'unpaid':
      return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
    case 'failed':
      return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
    case 'refunded':
      return 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300'
    default:
      return 'bg-surface-secondary text-foreground'
  }
}

export default function OrderDetailPage({ params }: { params: { id: string } }) {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [order, setOrder] = useState<OrderDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [isPayingNow, setIsPayingNow] = useState(false)
  const [paymentError, setPaymentError] = useState('')
  const [razorpayLoaded, setRazorpayLoaded] = useState(false)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login?redirect=/account/orders')
      return
    }
    if (user) {
      fetchOrder()
    }
  }, [user, authLoading, router])

  const fetchOrder = async () => {
    try {
      const response = await fetch(`/api/orders/${params.id}`)
      if (!response.ok) {
        throw new Error('Failed to fetch order details')
      }
      const data = await response.json()
      setOrder(data.order)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelOrder = async () => {
    setIsCancelling(true)
    try {
      const response = await fetch(`/api/orders/${params.id}/cancel`, {
        method: 'POST',
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to cancel order')
      }
      // Re-fetch to get updated status
      await fetchOrder()
      setShowCancelConfirm(false)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsCancelling(false)
    }
  }

  const loadRazorpayScript = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (razorpayLoaded || document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]')) {
        setRazorpayLoaded(true)
        resolve()
        return
      }
      const script = document.createElement('script')
      script.src = 'https://checkout.razorpay.com/v1/checkout.js'
      script.async = true
      script.onload = () => { setRazorpayLoaded(true); resolve() }
      script.onerror = () => reject(new Error('Failed to load payment gateway'))
      document.body.appendChild(script)
    })
  }

  const handlePayNow = async () => {
    if (!order) return
    setIsPayingNow(true)
    setPaymentError('')

    try {
      await loadRazorpayScript()

      // Create Razorpay order
      const rzpResponse = await fetch('/api/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id }),
      })
      const rzpData = await rzpResponse.json()
      if (!rzpResponse.ok) throw new Error(rzpData.error || 'Failed to initiate payment')

      const options = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID!,
        amount: rzpData.amount,
        currency: rzpData.currency,
        name: 'Jeffi Stores',
        description: `Order #${order.orderNumber}`,
        order_id: rzpData.razorpayOrderId,
        handler: async function (response: any) {
          try {
            const verifyResponse = await fetch('/api/razorpay/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                orderId: order.id,
              }),
            })
            const verifyData = await verifyResponse.json()
            if (!verifyResponse.ok) throw new Error(verifyData.error || 'Verification failed')

            // Re-fetch order to show updated status
            await fetchOrder()
            setIsPayingNow(false)
          } catch (err: any) {
            setPaymentError('Payment received but verification failed. Please contact support — your payment is safe.')
            setIsPayingNow(false)
          }
        },
        prefill: {
          name: order.shippingAddress?.full_name || '',
          email: user?.email || '',
          contact: order.shippingAddress?.phone || '',
        },
        theme: { color: '#f97316' },
        modal: {
          ondismiss: function () {
            setIsPayingNow(false)
          },
        },
      }

      const rzp = new (window as any).Razorpay(options)
      rzp.on('payment.failed', function (response: any) {
        setPaymentError(`Payment failed: ${response.error.description}. Please try again.`)
        setIsPayingNow(false)
      })
      rzp.open()
    } catch (err: any) {
      setPaymentError(err.message)
      setIsPayingNow(false)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-accent-500 border-t-transparent rounded-full mx-auto"></div>
          <p className="mt-4 text-foreground-secondary">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) return null

  if (error || !order) {
    return (
      <div className="bg-surface min-h-screen py-8">
        <div className="container mx-auto px-4">
          {/* Mobile Account Nav */}
          <div className="lg:hidden overflow-x-auto mb-4">
            <nav className="flex gap-2 min-w-max">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                    (item.exact ? pathname === item.href : pathname.startsWith(item.href))
                      ? 'bg-accent-500 text-white'
                      : 'bg-surface-secondary text-foreground-secondary hover:bg-border-default'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6">
            <div className="lg:col-span-1">
              <AccountSidebar />
            </div>
            <div className="lg:col-span-3">
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-12 text-center">
                <h3 className="text-xl font-semibold text-foreground mb-2">Order Not Found</h3>
                <p className="text-foreground-secondary mb-6">{error || 'Unable to load order details'}</p>
                <Link
                  href="/account/orders"
                  className="inline-block px-6 py-3 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold transition-colors"
                >
                  View All Orders
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-surface min-h-screen py-8">
      <div className="container mx-auto px-4">
        <h1 className="text-3xl font-bold text-foreground mb-8">Order Details</h1>

        {/* Mobile Account Nav */}
        <div className="lg:hidden overflow-x-auto mb-4">
          <nav className="flex gap-2 min-w-max">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  (item.exact ? pathname === item.href : pathname.startsWith(item.href))
                    ? 'bg-accent-500 text-white'
                    : 'bg-surface-secondary text-foreground-secondary hover:bg-border-default'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6">
          <div className="lg:col-span-1">
            <AccountSidebar />
          </div>

          <div className="lg:col-span-3 space-y-4 sm:space-y-6">
            {/* Back link */}
            <Link
              href="/account/orders"
              className="inline-flex items-center text-accent-600 hover:text-accent-700 dark:text-accent-400 dark:hover:text-accent-300 font-medium text-sm"
            >
              <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to My Orders
            </Link>

            {/* Order Header */}
            <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-foreground">
                    Order #{order.orderNumber}
                  </h2>
                  <p className="text-sm text-foreground-secondary mt-1">
                    Placed on {new Date(order.createdAt).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })} at {new Date(order.createdAt).toLocaleTimeString('en-IN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium capitalize ${getStatusColor(order.status)}`}>
                    {order.status === 'cancel_requested' ? 'Cancellation Requested' : order.status}
                  </span>
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium capitalize ${getPaymentStatusColor(order.paymentStatus)}`}>
                    Payment: {order.paymentStatus}
                  </span>
                  {CANCELLABLE_STATUSES.includes(order.status) && (
                    <button
                      type="button"
                      onClick={() => setShowCancelConfirm(true)}
                      className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50 border border-red-200 dark:border-red-800 transition-colors"
                    >
                      {order.status === 'pending' && order.paymentStatus === 'unpaid' ? 'Cancel Order' : 'Request Cancellation'}
                    </button>
                  )}
                  {order.invoiceNumber && (
                    <a
                      href={`/api/orders/${order.id}/invoice`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-accent-50 text-accent-700 hover:bg-accent-100 border border-accent-200 transition-colors gap-1"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Download Invoice
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Cancel Confirmation Dialog */}
            {showCancelConfirm && (
              <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 sm:p-6">
                {order.status === 'pending' && order.paymentStatus === 'unpaid' ? (
                  <>
                    <h3 className="text-lg font-bold text-red-900 dark:text-red-300 mb-2">Cancel this order?</h3>
                    <p className="text-red-800 dark:text-red-300 text-sm mb-4">
                      This order will be cancelled immediately and stock will be restored. This action cannot be undone.
                    </p>
                  </>
                ) : (
                  <>
                    <h3 className="text-lg font-bold text-red-900 dark:text-red-300 mb-2">Request cancellation for this order?</h3>
                    <p className="text-red-800 dark:text-red-300 text-sm mb-4">
                      Your cancellation request will be sent to our team for review. You will be notified once it is approved or rejected.
                    </p>
                  </>
                )}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleCancelOrder}
                    disabled={isCancelling}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium text-sm transition-colors disabled:bg-red-300 disabled:cursor-not-allowed flex items-center"
                  >
                    {isCancelling ? (
                      <>
                        <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                        {order.status === 'pending' && order.paymentStatus === 'unpaid' ? 'Cancelling...' : 'Submitting...'}
                      </>
                    ) : (
                      order.status === 'pending' && order.paymentStatus === 'unpaid' ? 'Yes, Cancel Order' : 'Yes, Request Cancellation'
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCancelConfirm(false)}
                    disabled={isCancelling}
                    className="px-4 py-2 bg-surface-elevated hover:bg-surface-secondary text-foreground-secondary rounded-lg font-medium text-sm border border-border-secondary transition-colors"
                  >
                    Keep Order
                  </button>
                </div>
              </div>
            )}

            {/* Cancel Requested Banner */}
            {order.status === 'cancel_requested' && (
              <div className="bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
                <div className="flex gap-3">
                  <svg className="w-5 h-5 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-orange-800 dark:text-orange-300 text-sm">
                    Your cancellation request is pending review by our team. You will receive an email once it is approved or rejected.
                  </p>
                </div>
              </div>
            )}

            {/* Order Items */}
            <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6">
              <h3 className="text-lg font-bold text-foreground mb-4">
                Order Items ({order.items.length} {order.items.length === 1 ? 'item' : 'items'})
              </h3>

              <div className="space-y-4">
                {order.items.map((item) => {
                  const primaryImage = item.products?.product_images?.find(img => img.is_primary) || item.products?.product_images?.[0]

                  return (
                    <div key={item.id} className="flex gap-4 pb-4 border-b border-border-default last:border-b-0">
                      <div className="relative w-20 h-20 flex-shrink-0 bg-surface-elevated rounded-lg overflow-hidden border border-border-default">
                        {primaryImage ? (
                          <img
                            src={primaryImage.thumbnail_url || primaryImage.image_url}
                            alt={item.productName}
                            className="w-full h-full object-cover rounded-lg"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <svg className="w-8 h-8 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        {item.products?.slug ? (
                          <Link
                            href={`/products/${item.products.slug}`}
                            className="font-medium text-foreground hover:text-accent-600 dark:hover:text-accent-400 block"
                          >
                            {item.productName}
                          </Link>
                        ) : (
                          <p className="font-medium text-foreground">{item.productName}</p>
                        )}
                        {item.variantName && (
                          <p className="text-sm text-foreground-muted">{item.variantName}</p>
                        )}
                        <p className="text-sm text-foreground-secondary mt-1">Quantity: {item.quantity}</p>
                        <p className="text-sm font-semibold text-foreground mt-1">
                          {item.unitPrice.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })} x {item.quantity} = {item.totalPrice.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Total */}
              <div className="mt-6 pt-4 border-t-2 border-border-default space-y-2">
                <div className="flex justify-between text-sm text-foreground-secondary">
                  <span>Subtotal</span>
                  <span>{order.subtotal.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                </div>
                {order.taxAmount > 0 && (
                  <div className="flex justify-between text-sm text-foreground-muted">
                    <span>Incl. GST</span>
                    <span>{order.taxAmount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-2">
                  <span className="text-lg font-bold text-foreground">Total</span>
                  <span className="text-2xl font-bold text-primary-600 dark:text-primary-400">
                    {order.totalAmount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                  </span>
                </div>
                <p className="text-xs text-foreground-muted">Price inclusive of all taxes</p>
              </div>
            </div>

            {/* Shipping Address */}
            {order.shippingAddress && (
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6">
                <h3 className="text-lg font-bold text-foreground mb-4">Shipping Address</h3>
                <div className="text-foreground-secondary">
                  <p className="font-semibold">{order.shippingAddress.full_name}</p>
                  <p className="mt-2">{order.shippingAddress.address_line1}</p>
                  {order.shippingAddress.address_line2 && (
                    <p>{order.shippingAddress.address_line2}</p>
                  )}
                  {order.shippingAddress.landmark && (
                    <p className="text-foreground-secondary text-sm">Landmark: {order.shippingAddress.landmark}</p>
                  )}
                  <p>
                    {order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postal_code}
                  </p>
                  <p className="mt-2 text-foreground-secondary">Phone: {order.shippingAddress.phone}</p>
                </div>
              </div>
            )}

            {/* Order Notes */}
            {order.notes && (
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6">
                <h3 className="text-lg font-bold text-foreground mb-2">Order Notes</h3>
                <p className="text-foreground-secondary">{order.notes}</p>
              </div>
            )}

            {/* Payment Status Banner */}
            {order.paymentStatus === 'paid' && (
              <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="flex gap-3">
                  <svg className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-green-800 dark:text-green-300 text-sm font-medium">
                    Payment received. Thank you for your purchase!
                  </p>
                </div>
              </div>
            )}

            {order.paymentStatus === 'unpaid' && isRazorpayEnabled && order.status !== 'cancelled' && order.status !== 'cancel_requested' && (
              <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex gap-3">
                    <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-blue-800 dark:text-blue-300 text-sm">
                      Payment is pending for this order. Pay online to confirm your order instantly.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handlePayNow}
                    disabled={isPayingNow}
                    className="flex-shrink-0 px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold text-sm transition-colors disabled:bg-accent-300 disabled:cursor-not-allowed flex items-center"
                  >
                    {isPayingNow ? (
                      <>
                        <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                        Processing...
                      </>
                    ) : (
                      `Pay ₹${order.totalAmount.toLocaleString('en-IN')}`
                    )}
                  </button>
                </div>
              </div>
            )}

            {order.paymentStatus === 'unpaid' && !isRazorpayEnabled && order.status !== 'cancelled' && order.status !== 'cancel_requested' && (
              <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <div className="flex gap-3">
                  <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-blue-800 dark:text-blue-300 text-sm">
                    Our team will contact you to confirm your order and provide payment details. For queries, call +91 89030 31299 or email jeffistoress@gmail.com.
                  </p>
                </div>
              </div>
            )}

            {order.paymentStatus === 'failed' && isRazorpayEnabled && order.status !== 'cancelled' && order.status !== 'cancel_requested' && (
              <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex gap-3">
                    <svg className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-red-800 dark:text-red-300 text-sm">
                      Payment failed for this order. Please retry to complete your purchase.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handlePayNow}
                    disabled={isPayingNow}
                    className="flex-shrink-0 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:bg-red-300 disabled:cursor-not-allowed flex items-center"
                  >
                    {isPayingNow ? (
                      <>
                        <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                        Processing...
                      </>
                    ) : (
                      'Retry Payment'
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Payment Error */}
            {paymentError && (
              <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <div className="flex gap-3">
                  <svg className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-red-800 dark:text-red-300 text-sm">{paymentError}</p>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                href="/account/orders"
                className="flex-1 bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors text-center"
              >
                View All Orders
              </Link>
              <Link
                href="/products"
                className="flex-1 bg-surface-elevated text-foreground-secondary px-6 py-3 rounded-lg border-2 border-border-secondary hover:bg-surface-secondary transition-colors text-center font-semibold"
              >
                Continue Shopping
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
