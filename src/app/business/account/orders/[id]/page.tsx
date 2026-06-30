'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useRouter } from 'next/navigation'
import { use, useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useCart } from '@/contexts/CartContext'
import BusinessAccountMobileHeader from '@/components/business/AccountMobileHeader'
import DelhiveryTracking from '@/components/DelhiveryTracking'
import { bp } from '@/lib/business-path'

const CANCELLABLE_STATUSES = ['pending', 'confirmed', 'processing']
const isRazorpayEnabled = process.env.NEXT_PUBLIC_ENABLE_RAZORPAY === 'true'
const PH = { 'X-Auth-Portal': 'business' }
const CONTINUOUS_UNITS = new Set(['m', 'cm', 'mm', 'km', 'ft', 'in', 'kg', 'g', 'mg', 'lb', 'oz', 'l', 'ml', 'm2', 'cm2', 'mm2', 'm3', 'cm3'])

interface OrderItem {
  id: string
  productId: string
  productName: string
  productSku: string | null
  variantName: string | null
  subVariantName: string | null
  subVariantSku: string | null
  quantity: number
  unitPrice: number
  totalPrice: number
  buyMode?: string
  buyUnit?: string | null
  products: {
    slug: string
    product_images: Array<{ thumbnail_url: string; image_url: string; is_primary: boolean }>
  }
}

interface OrderDetails {
  id: string
  orderNumber: string
  invoiceNumber: string | null
  viewToken: string | null
  totalAmount: number
  subtotal: number
  taxAmount: number
  discountAmount: number
  businessDiscountAmount: number
  shippingAmount: number
  status: string
  paymentStatus: string
  paymentMode: string | null
  razorpayQrImageUrl: string | null
  createdAt: string
  updatedAt: string
  deliveredAt: string | null
  notes: string | null
  trackingUrl: string | null
  awbNumber: string | null
  originalOrderId: string | null
  originalOrderNumber: string | null
  orderType: string
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
    case 'pending': return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
    case 'confirmed': return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
    case 'processing': return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
    case 'shipped': return 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300'
    case 'out_for_delivery': return 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300'
    case 'delivered': return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
    case 'cancel_requested': return 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300'
    case 'cancelled': return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
    case 'return_requested': return 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300'
    case 'return_approved':
    case 'return_received': return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
    case 'return_rejected': return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
    case 'returned': return 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300'
    default: return 'bg-surface-secondary text-foreground'
  }
}

function getPaymentStatusColor(status: string) {
  switch (status) {
    case 'paid': return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
    case 'pending':
    case 'unpaid': return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
    case 'failed': return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
    case 'refunded': return 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300'
    default: return 'bg-surface-secondary text-foreground'
  }
}

function statusLabel(status: string) {
  switch (status) {
    case 'cancel_requested': return 'Cancellation Requested'
    case 'cancel_rejected': return 'Cancellation Rejected'
    case 'out_for_delivery': return 'Out for Delivery'
    case 'return_requested': return 'Return Requested'
    case 'return_approved': return 'Return Approved'
    case 'return_received': return 'Return Received'
    case 'return_rejected': return 'Return Rejected'
    case 'returned': return 'Returned'
    default: return status.charAt(0).toUpperCase() + status.slice(1)
  }
}

