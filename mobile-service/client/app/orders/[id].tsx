import { useCallback, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import RazorpayCheckout from 'react-native-razorpay'
import { PackageOpen } from 'lucide-react-native'
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
  type OrderReview,
} from '../../src/api/account'
import ReviewModal from '../../src/components/account/ReviewModal'
import { useRequireAuth } from '../../src/components/account/hooks'
import OrderLoading from '../../src/components/orders/OrderLoading'
import OrderHeader from '../../src/components/orders/OrderHeader'
import { AdjustmentNotice, CancelConfirm, VariantChangeNotice } from '../../src/components/orders/OrderChanges'
import { StatusNotices } from '../../src/components/orders/StatusNotices'
import { ReturnForm, ReturnItems } from '../../src/components/orders/Returns'
import { DeliveryEstimate, TrackingCard } from '../../src/components/orders/Delivery'
import { OrderItemRow, OrderItemsTop, OrderTotals } from '../../src/components/orders/OrderItems'
import { ReviewPrompt } from '../../src/components/orders/Reviews'
import { OrderNote, StoreNotes } from '../../src/components/orders/Notes'
import { ShippingAddress } from '../../src/components/orders/ShippingAddress'
import { PaymentNotices } from '../../src/components/orders/Payment'
import { invoiceUrl, RETURN_STATUSES, returnEligibility, returnTitle } from '../../src/components/orders/shared'
import { Button, EmptyState, List, Screen } from '../../src/ui'
import { useStoreConfig } from '../../src/hooks/useStoreConfig'
import { useCartStore } from '../../src/stores/cartStore'
import { showToast } from '../../src/stores/toastStore'
import { accent } from '../../src/theme'

// Mirror of controller-service app/(storefront)/account/orders/[id]/page.tsx; the sections live in
// src/components/orders.

const TITLE = 'Order Details'

