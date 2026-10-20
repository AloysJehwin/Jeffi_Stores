import { useState, useEffect } from 'react'
import { View, Text, ScrollView, TouchableOpacity, Alert, useWindowDimensions } from 'react-native'
import { Image } from 'expo-image'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pushRecentlyViewed } from '../../src/stores/recentlyViewedStore'
import { Ionicons } from '@expo/vector-icons'
import { getProductBySlug } from '../../src/api/products'
import { addToCart } from '../../src/api/cart'
import { getWishlist, addToWishlist, removeFromWishlist } from '../../src/api/wishlist'
import { useAuthStore } from '../../src/stores/authStore'
import type { ProductVariant } from '../../src/types'
import TopNav from '../../src/components/layout/TopNav'
import Spinner from '../../src/components/ui/Spinner'

export default function ProductDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const router = useRouter()
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const { width } = useWindowDimensions()

  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [imageIndex, setImageIndex] = useState(0)

  const { data: product, isLoading } = useQuery({
    queryKey: ['product', slug],
    queryFn: () => getProductBySlug(slug),
  })

  useEffect(() => {
    if (product?.has_variants && product.product_variants?.length > 0) {
      const firstActive = product.product_variants.find((v) => v.is_active) ?? product.product_variants[0]
      setSelectedVariant(firstActive)
    }
  }, [product?.id])

  // Same entry the web's TrackRecentlyViewed records, feeding the home "Recently viewed" section.
  useEffect(() => {
    if (!product) return
    const p = product as typeof product & Record<string, any>
    const img = p.product_images?.find((i: any) => i.is_primary) || p.product_images?.[0]
    pushRecentlyViewed({
      id: p.id,
      name: p.name,
      slug: p.slug,
      price: Number(p.has_variants && p.variant_min_price ? p.variant_min_price : p.base_price),
      mrp: p.mrp ? Number(p.mrp) : null,
      brand: p.brands?.name ?? null,
      inStock: p.has_variants ? Number(p.variant_stock_total ?? 0) > 0 : p.stock_status !== 'Out of Stock',
      image: img?.thumbnail_url || img?.image_url || null,
      categoryId: p.category_id ?? null,
    })
  }, [product?.id])

  const { data: wishlistItems } = useQuery({
    queryKey: ['wishlist'],
    queryFn: getWishlist,
    enabled: !!user,
  })

  const isWishlisted = wishlistItems?.some((w) => w.product_id === product?.id) ?? false

  const addToCartMutation = useMutation({
    mutationFn: () => addToCart({
      product_id: product!.id,
      variant_id: selectedVariant?.id ?? (variants.length > 0 ? variants[0].id : null),
      quantity,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cart'] })
      Alert.alert('Added to Cart', `${product?.name} added to your cart.`, [
        { text: 'Continue Shopping' },
        { text: 'View Cart', onPress: () => router.push('/(tabs)/cart') },
      ])
    },
    onError: (err: any) => Alert.alert('Error', err.message || 'Failed to add to cart'),
  })

  const buyNowMutation = useMutation({
    mutationFn: () => addToCart({
      product_id: product!.id,
      variant_id: selectedVariant?.id ?? (variants.length > 0 ? variants[0].id : null),
      quantity,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cart'] })
      router.push('/checkout/review')
    },
    onError: (err: any) => Alert.alert('Error', err.message || 'Failed to proceed'),
  })

  const wishlistMutation = useMutation({
    mutationFn: () => isWishlisted ? removeFromWishlist(product!.id) : addToWishlist(product!.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wishlist'] }),
    onError: (err: any) => Alert.alert('Error', err.message || 'Failed to update wishlist'),
  })

  if (isLoading || !product) return <Spinner />

  const images = product.product_images || []
  const variants = product.product_variants || []
  const currentVariant = selectedVariant || (variants.length > 0 ? variants[0] : null)

  const price = currentVariant
    ? (currentVariant.sale_price ?? currentVariant.price ?? product.base_price)
    : (product.sale_price ?? product.base_price)
  const mrp = currentVariant?.mrp
    ? Number(currentVariant.mrp)
    : (product.mrp ? Number(product.mrp) : null)
  const discount = mrp && mrp > Number(price)
    ? Math.round(((mrp - Number(price)) / mrp) * 100)
    : 0
  const savings = mrp && mrp > Number(price) ? mrp - Number(price) : 0

  const stockQty = currentVariant ? currentVariant.stock_quantity : product.stock_quantity
  const inStock = stockQty > 0
  const needsVariant = product.has_variants && variants.length > 0 && !selectedVariant
  const canAct = inStock && !needsVariant

  return (
    <View className="flex-1 bg-white dark:bg-[#1a1b23]">
      <TopNav />

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Breadcrumb */}
        <View className="flex-row items-center px-4 py-2 flex-wrap gap-1">
          <TouchableOpacity onPress={() => router.push('/(tabs)')}>
            <Text className="text-xs text-gray-400">Home</Text>
          </TouchableOpacity>
          <Text className="text-xs text-gray-300 dark:text-gray-600"> / </Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/products')}>
            <Text className="text-xs text-gray-400">Products</Text>
          </TouchableOpacity>
          {product.categories && (
            <>
              <Text className="text-xs text-gray-300 dark:text-gray-600"> / </Text>
              <Text className="text-xs text-gray-400" numberOfLines={1}>{product.categories.name}</Text>
            </>
          )}
          <Text className="text-xs text-gray-300 dark:text-gray-600"> / </Text>
          <Text className="text-xs text-gray-700 dark:text-gray-300 font-medium" numberOfLines={1}>{product.name}</Text>
        </View>

        {/* Main image */}
        <View
          className="mx-3 rounded-xl overflow-hidden bg-gray-50 dark:bg-[#24252f] border border-gray-200 dark:border-[#3f4150]"
          style={{ height: width - 24 }}
        >
          {images.length > 0 ? (
            <>
              <Image
                source={{ uri: images[imageIndex]?.image_url }}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                contentFit="cover"
                blurRadius={24}
              />
              <Image
                source={{ uri: images[imageIndex]?.image_url }}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                contentFit="contain"
              />
            </>
          ) : (
            <View className="flex-1 items-center justify-center">
              <Ionicons name="image-outline" size={64} color="#9CA3AF" />
            </View>
          )}
        </View>

        {/* Thumbnail strip */}
        {images.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 12, gap: 8 }}>
            {images.map((img, i) => (
              <TouchableOpacity
                key={img.id}
                onPress={() => setImageIndex(i)}
                className={`w-16 h-16 rounded-lg border-2 overflow-hidden ${i === imageIndex ? 'border-accent-500' : 'border-gray-200 dark:border-[#3f4150]'}`}
              >
                <Image source={{ uri: img.thumbnail_url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        <View className="px-4 pt-3">
          {/* Name */}
          <Text
            className="text-2xl font-black text-gray-900 dark:text-gray-100 mb-2 leading-snug"
            style={{ fontStyle: 'italic' }}
          >
            {product.name}
          </Text>

          {product.brands && (
            <Text className="text-sm text-gray-500 dark:text-gray-400 mb-0.5">
              Brand: <Text className="font-semibold text-gray-700 dark:text-gray-300">{product.brands.name}</Text>
            </Text>
          )}
          {product.sku && (
            <Text className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              SKU: <Text className="font-semibold text-gray-700 dark:text-gray-300">{product.sku}</Text>
            </Text>
          )}

          {/* Variants */}
          {variants.length > 0 && (
            <View className="mb-4">
              <Text className="font-semibold text-gray-700 dark:text-gray-300 mb-2">
                {product.has_variants ? 'Select Length' : 'Variants'}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {variants.map((v) => {
                  const isSelected = currentVariant?.id === v.id
                  return (
                    <TouchableOpacity
                      key={v.id}
                      onPress={() => setSelectedVariant(v)}
                      disabled={!v.is_active}
                      className={`px-4 py-2 rounded-xl border-2 ${
                        isSelected
                          ? 'bg-accent-500 border-accent-500'
                          : 'border-gray-200 dark:border-[#3f4150] bg-white dark:bg-[#24252f]'
                      } ${!v.is_active ? 'opacity-40' : ''}`}
                    >
                      <Text className={`text-sm font-semibold ${isSelected ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                        {v.variant_name}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </View>
          )}

          {/* Price block */}
          <View className="bg-gray-50 dark:bg-[#24252f] rounded-xl p-4 mb-4 border border-gray-100 dark:border-[#3f4150]">
            <View className="flex-row items-baseline gap-3 mb-1 flex-wrap">
              <Text className="text-3xl font-black text-primary-500">
                Rs. {Number(price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </Text>
              {mrp && mrp > Number(price) && (
                <Text className="text-lg text-gray-400 line-through">
                  Rs. {mrp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </Text>
              )}
            </View>
            {discount > 0 && (
              <View className="flex-row items-center gap-2 mb-1">
                <View className="bg-accent-500 px-2 py-0.5 rounded-full">
                  <Text className="text-white text-xs font-bold">{discount}% off</Text>
                </View>
                <Text className="text-sm text-gray-500 dark:text-gray-400">
                  You save Rs. {savings.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </Text>
              </View>
            )}
            {product.gst_percentage && (
              <Text className="text-xs text-gray-400">
                Inclusive of all taxes ({product.gst_percentage}% GST)
              </Text>
            )}
          </View>

          {/* Stock */}
          <View className="flex-row items-center gap-2 mb-4">
            <Ionicons
              name={inStock ? 'checkmark-circle' : 'close-circle'}
              size={18}
              color={inStock ? '#7cb900' : '#EF4444'}
            />
            <Text className={`font-semibold text-sm ${inStock ? 'text-accent-600' : 'text-red-500'}`}>
              {inStock ? `In Stock (${stockQty} available)` : 'Out of Stock'}
            </Text>
          </View>

          {/* Quantity */}
          <Text className="font-medium text-gray-700 dark:text-gray-300 mb-2">Quantity</Text>
          <View className="flex-row items-center border border-gray-200 dark:border-[#3f4150] rounded-xl overflow-hidden self-start mb-6">
            <TouchableOpacity
              onPress={() => setQuantity((q) => Math.max(1, q - 1))}
              className="w-12 h-12 items-center justify-center bg-gray-50 dark:bg-[#2e303b]"
            >
              <Ionicons name="remove" size={20} color="#6B7280" />
            </TouchableOpacity>
            <Text className="w-12 text-center font-bold text-gray-900 dark:text-gray-100 text-base">{quantity}</Text>
            <TouchableOpacity
              onPress={() => setQuantity((q) => q + 1)}
              className="w-12 h-12 items-center justify-center bg-gray-50 dark:bg-[#2e303b]"
            >
              <Ionicons name="add" size={20} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {needsVariant && (
            <Text className="text-center text-sm text-orange-500 mb-3 font-medium">Please select a variant</Text>
          )}

          {/* Action buttons — matching website exactly */}
          <TouchableOpacity
            onPress={() => canAct && buyNowMutation.mutate()}
            disabled={!canAct || buyNowMutation.isPending}
            className={`py-4 rounded-xl items-center flex-row justify-center gap-2 mb-3 ${canAct ? 'bg-accent-500' : 'bg-gray-300 dark:bg-gray-700'}`}
          >
            <Ionicons name="flash-outline" size={18} color="white" />
            <Text className="text-white font-bold text-base">
              {buyNowMutation.isPending ? 'Processing...' : 'Buy Now'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => canAct && addToCartMutation.mutate()}
            disabled={!canAct || addToCartMutation.isPending}
            className={`py-4 rounded-xl items-center flex-row justify-center gap-2 mb-3 ${canAct ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-700'}`}
          >
            <Ionicons name="cart-outline" size={18} color="white" />
            <Text className="text-white font-bold text-base">
              {addToCartMutation.isPending ? 'Adding...' : 'Add to Cart'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              if (!user) { router.push('/(auth)/login'); return }
              wishlistMutation.mutate()
            }}
            disabled={wishlistMutation.isPending}
            className="py-3.5 rounded-xl items-center flex-row justify-center gap-2 mb-4 border-2 border-gray-200 dark:border-[#3f4150] bg-white dark:bg-[#24252f]"
          >
            <Ionicons name={isWishlisted ? 'heart' : 'heart-outline'} size={18} color={isWishlisted ? '#EF4444' : '#6B7280'} />
            <Text className="text-gray-600 dark:text-gray-300 font-semibold">
              {isWishlisted ? 'Saved to Wishlist' : 'Add to Wishlist'}
            </Text>
          </TouchableOpacity>

          {/* Support */}
          <View className="mb-3">
            <Text className="text-sm text-gray-500 dark:text-gray-400 mb-2">Need help with your order?</Text>
            <View className="border border-gray-200 dark:border-[#3f4150] rounded-xl py-3 px-4 flex-row items-center gap-2 mb-2 bg-white dark:bg-[#24252f]">
              <Ionicons name="call-outline" size={16} color="#6B7280" />
              <Text className="text-sm text-gray-600 dark:text-gray-400">Call: +91 89030 31299</Text>
            </View>
            <View className="border border-gray-200 dark:border-[#3f4150] rounded-xl py-3 px-4 flex-row items-center gap-2 bg-white dark:bg-[#24252f]">
              <Ionicons name="mail-outline" size={16} color="#6B7280" />
              <Text className="text-sm text-gray-600 dark:text-gray-400">Email Inquiry</Text>
            </View>
          </View>

          {/* Description */}
          {product.description && (
            <View className="mb-6 pt-4 border-t border-gray-100 dark:border-[#3f4150]">
              <Text className="font-bold text-gray-900 dark:text-gray-100 mb-2 text-base">Product Specifications</Text>
              <Text className="text-gray-600 dark:text-gray-400 leading-6 text-sm">{product.description}</Text>
            </View>
          )}

          <View className="h-8" />
        </View>
      </ScrollView>
    </View>
  )
}
