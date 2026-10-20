import { useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, TextInput, Linking, Alert } from 'react-native'
import { Image } from 'expo-image'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import RazorpayCheckout from 'react-native-razorpay'
import { createOrder } from '../../src/api/orders'
import { api } from '../../src/api/client'
import { getCart } from '../../src/api/cart'
import { listAddresses } from '../../src/api/addresses'
import { useCartStore } from '../../src/stores/cartStore'
import { useAuthStore } from '../../src/stores/authStore'
import Spinner from '../../src/components/ui/Spinner'

const RAZORPAY_ENABLED = process.env.EXPO_PUBLIC_ENABLE_RAZORPAY !== 'false'

export default function CheckoutPaymentScreen() {
  const router = useRouter()
  const { addressId } = useLocalSearchParams<{ addressId: string }>()
  const { reset: resetCart } = useCartStore()
  const { user } = useAuthStore()
  const qc = useQueryClient()

  const [paymentMethod, setPaymentMethod] = useState<'razorpay' | 'manual'>('manual')
  const [notes, setNotes] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)

  const { data: cartData, isLoading: cartLoading } = useQuery({
    queryKey: ['cart'],
    queryFn: getCart,
  })

  const { data: addresses } = useQuery({
    queryKey: ['addresses'],
    queryFn: listAddresses,
  })

  const selectedAddress = addresses?.find((a) => a.id === addressId)

  const items = cartData?.items || []
  const subtotal = items.reduce((sum, item) => {
    const isCustomQty = item.buy_mode === 'weight' || item.buy_mode === 'length'
    const price = isCustomQty
      ? (item.price_at_addition ?? 0)
      : (item.variant?.sale_price ?? item.variant?.price ?? item.products.sale_price ?? item.products.base_price)
    return sum + price * Number(item.quantity)
  }, 0)

  const createOrderMutation = useMutation({
    mutationFn: () => {
      if (!selectedAddress) throw new Error('No address selected')
      return createOrder({
        shippingAddress: {
          fullName: selectedAddress.full_name,
          addressLine1: selectedAddress.address_line1,
          addressLine2: selectedAddress.address_line2 ?? undefined,
          landmark: selectedAddress.landmark ?? undefined,
          city: selectedAddress.city,
          state: selectedAddress.state,
          postalCode: selectedAddress.postal_code,
          country: selectedAddress.country,
          phone: selectedAddress.phone,
        },
        payment_method: paymentMethod,
        notes: notes.trim() || undefined,
      })
    },
    onSuccess: async (order) => {
      if (paymentMethod === 'razorpay') {
        await initiateRazorpayPayment(order.id, order.total)
      } else {
        resetCart()
        qc.invalidateQueries({ queryKey: ['cart'] })
        qc.invalidateQueries({ queryKey: ['orders'] })
        router.replace(`/orders/${order.id}`)
      }
    },
    onError: (err: any) => {
      setIsProcessing(false)
      Alert.alert('Error', err.message || 'Failed to place order')
    },
  })

  const initiateRazorpayPayment = async (orderId: string, totalAmount: number) => {
    try {
      if (!RazorpayCheckout || !(RazorpayCheckout as any).open) {
        Alert.alert('Not supported', 'Online payment requires a native build. Please use the dev client app.')
        setIsProcessing(false)
        return
      }

      const rzpData = await api<{ razorpayOrderId: string; amount: number; currency: string; key_id: string }>(
        '/api/razorpay/create-order',
        { method: 'POST', body: JSON.stringify({ orderId }) }
      )

      const options = {
        description: 'Order Payment',
        image: 'https://www.jeffistores.in/logo.png',
        currency: rzpData.currency,
        key: rzpData.key_id,
        amount: String(rzpData.amount),
        order_id: rzpData.razorpayOrderId,
        name: 'Jeffi Stores',
        prefill: {
          email: user?.email || '',
          contact: (selectedAddress?.phone || '').replace(/\D/g, '').slice(-10),
          name: selectedAddress?.full_name || '',
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
          orderId,
        }),
      })

      resetCart()
      qc.invalidateQueries({ queryKey: ['cart'] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      router.replace(`/orders/${orderId}`)
    } catch (err: any) {
      if (err?.code === 0) {
        resetCart()
        qc.invalidateQueries({ queryKey: ['cart'] })
        qc.invalidateQueries({ queryKey: ['orders'] })
        router.replace(`/orders/${orderId}`)
      } else {
        Alert.alert(
          'Payment Error',
          `Code: ${err?.code}\nDescription: ${err?.description || err?.message || JSON.stringify(err)}`,
          [{ text: 'OK' }]
        )
        api(`/api/orders/${orderId}/payment-failed`, {
          method: 'POST',
          body: JSON.stringify({ errorDescription: err?.description || err?.message || 'Payment failed' }),
        }).catch(() => {})
        resetCart()
        qc.invalidateQueries({ queryKey: ['cart'] })
        qc.invalidateQueries({ queryKey: ['orders'] })
        router.replace(`/orders/${orderId}`)
      }
    } finally {
      setIsProcessing(false)
    }
  }

  const handlePlaceOrder = () => {
    Alert.alert(
      'Confirm Order',
      `Place order for ₹${subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: paymentMethod === 'razorpay' ? 'Pay Now' : 'Place Order',
          onPress: () => {
            setIsProcessing(true)
            createOrderMutation.mutate()
          },
        },
      ]
    )
  }

  const isPending = isProcessing || createOrderMutation.isPending

  if (cartLoading) return <Spinner />

  return (
    <SafeAreaView className="flex-1 bg-gray-50 dark:bg-[#1a1b23]">
      <View className="flex-row items-center px-4 py-3 border-b border-gray-100 dark:border-[#3f4150] bg-white dark:bg-[#24252f]">
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#6B7280" />
        </TouchableOpacity>
        <Text className="flex-1 text-center font-bold text-gray-900 dark:text-gray-100 text-base">Place Order</Text>
        <View className="w-6" />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>

        {/* Order Items */}
        <View className="bg-white dark:bg-[#24252f] rounded-xl border border-gray-200 dark:border-[#3f4150] p-4 mb-4">
          <Text className="font-bold text-gray-900 dark:text-gray-100 text-base mb-3">Order Items</Text>
          {items.map((item) => {
            const isCustomQty = item.buy_mode === 'weight' || item.buy_mode === 'length'
            const price = isCustomQty
              ? (item.price_at_addition ?? 0)
              : (item.variant?.sale_price ?? item.variant?.price ?? item.products.sale_price ?? item.products.base_price)
            const qty = isCustomQty
              ? `${Number(item.quantity).toFixed(3)} ${item.buy_unit ?? ''}`
              : String(Math.round(Number(item.quantity)))
            const itemTotal = price * Number(item.quantity)
            const imgs = item.products.product_images || []
            const img = imgs.find((i: any) => i.is_primary) || imgs[0]

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
                    {item.products.name}
                  </Text>
                  {item.variant && (
                    <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{item.variant.variant_name}</Text>
                  )}
                  <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    ₹{Number(price).toLocaleString('en-IN', { minimumFractionDigits: 2 })} × {qty}
                  </Text>
                  <Text className="text-sm font-bold text-gray-900 dark:text-gray-100 mt-1">
                    ₹{itemTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </Text>
                </View>
              </View>
            )
          })}
        </View>

        {/* Delivery Address */}
        {selectedAddress && (
          <View className="bg-white dark:bg-[#24252f] rounded-xl border border-gray-200 dark:border-[#3f4150] p-4 mb-4">
            <View className="flex-row justify-between items-center mb-3">
              <Text className="font-bold text-gray-900 dark:text-gray-100 text-base">Delivery Address</Text>
              <TouchableOpacity onPress={() => router.back()}>
                <Text className="text-accent-500 text-sm font-semibold">Change</Text>
              </TouchableOpacity>
            </View>
            <View className="bg-gray-50 dark:bg-[#1a1b23] rounded-xl p-3">
              <Text className="font-semibold text-gray-900 dark:text-gray-100">{selectedAddress.full_name}</Text>
              <Text className="text-gray-600 dark:text-gray-400 text-sm mt-1">{selectedAddress.address_line1}</Text>
              {selectedAddress.address_line2 ? (
                <Text className="text-gray-600 dark:text-gray-400 text-sm">{selectedAddress.address_line2}</Text>
              ) : null}
              {selectedAddress.landmark ? (
                <Text className="text-gray-500 dark:text-gray-400 text-xs">Landmark: {selectedAddress.landmark}</Text>
              ) : null}
              <Text className="text-gray-600 dark:text-gray-400 text-sm">
                {selectedAddress.city}, {selectedAddress.state} {selectedAddress.postal_code}
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-sm mt-1">Phone: {selectedAddress.phone}</Text>
            </View>
          </View>
        )}

        {/* Payment Method */}
        <View className="bg-white dark:bg-[#24252f] rounded-xl border border-gray-200 dark:border-[#3f4150] p-4 mb-4">
          <Text className="font-bold text-gray-900 dark:text-gray-100 text-base mb-3">Payment Method</Text>

          {RAZORPAY_ENABLED && (
            <TouchableOpacity
              onPress={() => setPaymentMethod('razorpay')}
              className={`flex-row items-center gap-3 p-3.5 rounded-xl border-2 mb-3 ${
                paymentMethod === 'razorpay' ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20' : 'border-gray-200 dark:border-[#3f4150]'
              }`}
            >
              <View className={`w-5 h-5 rounded-full border-2 items-center justify-center ${paymentMethod === 'razorpay' ? 'border-accent-500' : 'border-gray-300'}`}>
                {paymentMethod === 'razorpay' && <View className="w-2.5 h-2.5 rounded-full bg-accent-500" />}
              </View>
              <Ionicons name="card-outline" size={22} color={paymentMethod === 'razorpay' ? '#7cb900' : '#9CA3AF'} />
              <View className="flex-1">
                <Text className={`font-semibold ${paymentMethod === 'razorpay' ? 'text-accent-700 dark:text-accent-400' : 'text-gray-900 dark:text-gray-100'}`}>
                  Pay Online
                </Text>
                <Text className="text-xs text-gray-500 dark:text-gray-400">UPI, Cards, Net Banking, Wallets</Text>
              </View>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            onPress={() => setPaymentMethod('manual')}
            className={`flex-row items-center gap-3 p-3.5 rounded-xl border-2 ${
              paymentMethod === 'manual' ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20' : 'border-gray-200 dark:border-[#3f4150]'
            }`}
          >
            <View className={`w-5 h-5 rounded-full border-2 items-center justify-center ${paymentMethod === 'manual' ? 'border-accent-500' : 'border-gray-300'}`}>
              {paymentMethod === 'manual' && <View className="w-2.5 h-2.5 rounded-full bg-accent-500" />}
            </View>
            <Ionicons name="receipt-outline" size={22} color={paymentMethod === 'manual' ? '#7cb900' : '#9CA3AF'} />
            <View className="flex-1">
              <Text className={`font-semibold ${paymentMethod === 'manual' ? 'text-accent-700 dark:text-accent-400' : 'text-gray-900 dark:text-gray-100'}`}>
                Request Manual Payment
              </Text>
              <Text className="text-xs text-gray-500 dark:text-gray-400">Our team will contact you for payment details</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Manual payment info box */}
        {paymentMethod === 'manual' && (
          <View className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 mb-4">
            <View className="flex-row gap-3">
              <Ionicons name="information-circle" size={28} color="#3B82F6" />
              <View className="flex-1">
                <Text className="font-bold text-blue-900 dark:text-blue-300 mb-1">Order Confirmation</Text>
                <Text className="text-blue-800 dark:text-blue-300 text-sm leading-relaxed">
                  Our team will contact you shortly to confirm your order and provide payment details.
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Order Notes */}
        <View className="bg-white dark:bg-[#24252f] rounded-xl border border-gray-200 dark:border-[#3f4150] p-4 mb-4">
          <Text className="font-bold text-gray-900 dark:text-gray-100 text-base mb-2">Order Notes (Optional)</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Any special instructions or requests..."
            placeholderTextColor="#9CA3AF"
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            className="border border-gray-200 dark:border-[#3f4150] rounded-xl p-3 text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-[#2e303b] min-h-[80px]"
          />
        </View>

        {/* Order Summary */}
        <View className="bg-white dark:bg-[#24252f] rounded-xl border border-gray-200 dark:border-[#3f4150] p-4 mb-4">
          <Text className="font-bold text-gray-900 dark:text-gray-100 text-base mb-3">Order Summary</Text>
          <View className="flex-row justify-between mb-2">
            <Text className="text-gray-500 dark:text-gray-400">Subtotal ({items.length} items)</Text>
            <Text className="font-medium text-gray-900 dark:text-gray-100">
              ₹{subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </Text>
          </View>
          <View className="flex-row justify-between mb-3">
            <Text className="text-gray-500 dark:text-gray-400">Delivery</Text>
            <Text className="font-semibold text-green-600">FREE</Text>
          </View>
          <View className="flex-row justify-between pt-3 border-t border-gray-100 dark:border-[#3f4150]">
            <Text className="font-bold text-gray-900 dark:text-gray-100 text-base">Total</Text>
            <Text className="font-bold text-accent-500 text-base">
              ₹{subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </Text>
          </View>
          <Text className="text-xs text-gray-400 mt-1">Price inclusive of all taxes</Text>
        </View>

        {/* Contact Us */}
        <View className="bg-white dark:bg-[#24252f] rounded-xl border border-gray-200 dark:border-[#3f4150] p-4 mb-4">
          <Text className="font-bold text-gray-900 dark:text-gray-100 text-base mb-3">Contact Us</Text>
          <View className="gap-3">
            <TouchableOpacity onPress={() => Linking.openURL('tel:+918903031299')} className="flex-row items-center gap-3">
              <Ionicons name="call-outline" size={18} color="#7cb900" />
              <Text className="text-gray-600 dark:text-gray-400 text-sm">+91 89030 31299</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => Linking.openURL('tel:+919488354099')} className="flex-row items-center gap-3">
              <Ionicons name="call-outline" size={18} color="#7cb900" />
              <Text className="text-gray-600 dark:text-gray-400 text-sm">+91 94883 54099</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => Linking.openURL('mailto:jeffistoress@gmail.com')} className="flex-row items-center gap-3">
              <Ionicons name="mail-outline" size={18} color="#7cb900" />
              <Text className="text-gray-600 dark:text-gray-400 text-sm">jeffistoress@gmail.com</Text>
            </TouchableOpacity>
          </View>
        </View>

      </ScrollView>

      <View className="bg-white dark:bg-[#24252f] border-t border-gray-100 dark:border-[#3f4150] px-4 py-4">
        <TouchableOpacity
          onPress={handlePlaceOrder}
          disabled={isPending}
          className="bg-accent-500 py-4 rounded-xl items-center flex-row justify-center gap-2 disabled:opacity-50"
        >
          {isPending ? (
            <>
              <View className="w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
              <Text className="text-white font-bold text-base">
                {paymentMethod === 'razorpay' ? 'Opening Payment...' : 'Placing Order...'}
              </Text>
            </>
          ) : paymentMethod === 'razorpay' ? (
            <>
              <Ionicons name="lock-closed-outline" size={18} color="white" />
              <Text className="text-white font-bold text-base">
                Pay ₹{subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </Text>
            </>
          ) : (
            <>
              <Text className="text-white font-bold text-base">Place Order</Text>
              <Ionicons name="checkmark" size={18} color="white" />
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.back()} className="mt-3 items-center py-2">
          <Text className="text-accent-500 font-semibold text-sm">← Back to Review</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}
