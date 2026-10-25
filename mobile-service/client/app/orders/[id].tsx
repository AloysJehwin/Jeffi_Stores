import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { KeyboardScroll } from '../../src/ui/KeyboardScroll'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import RazorpayCheckout from 'react-native-razorpay'
import TopNav from '../../src/components/layout/TopNav'
import { api } from '../../src/api/client'
import { createRazorpayOrder, verifyPayment } from '../../src/api/razorpay'
import {
  cancelOrderWith,
  confirmOrderChange,
  getOrderDetails,
  getOrderReviews,
  getReturnInfo,
  rejectAdjustment,
  rejectVariantChange,
  submitReturnRequest,
  type OrderDetails,
  type OrderReview,
} from '../../src/api/account'
import AccountMobileHeader from '../../src/components/account/AccountMobileHeader'
import HeroIcon, { TintIcon, type HeroIconName } from '../../src/components/account/HeroIcon'
import OrderAddressChange from '../../src/components/account/OrderAddressChange'
import OrderTracking from '../../src/components/account/OrderTracking'
import ReviewModal from '../../src/components/account/ReviewModal'
import { useRequireAuth } from '../../src/components/account/hooks'
import { NEUTRAL_TONE, ORDER_STATUS_TONE, orderStatusLabel, Pulse, Select, StatusPill } from '../../src/components/account/ui'
import WarningBadges from '../../src/components/cart/WarningBadges'
import { useStoreConfig } from '../../src/hooks/useStoreConfig'
import { absUrl } from '../../src/lib/links'
import { useCartStore } from '../../src/stores/cartStore'
import { showToast } from '../../src/stores/toastStore'
import { accent, useTokens } from '../../src/theme'

// Mirror of controller-service app/(storefront)/account/orders/[id]/page.tsx.

const RAZORPAY_ENABLED = process.env.EXPO_PUBLIC_ENABLE_RAZORPAY !== 'false'
const ROOT_DOMAIN = (process.env.EXPO_PUBLIC_ROOT_DOMAIN || 'jeffistores.in').replace(/^\.+|\/+$/g, '')
const CANCELLABLE_STATUSES = ['pending', 'confirmed', 'processing']
const RETURN_STATUSES = ['return_requested', 'return_approved', 'return_received', 'return_rejected', 'returned']
const DAY = 24 * 60 * 60 * 1000
const CARD = 'bg-surface-elevated rounded-lg border border-border-default p-4'
const SHADOW = { boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)' }
const REASONS = [
  { value: 'defective', label: 'Defective product' },
  { value: 'wrong_item', label: 'Wrong item sent' },
  { value: 'not_as_described', label: 'Not as described' },
  { value: 'damaged', label: 'Damaged in transit' },
  { value: 'other', label: 'Other' },
]

const inrCur = (n: number) => Number(n).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })
const inrPlain = (n: number | string) => parseFloat(String(n)).toLocaleString('en-IN', { maximumFractionDigits: 2 })
const fmtQty = (q: number) => Number(Number(q).toFixed(3)).toString()
const unitText = (label: string | null) => (label ? label.replace(/^(.+?)2$/, '$1²') : '')
const invoiceUrl = (slug: string | null, token: string) => `https://${slug ? `invoice-${slug}` : 'invoice'}.${ROOT_DOMAIN}/${token}`

