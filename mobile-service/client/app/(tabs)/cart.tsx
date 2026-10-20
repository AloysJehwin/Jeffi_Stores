import { View, Text, FlatList, TouchableOpacity } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { getCart, updateCartItem, removeCartItem } from '../../src/api/cart'
import { useAuthStore } from '../../src/stores/authStore'
import type { CartItem } from '../../src/types'
import TopNav from '../../src/components/layout/TopNav'
import Spinner from '../../src/components/ui/Spinner'

function CartItemRow({ item }: { item: CartItem }) {
  const qc = useQueryClient()

  const updateMutation = useMutation({
    mutationFn: (qty: number) => updateCartItem(item.id, qty),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cart'] }),
  })
  const removeMutation = useMutation({
    mutationFn: () => removeCartItem(item.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cart'] }),
  })

  const primaryImage = item.products.product_images?.find((i) => i.is_primary) || item.products.product_images?.[0]
  const price = item.variant?.sale_price ?? item.variant?.price ?? item.products.sale_price ?? item.products.base_price
  const total = price * item.quantity

  return (
    <View className="flex-row gap-3 bg-white dark:bg-[#24252f] rounded-xl p-3 border border-gray-200 dark:border-[#3f4150]">
      <View className="w-20 h-20 rounded-lg bg-gray-100 dark:bg-[#2e303b] overflow-hidden border border-gray-100 dark:border-[#3f4150]">
        {primaryImage ? (
          <>
            <Image
              source={{ uri: primaryImage.thumbnail_url }}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
              contentFit="cover"
              blurRadius={12}
            />
            <Image
              source={{ uri: primaryImage.thumbnail_url }}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
              contentFit="contain"
            />
          </>
        ) : (
          <View className="flex-1 items-center justify-center">
            <Ionicons name="image-outline" size={28} color="#9CA3AF" />
          </View>
        )}
      </View>

      <View className="flex-1">
        <Text className="font-semibold text-gray-900 dark:text-gray-100 text-sm leading-snug" numberOfLines={2}>
          {item.products.name}
        </Text>
        {item.variant && (
          <Text className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{item.variant.variant_name}</Text>
        )}
        <Text className="text-primary-500 font-bold mt-1 text-sm">
          Rs. {total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
        </Text>
        <View className="flex-row items-center justify-between mt-2">
          <View className="flex-row items-center border border-gray-200 dark:border-[#3f4150] rounded-lg overflow-hidden">
            <TouchableOpacity
              onPress={() => item.quantity > 1 && updateMutation.mutate(item.quantity - 1)}
              className="w-8 h-8 items-center justify-center bg-gray-50 dark:bg-[#2e303b]"
              disabled={updateMutation.isPending}
            >
              <Ionicons name="remove" size={16} color="#6B7280" />
            </TouchableOpacity>
            <Text className="w-8 text-center text-gray-900 dark:text-gray-100 font-semibold text-sm">
              {Math.round(Number(item.quantity))}
            </Text>
            <TouchableOpacity
              onPress={() => updateMutation.mutate(item.quantity + 1)}
              className="w-8 h-8 items-center justify-center bg-gray-50 dark:bg-[#2e303b]"
              disabled={updateMutation.isPending}
            >
              <Ionicons name="add" size={16} color="#6B7280" />
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={() => removeMutation.mutate()} disabled={removeMutation.isPending}>
            <Ionicons name="trash-outline" size={18} color="#EF4444" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}

export default function CartScreen() {
  const router = useRouter()
  const { user } = useAuthStore()
  const { data, isLoading } = useQuery({ queryKey: ['cart'], queryFn: getCart })

  const items = data?.items || []
  const subtotal = items.reduce((sum, item) => {
    const price = item.variant?.sale_price ?? item.variant?.price ?? item.products.sale_price ?? item.products.base_price
    return sum + price * item.quantity
  }, 0)

  if (isLoading) return (
    <View className="flex-1 bg-gray-50 dark:bg-[#1a1b23]">
      <TopNav />
      <Spinner />
    </View>
  )

  return (
    <View className="flex-1 bg-gray-50 dark:bg-[#1a1b23]">
      <TopNav />

      {items.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="cart-outline" size={80} color="#9CA3AF" />
          <Text className="text-gray-900 dark:text-gray-100 text-xl font-bold mt-4">Your cart is empty</Text>
          <Text className="text-gray-500 dark:text-gray-400 text-sm mt-1 text-center">
            Start shopping to add items to your cart
          </Text>
          <TouchableOpacity
            onPress={() => router.push('/(tabs)/products')}
            className="mt-6 bg-accent-500 px-8 py-3.5 rounded-xl"
          >
            <Text className="text-white font-bold">Browse Products</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View className="flex-1">
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 20 }}
            renderItem={({ item }) => <CartItemRow item={item} />}
            showsVerticalScrollIndicator={false}
          />
          <View className="bg-white dark:bg-[#24252f] border-t border-gray-200 dark:border-[#3f4150] px-4 pt-4 pb-6">
            <View className="flex-row justify-between mb-1.5">
              <Text className="text-gray-600 dark:text-gray-400">Subtotal</Text>
              <Text className="font-semibold text-gray-900 dark:text-gray-100">
                Rs. {subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </Text>
            </View>
            <View className="flex-row justify-between mb-1.5">
              <Text className="text-gray-600 dark:text-gray-400">Delivery</Text>
              <Text className="font-semibold text-accent-600">FREE</Text>
            </View>
            <View className="flex-row justify-between pt-3 mb-4 border-t border-gray-100 dark:border-[#3f4150]">
              <Text className="font-bold text-gray-900 dark:text-gray-100 text-base">Total</Text>
              <Text className="font-bold text-primary-500 text-base">
                Rs. {subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => { if (!user) router.push('/(auth)/login'); else router.push('/checkout/review') }}
              className="bg-accent-500 py-4 rounded-xl items-center flex-row justify-center gap-2"
            >
              <Text className="text-white font-bold text-base">Proceed to Checkout</Text>
              <Ionicons name="arrow-forward" size={18} color="white" />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  )
}
