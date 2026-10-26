import { useState } from 'react'
import { Pressable, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { ImageIcon } from 'lucide-react-native'
import { Badge, Button, Card, ModalSheet, Pill, Text, usePressScale } from '../../ui'
import { Grid, SectionHeading, useColumnWidth } from './layout'
import { useImageSource } from '../../hooks/useImageSource'
import { inr, num } from '../../lib/format'
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


function PhotoIcon({ color }: { color: string }) {
  return <ImageIcon size={32} color={color} strokeWidth={1} />
}

export default function RecentlyViewed({ section }: SectionProps) {
  const router = useRouter()
  const stored = useRecentlyViewedStore(s => s.items)
  const [quickView, setQuickView] = useState<RecentProduct | null>(null)
  // The last product stays in the sheet while it slides away.
  const [shown, setShown] = useState<RecentProduct | null>(null)
  if (quickView && quickView !== shown) setShown(quickView)
  const limit = sectionLimit(section, 6)
  const minItems = configNumber(section, 'minItems', 2, 12)
  const products = stored.slice(0, limit)

  if (products.length === 0 || products.length < minItems) return null

  const open = (slug: string) => router.push(`/product/${slug}`)

  return (
    <>
      <View className="px-4 py-12">
        <SectionHeading title={section.copy.title ?? 'Recently viewed'} className="mb-6" />
        <Grid cols={2} gap={12}>
          {products.map(product => (
            <Tile key={product.id} product={product} onPress={() => open(product.slug)} onLongPress={() => setQuickView(product)} />
          ))}
        </Grid>
      </View>

      {/* Long-press quick-view (mobile only on the web). */}
      <ModalSheet
        open={!!quickView}
        onClose={() => setQuickView(null)}
        footer={
          shown ? (
            <Button
              label="View Full Details"
              onPress={() => {
                const slug = shown.slug
                setQuickView(null)
                open(slug)
              }}
            />
          ) : null
        }
      >
        {shown ? <QuickView product={shown} /> : null}
      </ModalSheet>
    </>
  )
}

function Tile({ product, onPress, onLongPress }: { product: RecentProduct; onPress: () => void; onLongPress: () => void }) {
  const t = useTokens()
  const press = usePressScale(0.97)
  const discount = product.mrp && product.mrp > product.price ? Math.round(((product.mrp - product.price) / product.mrp) * 100) : 0
  const tile = useColumnWidth(2, 12)
  const image = useImageSource()(product.image, tile)
  return (
    <Animated.View style={press.style} className="flex-1">
      <Pressable
        className="flex-1"
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={450}
        unstable_pressDelay={80}
        accessibilityRole="button"
        accessibilityLabel={product.name}
        accessibilityHint="Long press for a quick view"
        {...press.handlers}
      >
        <Card padded={false} className="flex-1 overflow-hidden">
          <View className="relative aspect-square overflow-hidden bg-surface">
            {image ? (
              <Image recyclingKey={product.image} source={image} contentFit="cover" style={{ width: '100%', height: '100%' }} accessibilityLabel={product.name} />
            ) : (
              <View className="h-full w-full items-center justify-center">
                <PhotoIcon color={t.foregroundMuted} />
              </View>
            )}
            {discount > 0 ? <Pill label={`${discount}% off`} tone="accent" className="absolute left-1.5 top-1.5" /> : null}
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
                  ₹{num(product.mrp)}
                </Text>
              ) : null}
            </View>
          </View>
        </Card>
      </Pressable>
    </Animated.View>
  )
}

function QuickView({ product }: { product: RecentProduct }) {
  const t = useTokens()
  const image = useImageSource()(product.image, 72)
  const off = product.mrp && product.mrp > product.price ? Math.round(((product.mrp - product.price) / product.mrp) * 100) : 0
  return (
    <View>
      <View className="mb-4 flex-row gap-4">
        <View className="h-20 w-20 shrink-0 overflow-hidden rounded-field border border-border-default bg-surface-secondary">
          {image ? (
            <Image recyclingKey={product.image} source={image} contentFit="contain" style={{ flex: 1, margin: 4 }} accessibilityLabel={product.name} />
          ) : (
            <View className="h-full w-full items-center justify-center">
              <PhotoIcon color={t.foregroundMuted} />
            </View>
          )}
        </View>
        <View className="min-w-0 flex-1">
          <Text className="mb-1 text-base font-semibold text-foreground" style={{ lineHeight: 22 }}>
            {product.name}
          </Text>
          {product.brand ? <Text className="text-xs text-foreground-muted">{product.brand}</Text> : null}
        </View>
      </View>

      <View className="mb-4 flex-row items-center gap-3">
        <Text className="text-2xl font-bold text-primary-600 dark:text-primary-400">₹{inr(product.price)}</Text>
        {product.mrp && product.mrp > product.price ? (
          <>
            <Text className="text-sm text-foreground-muted line-through">₹{inr(product.mrp)}</Text>
            {off > 0 ? <Badge label={`${off}% off`} tone="accent" solid /> : null}
          </>
        ) : null}
      </View>

      <Text className="text-xs text-foreground-muted">Incl. all taxes</Text>
    </View>
  )
}
