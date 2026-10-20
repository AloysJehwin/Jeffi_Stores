import { useState, useEffect, useRef } from 'react'
import { View, Text, ScrollView, TouchableOpacity, Alert, Modal, TextInput, Linking, ActivityIndicator } from 'react-native'
import { Image } from 'expo-image'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import RazorpayCheckout from 'react-native-razorpay'
import { getOrder, cancelOrder, requestReturn, getReturnRequest } from '../../src/api/orders'
import { api } from '../../src/api/client'
import { useAuthStore } from '../../src/stores/authStore'
import { useCartStore } from '../../src/stores/cartStore'
import Spinner from '../../src/components/ui/Spinner'
import type { OrderStatus, ReturnRequest } from '../../src/types'

const RAZORPAY_ENABLED = process.env.EXPO_PUBLIC_ENABLE_RAZORPAY !== 'false'

const STATUS_STEPS: OrderStatus[] = ['pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered']

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending:          { label: 'Pending',               color: 'text-yellow-700 dark:text-yellow-400', bg: 'bg-yellow-100 dark:bg-yellow-900/30' },
  confirmed:        { label: 'Confirmed',              color: 'text-blue-700 dark:text-blue-400',    bg: 'bg-blue-100 dark:bg-blue-900/30' },
  processing:       { label: 'Processing',             color: 'text-blue-700 dark:text-blue-400',    bg: 'bg-blue-100 dark:bg-blue-900/30' },
  shipped:          { label: 'Shipped',                color: 'text-purple-700 dark:text-purple-400',bg: 'bg-purple-100 dark:bg-purple-900/30' },
  out_for_delivery: { label: 'Out for Delivery',       color: 'text-indigo-700 dark:text-indigo-400',bg: 'bg-indigo-100 dark:bg-indigo-900/30' },
  delivered:        { label: 'Delivered',              color: 'text-green-700 dark:text-green-400',  bg: 'bg-green-100 dark:bg-green-900/30' },
  cancel_requested: { label: 'Cancel Requested',       color: 'text-orange-700 dark:text-orange-400',bg: 'bg-orange-100 dark:bg-orange-900/30' },
  cancel_rejected:  { label: 'Cancellation Rejected',  color: 'text-red-700 dark:text-red-400',     bg: 'bg-red-100 dark:bg-red-900/30' },
  cancelled:        { label: 'Cancelled',              color: 'text-red-700 dark:text-red-400',     bg: 'bg-red-100 dark:bg-red-900/30' },
  return_requested: { label: 'Return Requested',       color: 'text-orange-700 dark:text-orange-400',bg: 'bg-orange-100 dark:bg-orange-900/30' },
  return_approved:  { label: 'Return Approved',        color: 'text-teal-700 dark:text-teal-400',   bg: 'bg-teal-100 dark:bg-teal-900/30' },
  return_received:  { label: 'Return Received',        color: 'text-teal-700 dark:text-teal-400',   bg: 'bg-teal-100 dark:bg-teal-900/30' },
  return_rejected:  { label: 'Return Rejected',        color: 'text-red-700 dark:text-red-400',     bg: 'bg-red-100 dark:bg-red-900/30' },
  returned:         { label: 'Returned',               color: 'text-gray-600 dark:text-gray-400',   bg: 'bg-gray-100 dark:bg-gray-800/50' },
}

const RETURN_REASONS = [
  { value: 'defective',        label: 'Defective / Not Working' },
  { value: 'wrong_item',       label: 'Wrong Item Received' },
  { value: 'not_as_described', label: 'Not as Described' },
  { value: 'damaged',          label: 'Damaged in Transit' },
  { value: 'other',            label: 'Other' },
]

const UNPAID_TIMEOUT_MS = 10 * 60 * 1000

