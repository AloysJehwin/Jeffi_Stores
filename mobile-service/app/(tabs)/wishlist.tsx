import { View, Text, FlatList, TouchableOpacity } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { getWishlist, removeFromWishlist } from '../../src/api/wishlist'
import { useAuthStore } from '../../src/stores/authStore'
import TopNav from '../../src/components/layout/TopNav'
import Spinner from '../../src/components/ui/Spinner'

export default function WishlistScreen() {
  const router = useRouter()
  const { user } = useAuthStore()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['wishlist'],
    queryFn: getWishlist,
    enabled: !!user,
  })

  const removeMutation = useMutation({
    mutationFn: removeFromWishlist,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wishlist'] }),
  })

  const items = data || []

  if (!user) {
    return (
      <View className="flex-1 bg-gray-50 dark:bg-[#1a1b23]">
        <TopNav />
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="heart-outline" size={72} color="#9CA3AF" />
          <Text className="text-gray-900 dark:text-gray-100 text-lg font-bold mt-4">Sign in to view wishlist</Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/login')} className="mt-6 bg-accent-500 px-8 py-3 rounded-xl">
            <Text className="text-white font-semibold">Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-gray-50 dark:bg-[#1a1b23]">
      <TopNav />

      <View className="px-4 py-3 bg-white dark:bg-[#24252f] border-b border-gray-100 dark:border-[#3f4150]">
        <Text className="text-xl font-extrabold text-gray-900 dark:text-gray-100">Wishlist</Text>
      </View>

      {isLoading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="heart-outline" size={72} color="#9CA3AF" />
          <Text className="text-gray-900 dark:text-gray-100 text-lg font-bold mt-4">No saved items yet</Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/products')} className="mt-6 bg-accent-500 px-8 py-3 rounded-xl">
            <Text className="text-white font-semibold">Browse Products</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 20 }}
          columnWrapperStyle={{ gap: 12 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const product = item.products
            if (!product?.id) {
              return (
                <View className="flex-1 bg-white dark:bg-[#24252f] rounded-xl border border-gray-200 dark:border-[#3f4150] overflow-hidden p-3">
                  <View className="aspect-[4/3] bg-gray-100 dark:bg-[#2e303b] rounded-lg items-center justify-center mb-2">
                    <Ionicons name="alert-circle-outline" size={32} color="#9CA3AF" />
                  </View>
                  <Text className="text-xs text-gray-400 mb-2">Product unavailable</Text>
                  <TouchableOpacity onPress={() => removeMutation.mutate(item.product_id)} className="flex-row items-center gap-1">
                    <Ionicons name="trash-outline" size={14} color="#EF4444" />
                    <Text className="text-red-500 text-xs">Remove</Text>
                  </TouchableOpacity>
                </View>
              )
            }
            const primaryImage = product.product_images?.find((i: any) => i.is_primary) || product.product_images?.[0]
            const price = product.sale_price ?? product.base_price
            return (
              <TouchableOpacity
                onPress={() => router.push(`/product/${product.slug}`)}
                className="flex-1 bg-white dark:bg-[#24252f] rounded-xl border border-gray-200 dark:border-[#3f4150] overflow-hidden"
              >
                <View className="aspect-[4/3] bg-gray-100 dark:bg-[#2e303b] relative">
                  {primaryImage ? (
                    <>
                      <Image source={{ uri: primaryImage.thumbnail_url }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} contentFit="cover" blurRadius={14} />
                      <Image source={{ uri: primaryImage.thumbnail_url }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} contentFit="contain" />
                    </>
                  ) : (
                    <View className="flex-1 items-center justify-center">
                      <Ionicons name="image-outline" size={36} color="#9CA3AF" />
                    </View>
                  )}
                </View>
                <View className="p-3">
                  <Text className="text-xs font-semibold text-gray-900 dark:text-gray-100 mb-1" numberOfLines={2}>{product.name}</Text>
                  <Text className="text-sm font-bold text-primary-500 mb-2">
                    Rs. {Number(price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </Text>
                  <TouchableOpacity onPress={() => removeMutation.mutate(item.product_id)} className="flex-row items-center gap-1">
                    <Ionicons name="trash-outline" size={14} color="#EF4444" />
                    <Text className="text-red-500 text-xs">Remove</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            )
          }}
        />
      )}
    </View>
  )
}
