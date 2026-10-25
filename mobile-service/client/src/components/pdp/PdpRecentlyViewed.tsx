import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { ImageIcon } from 'lucide-react-native'
import { Badge, Button, Card, ModalSheet, Pill, Text, Title } from '../../ui'
import { Grid } from '../home/layout'
import { absUrl } from '../../lib/links'
import { inr } from '../../lib/format'
import { useRecentlyViewedStore, type RecentProduct } from '../../stores/recentlyViewedStore'
import { useTokens } from '../../theme'

// Mirror of controller-service components/visitor/RecentlyViewed.tsx as the PDP renders it (excludeId, minItems 2).

const noDecimals = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 0 })

function Photo({ uri, label, cover }: { uri: string | null; label: string; cover?: boolean }) {
  const t = useTokens()
  return uri ? (
    <Image recyclingKey={uri} source={{ uri }} contentFit={cover ? 'cover' : 'contain'} style={cover ? { width: '100%', height: '100%' } : { flex: 1, margin: 4 }} accessibilityLabel={label} />
  ) : (
    <View className="h-full w-full items-center justify-center">
      <ImageIcon size={32} strokeWidth={1} color={t.foregroundMuted} />
    </View>
  )
}

export default function PdpRecentlyViewed({ excludeId, limit = 6, minItems = 2 }: { excludeId: string; limit?: number; minItems?: number }) {
  const router = useRouter()
  const stored = useRecentlyViewedStore(s => s.items)
  const [quickView, setQuickView] = useState<RecentProduct | null>(null)
  // The last product stays in the sheet while it slides away.
  const [shown, setShown] = useState<RecentProduct | null>(null)
  if (quickView && quickView !== shown) setShown(quickView)
  const products = stored.filter(p => p.id !== excludeId).slice(0, limit)
  if (products.length === 0 || products.length < minItems) return null
  const open = (slug: string) => router.push(`/product/${slug}`)
  const qvDiscount = shown?.mrp && shown.mrp > shown.price ? Math.round(((shown.mrp - shown.price) / shown.mrp) * 100) : 0

  return (
    <>
      <View className="mt-8">
        <Title className="mb-4">Recently Viewed</Title>
        <Grid cols={2} gap={12}>
          {products.map(product => {
            const discount = product.mrp && product.mrp > product.price ? Math.round(((product.mrp - product.price) / product.mrp) * 100) : 0
            return (
              <Pressable
                key={product.id}
                accessibilityRole="button"
                accessibilityLabel={product.name}
                accessibilityHint="Long press for a quick view"
                className="flex-1 active:opacity-90"
                onPress={() => open(product.slug)}
                onLongPress={() => setQuickView(product)}
                delayLongPress={450}
              >
                <Card padded={false} className="flex-1 overflow-hidden">
                  <View className="relative aspect-square overflow-hidden bg-surface">
                    <Photo uri={absUrl(product.image)} label={product.name} cover />
                    {discount > 0 ? <Pill label={`${discount}% off`} tone="accent" className="absolute left-1.5 top-1.5" /> : null}
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
                </Card>
              </Pressable>
            )
          })}
        </Grid>
      </View>

      <ModalSheet
        open={!!quickView}
        onClose={() => setQuickView(null)}
        footer={
          <Button
            label="View Full Details"
            onPress={() => {
              if (!shown) return
              setQuickView(null)
              open(shown.slug)
            }}
          />
        }
      >
        {shown ? (
          <View className="pt-1">
            <View className="mb-4 flex-row gap-4">
              <View className="h-20 w-20 shrink-0 overflow-hidden rounded-field border border-border-default bg-surface-secondary">
                <Photo uri={absUrl(shown.image)} label={shown.name} />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="mb-1 text-base font-bold leading-[22px] text-foreground">{shown.name}</Text>
                {shown.brand ? <Text className="text-xs text-foreground-muted">{shown.brand}</Text> : null}
              </View>
            </View>
            <View className="mb-1 flex-row flex-wrap items-center gap-x-3 gap-y-1">
              <Text className="text-2xl font-extrabold text-primary-600 dark:text-primary-400">₹{inr(shown.price)}</Text>
              {shown.mrp && shown.mrp > shown.price ? (
                <>
                  <Text className="text-sm text-foreground-muted line-through">₹{inr(shown.mrp)}</Text>
                  {qvDiscount > 0 ? <Badge label={`${qvDiscount}% off`} tone="accent" solid /> : null}
                </>
              ) : null}
            </View>
            <Text className="text-xs text-foreground-muted">Incl. all taxes</Text>
          </View>
        ) : null}
      </ModalSheet>
    </>
  )
}
