import { Pressable, View } from 'react-native'
import { Text } from '../../ui'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { getPopularProducts } from '../../api/account'
import { Grid } from '../home/layout'
import { ImageOff } from 'lucide-react-native'
import { useTokens } from '../../theme'

// Mirror of controller-service components/visitor/FeaturedProducts.tsx ("You might also like").

export default function FeaturedProducts() {
  const router = useRouter()
  const t = useTokens()
  const { data: products = [] } = useQuery({ queryKey: ['popular-products-4'], queryFn: getPopularProducts, staleTime: 5 * 60_000 })
  if (products.length === 0) return null

  return (
    <View className="mt-8">
      <Text className="text-base font-semibold text-foreground mb-3">You might also like</Text>
      <Grid cols={2} gap={12}>
        {products.map(p => {
          const image = p.product_images?.find(i => i.is_primary) || p.product_images?.[0]
          const price = Number(p.has_variants && p.variant_min_price ? p.variant_min_price : p.base_price)
          const mrp = p.mrp ? Number(p.mrp) : null
          const discount = mrp && mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0
          return (
            <Pressable
              key={p.id}
              onPress={() => router.push(`/product/${p.slug}`)}
              className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden"
            >
              <View className="relative bg-surface" style={{ aspectRatio: 1 }}>
                {image ? (
                  <Image source={{ uri: image.thumbnail_url }} style={{ position: 'absolute', top: 8, left: 8, right: 8, bottom: 8 }} contentFit="contain" />
                ) : (
                  <View className="flex-1 items-center justify-center">
                    <ImageOff size={36} color={t.foregroundMuted} strokeWidth={1.5} />
                  </View>
                )}
                {discount > 0 && (
                  <View className="absolute top-2 right-2 bg-accent-500 px-1.5 py-0.5 rounded-full">
                    <Text className="text-[11px] font-bold text-white">
                      {discount}% off
                    </Text>
                  </View>
                )}
              </View>
              <View className="p-3">
                <Text className="text-xs font-medium text-foreground mb-1" numberOfLines={2}>
                  {p.name}
                </Text>
                <View className="flex-row items-baseline gap-1.5">
                  <Text className="text-sm font-bold text-foreground">₹{price.toLocaleString('en-IN')}</Text>
                  {mrp != null && mrp > price && (
                    <Text className="text-[11px] text-foreground-muted line-through">
                      ₹{mrp.toLocaleString('en-IN')}
                    </Text>
                  )}
                </View>
              </View>
            </Pressable>
          )
        })}
      </Grid>
    </View>
  )
}
