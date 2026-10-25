import { useState } from 'react'
import { Modal, Pressable, View } from 'react-native'
import { Text } from '../../ui'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import Animated, { Easing, SlideInDown } from 'react-native-reanimated'
import { Glyph, P } from './Glyph'
import { Grid } from '../home/layout'
import { absUrl } from '../../lib/links'
import { inr } from '../../lib/format'
import { useRecentlyViewedStore, type RecentProduct } from '../../stores/recentlyViewedStore'

// Mirror of controller-service components/visitor/RecentlyViewed.tsx as the PDP renders it (excludeId, minItems 2).

const noDecimals = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 0 })

function Photo({ uri, label, cover }: { uri: string | null; label: string; cover?: boolean }) {
  return uri ? (
    <Image source={{ uri }} contentFit={cover ? 'cover' : 'contain'} style={cover ? { width: '100%', height: '100%' } : { flex: 1, margin: 4 }} accessibilityLabel={label} />
  ) : (
    <View className="h-full w-full items-center justify-center">
      <Glyph d={P.photo} size={32} strokeWidth={1} className="text-foreground-muted" />
    </View>
  )
}

export default function PdpRecentlyViewed({ excludeId, limit = 6, minItems = 2 }: { excludeId: string; limit?: number; minItems?: number }) {
  const router = useRouter()
  const stored = useRecentlyViewedStore(s => s.items)
  const [quickView, setQuickView] = useState<RecentProduct | null>(null)
  const products = stored.filter(p => p.id !== excludeId).slice(0, limit)
  if (products.length === 0 || products.length < minItems) return null
  const open = (slug: string) => router.push(`/product/${slug}`)
  const qvDiscount = quickView?.mrp && quickView.mrp > quickView.price ? Math.round(((quickView.mrp - quickView.price) / quickView.mrp) * 100) : 0

  return (
    <>
      <View className="mt-10">
        <Text className="mb-6 text-2xl font-bold text-foreground">Recently Viewed</Text>
        <Grid cols={2} gap={12}>
          {products.map(product => {
            const discount = product.mrp && product.mrp > product.price ? Math.round(((product.mrp - product.price) / product.mrp) * 100) : 0
            return (
              <Pressable key={product.id} className="flex-1" onPress={() => open(product.slug)} onLongPress={() => setQuickView(product)} delayLongPress={450}>
                <View className="flex-1 overflow-hidden rounded-xl border border-border-default bg-surface-elevated">
                  <View className="relative aspect-square overflow-hidden bg-surface">
                    <Photo uri={absUrl(product.image)} label={product.name} cover />
                    {discount > 0 ? (
                      <View className="absolute left-1.5 top-1.5 rounded-full bg-accent-500 px-1.5 py-0.5 shadow">
                        <Text className="text-xs font-bold text-white" style={{ lineHeight: 12 }}>
                          {discount}% off
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <View className="flex-1 gap-0.5 p-2">
                    {product.brand ? (
                      <Text numberOfLines={1} className="text-xs font-medium uppercase text-accent-600 dark:text-accent-400" style={{ letterSpacing: 0.3, lineHeight: 12 }}>
                        {product.brand}
                      </Text>
                    ) : null}
                    <Text numberOfLines={2} className="flex-1 text-xs font-medium text-foreground" style={{ lineHeight: 16.5 }}>
                      {product.name}
                    </Text>
                    <View className="mt-0.5 flex-row items-baseline gap-1">
                      <Text className="text-xs font-bold text-primary-600 dark:text-primary-400">₹{inr(product.price)}</Text>
                      {product.mrp && product.mrp > product.price ? (
                        <Text className="text-xs text-foreground-muted line-through" style={{ lineHeight: 12 }}>
                          ₹{noDecimals(product.mrp)}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </View>
              </Pressable>
            )
          })}
        </Grid>
      </View>

      <Modal visible={!!quickView} transparent animationType="fade" onRequestClose={() => setQuickView(null)}>
        <View className="flex-1 justify-end">
          <Pressable className="absolute inset-0 bg-black/50" onPress={() => setQuickView(null)} />
          {quickView ? (
            <Animated.View entering={SlideInDown.duration(280).easing(Easing.bezier(0.32, 0.72, 0, 1))} className="rounded-t-2xl bg-surface-elevated p-5 pb-8 shadow-2xl">
              <View className="mx-auto mb-4 h-1 w-10 rounded-full bg-border-default" />
              <View className="mb-4 flex-row gap-4">
                <View className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-border-default bg-surface-secondary">
                  <Photo uri={absUrl(quickView.image)} label={quickView.name} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="mb-1 text-base font-semibold text-foreground" style={{ lineHeight: 22 }}>
                    {quickView.name}
                  </Text>
                  {quickView.brand ? <Text className="text-xs text-foreground-muted">{quickView.brand}</Text> : null}
                </View>
              </View>
              <View className="mb-4 flex-row items-center gap-3">
                <Text className="text-2xl font-bold text-primary-600 dark:text-primary-400">₹{inr(quickView.price)}</Text>
                {quickView.mrp && quickView.mrp > quickView.price ? (
                  <>
                    <Text className="text-sm text-foreground-muted line-through">₹{inr(quickView.mrp)}</Text>
                    {qvDiscount > 0 ? (
                      <View className="rounded-full bg-accent-500 px-2 py-0.5">
                        <Text className="text-xs font-semibold text-white">{qvDiscount}% off</Text>
                      </View>
                    ) : null}
                  </>
                ) : null}
              </View>
              <Text className="mb-5 text-xs text-foreground-muted">Incl. all taxes</Text>
              <Pressable
                className="w-full rounded-xl bg-accent-500 py-3"
                onPress={() => {
                  const slug = quickView.slug
                  setQuickView(null)
                  open(slug)
                }}
              >
                <Text className="text-center font-semibold text-white">View Full Details</Text>
              </Pressable>
            </Animated.View>
          ) : null}
        </View>
      </Modal>
    </>
  )
}