const RAZORPAY_ENABLED = process.env.EXPO_PUBLIC_ENABLE_RAZORPAY !== 'false'

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const qc = useQueryClient()
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

  if (!user || orderQ.isLoading) return <Screen title={TITLE} loading skeleton={<OrderLoading />} />

  if (orderQ.isError || !order) {
    return (
      <Screen title={TITLE}>
        <EmptyState
          fill
          icon={PackageOpen}
          title="Order Not Found"
          message={(orderQ.error as Error)?.message || 'Unable to load order details'}
          actionLabel="View All Orders"
          onAction={() => router.replace('/orders')}
        />
      </Screen>
    )
  }

  const { deliveryTs, canRefund, canReplace, canReturn, returnWindowExpired } = returnEligibility(order, returnRequest, monthlyLimitReached)
  const unpaidPending = order.status === 'pending' && order.paymentStatus === 'unpaid'
  const showInvoice = !!order.invoiceNumber && !order.originalOrderId && !!order.viewToken && (order.paymentStatus === 'paid' || order.paymentStatus === 'cod_collected')
  const countdown = timeLeft !== null && timeLeft > 0 ? `${Math.floor(timeLeft / 60000)}:${String(Math.floor((timeLeft % 60000) / 1000)).padStart(2, '0')}` : null

  const a = order.pendingAdjustment
  const vc = order.pendingVariantChange

  return (
    <>
      {/* Items are list rows (the card sliced per row); everything above and below rides as header and footer. */}
      <Screen title={TITLE} mode="none">
        <List
          data={order.items}
          keyExtractor={item => item.id}
          keyboard
          renderItem={({ item, index }) => <OrderItemRow item={item} index={index} />}
          ListHeaderComponent={
            <View className="gap-4">
              <OrderHeader
                order={order}
                unpaidPending={unpaidPending}
                returnLabel={returnTitle(canRefund, canReplace)}
                showReturn={canReturn && !showReturnForm}
                returnWindowExpired={returnWindowExpired}
                limitReached={monthlyLimitReached && (canRefund || canReplace) && !returnRequest}
                invoiceUrl={showInvoice ? invoiceUrl(config.slug, order.viewToken!) : null}
                onCancel={() => setShowCancelConfirm(true)}
                onReturn={() => {
                  setReturnType(canRefund ? 'refund' : 'replacement')
                  setShowReturnForm(true)
                }}
              />

              {showCancelConfirm && <CancelConfirm unpaidPending={unpaidPending} busy={isCancelling} onConfirm={handleCancelOrder} onKeep={() => setShowCancelConfirm(false)} />}

              <StatusNotices order={order} returnRequest={returnRequest} refundBreakdown={refundBreakdown} />

              {a && (
                <AdjustmentNotice
                  order={order}
                  busy={vcrBusy}
                  onConfirm={() => confirmChange(`/api/orders/${order.id}/adjustments/${a.id}/confirm`, 'Order changes')}
                  onDecline={() => reject(() => rejectAdjustment(order.id, a.id), 'Could not decline the changes')}
                />
              )}

              {vc && vc.status === 'pending_customer' && (
                <VariantChangeNotice
                  order={order}
                  busy={vcrBusy}
                  onConfirm={() => confirmChange(`/api/orders/${order.id}/variant-change/confirm`, 'Variant change')}
                  onDecline={() => reject(() => rejectVariantChange(order.id), 'Failed to decline change')}
                />
              )}

              {returnRequest && !!returnRequest.items?.length && RETURN_STATUSES.includes(order.status) && <ReturnItems returnRequest={returnRequest} />}

              {showReturnForm && (
                <ReturnForm
                  order={order}
                  title={returnTitle(canRefund, canReplace)}
                  canRefund={canRefund}
                  canReplace={canReplace}
                  deliveryTs={deliveryTs}
                  returnType={returnType}
                  onType={rt => {
                    setReturnType(rt)
                    setReturnSelectedItems({})
                  }}
                  selected={returnSelectedItems}
                  onToggle={(itemId, on) => setReturnSelectedItems(prev => ({ ...prev, [itemId]: on }))}
                  reason={returnReason}
                  onReason={setReturnReason}
                  description={returnDescription}
                  onDescription={setReturnDescription}
                  error={returnError}
                  submitting={isSubmittingReturn}
                  onSubmit={handleSubmitReturn}
                  onCancel={() => {
                    setShowReturnForm(false)
                    setReturnError('')
                    setReturnSelectedItems({})
                  }}
                />
              )}

              <DeliveryEstimate order={order} />

              {!!order.awbNumber && !order.isAllDigital && <TrackingCard orderId={order.id} />}

              {RETURN_STATUSES.includes(order.status) && !!returnRequest?.rvp_awb_number && <TrackingCard orderId={order.id} reverse />}
              <OrderItemsTop order={order} />
            </View>
          }
          ListFooterComponent={
            <View className="gap-4">
              <OrderTotals order={order} />
              {(order.status === 'delivered' || order.status === 'granted') && <ReviewPrompt order={order} reviewMap={reviewMap} onOpen={() => setShowReviewModal(true)} />}

              {!!order.sharedNotes?.length && <StoreNotes notes={order.sharedNotes} />}

              {order.shippingAddress && <ShippingAddress order={order} onChanged={fetchOrder} />}

              {!!order.notes && <OrderNote notes={order.notes} />}

              <PaymentNotices
                order={order}
                razorpay={isRazorpayEnabled}
                countdown={countdown}
                autoCancelling={isAutoCancelling}
                paying={isPayingNow}
                onPay={handlePayNow}
                store={storeIdentity}
              />

              <View className="gap-3">
                <Button label="View All Orders" onPress={() => router.navigate('/orders')} />
                <Button label="Continue Shopping" variant="outline" onPress={() => router.navigate('/(tabs)/products')} />
              </View>
            </View>
          }
        />
      </Screen>

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
    </>
  )
}
