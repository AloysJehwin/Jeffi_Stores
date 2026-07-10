'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter, usePathname } from 'next/navigation'
import { use, useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useCart } from '@/contexts/CartContext'
import { navItems } from '@/components/visitor/AccountSidebar'
import CustomSelect from '@/components/visitor/CustomSelect'
import DelhiveryTracking from '@/components/DelhiveryTracking'
import ReviewModal from '@/components/shared/ReviewModal'

const CANCELLABLE_STATUSES = ['pending', 'confirmed', 'processing']
const RETURN_STATUSES = ['return_requested', 'return_approved', 'return_received', 'return_rejected', 'returned']
const isRazorpayEnabled = process.env.NEXT_PUBLIC_ENABLE_RAZORPAY === 'true'

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
  returnAllowed: boolean
  returnWindowDays: number
  replacementAllowed: boolean
  replacementWindowDays: number
  products: {
    slug: string
    extra_delivery_days?: number | null
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
  viewToken: string | null
  totalAmount: number
  subtotal: number
  taxAmount: number
  discountAmount: number
  shippingAmount: number
  status: string
  paymentStatus: string
  createdAt: string
  updatedAt: string
  deliveredAt: string | null
  notes: string | null
  trackingUrl: string | null
  awbNumber: string | null
  estimatedDeliveryDate: string | null
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

function UnitLabel({ label }: { label: string | null | undefined }) {
  if (!label) return null
  const match = label.match(/^(.+?)2$/)
  if (match) return <>{match[1]}<sup>2</sup></>
  return <>{label}</>
}

function resolveOrderEdd(order: OrderDetails): string | null {
  if (!order.estimatedDeliveryDate) return null
  return new Date(order.estimatedDeliveryDate + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' })
}
function getEddDisplay(order: OrderDetails, edd: string): { label: string; sub: string; color: string } {
  if (order.status === 'delivered') {
    return { label: 'Delivered', sub: order.deliveredAt ? new Date(order.deliveredAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : edd, color: 'text-green-600 dark:text-green-400' }
  }
  if (order.status === 'out_for_delivery') {
    return { label: 'Arriving Today', sub: 'Out for delivery', color: 'text-accent-500' }
  }
  const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  todayIST.setHours(0, 0, 0, 0)
  const eddDate = new Date(edd + ' 00:00:00')
  const diffDays = Math.round((eddDate.getTime() - todayIST.getTime()) / 86400000)
  if (diffDays === 0) return { label: 'Arriving Today', sub: edd, color: 'text-accent-500' }
  if (diffDays === 1) return { label: 'Arriving Tomorrow', sub: edd, color: 'text-accent-500' }
  if (diffDays < 0) return { label: 'Expected by ' + edd, sub: 'Delivery delayed', color: 'text-orange-500 dark:text-orange-400' }
  return { label: 'Estimated Delivery', sub: edd, color: 'text-foreground' }
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
    case 'out_for_delivery':
      return 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300'
    case 'delivered':
      return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
    case 'cancel_requested':
      return 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300'
    case 'cancelled':
      return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
    case 'return_requested':
      return 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300'
    case 'return_approved':
    case 'return_received':
      return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
    case 'return_rejected':
      return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
    case 'returned':
      return 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300'
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

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user, isLoading: authLoading } = useAuth()
  const avatarUrl = user?.avatarUrl ?? null
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
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  const [isAutoCancelling, setIsAutoCancelling] = useState(false)
  const autoCancelTriggeredRef = useRef(false)
  const { refreshCart } = useCart()

  const [returnRequest, setReturnRequest] = useState<{
    id: string; type: string; status: string; reason: string;
    description?: string | null; admin_notes?: string | null;
    replacement_order_id?: string | null; replacement_order_number?: string | null;
    rvp_awb_number?: string | null;
  } | null>(null)
  const [monthlyLimitReached, setMonthlyLimitReached] = useState(false)
  const [showReturnForm, setShowReturnForm] = useState(false)
  const [returnType, setReturnType] = useState<'refund' | 'replacement'>('refund')
  const [returnReason, setReturnReason] = useState('')
  const [returnDescription, setReturnDescription] = useState('')
  const [isSubmittingReturn, setIsSubmittingReturn] = useState(false)
  const [returnError, setReturnError] = useState('')
  const [returnSuccess, setReturnSuccess] = useState('')
  const [returnImages, setReturnImages] = useState<File[]>([])
  const [returnImagePreviews, setReturnImagePreviews] = useState<string[]>([])
  const [isUploadingImages, setIsUploadingImages] = useState(false)

  const [reviewMap, setReviewMap] = useState<Record<string, { id: string; rating: number; title: string | null; comment: string; tags: string[]; image_urls: string[]; image_thumbnail_urls: string[] }>>({})
  const [showReviewModal, setShowReviewModal] = useState(false)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push(`/login?redirect=/account/orders/${id}`)
      return
    }
    if (user) {
      fetchOrder()
    }
  }, [user, authLoading, router])

  const fetchOrder = async () => {
    try {
      const response = await fetch(`/api/orders/${id}`, { credentials: 'include' })
      if (!response.ok) {
        throw new Error('Failed to fetch order details')
      }
      const data = await response.json()
      setOrder(data.order)

      const revRes = await fetch(`/api/reviews?orderId=${id}`, { credentials: 'include' })
      if (revRes.ok) {
        const revData = await revRes.json()
        const map: typeof reviewMap = {}
        for (const r of (revData.reviews ?? [])) map[r.product_id] = r
        setReviewMap(map)
      }

      const retRes = await fetch(`/api/orders/${id}/return`, { credentials: 'include' })
      if (retRes.ok) {
        const retData = await retRes.json()
        setReturnRequest(retData.returnRequest || null)
        setMonthlyLimitReached(!!retData.monthlyLimitReached)
      }
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
      const response = await fetch(`/api/orders/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          restoreToCart: order?.orderType !== 'direct',
          autoCancelUnpaid: true,
        }),
      })
      if (response.ok) {
        await fetchOrder()
        await refreshCart()
      }
    } catch {
    } finally {
      setIsAutoCancelling(false)
    }
  }, [id])

  useEffect(() => {
    if (!order) return
    if (order.status === 'cancelled' || order.status === 'cancel_requested') return
    if (order.paymentStatus !== 'failed' && order.paymentStatus !== 'unpaid') return
    if (!isRazorpayEnabled) return

    const orderCreatedAt = new Date(order.createdAt).getTime()
    const deadline = orderCreatedAt + 10 * 60 * 1000

    const tick = () => {
      const remaining = Math.max(0, deadline - Date.now())
      setTimeLeft(remaining)

      if (remaining <= 0) {
        handleAutoCancel()
      }
    }

    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [order, handleAutoCancel])

  const handleCancelOrder = async () => {
    setIsCancelling(true)
    try {
      const response = await fetch(`/api/orders/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ restoreToCart: order?.orderType !== 'direct' }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to cancel order')
      }
      await fetchOrder()
      await refreshCart()
      setShowCancelConfirm(false)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsCancelling(false)
    }
  }

  const handleReturnImageAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const remaining = 3 - returnImages.length
    const toAdd = files.slice(0, remaining)
    setReturnImages(prev => [...prev, ...toAdd])
    toAdd.forEach(f => {
      const reader = new FileReader()
      reader.onload = ev => setReturnImagePreviews(prev => [...prev, ev.target?.result as string])
      reader.readAsDataURL(f)
    })
    e.target.value = ''
  }

  const handleReturnImageRemove = (idx: number) => {
    setReturnImages(prev => prev.filter((_, i) => i !== idx))
    setReturnImagePreviews(prev => prev.filter((_, i) => i !== idx))
  }

  const handleSubmitReturn = async () => {
    setIsSubmittingReturn(true)
    setReturnError('')
    setReturnSuccess('')
    if (!returnReason) {
      setReturnError('Please select a reason.')
      setIsSubmittingReturn(false)
      return
    }
    try {
      let uploadedUrls: string[] = []
      if (returnImages.length > 0) {
        setIsUploadingImages(true)
        for (const file of returnImages) {
          const fd = new FormData()
          fd.append('file', file)
          const res = await fetch(`/api/orders/${id}/return-images`, { method: 'POST', body: fd, credentials: 'include' })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || 'Image upload failed')
          uploadedUrls.push(data.url)
        }
        setIsUploadingImages(false)
      }
      const response = await fetch(`/api/orders/${id}/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type: returnType, reason: returnReason, description: returnDescription || undefined, image_urls: uploadedUrls }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to submit return request')
      setReturnSuccess('Your return request has been submitted. Our team will review it shortly.')
      setShowReturnForm(false)
      await fetchOrder()
    } catch (err: any) {
      setReturnError(err.message)
    } finally {
      setIsSubmittingReturn(false)
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

      const rzpResponse = await fetch('/api/razorpay/create-order', {
        method: 'POST',
        credentials: 'include',
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
              credentials: 'include',
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

            await fetchOrder()
            setIsPayingNow(false)
          } catch (err: any) {
            setPaymentError(err?.message || 'Payment received but verification failed. Please contact support — your payment is safe.')
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
      <div className="bg-surface min-h-screen">
        <div className="container mx-auto px-4">
          <div className="py-4 sm:py-6 space-y-4 sm:space-y-6 animate-pulse">
            {/* Order header skeleton */}
            <div className="bg-surface-elevated rounded-lg border border-border-default p-4 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="h-6 w-48 bg-surface-secondary rounded" />
                  <div className="h-4 w-64 bg-surface-secondary rounded" />
                </div>
                <div className="flex gap-2">
                  <div className="h-6 w-20 bg-surface-secondary rounded-full" />
                  <div className="h-6 w-24 bg-surface-secondary rounded-full" />
                </div>
              </div>
            </div>
            {/* Order items skeleton */}
            <div className="bg-surface-elevated rounded-lg border border-border-default p-4 sm:p-6 space-y-4">
              <div className="h-5 w-36 bg-surface-secondary rounded" />
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex gap-4 pb-4 border-b border-border-default last:border-b-0" style={{ animationDelay: `${i * 60}ms` }}>
                  <div className="w-20 h-20 bg-surface-secondary rounded-lg shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-surface-secondary rounded w-3/4" />
                    <div className="h-3 bg-surface-secondary rounded w-1/4" />
                    <div className="h-3 bg-surface-secondary rounded w-1/2" />
                  </div>
                </div>
              ))}
              {/* Totals skeleton */}
              <div className="pt-4 border-t-2 border-border-default space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex justify-between" style={{ animationDelay: `${i * 50}ms` }}>
                    <div className="h-4 w-20 bg-surface-secondary rounded" />
                    <div className="h-4 w-24 bg-surface-secondary rounded" />
                  </div>
                ))}
                <div className="flex justify-between pt-2">
                  <div className="h-6 w-12 bg-surface-secondary rounded" />
                  <div className="h-7 w-28 bg-surface-secondary rounded" />
                </div>
              </div>
            </div>
            {/* Shipping address skeleton */}
            <div className="bg-surface-elevated rounded-lg border border-border-default p-4 sm:p-6 space-y-3">
              <div className="h-5 w-40 bg-surface-secondary rounded" />
              <div className="h-4 w-32 bg-surface-secondary rounded" />
              <div className="h-4 w-56 bg-surface-secondary rounded" />
              <div className="h-4 w-44 bg-surface-secondary rounded" />
              <div className="h-4 w-36 bg-surface-secondary rounded" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!user) return null

  const canRefund = order?.status === 'delivered' && !returnRequest && order.items.length > 0 && (() => {
    const deliveryDate = order.deliveredAt || order.updatedAt
    if (!deliveryDate) return false
    if (order.items.some((item: OrderItem) => !item.returnAllowed)) return false
    const ts = new Date(deliveryDate).getTime()
    const minWindow = Math.min(...order.items.map((item: OrderItem) => item.returnWindowDays))
    return Date.now() <= ts + minWindow * 24 * 60 * 60 * 1000
  })()

  const canReplace = order?.status === 'delivered' && !returnRequest && order.items.length > 0 && (() => {
    const deliveryDate = order.deliveredAt || order.updatedAt
    if (!deliveryDate) return false
    if (order.items.some((item: OrderItem) => !item.replacementAllowed)) return false
    const ts = new Date(deliveryDate).getTime()
    const minWindow = Math.min(...order.items.map((item: OrderItem) => item.replacementWindowDays))
    return Date.now() <= ts + minWindow * 24 * 60 * 60 * 1000
  })()

  const canReturn = !monthlyLimitReached && (canRefund || canReplace)

  const returnWindowExpired = order?.status === 'delivered' && !returnRequest && !monthlyLimitReached && !(canRefund || canReplace) && (() => {
    const deliveryDate = order.deliveredAt || order.updatedAt
    if (!deliveryDate) return false
    const allAllowed = order.items.every((item: OrderItem) => item.returnAllowed || item.replacementAllowed)
    if (!allAllowed) return false
    const ts = new Date(deliveryDate).getTime()
    return order.items.every((item: OrderItem) => {
      const days = Math.max(item.returnWindowDays, item.replacementWindowDays)
      return Date.now() > ts + days * 24 * 60 * 60 * 1000
    })
  })()

  const MobileAccountHeader = () => (
    <>
      <div className="lg:hidden bg-accent-500 pt-8 pb-10 px-4">
        <h1 className="text-lg font-semibold text-white/80 mb-4">My Account</h1>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full overflow-hidden flex-shrink-0">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-white/20 flex items-center justify-center text-2xl font-bold text-white">
                {user?.firstName?.[0]?.toUpperCase() || 'U'}
              </div>
            )}
          </div>
          <div>
            <p className="text-xl font-bold text-white">{user?.firstName} {user?.lastName}</p>
            <p className="text-sm text-white/70 mt-0.5">{user?.email}</p>
          </div>
        </div>
      </div>
      <div className="lg:hidden relative z-10 mx-4 -mt-8 mb-4">
        <div className="bg-surface-elevated rounded-xl shadow-md border border-border-default overflow-hidden">
          <div className="flex">
            {navItems.map((item) => {
              const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors border-b-2 ${
                    isActive
                      ? 'text-accent-600 border-accent-500 dark:text-accent-400'
                      : 'text-foreground-muted border-transparent'
                  }`}
                >
                  <span className={isActive ? 'text-accent-500' : 'text-foreground-muted'}>{item.icon}</span>
                  <span className="leading-tight text-center" style={{ fontSize: '10px' }}>{item.label}</span>
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )

  if (error || !order) {
    return (
      <div className="bg-surface min-h-screen">
        <MobileAccountHeader />
        <div className="container mx-auto px-4">
          <div className="py-4">
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
    )
  }

  return (
    <>
    <div className="bg-surface min-h-screen">
      <MobileAccountHeader />
      <div className="container mx-auto px-4 pb-8">
        <div className="py-4 sm:py-6 space-y-4 sm:space-y-6">
            {/* Order Header */}
            <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-foreground">
                    Order #{order.orderNumber}
                  </h2>
                  {order.originalOrderId && order.originalOrderNumber && (
                    <p className="text-sm text-blue-600 dark:text-blue-400 mt-0.5">
                      Replacement for{' '}
                      <a href={`/account/orders/${order.originalOrderId}`} className="underline hover:text-blue-800 dark:hover:text-blue-300">
                        #{order.originalOrderNumber}
                      </a>
                    </p>
                  )}
                  <p className="text-sm text-foreground-secondary mt-1">
                    Placed on {new Date(order.createdAt).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })} at {new Date(order.createdAt).toLocaleTimeString('en-IN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Asia/Kolkata',
                    })}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                    {order.status === 'cancel_requested' ? 'Cancellation Requested'
                      : order.status === 'cancel_rejected' ? 'Cancellation Rejected'
                      : order.status === 'out_for_delivery' ? 'Out for Delivery'
                      : order.status === 'return_requested' ? 'Return Requested'
                      : order.status === 'return_approved' ? 'Return Approved'
                      : order.status === 'return_received' ? 'Return Received'
                      : order.status === 'return_rejected' ? 'Return Rejected'
                      : order.status === 'returned' ? 'Returned'
                      : order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                  </span>
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium capitalize ${getPaymentStatusColor(order.paymentStatus)}`}>
                    Payment: {order.paymentStatus}
                  </span>
                  {(CANCELLABLE_STATUSES.includes(order.status) || (canReturn && !showReturnForm) || returnWindowExpired || monthlyLimitReached || (order.invoiceNumber && !order.originalOrderId)) && (
                    <span className="hidden sm:inline-block w-px h-5 bg-border-default mx-1" aria-hidden />
                  )}
                  {CANCELLABLE_STATUSES.includes(order.status) && (
                    <button
                      type="button"
                      onClick={() => setShowCancelConfirm(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500 hover:bg-red-600 text-white shadow-sm transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      {order.status === 'pending' && order.paymentStatus === 'unpaid' ? 'Cancel Order' : 'Request Cancellation'}
                    </button>
                  )}
                  {canReturn && !showReturnForm && (
                    <button
                      type="button"
                      onClick={() => {
                        setReturnType(canRefund ? 'refund' : 'replacement')
                        setShowReturnForm(true)
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-orange-500 hover:bg-orange-600 text-white shadow-sm transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                      {canRefund && canReplace ? 'Request Return / Replacement' : canRefund ? 'Request Return' : 'Request Replacement'}
                    </button>
                  )}
                  {returnWindowExpired && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 italic">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      Return window closed
                    </span>
                  )}
                  {monthlyLimitReached && (canRefund || canReplace) && !returnRequest && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 italic">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      Monthly return limit reached
                    </span>
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

            {/* Return Status Banners */}
            {returnSuccess && (
              <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <p className="text-green-800 dark:text-green-300 text-sm">{returnSuccess}</p>
              </div>
            )}

            {order.status === 'return_requested' && (
              <div className="bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
                <div className="flex gap-3">
                  <svg className="w-5 h-5 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-orange-800 dark:text-orange-300 text-sm">Return request submitted — awaiting admin review.</p>
                </div>
              </div>
            )}

            {order.status === 'return_approved' && (
              <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <p className="text-blue-800 dark:text-blue-300 text-sm font-medium">Return Approved</p>
                <p className="text-blue-700 dark:text-blue-300 text-sm mt-1">Please ship the item back. A team member will contact you with return shipping instructions.</p>
              </div>
            )}

            {order.status === 'return_received' && (
              <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <p className="text-blue-800 dark:text-blue-300 text-sm">Item received — processing your {returnRequest?.type === 'replacement' ? 'replacement order' : 'refund'}.</p>
              </div>
            )}

            {order.status === 'return_rejected' && (
              <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <p className="text-red-800 dark:text-red-300 text-sm font-medium">Return Request Rejected</p>
                {returnRequest?.admin_notes && (
                  <p className="text-red-700 dark:text-red-300 text-sm mt-1">{returnRequest.admin_notes}</p>
                )}
              </div>
            )}

            {order.status === 'returned' && (
              <div className="bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
                <p className="text-purple-800 dark:text-purple-300 text-sm font-medium">Resolved</p>
                {returnRequest?.type === 'replacement' && returnRequest.replacement_order_id ? (
                  <p className="text-purple-700 dark:text-purple-300 text-sm mt-1">
                    Your replacement order{' '}
                    <a href={`/account/orders/${returnRequest.replacement_order_id}`} className="underline font-medium">
                      #{returnRequest.replacement_order_number || returnRequest.replacement_order_id.slice(0, 8)}
                    </a>{' '}
                    has been created and confirmed.
                  </p>
                ) : (
                  <p className="text-purple-700 dark:text-purple-300 text-sm mt-1">
                    Your refund has been processed. It may take 5–7 business days to reflect in your account.
                  </p>
                )}
              </div>
            )}

            {/* Return Request Form */}
            {showReturnForm && (
              <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4 sm:p-6">
                <h3 className="text-lg font-bold text-orange-900 dark:text-orange-300 mb-4">{canRefund && canReplace ? 'Request Return / Replacement' : canRefund ? 'Request Return' : 'Request Replacement'}</h3>
                {returnError && (
                  <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-300 text-sm">
                    {returnError}
                  </div>
                )}
                <div className="space-y-4">
                  {canRefund && canReplace && (
                    <div>
                      <p className="text-sm font-medium text-foreground-secondary mb-2">What would you like?</p>
                      <div className="flex gap-3">
                        {(['refund', 'replacement'] as const)
                          .map((t) => (
                          <label key={t} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="returnType"
                              value={t}
                              checked={returnType === t}
                              onChange={() => setReturnType(t)}
                              className="accent-accent-500"
                            />
                            <span className="text-sm text-foreground capitalize">{t}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-foreground-secondary mb-1">Reason</label>
                    <CustomSelect
                      value={returnReason}
                      placeholder="Select a reason…"
                      options={[
                        { value: 'defective', label: 'Defective product' },
                        { value: 'wrong_item', label: 'Wrong item sent' },
                        { value: 'not_as_described', label: 'Not as described' },
                        { value: 'damaged', label: 'Damaged in transit' },
                        { value: 'other', label: 'Other' },
                      ]}
                      onChange={val => setReturnReason(val)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground-secondary mb-1">Description <span className="text-foreground-muted">(optional)</span></label>
                    <textarea
                      value={returnDescription}
                      onChange={e => setReturnDescription(e.target.value)}
                      rows={3}
                      maxLength={500}
                      placeholder="Please describe the issue in detail..."
                      className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm resize-none"
                    />
                    <p className="text-xs text-foreground-muted mt-1">{returnDescription.length}/500</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground-secondary mb-1">
                      Photos <span className="text-foreground-muted">(optional, up to 3)</span>
                    </label>
                    <div className="flex gap-2 flex-wrap">
                      {returnImagePreviews.map((src, i) => (
                        <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-border-secondary">
                          <img src={src} alt="" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => handleReturnImageRemove(i)}
                            className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center text-white text-xs"
                          >✕</button>
                        </div>
                      ))}
                      {returnImages.length < 3 && (
                        <label className="w-20 h-20 flex flex-col items-center justify-center border-2 border-dashed border-border-secondary rounded-lg cursor-pointer hover:border-accent-400 transition-colors text-foreground-muted hover:text-accent-500">
                          <svg className="w-6 h-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                          </svg>
                          <span className="text-xs">Add</span>
                          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleReturnImageAdd} />
                        </label>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleSubmitReturn}
                      disabled={isSubmittingReturn}
                      className="flex-1 px-4 py-2.5 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold text-sm transition-colors disabled:bg-accent-300 disabled:cursor-not-allowed flex items-center justify-center"
                    >
                      {isSubmittingReturn ? (
                        <>
                          <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                          {isUploadingImages ? 'Uploading photos...' : 'Submitting...'}
                        </>
                      ) : 'Submit Request'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowReturnForm(false); setReturnError(''); setReturnImages([]); setReturnImagePreviews([]) }}
                      disabled={isSubmittingReturn}
                      className="px-4 py-2.5 bg-surface-elevated hover:bg-surface-secondary text-foreground-secondary rounded-lg font-medium text-sm border border-border-secondary transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Estimated Delivery */}
            {!['cancelled', 'returned'].includes(order.status) && (() => { const edd = resolveOrderEdd(order); if (!edd) return null; const { label, sub, color } = getEddDisplay(order, edd); return (
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default px-4 sm:px-6 py-4 flex items-center gap-3">
                <svg className="w-5 h-5 text-accent-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <div>
                  <p className={`text-sm font-semibold ${color}`}>{label}</p>
                  <p className="text-xs text-foreground-muted">{sub}</p>
                </div>
              </div>
            ) })()}

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
                  <DelhiveryTracking orderId={order.id} apiBase="/api/orders" />
                </div>
              </div>
            )}

            {/* Return Shipment Tracking */}
            {RETURN_STATUSES.includes(order.status) && returnRequest?.rvp_awb_number && (
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
                <div className="px-4 sm:px-6 py-4 border-b border-border-default flex items-center gap-2">
                  <svg className="w-5 h-5 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                  </svg>
                  <h3 className="text-base font-semibold text-foreground">Return Shipment Tracking</h3>
                </div>
                <div className="p-4 sm:p-6">
                  <DelhiveryTracking orderId={order.id} apiBase="/api/orders" trackPath="track-rvp" />
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
                          const isFractional = (item.buyMode && item.buyMode !== 'unit') || (item.buyUnit && item.buyUnit !== 'unit')
                          const unitLabel = item.buyUnit && item.buyUnit !== 'unit' ? item.buyUnit : (item.buyMode && item.buyMode !== 'unit' ? item.buyMode : null)
                          const qtyDisplay = isFractional
                            ? Number(Number(item.quantity).toFixed(6)).toString()
                            : String(Math.round(Number(item.quantity)))
                          return (
                            <>
                              <p className="text-sm text-foreground-secondary mt-1">
                                Quantity: {qtyDisplay}{unitLabel ? <> <UnitLabel label={unitLabel} /></> : ''}
                              </p>
                              <p className="text-sm font-semibold text-foreground mt-1">
                                {item.unitPrice.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}{unitLabel ? <> / <UnitLabel label={unitLabel} /></> : ''} x {qtyDisplay}{unitLabel ? <> <UnitLabel label={unitLabel} /></> : ''} = {item.totalPrice.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                              </p>
                            </>
                          )
                        })()}
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
                {order.discountAmount > 0 && (
                  <div className="flex justify-between text-sm text-green-600 dark:text-green-400 font-medium">
                    <span>Discount</span>
                    <span>−{order.discountAmount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
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

            {/* Rate Your Order */}
            {order.status === 'delivered' && (
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base font-bold text-foreground">Rate Your Order</h3>
                    <p className="text-sm text-foreground-muted mt-0.5">
                      {order.items.every(item => reviewMap[item.productId])
                        ? 'You have reviewed all items in this order.'
                        : 'Share your experience with the products you received.'}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowReviewModal(true)}
                    className="flex-shrink-0 px-4 py-2 rounded-lg bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold transition-colors"
                  >
                    {order.items.every(item => reviewMap[item.productId]) ? 'Edit Reviews' : 'Write Reviews'}
                  </button>
                </div>
                {order.items.some(item => reviewMap[item.productId]) && (
                  <div className="mt-4 pt-4 border-t border-border-default flex flex-wrap gap-3">
                    {order.items.filter(item => reviewMap[item.productId]).map(item => {
                      const r = reviewMap[item.productId]
                      return (
                        <div key={item.productId} className="flex items-center gap-2 text-xs text-foreground-secondary">
                          <span className="text-yellow-400 text-sm">{'★'.repeat(r.rating)}<span className="text-gray-300">{'★'.repeat(5 - r.rating)}</span></span>
                          <span className="font-medium text-foreground truncate max-w-[140px]">{item.productName}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

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
                  <div className="flex gap-3 flex-1">
                    <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <p className="text-blue-800 dark:text-blue-300 text-sm">
                        Payment is pending for this order. Pay online to confirm your order instantly.
                      </p>
                      {timeLeft !== null && timeLeft > 0 && (
                        <p className="text-blue-900 dark:text-blue-200 text-sm font-bold mt-2">
                          Time remaining to pay: {Math.floor(timeLeft / 60000)}:{String(Math.floor((timeLeft % 60000) / 1000)).padStart(2, '0')}
                        </p>
                      )}
                      {isAutoCancelling && (
                        <p className="text-blue-800 dark:text-blue-300 text-sm mt-2">
                          Time expired. Cancelling order and restoring items to your cart...
                        </p>
                      )}
                    </div>
                  </div>
                  {!isAutoCancelling && (
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
                  <p className="text-blue-800 dark:text-blue-300 text-sm">
                    Our team will contact you to confirm your order and provide payment details. For queries, call +91 96853 54099 or email jeffistoress@gmail.com.
                  </p>
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
                      <p className="text-red-800 dark:text-red-300 text-sm">
                        Payment failed for this order. Please retry to complete your purchase.
                      </p>
                      {timeLeft !== null && timeLeft > 0 && (
                        <p className="text-red-900 dark:text-red-200 text-sm font-bold mt-2">
                          Time remaining to pay: {Math.floor(timeLeft / 60000)}:{String(Math.floor((timeLeft % 60000) / 1000)).padStart(2, '0')}
                        </p>
                      )}
                      {isAutoCancelling && (
                        <p className="text-red-800 dark:text-red-300 text-sm mt-2">
                          Time expired. Cancelling order and restoring items to your cart...
                        </p>
                      )}
                    </div>
                  </div>
                  {!isAutoCancelling && (
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
                  )}
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
      {showReviewModal && (
        <ReviewModal
          items={order.items.map(item => ({
            productId: item.productId,
            productName: item.productName,
            productImage: item.products?.product_images?.find(img => img.is_primary)?.thumbnail_url
              || item.products?.product_images?.[0]?.thumbnail_url
              || null,
          }))}
          orderId={id}
          reviewMap={reviewMap}
          onClose={() => setShowReviewModal(false)}
          onSuccess={(productId, review) => {
            setReviewMap(prev => ({ ...prev, [productId]: review }))
          }}
        />
      )}
    </>
  )
}