function useCountdown(createdAt: string, enabled: boolean) {
  const [remaining, setRemaining] = useState(0)
  const ref = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!enabled) { setRemaining(0); return }
    const tick = () => {
      const elapsed = Date.now() - new Date(createdAt).getTime()
      setRemaining(Math.max(0, UNPAID_TIMEOUT_MS - elapsed))
    }
    tick()
    ref.current = setInterval(tick, 1000)
    return () => { if (ref.current) clearInterval(ref.current) }
  }, [createdAt, enabled])

  const mins = Math.floor(remaining / 60000)
  const secs = Math.floor((remaining % 60000) / 1000)
  return { remaining, display: `${mins}:${secs.toString().padStart(2, '0')}` }
}

export default function OrderDetailScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const { reset: resetCart } = useCartStore()

  const [showReturnModal, setShowReturnModal] = useState(false)
  const [returnType, setReturnType] = useState<'refund' | 'replacement'>('refund')
  const [returnReason, setReturnReason] = useState('')
  const [returnDesc, setReturnDesc] = useState('')
  const [isRepaying, setIsRepaying] = useState(false)

  const { data: order, isLoading } = useQuery({
    queryKey: ['order', id],
    queryFn: () => getOrder(id),
    refetchInterval: (query) => {
      const data = query.state.data
      if (data?.paymentStatus === 'unpaid' && data?.status === 'pending') return 15000
      return false
    },
  })

  const { data: returnRequest } = useQuery({
    queryKey: ['returnRequest', id],
    queryFn: () => getReturnRequest(id),
    enabled: !!order && ['return_requested', 'return_approved', 'return_received', 'return_rejected', 'returned'].includes(order.status),
  })

  const isUnpaid = order?.paymentStatus === 'unpaid' && order?.status === 'pending'
  const { remaining: countdownMs, display: countdownDisplay } = useCountdown(order?.createdAt ?? '', !!isUnpaid)

  useEffect(() => {
    if (isUnpaid && countdownMs === 0 && order) {
      cancelOrder(order.id).catch(() => {}).finally(() => {
        qc.invalidateQueries({ queryKey: ['order', id] })
        qc.invalidateQueries({ queryKey: ['orders'] })
      })
    }
  }, [countdownMs, isUnpaid])

  const cancelMutation = useMutation({
    mutationFn: () => cancelOrder(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['order', id] })
      qc.invalidateQueries({ queryKey: ['orders'] })
    },
    onError: (err: any) => Alert.alert('Error', err.message || 'Failed to submit request'),
  })

  const returnMutation = useMutation({
    mutationFn: () => requestReturn(id, {
      type: returnType,
      reason: returnReason,
      description: returnDesc.trim() || undefined,
    }),
    onSuccess: () => {
      setShowReturnModal(false)
      qc.invalidateQueries({ queryKey: ['order', id] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['returnRequest', id] })
    },
    onError: (err: any) => Alert.alert('Error', err.message || 'Failed to submit return request'),
  })

  const handleCancel = () => {
    const isInstant = order?.status === 'pending' && order?.paymentStatus !== 'paid'
    Alert.alert(
      isInstant ? 'Cancel Order' : 'Request Cancellation',
      isInstant
        ? 'Cancel this order? This cannot be undone.'
        : 'Submit a cancellation request? Our team will review and confirm.',
      [
        { text: 'Back', style: 'cancel' },
        { text: isInstant ? 'Cancel Order' : 'Submit Request', style: 'destructive', onPress: () => cancelMutation.mutate() },
      ]
    )
  }

  const handleRepay = async () => {
    if (!order || !user) return
    setIsRepaying(true)
    try {
      const rzpData = await api<{ razorpayOrderId: string; amount: number; currency: string; key_id: string }>(
        '/api/razorpay/create-order',
        { method: 'POST', body: JSON.stringify({ orderId: order.id }) }
      )
      const options = {
        description: 'Order Payment',
        currency: rzpData.currency,
        key: rzpData.key_id,
        amount: String(rzpData.amount),
        order_id: rzpData.razorpayOrderId,
        name: 'Jeffi Stores',
        prefill: {
          email: user.email || '',
          contact: order.shippingAddress?.phone || '',
          name: order.shippingAddress?.full_name || '',
        },
        theme: { color: '#7cb900' },
      }
      const paymentData = await RazorpayCheckout.open(options)
      await api('/api/razorpay/verify', {
        method: 'POST',
        body: JSON.stringify({
          razorpay_order_id: paymentData.razorpay_order_id,
          razorpay_payment_id: paymentData.razorpay_payment_id,
          razorpay_signature: paymentData.razorpay_signature,
          orderId: order.id,
        }),
      })
      resetCart()
      qc.invalidateQueries({ queryKey: ['cart'] })
      qc.invalidateQueries({ queryKey: ['order', id] })
      qc.invalidateQueries({ queryKey: ['orders'] })
    } catch (err: any) {
      if (err?.code !== 0) {
        api(`/api/orders/${order.id}/payment-failed`, {
          method: 'POST',
          body: JSON.stringify({ errorDescription: err?.description || err?.message || 'Payment failed' }),
        }).catch(() => {})
      }
      qc.invalidateQueries({ queryKey: ['order', id] })
    } finally {
      setIsRepaying(false)
    }
  }

  const handleReturnSubmit = () => {
    if (!returnReason) { Alert.alert('Select a reason', 'Please select a reason for the return.'); return }
    returnMutation.mutate()
  }

  if (isLoading || !order) return <Spinner />

  const meta = STATUS_META[order.status] ?? { label: order.status, color: 'text-gray-600 dark:text-gray-400', bg: 'bg-gray-100 dark:bg-gray-800' }
  const currentStepIdx = STATUS_STEPS.indexOf(order.status as any)
  const isProgressStatus = currentStepIdx !== -1
  const isCancellable = ['pending', 'confirmed', 'processing'].includes(order.status)
  const isDeliveredReturnable = order.status === 'delivered' && (() => {
    const base = new Date(order.deliveredAt || order.updatedAt)
    return Date.now() - base.getTime() < 7 * 24 * 60 * 60 * 1000
  })()
  const isReturnActive = ['return_requested', 'return_approved', 'return_received', 'return_rejected', 'returned'].includes(order.status)

  return (
    <SafeAreaView className="flex-1 bg-gray-50 dark:bg-[#1a1b23]">
      <View className="flex-row items-center px-4 py-3 border-b border-gray-100 dark:border-[#3f4150] bg-white dark:bg-[#24252f]">
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#6B7280" />
        </TouchableOpacity>
        <View className="flex-1 items-center">
          <Text className="font-bold text-gray-900 dark:text-gray-100 text-sm" numberOfLines={1}>
            #{order.orderNumber}
          </Text>
          <Text className="text-xs text-gray-400">
            {new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </Text>
        </View>
        <View className="w-6" />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* Unpaid countdown */}
        {isUnpaid && (
          <View className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl p-4 mb-4">
            <View className="flex-row items-center gap-2 mb-2">
              <Ionicons name="time-outline" size={20} color="#f97316" />
              <Text className="font-bold text-orange-800 dark:text-orange-300">Payment Pending</Text>
            </View>
            <Text className="text-orange-700 dark:text-orange-300 text-sm mb-3">
              {countdownMs > 0
                ? `Complete payment within ${countdownDisplay} or this order will be cancelled automatically.`
                : 'Time expired — this order is being cancelled.'}
            </Text>
            {countdownMs > 0 && RAZORPAY_ENABLED && (
              <TouchableOpacity
                onPress={handleRepay}
                disabled={isRepaying}
                className="bg-accent-500 py-2.5 rounded-xl items-center flex-row justify-center gap-2"
              >
                {isRepaying
                  ? <ActivityIndicator size="small" color="white" />
                  : <Ionicons name="lock-closed-outline" size={16} color="white" />}
                <Text className="text-white font-semibold text-sm">
                  {isRepaying ? 'Opening Payment...' : `Pay ₹${Number(order.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Status card */}
        <View className="bg-white dark:bg-[#24252f] rounded-xl border border-gray-200 dark:border-[#3f4150] p-4 mb-4">
          <View className="flex-row items-center justify-between mb-3">
            <Text className="font-bold text-gray-900 dark:text-gray-100 text-base">Order Status</Text>
            <View className={`px-3 py-1 rounded-full ${meta.bg}`}>
              <Text className={`text-xs font-bold ${meta.color}`}>{meta.label}</Text>
            </View>
          </View>

          {/* Progress tracker */}
          {isProgressStatus && (
            <View className="mt-2">
              {STATUS_STEPS.map((step, i) => {
                const done = i <= currentStepIdx
                const isLast = i === STATUS_STEPS.length - 1
                return (
                  <View key={step} className="flex-row items-start gap-3">
                    <View className="items-center" style={{ width: 24 }}>
                      <View className={`w-6 h-6 rounded-full items-center justify-center ${done ? 'bg-accent-500' : 'bg-gray-200 dark:bg-[#3f4150]'}`}>
                        {done
                          ? <Ionicons name="checkmark" size={14} color="white" />
                          : <View className="w-2 h-2 rounded-full bg-gray-400" />}
                      </View>
                      {!isLast && (
                        <View
                          className={`w-0.5 mt-0.5 mb-0.5 ${done && i < currentStepIdx ? 'bg-accent-500' : 'bg-gray-200 dark:bg-[#3f4150]'}`}
                          style={{ minHeight: 20 }}
                        />
                      )}
                    </View>
                    <Text className={`text-sm py-0.5 ${done ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-400'}`}>
                      {STATUS_META[step]?.label ?? step}
                    </Text>
                  </View>
                )
              })}
            </View>
          )}

          {/* Tracking URL */}
          {order.trackingUrl && ['shipped', 'out_for_delivery'].includes(order.status) && (
            <TouchableOpacity
              onPress={() => Linking.openURL(order.trackingUrl!)}
              className="mt-3 flex-row items-center gap-2 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-xl px-4 py-3"
            >
              <Ionicons name="location-outline" size={18} color="#7c3aed" />
              <Text className="text-purple-700 dark:text-purple-300 font-semibold text-sm flex-1">Track Shipment</Text>
              <Ionicons name="open-outline" size={14} color="#7c3aed" />
            </TouchableOpacity>
          )}

          {/* Cancel-state notes */}
          {order.status === 'cancel_requested' && (
            <View className="mt-3 bg-orange-50 dark:bg-orange-900/20 rounded-xl p-3">
              <Text className="text-orange-700 dark:text-orange-300 text-sm">
                Your cancellation request is under review. We'll notify you once it's processed.
              </Text>
            </View>
          )}
          {order.status === 'cancel_rejected' && order.cancellation_note && (
            <View className="mt-3 bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
              <Text className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1">Rejection Reason</Text>
              <Text className="text-red-700 dark:text-red-300 text-sm">{order.cancellation_note}</Text>
            </View>
          )}
        </View>

        {/* Return / replacement status card */}
        {isReturnActive && (
          <View className="bg-white dark:bg-[#24252f] rounded-xl border border-gray-200 dark:border-[#3f4150] p-4 mb-4">
            <Text className="font-bold text-gray-900 dark:text-gray-100 text-base mb-3">Return / Replacement</Text>
            {returnRequest ? (
              <>
                <View className="flex-row gap-2 mb-2 flex-wrap">
                  <View className="bg-gray-100 dark:bg-[#2e303b] px-2.5 py-0.5 rounded-full">
                    <Text className="text-xs text-gray-600 dark:text-gray-300 capitalize font-medium">{returnRequest.type}</Text>
                  </View>
                  <View className="bg-orange-100 dark:bg-orange-900/30 px-2.5 py-0.5 rounded-full">
                    <Text className="text-xs text-orange-700 dark:text-orange-400 font-semibold capitalize">
                      {returnRequest.status.replace(/_/g, ' ')}
                    </Text>
                  </View>
                </View>
                <Text className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                  Reason: {RETURN_REASONS.find(r => r.value === returnRequest.reason)?.label ?? returnRequest.reason}
                </Text>
                {returnRequest.description
                  ? <Text className="text-sm text-gray-500 dark:text-gray-400 mb-2">"{returnRequest.description}"</Text>
                  : null}
                {order.status === 'return_requested' && (
                  <Text className="text-sm text-orange-600 dark:text-orange-400">Under review — we'll be in touch soon.</Text>
                )}
                {order.status === 'return_approved' && (
                  <Text className="text-sm text-teal-600 dark:text-teal-400">Approved — please ship the item back to us.</Text>
                )}
                {order.status === 'return_received' && (
                  <Text className="text-sm text-teal-600 dark:text-teal-400">We've received your return and are processing it.</Text>
                )}
                {order.status === 'return_rejected' && returnRequest.admin_notes && (
                  <View className="mt-2 bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
                    <Text className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1">Rejection Reason</Text>
                    <Text className="text-red-700 dark:text-red-300 text-sm">{returnRequest.admin_notes}</Text>
                  </View>
                )}
                {order.status === 'returned' && returnRequest.type === 'refund' && (
                  <Text className="text-sm text-green-600 dark:text-green-400 mt-1">
                    Refund has been processed to your original payment method.
                  </Text>
                )}
                {order.status === 'returned' && returnRequest.type === 'replacement' && returnRequest.replacement_order_id && (
                  <TouchableOpacity
                    onPress={() => router.push(`/orders/${returnRequest.replacement_order_id}`)}
                    className="mt-2 flex-row items-center gap-2 bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800 rounded-xl px-4 py-3"
                  >
                    <Ionicons name="arrow-redo-outline" size={16} color="#7cb900" />
                    <Text className="text-accent-600 dark:text-accent-400 font-semibold text-sm">View Replacement Order</Text>
                  </TouchableOpacity>
                )}
              </>
            ) : (
              <ActivityIndicator size="small" color="#9CA3AF" />
            )}
          </View>
        )}

        {/* Replacement — link back to original */}
        {order.originalOrderNumber && order.originalOrderId && (
          <View className="bg-white dark:bg-[#24252f] rounded-xl border border-gray-200 dark:border-[#3f4150] p-4 mb-4">
            <Text className="text-sm text-gray-500 dark:text-gray-400">
              This is a replacement for{' '}
              <Text
                className="text-accent-600 dark:text-accent-400 font-semibold"
                onPress={() => router.push(`/orders/${order.originalOrderId}`)}
              >
                #{order.originalOrderNumber}
              </Text>
            </Text>
          </View>
        )}

        {/* Order Items */}
        <View className="bg-white dark:bg-[#24252f] rounded-xl border border-gray-200 dark:border-[#3f4150] p-4 mb-4">
          <Text className="font-bold text-gray-900 dark:text-gray-100 text-base mb-3">
            Items ({order.items.length})
          </Text>
          {order.items.map((item) => {
            const imgs = item.products?.product_images ?? []
            const img = imgs.find((i) => i.is_primary) ?? imgs[0]
            const isCustom = item.buyMode === 'weight' || item.buyMode === 'length'
            const qtyLabel = isCustom
              ? `${Number(item.quantity).toFixed(3)} ${item.buyUnit ?? ''}`
              : String(Math.round(Number(item.quantity)))
            return (
              <View key={item.id} className="flex-row gap-3 py-3 border-b border-gray-100 dark:border-[#3f4150] last:border-b-0">
                <View className="w-16 h-16 rounded-lg bg-gray-100 dark:bg-[#2e303b] overflow-hidden border border-gray-100 dark:border-[#3f4150] shrink-0">
                  {img?.thumbnail_url ? (
                    <>
                      <Image source={{ uri: img.thumbnail_url }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} contentFit="cover" blurRadius={10} />
                      <Image source={{ uri: img.thumbnail_url }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} contentFit="contain" />
                    </>
                  ) : (
                    <View className="flex-1 items-center justify-center">
                      <Ionicons name="image-outline" size={24} color="#9CA3AF" />
                    </View>
                  )}
                </View>
                <View className="flex-1">
                  <Text className="font-semibold text-gray-900 dark:text-gray-100 text-sm leading-snug" numberOfLines={2}>
                    {item.productName}
                  </Text>
                  {item.variantName && (
                    <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{item.variantName}</Text>
                  )}
                  <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    ₹{Number(item.unitPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })} × {qtyLabel}
                  </Text>
                  <Text className="text-sm font-bold text-gray-900 dark:text-gray-100 mt-1">
                    ₹{Number(item.totalPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </Text>
                </View>
              </View>
            )
          })}
        </View>

        {/* Delivery address */}
        {order.shippingAddress && (
          <View className="bg-white dark:bg-[#24252f] rounded-xl border border-gray-200 dark:border-[#3f4150] p-4 mb-4">
            <Text className="font-bold text-gray-900 dark:text-gray-100 text-base mb-2">Delivery Address</Text>
            <Text className="font-semibold text-gray-900 dark:text-gray-100">{order.shippingAddress.full_name}</Text>
            <Text className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{order.shippingAddress.address_line1}</Text>
            {order.shippingAddress.address_line2
              ? <Text className="text-sm text-gray-600 dark:text-gray-400">{order.shippingAddress.address_line2}</Text>
              : null}
            {order.shippingAddress.landmark
              ? <Text className="text-xs text-gray-500 dark:text-gray-400">Landmark: {order.shippingAddress.landmark}</Text>
              : null}
            <Text className="text-sm text-gray-600 dark:text-gray-400">
              {order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postal_code}
            </Text>
            <Text className="text-sm text-gray-500 dark:text-gray-400 mt-1">Phone: {order.shippingAddress.phone}</Text>
          </View>
        )}

        {/* Order summary */}
        <View className="bg-white dark:bg-[#24252f] rounded-xl border border-gray-200 dark:border-[#3f4150] p-4 mb-4">
          <Text className="font-bold text-gray-900 dark:text-gray-100 text-base mb-3">Order Summary</Text>
          <View className="flex-row justify-between mb-2">
            <Text className="text-gray-500 dark:text-gray-400">Subtotal</Text>
            <Text className="text-gray-900 dark:text-gray-100 font-medium">
              ₹{Number(order.subtotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </Text>
          </View>
          {order.taxAmount > 0 && (
            <View className="flex-row justify-between mb-2">
              <Text className="text-gray-500 dark:text-gray-400">Tax (GST)</Text>
              <Text className="text-gray-900 dark:text-gray-100 font-medium">
                ₹{Number(order.taxAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </Text>
            </View>
          )}
          <View className="flex-row justify-between mb-2">
            <Text className="text-gray-500 dark:text-gray-400">Delivery</Text>
            <Text className="text-green-600 font-semibold">FREE</Text>
          </View>
          <View className="flex-row justify-between pt-3 border-t border-gray-100 dark:border-[#3f4150]">
            <Text className="font-bold text-gray-900 dark:text-gray-100 text-base">Total</Text>
            <Text className="font-bold text-accent-500 text-base">
              ₹{Number(order.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </Text>
          </View>
          <Text className="text-xs text-gray-400 mt-1">Price inclusive of all taxes</Text>
        </View>

        {/* Notes */}
        {order.notes && (
          <View className="bg-white dark:bg-[#24252f] rounded-xl border border-gray-200 dark:border-[#3f4150] p-4 mb-4">
            <Text className="font-bold text-gray-900 dark:text-gray-100 text-base mb-1">Order Notes</Text>
            <Text className="text-sm text-gray-600 dark:text-gray-400">{order.notes}</Text>
          </View>
        )}

        {/* Action buttons */}
        <View className="gap-3">
          {isCancellable && (
            <TouchableOpacity
              onPress={handleCancel}
              disabled={cancelMutation.isPending}
              className="border-2 border-red-400 rounded-xl py-3.5 items-center"
            >
              <Text className="text-red-500 font-semibold">
                {cancelMutation.isPending
                  ? 'Submitting...'
                  : order.status === 'pending' && order.paymentStatus !== 'paid'
                    ? 'Cancel Order'
                    : 'Request Cancellation'}
              </Text>
            </TouchableOpacity>
          )}
          {isDeliveredReturnable && !isReturnActive && (
            <TouchableOpacity
              onPress={() => setShowReturnModal(true)}
              className="border-2 border-accent-400 rounded-xl py-3.5 items-center"
            >
              <Text className="text-accent-600 dark:text-accent-400 font-semibold">Return / Replace Item</Text>
            </TouchableOpacity>
          )}
        </View>

      </ScrollView>

      {/* Return request modal */}
      <Modal visible={showReturnModal} transparent animationType="slide">
        <View className="flex-1 justify-end bg-black/50">
          <View className="bg-white dark:bg-[#24252f] rounded-t-2xl">
            <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-[#3f4150]">
              <Text className="font-bold text-gray-900 dark:text-gray-100 text-base">Return / Replace</Text>
              <TouchableOpacity onPress={() => setShowReturnModal(false)}>
                <Ionicons name="close" size={22} color="#6B7280" />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
              <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">What would you like?</Text>
              <View className="flex-row gap-3 mb-4">
                {(['refund', 'replacement'] as const).map((t) => (
                  <TouchableOpacity
                    key={t}
                    onPress={() => setReturnType(t)}
                    className={`flex-1 py-3 rounded-xl border-2 items-center ${returnType === t ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20' : 'border-gray-200 dark:border-[#3f4150]'}`}
                  >
                    <Text className={`font-semibold capitalize text-sm ${returnType === t ? 'text-accent-600 dark:text-accent-400' : 'text-gray-600 dark:text-gray-300'}`}>
                      {t}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Reason *</Text>
              <View className="gap-2 mb-4">
                {RETURN_REASONS.map((r) => (
                  <TouchableOpacity
                    key={r.value}
                    onPress={() => setReturnReason(r.value)}
                    className={`flex-row items-center gap-3 p-3 rounded-xl border ${returnReason === r.value ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20' : 'border-gray-200 dark:border-[#3f4150]'}`}
                  >
                    <View className={`w-4 h-4 rounded-full border-2 items-center justify-center ${returnReason === r.value ? 'border-accent-500' : 'border-gray-300'}`}>
                      {returnReason === r.value && <View className="w-2 h-2 rounded-full bg-accent-500" />}
                    </View>
                    <Text className={`text-sm ${returnReason === r.value ? 'text-accent-600 dark:text-accent-400 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Additional Details (Optional)</Text>
              <TextInput
                value={returnDesc}
                onChangeText={setReturnDesc}
                placeholder="Describe the issue..."
                placeholderTextColor="#9CA3AF"
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                className="border border-gray-200 dark:border-[#3f4150] rounded-xl p-3 text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-[#2e303b] min-h-[80px] mb-4"
              />

              <TouchableOpacity
                onPress={handleReturnSubmit}
                disabled={returnMutation.isPending}
                className="bg-accent-500 py-4 rounded-xl items-center"
              >
                {returnMutation.isPending
                  ? <ActivityIndicator color="white" />
                  : <Text className="text-white font-bold">Submit Request</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}
