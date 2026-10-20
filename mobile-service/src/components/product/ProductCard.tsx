import { View, Text, TouchableOpacity } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { addToWishlist } from '../../api/wishlist'
import type { Product } from '../../types'

interface ProductCardProps {
  product: Product
}

export default function ProductCard({ product }: ProductCardProps) {
  const router = useRouter()
  const qc = useQueryClient()

  const primaryImage = product.product_images?.find((i) => i.is_primary) || product.product_images?.[0]
  const displayPrice = product.has_variants
    ? (product.variant_min_price ?? product.base_price)
    : (product.sale_price ?? product.base_price)
  const mrp = product.mrp ? Number(product.mrp) : null
  const discount = mrp && mrp > Number(displayPrice)
    ? Math.round(((mrp - Number(displayPrice)) / mrp) * 100)
    : 0
  const effectiveStock = product.has_variants
    ? Number(product.variant_stock_total ?? 0)
    : product.stock_quantity

  const wishlistMutation = useMutation({
    mutationFn: () => addToWishlist(product.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wishlist'] }),
  })

  return (
    <TouchableOpacity
      onPress={() => router.push(`/product/${product.slug}`)}
      className="bg-white dark:bg-[#24252f] rounded-xl border border-gray-200 dark:border-[#3f4150] overflow-hidden"
      activeOpacity={0.85}
    >
      <View className="relative">
        <View className="aspect-[4/3] border-b border-gray-100 dark:border-[#3f4150] overflow-hidden bg-gray-50 dark:bg-[#2e303b]">
          {primaryImage ? (
            <>
              <Image
                source={{ uri: primaryImage.image_url || primaryImage.thumbnail_url }}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                contentFit="cover"
                blurRadius={18}
              />
              <Image
                source={{ uri: primaryImage.image_url || primaryImage.thumbnail_url }}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                contentFit="contain"
              />
            </>
          ) : (
            <View className="flex-1 items-center justify-center">
              <Ionicons name="image-outline" size={32} color="#9CA3AF" />
            </View>
          )}
          {discount > 0 && (
            <View className="absolute top-2 right-2 bg-accent-500 px-2 py-0.5 rounded">
              <Text className="text-white text-[10px] font-bold">{discount}% off</Text>
            </View>
          )}
          {effectiveStock === 0 && (
            <View className="absolute inset-0 bg-black/40 items-center justify-center">
              <View className="bg-white px-2 py-0.5 rounded-full">
                <Text className="text-gray-700 text-xs font-bold">Out of Stock</Text>
              </View>
            </View>
          )}
        </View>
      </View>

      <View className="p-3">
        {(product.brands?.name) && (
          <Text className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">
            Brand: {product.brands.name}
          </Text>
        )}
        {(product.categories?.name) && (
          <Text className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">
            Category: {product.categories.name}
          </Text>
        )}
        <Text
          className="text-xs font-semibold text-gray-900 dark:text-gray-100 leading-snug mb-2"
          numberOfLines={2}
        >
          {product.name}
        </Text>
        <View className="flex-row items-baseline gap-1.5 flex-wrap mb-1">
          <Text className="text-sm font-extrabold text-primary-500">
            {product.has_variants ? 'From ' : ''}{'₹'}{Number(displayPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </Text>
          {mrp && mrp > Number(displayPrice) && (
            <Text className="text-[11px] text-gray-400 line-through">
              {'₹'}{mrp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </Text>
          )}
        </View>
        <Text className={`text-[11px] font-semibold ${effectiveStock > 0 ? 'text-accent-600' : 'text-red-500'}`}>
          {effectiveStock > 0 ? 'In Stock' : 'Out of Stock'}
        </Text>
      </View>
    </TouchableOpacity>
  )
}