export default function BusinessOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const [order, setOrder] = useState<OrderDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isCancelling, setIsCancelling] = useState(false)
  const confirm = useConfirm()
  const [isPayingNow, setIsPayingNow] = useState(false)
  const [paymentError, setPaymentError] = useState('')
  const [razorpayLoaded, setRazorpayLoaded] = useState(false)
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  const [isAutoCancelling, setIsAutoCancelling] = useState(false)
  const autoCancelTriggeredRef = useRef(false)
  const { refreshCart } = useCart()

  useEffect(() => {
    if (!authLoading && !user) {
      router.push(bp(`/business/signin?callbackUrl=/business/account/orders/${id}`))
      return
    }
    if (user) fetchOrder()
  }, [user, authLoading, router])

  const fetchOrder = async () => {
    try {
      const res = await fetch(`/api/orders/${id}`, { credentials: 'include', headers: PH })
      if (!res.ok) throw new Error('Failed to fetch order details')
      const data = await res.json()
      setOrder(data.order)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleAutoCancel = useCallback(async () => {
    if (autoCancelTriggeredRef.current) return
    autoCancelTriggeredRef.current = true
    setIsAutoCancelling(true)
    try {
      const res = await fetch(`/api/orders/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...PH },
        credentials: 'include',
        body: JSON.stringify({ restoreToCart: order?.orderType !== 'direct', autoCancelUnpaid: true }),
      })
      if (res.ok) { await fetchOrder(); await refreshCart() }
    } catch {
    } finally {
      setIsAutoCancelling(false)
    }
  }, [id])

  useEffect(() => {
    if (!order || order.status === 'cancelled' || order.status === 'cancel_requested') return
    if (order.paymentStatus !== 'failed' && order.paymentStatus !== 'unpaid') return
    if (!isRazorpayEnabled) return
    // UPI QR orders are paid by scanning — no countdown or auto-cancel
    if (order.paymentMode === 'upi_qr') return
    const deadline = new Date(order.createdAt).getTime() + 10 * 60 * 1000
    const tick = () => {
      const remaining = Math.max(0, deadline - Date.now())
      setTimeLeft(remaining)
      if (remaining <= 0) handleAutoCancel()
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [order, handleAutoCancel])

  // Poll every 5s for UPI QR orders until paid
  useEffect(() => {
    if (!order || order.paymentMode !== 'upi_qr' || order.paymentStatus === 'paid') return
    if (order.status === 'cancelled' || order.status === 'cancel_requested') return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/orders/${id}`, { credentials: 'include', headers: PH })
        if (!res.ok) return
        const data = await res.json()
        if (data.order?.paymentStatus === 'paid') {
          setOrder(data.order)
          clearInterval(interval)
        }
      } catch { /* ignore */ }
    }, 5000)
    return () => clearInterval(interval)
  }, [id, order?.paymentMode, order?.paymentStatus, order?.status])

  const handleCancelOrder = async () => {
    const isImmediate = order?.status === 'pending' && order?.paymentStatus === 'unpaid'
    const ok = await confirm({
      title: isImmediate ? 'Cancel this order?' : 'Request cancellation for this order?',
      message: isImmediate
        ? 'This order will be cancelled immediately and stock will be restored. This action cannot be undone.'
        : 'Your cancellation request will be sent to our team for review. You will be notified once it is approved or rejected.',
      confirmLabel: isImmediate ? 'Yes, Cancel Order' : 'Yes, Request Cancellation',
      cancelLabel: 'Keep Order',
      variant: 'danger',
    })
    if (!ok) return
    setIsCancelling(true)
    try {
      const res = await fetch(`/api/orders/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...PH },
        credentials: 'include',
        body: JSON.stringify({ restoreToCart: order?.orderType !== 'direct' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to cancel order')
      await fetchOrder()
      await refreshCart()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsCancelling(false)
    }
  }

  const loadRazorpayScript = (): Promise<void> => new Promise((resolve, reject) => {
    if (razorpayLoaded || document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]')) {
      setRazorpayLoaded(true); resolve(); return
    }
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.onload = () => { setRazorpayLoaded(true); resolve() }
    script.onerror = () => reject(new Error('Failed to load payment gateway'))
    document.body.appendChild(script)
  })

  const handlePayNow = async () => {
    if (!order) return
    setIsPayingNow(true)
    setPaymentError('')
    try {
      await loadRazorpayScript()
      const rzpRes = await fetch('/api/razorpay/create-order', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...PH },
        body: JSON.stringify({ orderId: order.id }),
      })
      const rzpData = await rzpRes.json()
      if (!rzpRes.ok) throw new Error(rzpData.error || 'Failed to initiate payment')
      const options = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID!,
        amount: rzpData.amount,
        currency: rzpData.currency,
        name: 'Jeffi Stores',
        description: `Order #${order.orderNumber}`,
        order_id: rzpData.razorpayOrderId,
        handler: async (response: any) => {
          try {
            const verifyRes = await fetch('/api/razorpay/verify', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json', ...PH },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                orderId: order.id,
              }),
            })
            const verifyData = await verifyRes.json()
            if (!verifyRes.ok) throw new Error(verifyData.error || 'Verification failed')
            await fetchOrder()
            setIsPayingNow(false)
          } catch (err: any) {
            setPaymentError(err?.message || 'Payment received but verification failed. Please contact support.')
            setIsPayingNow(false)
          }
        },
        prefill: {
          name: order.shippingAddress?.full_name || '',
          email: user?.email || '',
          contact: order.shippingAddress?.phone || '',
        },
        theme: { color: '#f97316' },
        modal: { ondismiss: () => setIsPayingNow(false) },
      }
      const rzp = new (window as any).Razorpay(options)
      rzp.on('payment.failed', (response: any) => {
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
      <div className="container mx-auto px-4 py-16 text-center">
        <div className="animate-spin w-12 h-12 border-4 border-accent-500 border-t-transparent rounded-full mx-auto" />
        <p className="mt-4 text-foreground-secondary">Loading...</p>
      </div>
    )
  }

  if (!user) return null

  if (error || !order) {
    return (
      <div className="bg-surface min-h-screen">
        <BusinessAccountMobileHeader />
        <div className="container mx-auto px-4">
          <div className="py-4">
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-12 text-center">
                <h3 className="text-xl font-semibold text-foreground mb-2">Order Not Found</h3>
                <p className="text-foreground-secondary mb-6">{error || 'Unable to load order details'}</p>
                <Link href={bp('/business/account/orders')} className="inline-block px-6 py-3 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold transition-colors">
                  View All Orders
                </Link>
              </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-surface min-h-screen">
      <BusinessAccountMobileHeader />
      <div className="container mx-auto px-4">
        <div className="py-4 sm:py-6 space-y-4 sm:space-y-6">
            {/* Order Header */}
            <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-foreground">Order #{order.orderNumber}</h2>
                  {order.originalOrderId && order.originalOrderNumber && (
                    <p className="text-sm text-blue-600 dark:text-blue-400 mt-0.5">
                      Replacement for{' '}
                      <Link href={bp(`/business/account/orders/${order.originalOrderId}`)} className="underline hover:text-blue-800 dark:hover:text-blue-300">
                        #{order.originalOrderNumber}
                      </Link>
                    </p>
                  )}
                  <p className="text-sm text-foreground-secondary mt-1">
                    Placed on {new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} at{' '}
                    {new Date(order.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                    {statusLabel(order.status)}
                  </span>
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium capitalize ${getPaymentStatusColor(order.paymentStatus)}`}>
                    Payment: {order.paymentStatus}
                  </span>
                  {CANCELLABLE_STATUSES.includes(order.status) && (
                    <button
                      type="button"
                      onClick={handleCancelOrder}
                      disabled={isCancelling}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500 hover:bg-red-600 text-white shadow-sm transition-colors disabled:opacity-50"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      {order.status === 'pending' && order.paymentStatus === 'unpaid' ? 'Cancel Order' : 'Request Cancellation'}
                    </button>
                  )}
                  {order.invoiceNumber && !order.originalOrderId && order.viewToken && (
                    <a
                      href={`/invoice/${order.viewToken}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent-500 hover:bg-accent-600 text-white shadow-sm transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                      View Invoice
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Status banners */}
            {order.status === 'cancel_requested' && (
              <div className="bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
                <div className="flex gap-3">
                  <svg className="w-5 h-5 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-orange-800 dark:text-orange-300 text-sm">Your cancellation request is pending review by our team.</p>
                </div>
              </div>
            )}

            {/* Tracking */}
            {order.awbNumber && (
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
                <div className="px-4 sm:px-6 py-4 border-b border-border-default flex items-center gap-2">
                  <svg className="w-5 h-5 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  <h3 className="text-base font-semibold text-foreground">Shipment Tracking</h3>
                </div>
                <div className="p-4 sm:p-6">
                  <DelhiveryTracking orderId={order.id} apiBase="/api/orders" headers={{ 'x-auth-portal': 'business' }} />
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
                          <img src={primaryImage.thumbnail_url || primaryImage.image_url} alt={item.productName} className="w-full h-full object-cover rounded-lg" />
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
                          <Link href={bp(`/business/products/${item.products.slug}`)} className="font-medium text-foreground hover:text-accent-600 dark:hover:text-accent-400 block">
                            {item.productName}
                          </Link>
                        ) : (
                          <p className="font-medium text-foreground">{item.productName}</p>
                        )}
                        {item.variantName && (
                          <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-xs font-medium bg-accent-50 dark:bg-accent-900/30 text-accent-700 dark:text-accent-300 border border-accent-200 dark:border-accent-700">
                            {item.variantName}
                          </span>
                        )}
                        {item.subVariantName && (
                          <span className="inline-flex items-center mt-1 ml-1 px-2 py-0.5 rounded-full text-xs font-medium bg-surface-secondary text-foreground-secondary border border-border-default">
                            {item.subVariantName}
                          </span>
                        )}
                        {(() => {
                          const isFractional = item.buyUnit
                            ? CONTINUOUS_UNITS.has(item.buyUnit.toLowerCase())
                            : (item.buyMode === 'weight' || item.buyMode === 'length')
                          const qtyDisplay = isFractional
                            ? `${Number(item.quantity).toFixed(3)}${item.buyUnit ? ` ${item.buyUnit}` : ''}`
                            : `${Math.round(Number(item.quantity))}${item.buyUnit && item.buyUnit !== 'unit' ? ` ${item.buyUnit}` : ''}`
                          const priceUnitSuffix = item.buyUnit && item.buyUnit !== 'unit' ? ` / ${item.buyUnit}` : ''
                          return (
                            <>
                              <p className="text-sm text-foreground-secondary mt-1">Quantity: {qtyDisplay}</p>
                              <p className="text-sm font-semibold text-foreground mt-1">
                                {item.unitPrice.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}{priceUnitSuffix} × {qtyDisplay} = {item.totalPrice.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                              </p>
                            </>
                          )
                        })()}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Totals */}
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
                {order.discountAmount > 0 && (
                  <div className="flex justify-between text-sm text-green-600 dark:text-green-400 font-medium">
                    <span>Discount</span>
                    <span>−{order.discountAmount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                  </div>
                )}
                {order.businessDiscountAmount > 0 && (
                  <div className="flex justify-between text-sm text-green-600 dark:text-green-400 font-medium">
                    <span>Business Discount</span>
                    <span>−{order.businessDiscountAmount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                  </div>
                )}
                {order.shippingAmount > 0 && (
                  <div className="flex justify-between text-sm text-foreground-secondary">
                    <span>Delivery</span>
                    <span>{order.shippingAmount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
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
                  {order.shippingAddress.address_line2 && <p>{order.shippingAddress.address_line2}</p>}
                  {order.shippingAddress.landmark && <p className="text-sm">Landmark: {order.shippingAddress.landmark}</p>}
                  <p>{order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postal_code}</p>
                  <p className="mt-2">Phone: {order.shippingAddress.phone}</p>
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

            {/* Payment banners */}
            {order.paymentStatus === 'paid' && (
              <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="flex gap-3">
                  <svg className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-green-800 dark:text-green-300 text-sm font-medium">Payment received. Thank you for your purchase!</p>
                </div>
              </div>
            )}

            {order.paymentStatus === 'unpaid' && isRazorpayEnabled && order.status !== 'cancelled' && order.status !== 'cancel_requested' && (
              <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex gap-3 flex-1">
                    <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <p className="text-blue-800 dark:text-blue-300 text-sm">Payment is pending. Pay online to confirm your order instantly.</p>
                      {timeLeft !== null && timeLeft > 0 && (
                        <p className="text-blue-900 dark:text-blue-200 text-sm font-bold mt-2">
                          Time remaining: {Math.floor(timeLeft / 60000)}:{String(Math.floor((timeLeft % 60000) / 1000)).padStart(2, '0')}
                        </p>
                      )}
                      {isAutoCancelling && <p className="text-blue-800 dark:text-blue-300 text-sm mt-2">Time expired. Cancelling order...</p>}
                    </div>
                  </div>
                  {!isAutoCancelling && (
                    <button type="button" onClick={handlePayNow} disabled={isPayingNow}
                      className="flex-shrink-0 px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold text-sm transition-colors disabled:bg-accent-300 disabled:cursor-not-allowed flex items-center">
                      {isPayingNow ? <><div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2" />Processing...</> : `Pay ₹${order.totalAmount.toLocaleString('en-IN')}`}
                    </button>
                  )}
                </div>
              </div>
            )}

            {order.paymentStatus === 'unpaid' && !isRazorpayEnabled && order.status !== 'cancelled' && order.status !== 'cancel_requested' && (
              <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <div className="flex gap-3">
                  <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-blue-800 dark:text-blue-300 text-sm">Our team will contact you to confirm your order and provide payment details.</p>
                </div>
              </div>
            )}

            {order.paymentStatus === 'failed' && isRazorpayEnabled && order.status !== 'cancelled' && order.status !== 'cancel_requested' && (
              <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex gap-3 flex-1">
                    <svg className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <p className="text-red-800 dark:text-red-300 text-sm">Payment failed. Please retry to complete your purchase.</p>
                      {timeLeft !== null && timeLeft > 0 && (
                        <p className="text-red-900 dark:text-red-200 text-sm font-bold mt-2">
                          Time remaining: {Math.floor(timeLeft / 60000)}:{String(Math.floor((timeLeft % 60000) / 1000)).padStart(2, '0')}
                        </p>
                      )}
                      {isAutoCancelling && <p className="text-red-800 dark:text-red-300 text-sm mt-2">Time expired. Cancelling order...</p>}
                    </div>
                  </div>
                  {!isAutoCancelling && (
                    <button type="button" onClick={handlePayNow} disabled={isPayingNow}
                      className="flex-shrink-0 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:bg-red-300 disabled:cursor-not-allowed flex items-center">
                      {isPayingNow ? <><div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2" />Processing...</> : 'Retry Payment'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {paymentError && (
              <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <p className="text-red-800 dark:text-red-300 text-sm">{paymentError}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-4">
              <Link href={bp('/business/account/orders')} className="flex-1 bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors text-center">
                View All Orders
              </Link>
              <Link href={bp('/business/products')} className="flex-1 bg-surface-elevated text-foreground-secondary px-6 py-3 rounded-lg border-2 border-border-secondary hover:bg-surface-secondary transition-colors text-center font-semibold">
                Continue Shopping
              </Link>
            </div>
          </div>
        </div>
      </div>
  )
}
