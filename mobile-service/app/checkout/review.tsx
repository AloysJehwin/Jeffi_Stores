import { useState, useEffect } from 'react'
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native'
import { Image } from 'expo-image'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { listAddresses } from '../../src/api/addresses'
import { getCart } from '../../src/api/cart'
import Spinner from '../../src/components/ui/Spinner'

export default function CheckoutReviewScreen() {
  const router = useRouter()
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null)

  const { data: addresses, isLoading: addrLoading } = useQuery({
    queryKey: ['addresses'],
    queryFn: listAddresses,
  })

  useEffect(() => {
    if (addresses && !selectedAddressId) {
      const def = addresses.find((a) => a.is_default) || addresses[0]
      if (def) setSelectedAddressId(def.id)
    }
  }, [addresses])

  const { data: cartData, isLoading: cartLoading } = useQuery({
    queryKey: ['cart'],
    queryFn: getCart,
  })

  if (addrLoading || cartLoading) return <Spinner />

  const items = cartData?.items || []
  const addrList = addresses || []

  const subtotal = items.reduce((sum, item) => {
    const price = item.variant?.sale_price ?? item.variant?.price ?? item.products.sale_price ?? item.products.base_price
    return sum + price * Number(item.quantity)
  }, 0)

  const handleContinue = () => {
    if (!selectedAddressId) {
      Alert.alert('Select Address', 'Please select a delivery address to continue.')
      return
    }
    router.push({ pathname: '/checkout/payment', params: { addressId: selectedAddressId } })
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50 dark:bg-[#1a1b23]">
      <View className="flex-row items-center px-4 py-3 border-b border-gray-100 dark:border-[#3f4150] bg-white dark:bg-[#24252f]">
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#6B7280" />
        </TouchableOpacity>
        <Text className="flex-1 text-center font-bold text-gray-900 dark:text-gray-100 text-base">Order Review</Text>
        <View className="w-6" />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>

        {/* Delivery Address */}
        <View className="bg-white dark:bg-[#24252f] rounded-xl border border-gray-200 dark:border-[#3f4150] p-4 mb-4">
          <View className="flex-row justify-between items-center mb-3">
            <Text className="font-bold text-gray-900 dark:text-gray-100 text-base">Delivery Address</Text>
            <TouchableOpacity onPress={() => router.push('/account/addresses')}>
              <Text className="text-accent-500 text-sm font-semibold">+ Add New</Text>
            </TouchableOpacity>
          </View>

          {addrList.length === 0 ? (
            <View className="py-4 items-center">
              <Ionicons name="location-outline" size={40} color="#9CA3AF" />
              <Text className="text-gray-500 dark:text-gray-400 mb-3 mt-2">No saved addresses</Text>
              <TouchableOpacity
                onPress={() => router.push('/account/addresses')}
                className="bg-accent-500 px-5 py-2.5 rounded-xl"
              >
                <Text className="text-white font-semibold">Add Address</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View className="gap-3">
              {addrList.map((addr) => (
                <TouchableOpacity
                  key={addr.id}
                  onPress={() => setSelectedAddressId(addr.id)}
                  className={`p-3.5 rounded-xl border-2 ${
                    selectedAddressId === addr.id
                      ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20'
                      : 'border-gray-200 dark:border-[#3f4150]'
                  }`}
                >
                  <View className="flex-row items-center gap-2 mb-1">
                    <View className={`w-4 h-4 rounded-full border-2 items-center justify-center ${
                      selectedAddressId === addr.id ? 'border-accent-500' : 'border-gray-300'
                    }`}>
                      {selectedAddressId === addr.id && (
                        <View className="w-2 h-2 rounded-full bg-accent-500" />
                      )}
                    </View>
                    <Text className="font-semibold text-gray-900 dark:text-gray-100">{addr.full_name}</Text>
                    {addr.is_default && (
                      <View className="bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded-full">
                        <Text className="text-green-700 dark:text-green-400 text-[10px] font-semibold">Default</Text>
                      </View>
                    )}
                    <View className="bg-gray-100 dark:bg-[#3f4150] px-2 py-0.5 rounded-full ml-auto">
                      <Text className="text-gray-500 dark:text-gray-400 text-[10px] capitalize">{addr.address_type}</Text>
                    </View>
                  </View>
                  <Text className="text-gray-600 dark:text-gray-400 text-sm ml-6">
                    {addr.address_line1}{addr.address_line2 ? `, ${addr.address_line2}` : ''}
                  </Text>
                  {addr.landmark ? (
                    <Text className="text-gray-500 dark:text-gray-400 text-xs ml-6">Landmark: {addr.landmark}</Text>
                  ) : null}
                  <Text className="text-gray-600 dark:text-gray-400 text-sm ml-6">
                    {addr.city}, {addr.state} {addr.postal_code}
                  </Text>
                  <Text className="text-gray-500 dark:text-gray-400 text-sm ml-6">Phone: {addr.phone}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Order Items */}
        <View className="bg-white dark:bg-[#24252f] rounded-xl border border-gray-200 dark:border-[#3f4150] p-4 mb-4">
          <Text className="font-bold text-gray-900 dark:text-gray-100 text-base mb-3">
            Order Items ({items.length})
          </Text>
          {items.map((item) => {
            const isCustomQty = item.buy_mode === 'weight' || item.buy_mode === 'length'
            const price = isCustomQty
              ? item.price_at_addition
              : (item.variant?.sale_price ?? item.variant?.price ?? item.products.sale_price ?? item.products.base_price)
            const qty = isCustomQty
              ? `${Number(item.quantity).toFixed(3)} ${item.buy_unit ?? ''}`
              : String(Math.round(Number(item.quantity)))
            const itemTotal = Number(price ?? 0) * Number(item.quantity)
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

      </ScrollView>

      <View className="bg-white dark:bg-[#24252f] border-t border-gray-100 dark:border-[#3f4150] px-4 py-4">
        <TouchableOpacity
          onPress={handleContinue}
          disabled={!selectedAddressId || addrList.length === 0}
          className="bg-accent-500 py-4 rounded-xl items-center flex-row justify-center gap-2 disabled:opacity-50"
        >
          <Text className="text-white font-bold text-base">Continue to Payment</Text>
          <Ionicons name="arrow-forward" size={18} color="white" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}