function resolveOrderEdd(order: OrderDetails): string | null {
  if (!order.estimatedDeliveryDate) return null
  return new Date(order.estimatedDeliveryDate + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' })
}

function getEddDisplay(order: OrderDetails, edd: string): { label: string; sub: string; color: string } {
  if (order.status === 'delivered')
    return {
      label: 'Delivered',
      sub: order.deliveredAt ? new Date(order.deliveredAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : edd,
      color: 'text-green-600 dark:text-green-400',
    }
  if (order.status === 'out_for_delivery') return { label: 'Arriving Today', sub: 'Out for delivery', color: 'text-accent-500' }
  const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  todayIST.setHours(0, 0, 0, 0)
  const eddDate = new Date(String(order.estimatedDeliveryDate).slice(0, 10) + 'T00:00:00Z')
  const diffDays = Math.round((eddDate.getTime() - todayIST.getTime()) / 86400000)
  if (diffDays === 0) return { label: 'Arriving Today', sub: edd, color: 'text-accent-500' }
  if (diffDays === 1) return { label: 'Arriving Tomorrow', sub: edd, color: 'text-accent-500' }
  if (diffDays < 0) return { label: 'Expected by ' + edd, sub: 'Delivery delayed', color: 'text-orange-500 dark:text-orange-400' }
  if (order.courierEdd && order.courierEdd === String(order.estimatedDeliveryDate).slice(0, 10)) return { label: 'Expected by ' + edd, sub: 'Courier estimate', color: 'text-foreground' }
  return { label: 'Estimated Delivery', sub: edd, color: 'text-foreground' }
}

const BANNER = {
  orange: { box: 'bg-orange-50 dark:bg-orange-900/30 border-orange-200 dark:border-orange-800', text: 'text-orange-800 dark:text-orange-300', icon: 'text-orange-600 dark:text-orange-400' },
  blue: { box: 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800', text: 'text-blue-800 dark:text-blue-300', icon: 'text-blue-600 dark:text-blue-400' },
  red: { box: 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800', text: 'text-red-800 dark:text-red-300', icon: 'text-red-600 dark:text-red-400' },
  green: { box: 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800', text: 'text-green-800 dark:text-green-300', icon: 'text-green-600 dark:text-green-400' },
  purple: { box: 'bg-purple-50 dark:bg-purple-900/30 border-purple-200 dark:border-purple-800', text: 'text-purple-800 dark:text-purple-300', icon: 'text-purple-600 dark:text-purple-400' },
}
type Tone = keyof typeof BANNER

function Banner({ tone, icon, children }: { tone: Tone; icon?: HeroIconName; children: ReactNode }) {
  const b = BANNER[tone]
  return (
    <View className={`border rounded-lg p-4 ${b.box}`}>
      <View className="flex-row gap-3">
        {icon && (
          <View className="mt-0.5">
            <TintIcon name={icon} size={20} className={b.icon} />
          </View>
        )}
        <View className="flex-1">{children}</View>
      </View>
    </View>
  )
}

function ActionPill({ label, icon, bg, onPress, disabled }: { label: string; icon?: HeroIconName; bg: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} className={`flex-row items-center gap-1.5 px-3 py-1.5 rounded-lg ${bg} ${disabled ? 'opacity-50' : ''}`} style={SHADOW}>
      {icon && <HeroIcon name={icon} size={14} color="white" />}
      <Text className="text-xs font-semibold text-white">{label}</Text>
    </Pressable>
  )
}

function Skeleton() {
  return (
    <View className="px-4 py-4 gap-4">
      <View className={CARD}>
        <Pulse className="h-6 w-48 bg-surface-secondary rounded mb-2" />
        <Pulse className="h-4 w-64 bg-surface-secondary rounded mb-3" />
        <View className="flex-row gap-2">
          <Pulse className="h-6 w-20 bg-surface-secondary rounded-full" />
          <Pulse className="h-6 w-24 bg-surface-secondary rounded-full" />
        </View>
      </View>
      <View className={CARD}>
        <Pulse className="h-5 w-40 bg-surface-secondary rounded mb-4" />
        {[0, 1].map(i => (
          <View key={i} className="flex-row gap-4 mb-4">
            <Pulse className="w-20 h-20 bg-surface-secondary rounded-lg" />
            <View className="flex-1 gap-2">
              <Pulse className="h-4 w-3/4 bg-surface-secondary rounded" />
              <Pulse className="h-3 w-1/2 bg-surface-secondary rounded" />
              <Pulse className="h-4 w-1/3 bg-surface-secondary rounded" />
            </View>
          </View>
        ))}
      </View>
      <Pulse className="h-32 bg-surface-elevated rounded-lg border border-border-default" />
    </View>
  )
}

export default function OrderDetailScreen() {
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const qc = useQueryClient()
  const t = useTokens()
  const user = useRequireAuth()
  const config = useStoreConfig()
  const storeIdentity = config.identity
  const isRazorpayEnabled = config.flags.razorpayEnabled && RAZORPAY_ENABLED
  const orderAutoCancelMinutes = Number((config as { orderAutoCancelMinutes?: number }).orderAutoCancelMinutes ?? 10)
  const resetCart = useCartStore(s => s.reset)

  const orderQ = useQuery({ queryKey: ['order', id], queryFn: () => getOrderDetails(id), enabled: !!user && !!id, retry: 0 })
  const reviewsQ = useQuery({ queryKey: ['order-reviews', id], queryFn: () => getOrderReviews(id), enabled: !!orderQ.data })
  const returnQ = useQuery({ queryKey: ['order-return', id], queryFn: () => getReturnInfo(id), enabled: !!orderQ.data })
  const order = orderQ.data
  const reviewMap = reviewsQ.data ?? {}
  const returnRequest = returnQ.data?.returnRequest ?? null
  const monthlyLimitReached = !!returnQ.data?.monthlyLimitReached
  const refundBreakdown = returnQ.data?.refundBreakdown ?? null

  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [isPayingNow, setIsPayingNow] = useState(false)
  const [vcrBusy, setVcrBusy] = useState(false)
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  const [isAutoCancelling, setIsAutoCancelling] = useState(false)
  const autoCancelTriggeredRef = useRef(false)
  const [showReturnForm, setShowReturnForm] = useState(false)
  const [returnType, setReturnType] = useState<'refund' | 'replacement'>('refund')
  const [returnReason, setReturnReason] = useState('')
  const [returnDescription, setReturnDescription] = useState('')
  const [isSubmittingReturn, setIsSubmittingReturn] = useState(false)
  const [returnError, setReturnError] = useState('')
  const [returnSelectedItems, setReturnSelectedItems] = useState<Record<string, boolean>>({})
  const [showReviewModal, setShowReviewModal] = useState(false)

  const fetchOrder = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['order', id] }),
      qc.invalidateQueries({ queryKey: ['order-return', id] }),
      qc.invalidateQueries({ queryKey: ['order-reviews', id] }),
    ])
    qc.invalidateQueries({ queryKey: ['orders'] })
    qc.invalidateQueries({ queryKey: ['orders-list'] })
  }, [qc, id])
  const refreshCart = () => qc.invalidateQueries({ queryKey: ['cart'] })

  const handleAutoCancel = useCallback(async () => {
    if (autoCancelTriggeredRef.current) return
    autoCancelTriggeredRef.current = true
    setIsAutoCancelling(true)
    try {
      await cancelOrderWith(id, { restoreToCart: order?.orderType !== 'direct', autoCancelUnpaid: true })
      await fetchOrder()
      refreshCart()
    } catch {
    } finally {
      setIsAutoCancelling(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, order?.orderType, fetchOrder])

  useEffect(() => {
    if (!order) return
    if (order.status === 'cancelled' || order.status === 'cancel_requested') return
    if (order.paymentStatus !== 'failed' && order.paymentStatus !== 'unpaid') return
    if (order.paymentMode === 'cod') return
    if (!isRazorpayEnabled) return
    const deadline = new Date(order.createdAt).getTime() + orderAutoCancelMinutes * 60 * 1000
    const tick = () => {
      const remaining = Math.max(0, deadline - Date.now())
      setTimeLeft(remaining)
      if (remaining <= 0) handleAutoCancel()
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [order, handleAutoCancel, orderAutoCancelMinutes, isRazorpayEnabled])

  const handleCancelOrder = async () => {
    setIsCancelling(true)
    try {
      await cancelOrderWith(id, { restoreToCart: order?.orderType !== 'direct' })
      await fetchOrder()
      refreshCart()
      setShowCancelConfirm(false)
    } catch (err: any) {
      showToast(err?.message || 'Failed to cancel order', 'error')
    } finally {
      setIsCancelling(false)
    }
  }

  const handleSubmitReturn = async () => {
    if (!order) return
    setReturnError('')
    if (!returnReason) return setReturnError('Please select a reason.')
    const selectedItemIds = Object.entries(returnSelectedItems)
      .filter(([, v]) => v)
      .map(([k]) => k)
    if (selectedItemIds.length === 0) return setReturnError('Please select at least one item to return.')
    setIsSubmittingReturn(true)
    try {
      // No image picker in the app: the request goes without photos.
      await submitReturnRequest(id, {
        type: returnType,
        reason: returnReason,
        description: returnDescription || undefined,
        image_urls: [],
        items: selectedItemIds.map(itemId => ({ order_item_id: itemId, quantity: order.items.find(i => i.id === itemId)!.quantity })),
      })
      showToast('Your return request has been submitted. Our team will review it shortly.', 'success')
      setShowReturnForm(false)
      setReturnSelectedItems({})
      await fetchOrder()
    } catch (err: any) {
      showToast(err?.message || 'Failed to submit return request', 'error')
    } finally {
      setIsSubmittingReturn(false)
    }
  }

  const prefill = () => ({ email: user?.email || '', contact: order?.shippingAddress?.phone || '', name: order?.shippingAddress?.full_name || '' })

  // The app's Razorpay retry flow (create-order → native Checkout → verify), on the web's copy.
  const handlePayNow = async () => {
    if (!order || !user) return
    setIsPayingNow(true)
    try {
      const rzp = await createRazorpayOrder({ orderId: order.id })
      const paymentData = await RazorpayCheckout.open({
        description: `Order #${order.orderNumber}`,
        currency: rzp.currency,
        key: rzp.key_id,
        amount: String(rzp.amount),
        order_id: rzp.razorpayOrderId,
        name: storeIdentity.name || 'Jeffi Stores',
        prefill: prefill(),
        theme: { color: accent[500] },
      })
      await verifyPayment({
        razorpay_order_id: paymentData.razorpay_order_id ?? rzp.razorpayOrderId,
        razorpay_payment_id: paymentData.razorpay_payment_id,
        razorpay_signature: paymentData.razorpay_signature ?? '',
        orderId: order.id,
      })
      resetCart()
      refreshCart()
      await fetchOrder()
    } catch (err: any) {
      if (err?.code !== 0) {
        api(`/api/orders/${order.id}/payment-failed`, {
          method: 'POST',
          body: JSON.stringify({ errorDescription: err?.description || err?.message || 'Payment failed' }),
        }).catch(() => {})
        showToast(err?.description ? `Payment failed: ${err.description}. Please try again.` : err?.message || 'Payment failed. Please try again.', 'error')
      }
      qc.invalidateQueries({ queryKey: ['order', id] })
    } finally {
      setIsPayingNow(false)
    }
  }

  // Confirm a proposed change; when extra is due, pay it in Checkout and verify.
  const confirmChange = async (path: string, label: string) => {
    if (!order) return
    setVcrBusy(true)
    try {
      const data = await confirmOrderChange(path)
      if (data.settlement === 'collect' && data.razorpayOrderId) {
        try {
          const r = await RazorpayCheckout.open({
            description: `${label} — Order #${order.orderNumber}`,
            currency: data.currency || 'INR',
            key: data.key_id || '',
            amount: String(data.amount ?? 0),
            order_id: data.razorpayOrderId,
            name: storeIdentity.name || 'Jeffi Stores',
            prefill: prefill(),
            theme: { color: accent[500] },
          })
          await verifyPayment({ razorpay_order_id: r.razorpay_order_id ?? data.razorpayOrderId, razorpay_payment_id: r.razorpay_payment_id, razorpay_signature: r.razorpay_signature ?? '' })
        } catch (err: any) {
          if (err?.code === 0) return
          throw new Error(err?.description ? `Payment failed: ${err.description}` : err?.message || 'Payment received but confirmation failed. Contact support — your payment is safe.')
        }
      }
      await fetchOrder()
    } catch (err: any) {
      showToast(err?.message || 'Failed to confirm change', 'error')
    } finally {
      setVcrBusy(false)
    }
  }

  const reject = async (fn: () => Promise<unknown>, fallback: string) => {
    setVcrBusy(true)
    try {
      await fn()
      await fetchOrder()
    } catch (err: any) {
      showToast(err?.message || fallback, 'error')
    } finally {
      setVcrBusy(false)
    }
  }

  if (!user || orderQ.isLoading) {
    return (
      <View className="flex-1 bg-surface">
        <TopNav />
        <ScrollView>
          <AccountMobileHeader />
          <Skeleton />
        </ScrollView>
      </View>
    )
  }

  if (orderQ.isError || !order) {
    return (
      <View className="flex-1 bg-surface">
        <TopNav />
        <ScrollView>
          <AccountMobileHeader />
          <View className="px-4 py-4">
            <View className={`${CARD} p-12 items-center`} style={SHADOW}>
              <Text className="text-xl font-semibold text-foreground mb-2">Order Not Found</Text>
              <Text className="text-foreground-secondary mb-6 text-center">{(orderQ.error as Error)?.message || 'Unable to load order details'}</Text>
              <Pressable onPress={() => router.replace('/orders')} className="px-6 py-3 bg-accent-500 rounded-lg">
                <Text className="text-white font-semibold">View All Orders</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </View>
    )
  }

  const deliveryTs = (() => {
    const d = order.deliveredAt || order.updatedAt
    return d ? new Date(d).getTime() : 0
  })()
  const delivered = order.status === 'delivered' && !returnRequest && order.items.length > 0 && !!deliveryTs
  const canRefund = delivered && order.items.some(i => i.returnAllowed && Date.now() <= deliveryTs + i.returnWindowDays * DAY)
  const canReplace = delivered && order.items.some(i => i.replacementAllowed && Date.now() <= deliveryTs + i.replacementWindowDays * DAY)
  const canReturn = !monthlyLimitReached && (canRefund || canReplace)
  const returnWindowExpired =
    delivered &&
    !monthlyLimitReached &&
    !(canRefund || canReplace) &&
    (() => {
      const eligible = order.items.filter(i => i.returnAllowed || i.replacementAllowed)
      return eligible.length > 0 && eligible.every(i => Date.now() > deliveryTs + Math.max(i.returnWindowDays, i.replacementWindowDays) * DAY)
    })()
  const unpaidPending = order.status === 'pending' && order.paymentStatus === 'unpaid'
  const notCancelled = order.status !== 'cancelled' && order.status !== 'cancel_requested'
  const showInvoice = !!order.invoiceNumber && !order.originalOrderId && !!order.viewToken && (order.paymentStatus === 'paid' || order.paymentStatus === 'cod_collected')
  const allReviewed = order.items.every(i => reviewMap[i.productId])
  const countdown = timeLeft !== null && timeLeft > 0 ? `${Math.floor(timeLeft / 60000)}:${String(Math.floor((timeLeft % 60000) / 1000)).padStart(2, '0')}` : null
  const thumbOf = (item: OrderDetails['items'][number]) => {
    const img = item.products?.product_images?.find(i => i.is_primary) || item.products?.product_images?.[0]
    return img ? absUrl(img.thumbnail_url || img.image_url) : null
  }

  const a = order.pendingAdjustment
  const vc = order.pendingVariantChange

  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      <KeyboardScroll contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <AccountMobileHeader />
        <View className="px-4 py-4 gap-4">
          {/* Order header */}
          <View className={CARD} style={SHADOW}>
            <Text className="text-xl font-bold text-foreground">Order #{order.orderNumber}</Text>
            {!!order.originalOrderId && !!order.originalOrderNumber && (
              <Text className="text-sm text-blue-600 dark:text-blue-400 mt-0.5">
                Replacement for{' '}
                <Text className="underline" onPress={() => router.push(`/orders/${order.originalOrderId}`)}>
                  #{order.originalOrderNumber}
                </Text>
              </Text>
            )}
            <Text className="text-sm text-foreground-secondary mt-1">
              Placed on {new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} at{' '}
              {new Date(order.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
            </Text>
            <View className="flex-row flex-wrap items-center gap-2 mt-4">
              <StatusPill tone={ORDER_STATUS_TONE[order.status] ?? NEUTRAL_TONE} label={order.status === 'returned' ? 'Returned' : orderStatusLabel(order.status)} className="px-2.5 py-1" />
              <StatusPill tone={ORDER_STATUS_TONE[order.paymentStatus] ?? NEUTRAL_TONE} label={`Payment: ${order.paymentStatus}`} className="px-2.5 py-1" textClass="text-xs font-medium capitalize" />
              {CANCELLABLE_STATUSES.includes(order.status) && !order.hasDigital && (
                <ActionPill label={unpaidPending ? 'Cancel Order' : 'Request Cancellation'} icon="x" bg="bg-red-500" onPress={() => setShowCancelConfirm(true)} />
              )}
              {canReturn && !showReturnForm && (
                <ActionPill
                  label={canRefund && canReplace ? 'Request Return / Replacement' : canRefund ? 'Request Return' : 'Request Replacement'}
                  icon="returnArrow"
                  bg="bg-orange-500"
                  onPress={() => {
                    setReturnType(canRefund ? 'refund' : 'replacement')
                    setShowReturnForm(true)
                  }}
                />
              )}
              {returnWindowExpired && (
                <View className="flex-row items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800/50">
                  <TintIcon name="clock" size={12} className="text-gray-500 dark:text-gray-400" />
                  <Text className="text-xs font-medium italic text-gray-500 dark:text-gray-400">Return window closed</Text>
                </View>
              )}
              {monthlyLimitReached && (canRefund || canReplace) && !returnRequest && (
                <View className="flex-row items-center gap-1 px-2.5 py-1 rounded-full bg-orange-100 dark:bg-orange-900/30">
                  <TintIcon name="clock" size={12} className="text-orange-700 dark:text-orange-300" />
                  <Text className="text-xs font-medium italic text-orange-700 dark:text-orange-300">Monthly return limit reached</Text>
                </View>
              )}
              {order.hasDigital && !!order.vaultUrl && <ActionPill label="Open my vault" bg="bg-green-600" onPress={() => Linking.openURL(order.vaultUrl!)} />}
              {showInvoice && <ActionPill label="View Invoice" icon="eye" bg="bg-accent-500" onPress={() => Linking.openURL(invoiceUrl(config.slug, order.viewToken!))} />}
            </View>
          </View>

          {showCancelConfirm && (
            <View className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <Text className="text-lg font-bold text-red-900 dark:text-red-300 mb-2">{unpaidPending ? 'Cancel this order?' : 'Request cancellation for this order?'}</Text>
              <Text className="text-red-800 dark:text-red-300 text-sm mb-4">
                {unpaidPending
                  ? 'This order will be cancelled immediately and stock will be restored. This action cannot be undone.'
                  : 'Your cancellation request will be sent to our team for review. You will be notified once it is approved or rejected.'}
              </Text>
              <View className="flex-row gap-3">
                <Pressable onPress={handleCancelOrder} disabled={isCancelling} className={`flex-row items-center px-4 py-2 rounded-lg ${isCancelling ? 'bg-red-300' : 'bg-red-600'}`}>
                  {isCancelling && <ActivityIndicator size="small" color="white" style={{ marginRight: 8 }} />}
                  <Text className="text-white font-medium text-sm">
                    {isCancelling ? (unpaidPending ? 'Cancelling...' : 'Submitting...') : unpaidPending ? 'Yes, Cancel Order' : 'Yes, Request Cancellation'}
                  </Text>
                </Pressable>
                <Pressable onPress={() => setShowCancelConfirm(false)} disabled={isCancelling} className="px-4 py-2 bg-surface-elevated rounded-lg border border-border-secondary">
                  <Text className="text-foreground-secondary font-medium text-sm">Keep Order</Text>
                </Pressable>
              </View>
            </View>
          )}

          {order.status === 'cancel_requested' && (
            <Banner tone="orange" icon="clock">
              <Text className="text-orange-800 dark:text-orange-300 text-sm">
                Your cancellation request is pending review by our team. You will receive an email once it is approved or rejected.
              </Text>
            </Banner>
          )}

          {a && (
            <View className="bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
              <Text className="font-semibold text-foreground">{a.status === 'awaiting_payment' ? 'Complete the payment to apply the changes' : 'Changes to your order need your approval'}</Text>
              <View className="mt-2 gap-1">
                {(a.lines || []).map((l, i) => {
                  const q = (n: number, u: string | null) => `${n}${u ? ` ${u}` : ''}`
                  return (
                    <Text key={i} className="text-sm text-foreground-secondary">
                      {l.action === 'remove' ? (
                        <>
                          Remove <Text className="line-through">{l.old.name}</Text> ({q(l.old.quantity, l.old.unit)})
                        </>
                      ) : l.action === 'quantity' ? (
                        <>
                          {l.old.name}: {q(l.old.quantity, l.old.unit)} → <Text className="font-bold">{q(l.new!.quantity, l.new!.unit)}</Text>
                        </>
                      ) : (
                        <>
                          <Text className="line-through">{l.old.name}</Text> → <Text className="font-bold">{l.new!.productName}</Text> ({q(l.new!.quantity, l.new!.unit)})
                        </>
                      )}
                    </Text>
                  )
                })}
              </View>
              {(() => {
                const amt = `₹${Math.abs(Number(a.net_diff)).toFixed(2)}`
                return (
                  <>
                    <Text className="text-sm mt-2 text-foreground">
                      {a.settlement_type === 'refund' ? (
                        <>
                          We&apos;ll <Text className="font-bold">refund {amt}</Text> to your original payment.
                        </>
                      ) : a.settlement_type === 'collect' ? (
                        <>
                          An extra <Text className="font-bold">{amt}</Text> is payable — you&apos;ll pay it securely on confirm.
                        </>
                      ) : a.settlement_type === 'cod_adjust' ? (
                        <>
                          Your new total is <Text className="font-bold">₹{Number(a.new_total).toFixed(2)}</Text>, payable on delivery.
                        </>
                      ) : (
                        'No change to what you pay.'
                      )}
                    </Text>
                    <View className="flex-row gap-2 mt-3">
                      <Pressable
                        onPress={() => confirmChange(`/api/orders/${order.id}/adjustments/${a.id}/confirm`, 'Order changes')}
                        disabled={vcrBusy}
                        className={`px-4 py-2 bg-orange-600 rounded-lg ${vcrBusy ? 'opacity-50' : ''}`}
                      >
                        <Text className="text-sm font-semibold text-white">{vcrBusy ? 'Processing…' : a.settlement_type === 'collect' ? `Confirm & pay ${amt}` : 'Confirm changes'}</Text>
                      </Pressable>
                      <Pressable onPress={() => reject(() => rejectAdjustment(order.id, a.id), 'Could not decline the changes')} disabled={vcrBusy} className={`px-4 py-2 ${vcrBusy ? 'opacity-50' : ''}`}>
                        <Text className="text-sm text-foreground-muted">Decline</Text>
                      </Pressable>
                    </View>
                  </>
                )
              })()}
            </View>
          )}

          {vc && vc.status === 'pending_customer' && (
            <Banner tone="orange" icon="warning">
              <Text className="font-semibold text-foreground">A variant change needs your approval</Text>
              <Text className="text-sm text-foreground-secondary mt-1">
                For <Text className="font-bold">{vc.productName}</Text>, we propose changing <Text className="line-through">{vc.oldVariantName || '—'}</Text> →{' '}
                <Text className="font-bold">{vc.newVariantName || '—'}</Text>.
              </Text>
              <Text className="text-sm mt-1 text-foreground">
                {vc.settlementType === 'refund' ? (
                  <>
                    We&apos;ll <Text className="font-bold">refund ₹{Math.abs(vc.priceDiff).toFixed(2)}</Text> to your original payment.
                  </>
                ) : vc.settlementType === 'collect' ? (
                  <>
                    An extra <Text className="font-bold">₹{Math.abs(vc.priceDiff).toFixed(2)}</Text> is payable — you&apos;ll pay it securely on confirm.
                  </>
                ) : vc.settlementType === 'cod_adjust' ? (
                  'Your total will be adjusted; you pay the updated amount on delivery.'
                ) : (
                  'No change to your total.'
                )}
              </Text>
              <View className="flex-row gap-2 mt-3">
                <Pressable
                  onPress={() => confirmChange(`/api/orders/${order.id}/variant-change/confirm`, 'Variant change')}
                  disabled={vcrBusy}
                  className={`px-4 py-2 bg-orange-600 rounded-lg ${vcrBusy ? 'opacity-50' : ''}`}
                >
                  <Text className="text-sm font-semibold text-white">{vcrBusy ? 'Processing…' : vc.settlementType === 'collect' ? 'Confirm & pay difference' : 'Confirm change'}</Text>
                </Pressable>
                <Pressable onPress={() => reject(() => rejectVariantChange(order.id), 'Failed to decline change')} disabled={vcrBusy} className={`px-4 py-2 ${vcrBusy ? 'opacity-50' : ''}`}>
                  <Text className="text-sm text-foreground-muted">Decline</Text>
                </Pressable>
              </View>
            </Banner>
          )}

          {order.status === 'return_requested' && (
            <Banner tone="orange" icon="clock">
              <Text className="text-orange-800 dark:text-orange-300 text-sm">Return request submitted — awaiting admin review.</Text>
            </Banner>
          )}
          {order.status === 'return_approved' && (
            <Banner tone="blue">
              <Text className="text-blue-800 dark:text-blue-300 text-sm font-medium">Return Approved</Text>
              <Text className="text-blue-700 dark:text-blue-300 text-sm mt-1">Please ship the item back. A team member will contact you with return shipping instructions.</Text>
            </Banner>
          )}
          {order.status === 'return_received' && (
            <Banner tone="blue">
              <Text className="text-blue-800 dark:text-blue-300 text-sm">Item received — processing your {returnRequest?.type === 'replacement' ? 'replacement order' : 'refund'}.</Text>
            </Banner>
          )}
          {order.status === 'return_rejected' && (
            <Banner tone="red">
              <Text className="text-red-800 dark:text-red-300 text-sm font-medium">Return Request Rejected</Text>
              {!!returnRequest?.admin_notes && <Text className="text-red-700 dark:text-red-300 text-sm mt-1">{returnRequest.admin_notes}</Text>}
            </Banner>
          )}
          {order.status === 'returned' && (
            <Banner tone="purple">
              <Text className="text-purple-800 dark:text-purple-300 text-sm font-medium">Resolved</Text>
              <Text className="text-purple-700 dark:text-purple-300 text-sm mt-1">
                {returnRequest?.type === 'replacement' && returnRequest.replacement_order_id ? (
                  <>
                    Your replacement order{' '}
                    <Text className="underline font-medium" onPress={() => router.push(`/orders/${returnRequest.replacement_order_id}`)}>
                      #{returnRequest.replacement_order_number || returnRequest.replacement_order_id.slice(0, 8)}
                    </Text>{' '}
                    has been created and confirmed.
                  </>
                ) : refundBreakdown && refundBreakdown.netRefund <= 0 && refundBreakdown.charge > 0 ? (
                  `Your return has been accepted. A ₹${inrPlain(refundBreakdown.charge)} return handling charge applied to the ₹${inrPlain(refundBreakdown.grossRefund)} returnable amount, so no amount was refunded for this return.`
                ) : refundBreakdown && refundBreakdown.charge > 0 ? (
                  `Your refund of ₹${inrPlain(refundBreakdown.netRefund)} has been processed (₹${inrPlain(refundBreakdown.grossRefund)} less a ₹${inrPlain(refundBreakdown.charge)} return handling charge). It may take 5–7 business days to reflect in your account.`
                ) : (
                  'Your refund has been processed. It may take 5–7 business days to reflect in your account.'
                )}
              </Text>
            </Banner>
          )}

          {returnRequest && !!returnRequest.items?.length && RETURN_STATUSES.includes(order.status) && (
            <View className={CARD} style={SHADOW}>
              <Text className="text-base font-semibold text-foreground mb-3">
                {returnRequest.type === 'replacement' ? 'Items Requested for Replacement' : 'Items Being Returned'}
                <Text className="text-sm font-normal text-foreground-secondary">
                  {'  '}· ₹{returnRequest.items.reduce((s, i) => s + parseFloat(String(i.refund_amount)), 0).toLocaleString('en-IN')} {returnRequest.type === 'refund' ? 'refund' : 'value'}
                </Text>
              </Text>
              <View className="border border-border-default rounded-lg overflow-hidden">
                {returnRequest.items.map((item, idx) => (
                  <View key={item.id ?? idx} className={`flex-row items-center justify-between px-3 py-2.5 bg-surface ${idx > 0 ? 'border-t border-border-default' : ''}`}>
                    <View className="flex-1">
                      <Text className="font-medium text-foreground text-sm" numberOfLines={1}>
                        {item.product_name}
                      </Text>
                      {!!item.variant_name && <Text className="text-xs text-foreground-secondary">{item.variant_name}</Text>}
                    </View>
                    <View className="items-end ml-4">
                      <Text className="text-xs text-foreground-secondary">
                        Qty {fmtQty(item.quantity)} × ₹{parseFloat(String(item.unit_price)).toLocaleString('en-IN')}
                      </Text>
                      <Text className="font-medium text-foreground text-sm">₹{parseFloat(String(item.refund_amount)).toLocaleString('en-IN')}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

          {showReturnForm && (
            <View className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
              <Text className="text-lg font-bold text-orange-900 dark:text-orange-300 mb-4">
                {canRefund && canReplace ? 'Request Return / Replacement' : canRefund ? 'Request Return' : 'Request Replacement'}
              </Text>
              {!!returnError && (
                <View className="mb-3 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
                  <Text className="text-red-800 dark:text-red-300 text-sm">{returnError}</Text>
                </View>
              )}
              <View className="gap-4">
                {canRefund && canReplace && (
                  <View>
                    <Text className="text-sm font-medium text-foreground-secondary mb-2">What would you like?</Text>
                    <View className="flex-row gap-4">
                      {(['refund', 'replacement'] as const).map(rt => (
                        <Pressable
                          key={rt}
                          onPress={() => {
                            setReturnType(rt)
                            setReturnSelectedItems({})
                          }}
                          className="flex-row items-center gap-2"
                        >
                          <View className={`w-4 h-4 rounded-full border-2 items-center justify-center ${returnType === rt ? 'border-accent-500' : 'border-border-secondary'}`}>
                            {returnType === rt && <View className="w-2 h-2 rounded-full bg-accent-500" />}
                          </View>
                          <Text className="text-sm text-foreground capitalize">{rt}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                )}
                <View>
                  <Text className="text-sm font-medium text-foreground-secondary mb-2">
                    Select items to return <Text className="text-red-500">*</Text>
                  </Text>
                  <View className="gap-2">
                    {order.items.map(item => {
                      const eligible =
                        returnType === 'refund'
                          ? item.returnAllowed && Date.now() <= deliveryTs + item.returnWindowDays * DAY
                          : item.replacementAllowed && Date.now() <= deliveryTs + item.replacementWindowDays * DAY
                      if (!eligible) return null
                      const checked = !!returnSelectedItems[item.id]
                      const thumb = thumbOf(item)
                      return (
                        <Pressable
                          key={item.id}
                          onPress={() => setReturnSelectedItems(prev => ({ ...prev, [item.id]: !checked }))}
                          className={`flex-row items-center gap-3 p-3 rounded-lg border ${checked ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20' : 'border-border-secondary bg-surface'}`}
                        >
                          <View className={`w-4 h-4 rounded items-center justify-center border ${checked ? 'bg-accent-500 border-accent-500' : 'border-border-secondary'}`}>
                            {checked && <HeroIcon name="check" size={12} color="white" strokeWidth={3} />}
                          </View>
                          {thumb && <Image source={{ uri: thumb }} style={{ width: 40, height: 40, borderRadius: 6 }} contentFit="cover" />}
                          <View className="flex-1">
                            <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                              {item.productName}
                            </Text>
                            {!!item.variantName && (
                              <Text className="text-xs text-foreground-secondary">
                                {item.variantName}
                                {item.subVariantName ? ` / ${item.subVariantName}` : ''}
                              </Text>
                            )}
                            <Text className="text-xs text-foreground-muted">
                              Qty: {fmtQty(item.quantity)} · ₹{item.unitPrice.toFixed(0)}
                            </Text>
                          </View>
                        </Pressable>
                      )
                    })}
                  </View>
                </View>
                <View>
                  <Text className="text-sm font-medium text-foreground-secondary mb-1">Reason</Text>
                  <Select value={returnReason} placeholder="Select a reason…" options={REASONS} onChange={setReturnReason} />
                </View>
                <View>
                  <Text className="text-sm font-medium text-foreground-secondary mb-1">
                    Description <Text className="text-foreground-muted">(optional)</Text>
                  </Text>
                  <TextInput
                    value={returnDescription}
                    onChangeText={setReturnDescription}
                    multiline
                    numberOfLines={3}
                    maxLength={500}
                    textAlignVertical="top"
                    placeholder="Please describe the issue in detail..."
                    placeholderTextColor={t.foregroundMuted}
                    className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground text-sm"
                    style={{ minHeight: 76 }}
                  />
                  <Text className="text-xs text-foreground-muted mt-1">{returnDescription.length}/500</Text>
                </View>
                <View className="flex-row gap-3">
                  <Pressable
                    onPress={handleSubmitReturn}
                    disabled={isSubmittingReturn}
                    className={`flex-1 flex-row items-center justify-center px-4 py-2.5 rounded-lg ${isSubmittingReturn ? 'bg-accent-300' : 'bg-accent-500'}`}
                  >
                    {isSubmittingReturn && <ActivityIndicator size="small" color="white" style={{ marginRight: 8 }} />}
                    <Text className="text-white font-semibold text-sm">{isSubmittingReturn ? 'Submitting...' : 'Submit Request'}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setShowReturnForm(false)
                      setReturnError('')
                      setReturnSelectedItems({})
                    }}
                    disabled={isSubmittingReturn}
                    className="px-4 py-2.5 bg-surface-elevated rounded-lg border border-border-secondary"
                  >
                    <Text className="text-foreground-secondary font-medium text-sm">Cancel</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}

          {!['cancelled', 'returned'].includes(order.status) &&
            !order.isAllDigital &&
            (() => {
              const edd = resolveOrderEdd(order)
              if (!edd) return null
              const { label, sub, color } = getEddDisplay(order, edd)
              return (
                <View className="bg-surface-elevated rounded-lg border border-border-default px-4 py-4 flex-row items-center gap-3" style={SHADOW}>
                  <HeroIcon name="calendar" size={20} color={accent[500]} />
                  <View>
                    <Text className={`text-sm font-semibold ${color}`}>{label}</Text>
                    <Text className="text-xs text-foreground-muted">{sub}</Text>
                  </View>
                </View>
              )
            })()}

          {!!order.awbNumber && !order.isAllDigital && (
            <View className="bg-surface-elevated rounded-lg border border-border-default" style={SHADOW}>
              <View className="px-4 py-4 border-b border-border-default flex-row items-center gap-2">
                <HeroIcon name="cube" size={20} color={accent[500]} />
                <Text className="text-base font-semibold text-foreground">Shipment Tracking</Text>
              </View>
              <View className="p-4">
                <OrderTracking orderId={order.id} />
              </View>
            </View>
          )}

          {RETURN_STATUSES.includes(order.status) && !!returnRequest?.rvp_awb_number && (
            <View className="bg-surface-elevated rounded-lg border border-border-default" style={SHADOW}>
              <View className="px-4 py-4 border-b border-border-default flex-row items-center gap-2">
                <HeroIcon name="returnArrow" size={20} color={accent[500]} />
                <Text className="text-base font-semibold text-foreground">Return Shipment Tracking</Text>
              </View>
              <View className="p-4">
                <OrderTracking orderId={order.id} trackPath="track-rvp" />
              </View>
            </View>
          )}

          {/* Order items + totals */}
          <View className={CARD} style={SHADOW}>
            <Text className="text-lg font-bold text-foreground mb-4">
              Order Items ({order.items.length} {order.items.length === 1 ? 'item' : 'items'})
            </Text>
            <View className="gap-4">
              {order.items.map((item, idx) => {
                const thumb = thumbOf(item)
                const isFractional = (item.buyMode && item.buyMode !== 'unit') || (item.buyUnit && item.buyUnit !== 'unit')
                const unitLabel = item.buyUnit && item.buyUnit !== 'unit' ? item.buyUnit : item.buyMode && item.buyMode !== 'unit' ? item.buyMode : null
                const qtyDisplay = isFractional ? Number(Number(item.quantity).toFixed(6)).toString() : String(Math.round(Number(item.quantity)))
                const u = unitText(unitLabel)
                return (
                  <View key={item.id} className={`flex-row gap-4 pb-4 ${idx < order.items.length - 1 ? 'border-b border-border-default' : ''}`}>
                    <View className="w-20 h-20 bg-surface-elevated rounded-lg overflow-hidden border border-border-default items-center justify-center">
                      {thumb ? (
                        <Image source={{ uri: thumb }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                      ) : (
                        <HeroIcon name="photo" size={32} color={t.foregroundMuted} />
                      )}
                    </View>
                    <View className="flex-1">
                      <Text
                        className="font-medium text-foreground"
                        onPress={item.products?.slug ? () => router.push(`/product/${item.products!.slug}`) : undefined}
                      >
                        {item.productName}
                      </Text>
                      {(!!item.variantName || !!item.subVariantName) && (
                        <View className="flex-row flex-wrap gap-1 mt-1">
                          {!!item.variantName && (
                            <View className="px-2 py-0.5 rounded-full bg-accent-50 dark:bg-accent-900/30 border border-accent-200 dark:border-accent-700">
                              <Text className="text-xs font-medium text-accent-700 dark:text-accent-300">{item.variantName}</Text>
                            </View>
                          )}
                          {!!item.subVariantName && (
                            <View className="px-2 py-0.5 rounded-full bg-surface-secondary border border-border-default">
                              <Text className="text-xs font-medium text-foreground-secondary">{item.subVariantName}</Text>
                            </View>
                          )}
                        </View>
                      )}
                      <WarningBadges fragile={item.products?.fragile} hazardous={item.products?.hazardous} flammable={item.products?.flammable} size="xs" />
                      {item.isDigital && (
                        <Text className="text-xs mt-1">
                          {item.accessGranted ? (
                            <Text className="text-green-700 dark:text-green-400 font-medium">
                              Access granted
                              {!!item.vaultUrl && (
                                <>
                                  {' · '}
                                  <Text className="underline" onPress={() => Linking.openURL(item.vaultUrl!)}>
                                    Open in vault
                                  </Text>
                                </>
                              )}
                            </Text>
                          ) : item.accessRevoked ? (
                            <Text className="text-red-600 dark:text-red-400 font-medium">Access revoked</Text>
                          ) : (
                            <Text className="text-foreground-muted">Digital item · access on payment</Text>
                          )}
                        </Text>
                      )}
                      <Text className="text-sm text-foreground-secondary mt-1">
                        Quantity: {qtyDisplay}
                        {u ? ` ${u}` : ''}
                      </Text>
                      <Text className="text-sm font-semibold text-foreground mt-1">
                        {inrCur(item.unitPrice)}
                        {u ? ` / ${u}` : ''} x {qtyDisplay}
                        {u ? ` ${u}` : ''} = {inrCur(item.totalPrice)}
                      </Text>
                    </View>
                  </View>
                )
              })}
            </View>
            <View className="mt-6 pt-4 border-t-2 border-border-default gap-2">
              <View className="flex-row justify-between">
                <Text className="text-sm text-foreground-secondary">Subtotal</Text>
                <Text className="text-sm text-foreground-secondary">{inrCur(order.subtotal)}</Text>
              </View>
              {order.taxAmount > 0 && (
                <View className="flex-row justify-between">
                  <Text className="text-sm text-foreground-muted">Incl. GST</Text>
                  <Text className="text-sm text-foreground-muted">{inrCur(order.taxAmount)}</Text>
                </View>
              )}
              {order.discountAmount > 0 && (
                <View className="flex-row justify-between">
                  <Text className="text-sm text-green-600 dark:text-green-400 font-medium">Discount</Text>
                  <Text className="text-sm text-green-600 dark:text-green-400 font-medium">−{inrCur(order.discountAmount)}</Text>
                </View>
              )}
              {order.shippingAmount > 0 && (
                <View className="flex-row justify-between">
                  <Text className="text-sm text-foreground-secondary">Delivery</Text>
                  <Text className="text-sm text-foreground-secondary">{inrCur(order.shippingAmount)}</Text>
                </View>
              )}
              {(order.codFeeAmount ?? 0) > 0 && (
                <View className="flex-row justify-between">
                  <Text className="text-sm text-foreground-secondary">COD handling fee</Text>
                  <Text className="text-sm text-foreground-secondary">{inrCur(order.codFeeAmount ?? 0)}</Text>
                </View>
              )}
              <View className="flex-row justify-between items-center pt-2">
                <Text className="text-lg font-bold text-foreground">Total</Text>
                <Text className="text-2xl font-bold text-primary-600 dark:text-primary-400">{inrCur(order.totalAmount)}</Text>
              </View>
              {order.taxAmount > 0 && <Text className="text-xs text-foreground-muted">Price inclusive of all taxes</Text>}
            </View>
          </View>

          {(order.status === 'delivered' || order.status === 'granted') && (
            <View className={CARD} style={SHADOW}>
              <View className="flex-row items-center justify-between gap-4">
                <View className="flex-1">
                  <Text className="text-base font-bold text-foreground">Rate Your Order</Text>
                  <Text className="text-sm text-foreground-muted mt-0.5">
                    {allReviewed ? 'You have reviewed all items in this order.' : 'Share your experience with the products you received.'}
                  </Text>
                </View>
                <Pressable onPress={() => setShowReviewModal(true)} className="px-4 py-2 rounded-lg bg-accent-500">
                  <Text className="text-white text-sm font-semibold">{allReviewed ? 'Edit Reviews' : 'Write Reviews'}</Text>
                </Pressable>
              </View>
              {order.items.some(i => reviewMap[i.productId]) && (
                <View className="mt-4 pt-4 border-t border-border-default flex-row flex-wrap gap-3">
                  {order.items
                    .filter(i => reviewMap[i.productId])
                    .map(item => {
                      const r = reviewMap[item.productId]
                      return (
                        <View key={item.productId} className="flex-row items-center gap-2">
                          <Text className="text-yellow-400 text-sm">
                            {'★'.repeat(r.rating)}
                            <Text className="text-gray-300">{'★'.repeat(5 - r.rating)}</Text>
                          </Text>
                          <Text className="text-xs font-medium text-foreground" numberOfLines={1} style={{ maxWidth: 140 }}>
                            {item.productName}
                          </Text>
                        </View>
                      )
                    })}
                </View>
              )}
            </View>
          )}

          {!!order.sharedNotes?.length && (
            <View className={CARD} style={SHADOW}>
              <Text className="text-lg font-bold text-foreground mb-1">Notes from the store</Text>
              <Text className="text-xs text-foreground-muted mb-4">Sketches, measurements and messages our team shared with you for this order.</Text>
              <View className="gap-4">
                {order.sharedNotes.map(n => (
                  <View key={n.id} className="border border-border-default rounded-lg p-4">
                    {!!n.title && <Text className="font-semibold text-foreground">{n.title}</Text>}
                    {!!n.body && <Text className="text-sm text-foreground-secondary mt-1">{n.body}</Text>}
                    {n.attachments?.some(x => x.kind === 'image') && (
                      <View className="flex-row flex-wrap gap-2 mt-3">
                        {n.attachments
                          .filter(x => x.kind === 'image')
                          .map(x => (
                            <Pressable key={x.id} onPress={() => Linking.openURL(absUrl(x.url) ?? x.url)}>
                              <Image source={{ uri: absUrl(x.thumbnailUrl || x.url) ?? undefined }} style={{ width: 96, height: 96, borderRadius: 8 }} contentFit="cover" />
                            </Pressable>
                          ))}
                      </View>
                    )}
                    {n.attachments
                      ?.filter(x => x.kind === 'audio')
                      .map(x => (
                        <Pressable key={x.id} onPress={() => Linking.openURL(absUrl(x.url) ?? x.url)} className="mt-3 self-start">
                          <Text className="text-sm text-accent-600">Play voice note</Text>
                        </Pressable>
                      ))}
                    <Text className="text-[11px] text-foreground-muted mt-2">{new Date(n.createdAt).toLocaleString('en-IN')}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {order.shippingAddress && (
            <View className={CARD} style={SHADOW}>
              <Text className="text-lg font-bold text-foreground mb-4">{order.isAllDigital ? 'Billing Address' : 'Shipping Address'}</Text>
              <Text className="font-semibold text-foreground-secondary">{order.shippingAddress.full_name}</Text>
              <Text className="mt-2 text-foreground-secondary">{order.shippingAddress.address_line1}</Text>
              {!!order.shippingAddress.address_line2 && <Text className="text-foreground-secondary">{order.shippingAddress.address_line2}</Text>}
              {!!order.shippingAddress.landmark && <Text className="text-foreground-secondary text-sm">Landmark: {order.shippingAddress.landmark}</Text>}
              <Text className="text-foreground-secondary">
                {order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postal_code}
              </Text>
              <Text className="mt-2 text-foreground-secondary">Phone: {order.shippingAddress.phone}</Text>
              <OrderAddressChange
                orderId={order.id}
                canChange={!!order.canChangeAddress && !order.isAllDigital}
                request={order.addressChange ?? null}
                currentAddress={order.shippingAddress}
                onChanged={fetchOrder}
              />
            </View>
          )}

          {!!order.notes && (
            <View className={CARD} style={SHADOW}>
              <Text className="text-lg font-bold text-foreground mb-2">Order Notes</Text>
              <Text className="text-foreground-secondary">{order.notes}</Text>
            </View>
          )}

          {order.paymentStatus === 'paid' && (
            <Banner tone="green" icon="checkCircle">
              <Text className="text-green-800 dark:text-green-300 text-sm font-medium">Payment received. Thank you for your purchase!</Text>
            </Banner>
          )}

          {order.paymentStatus === 'unpaid' && order.paymentMode !== 'cod' && isRazorpayEnabled && notCancelled && (
            <Banner tone="blue" icon="info">
              <Text className="text-blue-800 dark:text-blue-300 text-sm">Payment is pending for this order. Pay online to confirm your order instantly.</Text>
              {countdown && <Text className="text-blue-900 dark:text-blue-200 text-sm font-bold mt-2">Time remaining to pay: {countdown}</Text>}
              {isAutoCancelling ? (
                <Text className="text-blue-800 dark:text-blue-300 text-sm mt-2">Time expired. Cancelling order and restoring items to your cart...</Text>
              ) : (
                <Pressable onPress={handlePayNow} disabled={isPayingNow} className={`mt-3 self-start flex-row items-center px-4 py-2 rounded-lg ${isPayingNow ? 'bg-accent-300' : 'bg-accent-500'}`}>
                  {isPayingNow && <ActivityIndicator size="small" color="white" style={{ marginRight: 8 }} />}
                  <Text className="text-white font-semibold text-sm">{isPayingNow ? 'Processing...' : `Pay ₹${order.totalAmount.toLocaleString('en-IN')}`}</Text>
                </Pressable>
              )}
            </Banner>
          )}

          {order.paymentStatus === 'unpaid' && !isRazorpayEnabled && notCancelled && (
            <Banner tone="blue" icon="info">
              <Text className="text-blue-800 dark:text-blue-300 text-sm">
                Our team will contact you to confirm your order and provide payment details.
                {(storeIdentity.phone || storeIdentity.email) && ' For queries, '}
                {storeIdentity.phone && `call ${storeIdentity.phone}`}
                {storeIdentity.phone && storeIdentity.email && ' or '}
                {storeIdentity.email && `email ${storeIdentity.email}`}
                {(storeIdentity.phone || storeIdentity.email) && '.'}
              </Text>
            </Banner>
          )}

          {order.paymentStatus === 'failed' && isRazorpayEnabled && notCancelled && (
            <Banner tone="red" icon="alertCircle">
              <Text className="text-red-800 dark:text-red-300 text-sm">Payment failed for this order. Please retry to complete your purchase.</Text>
              {countdown && <Text className="text-red-900 dark:text-red-200 text-sm font-bold mt-2">Time remaining to pay: {countdown}</Text>}
              {isAutoCancelling ? (
                <Text className="text-red-800 dark:text-red-300 text-sm mt-2">Time expired. Cancelling order and restoring items to your cart...</Text>
              ) : (
                <Pressable onPress={handlePayNow} disabled={isPayingNow} className={`mt-3 self-start flex-row items-center px-4 py-2 rounded-lg ${isPayingNow ? 'bg-red-300' : 'bg-red-600'}`}>
                  {isPayingNow && <ActivityIndicator size="small" color="white" style={{ marginRight: 8 }} />}
                  <Text className="text-white font-semibold text-sm">{isPayingNow ? 'Processing...' : 'Retry Payment'}</Text>
                </Pressable>
              )}
            </Banner>
          )}

          <View className="gap-4">
            <Pressable onPress={() => router.navigate('/orders')} className="bg-accent-500 px-6 py-3 rounded-lg items-center">
              <Text className="text-white font-semibold">View All Orders</Text>
            </Pressable>
            <Pressable onPress={() => router.navigate('/(tabs)/products')} className="bg-surface-elevated px-6 py-3 rounded-lg border-2 border-border-secondary items-center">
              <Text className="text-foreground-secondary font-semibold">Continue Shopping</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardScroll>

      {showReviewModal && (
        <ReviewModal
          items={order.items.map(i => ({
            productId: i.productId,
            productName: i.productName,
            productImage: i.products?.product_images?.find(img => img.is_primary)?.thumbnail_url || i.products?.product_images?.[0]?.thumbnail_url || null,
          }))}
          reviewMap={reviewMap}
          onClose={() => setShowReviewModal(false)}
          onSuccess={(productId, review: OrderReview) => qc.setQueryData<Record<string, OrderReview>>(['order-reviews', id], prev => ({ ...(prev ?? {}), [productId]: review }))}
        />
      )}
    </View>
  )
}
