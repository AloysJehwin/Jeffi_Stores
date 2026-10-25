import { useState } from 'react'
import { Modal, Pressable, View } from 'react-native'
import { Text } from '../../ui'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import Animated, { Easing, SlideInDown } from 'react-native-reanimated'
import Svg, { Path } from 'react-native-svg'
import { Grid } from './layout'
import { absUrl } from '../../lib/links'
import { inr } from '../../lib/format'
import { useTokens } from '../../theme'
import { useRecentlyViewedStore, type RecentProduct } from '../../stores/recentlyViewedStore'
import type { HomeSection, SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/RecentlyViewed.tsx as the homepage renders it.

// homepage-sections sectionLimit / configNumber.
function sectionLimit(section: HomeSection, fallback: number): number {
  const raw = section.config?.limit
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function configNumber(section: HomeSection, key: string, fallback: number, max = 100): number {
  const raw = section.config?.[key]
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : fallback
}

const noDecimals = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 0 })

function PhotoIcon({ color }: { color: string }) {
  return (
    <Svg width={32} height={32} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
        stroke={color}
        strokeWidth={1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export default function RecentlyViewed({ section }: SectionProps) {
  const router = useRouter()
  const t = useTokens()
  const stored = useRecentlyViewedStore(s => s.items)
  const [quickView, setQuickView] = useState<RecentProduct | null>(null)
  const limit = sectionLimit(section, 6)
  const minItems = configNumber(section, 'minItems', 2, 12)
  const products = stored.slice(0, limit)

  if (products.length === 0 || products.length < minItems) return null

  const open = (slug: string) => router.push(`/product/${slug}`)

  return (
    <>
      <View className="px-4 py-12">
        <Text className="mb-6 text-2xl font-bold text-foreground">{section.copy.title ?? 'Recently viewed'}</Text>
        <Grid cols={2} gap={12}>
          {products.map(product => {
            const discount = product.mrp && product.mrp > product.price ? Math.round(((product.mrp - product.price) / product.mrp) * 100) : 0
            const image = absUrl(product.image)
            return (
              <Pressable
                key={product.id}
                className="flex-1"
                onPress={() => open(product.slug)}
                onLongPress={() => setQuickView(product)}
                delayLongPress={450}
              >
                <View className="flex-1 overflow-hidden rounded-xl border border-border-default bg-surface-elevated">
                  <View className="relative aspect-square overflow-hidden bg-surface">
                    {image ? (
                      <Image source={{ uri: image }} contentFit="cover" style={{ width: '100%', height: '100%' }} accessibilityLabel={product.name} />
                    ) : (
                      <View className="h-full w-full items-center justify-center">
                        <PhotoIcon color={t.foregroundMuted} />
                      </View>
                    )}
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
                      <Text
                        numberOfLines={1}
                        className="text-xs font-medium uppercase text-accent-600 dark:text-accent-400"
                        style={{ letterSpacing: 0.3, lineHeight: 12 }}
                      >
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

      {/* Long-press quick-view (mobile only on the web). */}
      <Modal visible={!!quickView} transparent animationType="fade" onRequestClose={() => setQuickView(null)}>
        <View className="flex-1 justify-end">
          <Pressable className="absolute inset-0 bg-black/50" onPress={() => setQuickView(null)} />
          {quickView ? (
            <Animated.View
              entering={SlideInDown.duration(280).easing(Easing.bezier(0.32, 0.72, 0, 1))}
              className="rounded-t-2xl bg-surface-elevated p-5 pb-8 shadow-2xl"
            >
              <View className="mx-auto mb-4 h-1 w-10 rounded-full bg-border-default" />

              <View className="mb-4 flex-row gap-4">
                <View className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-border-default bg-surface-secondary">
                  {absUrl(quickView.image) ? (
                    <Image
                      source={{ uri: absUrl(quickView.image)! }}
                      contentFit="contain"
                      style={{ flex: 1, margin: 4 }}
                      accessibilityLabel={quickView.name}
                    />
                  ) : (
                    <View className="h-full w-full items-center justify-center">
                      <PhotoIcon color={t.foregroundMuted} />
                    </View>
                  )}
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
                    {Math.round(((quickView.mrp - quickView.price) / quickView.mrp) * 100) > 0 ? (
                      <View className="rounded-full bg-accent-500 px-2 py-0.5">
                        <Text className="text-xs font-semibold text-white">
                          {Math.round(((quickView.mrp - quickView.price) / quickView.mrp) * 100)}% off
                        </Text>
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
