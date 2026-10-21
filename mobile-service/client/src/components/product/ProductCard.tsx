import { memo, useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { Heart, ImageIcon } from 'lucide-react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import QuickAddButton from './QuickAddButton'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import { useWishlistToggle } from '../../hooks/useWishlist'
import { useAuthStore } from '../../stores/authStore'
import { resolveEdd } from '../../lib/edd'
import { inr, shortDate } from '../../lib/format'
import { status, useTokens } from '../../theme'
import type { CardProduct } from '../../types/home'

// Mirror of controller-service components/visitor/ProductCard.tsx at the mobile breakpoint.

function SaleRibbon() {
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: 16, right: -16, width: 80, transform: [{ rotate: '45deg' }], zIndex: 10 }}
    >
      <Svg width={80} height={14} style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id="sale" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={status.saleFrom} />
            <Stop offset="1" stopColor={status.saleTo} />
          </LinearGradient>
        </Defs>
        <Rect width={80} height={14} fill="url(#sale)" />
      </Svg>
      <Text className="text-center font-bold text-white" style={{ fontSize: 8, lineHeight: 14 }}>
        SALE
      </Text>
    </View>
  )
}

function Pill({ label, className }: { label: string; className: string }) {
  return (
    <View className={`rounded-full px-2 py-0.5 ${className}`}>
      <Text className="text-xs font-semibold text-white">{label}</Text>
    </View>
  )
}

function ProductCard({ product, handlingDays = 2 }: { product: CardProduct; handlingDays?: number }) {
  const router = useRouter()
  const t = useTokens()
  const user = useAuthStore(s => s.user)
  const { gstEnabled, digitalProductsEnabled } = useStoreConfig().flags
  const digital = digitalProductsEnabled && product.isDigital
  const inStock = digital || product.effectiveStock > 0
  const { inWishlist, toggle, pending } = useWishlistToggle(product.id)
  const [edd, setEdd] = useState<string | null>(null)
  const img = product.primaryImage

  useEffect(() => {
    if (digital) return
    let live = true
    resolveEdd(!!user, handlingDays, product.extraDeliveryDays).then(v => {
      if (live && v) setEdd(v)
    })
    return () => {
      live = false
    }
  }, [digital, user, handlingDays, product.extraDeliveryDays])

  return (
    <Pressable
      onPress={() => router.push(`/product/${product.slug}`)}
      className="grow flex-col overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-sm"
    >
      <View className="px-3 pt-3">
        <View
          className="relative w-full overflow-hidden rounded-lg border-2 border-gray-300 dark:border-gray-600"
          style={{ aspectRatio: 5 / 3 }}
        >
          {img ? (
            <>
              <Image
                source={{ uri: img.image_url }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  opacity: 0.6,
                  transform: [{ scale: 1.1 }],
                }}
                contentFit="cover"
                blurRadius={24}
                cachePolicy="memory-disk"
                recyclingKey={img.image_url}
              />
              <Image
                source={{ uri: img.image_url }}
                placeholder={img.blurhash ? { blurhash: img.blurhash } : undefined}
                style={{ width: '100%', height: '100%' }}
                contentFit="contain"
                transition={200}
                cachePolicy="memory-disk"
                recyclingKey={img.image_url}
                accessibilityLabel={product.name}
              />
            </>
          ) : (
            <View className="flex-1 items-center justify-center">
              <ImageIcon size={48} color={t.foregroundMuted} strokeWidth={1} />
            </View>
          )}

          {product.discountPct > 0 && <SaleRibbon />}

          {(product.mrpDiscount > 0 || product.badge || digital) && (
            <View className="absolute left-2 top-2 items-start gap-1">
              {product.mrpDiscount > 0 && (
                <Pill label={`${product.mrpDiscount}% off`} className="bg-accent-500 dark:bg-accent-600" />
              )}
              {digital && <Pill label="Digital" className="bg-violet-600" />}
              {product.badge ? <Pill label={product.badge} className="bg-primary-500 dark:bg-primary-600" /> : null}
            </View>
          )}
        </View>
      </View>

      <View className="grow flex-col p-2.5">
        <View className="mb-1.5 flex-row items-start justify-between gap-2">
          <Text className="mb-1.5 min-h-[40px] flex-1 text-sm font-semibold text-foreground" numberOfLines={2}>
            {product.name}
          </Text>
          <View className="mt-0.5 shrink-0 flex-row items-center gap-1.5">
            <QuickAddButton product={product} inStock={inStock} />
            <Pressable
              onPress={toggle}
              disabled={pending}
              hitSlop={6}
              accessibilityLabel={inWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
              className="h-7 w-7 items-center justify-center rounded-full border border-border-default bg-surface-secondary disabled:opacity-60"
            >
              <Heart
                size={14}
                strokeWidth={2}
                color={inWishlist ? status.heart : t.foregroundMuted}
                fill={inWishlist ? status.heart : 'none'}
              />
            </Pressable>
          </View>
        </View>

        <View className="mb-2 gap-0.5">
          {product.brandName ? (
            <Text className="text-xs text-foreground-muted" numberOfLines={1}>
              Brand: {product.brandName}
            </Text>
          ) : null}
          {product.categoryName ? (
            <Text className="text-xs text-foreground-muted" numberOfLines={1}>
              Category: {product.categoryName}
            </Text>
          ) : null}
        </View>

        <View className="mt-auto">
          <View className="mb-0.5">
            <Text className="text-base font-bold leading-tight text-primary-600 dark:text-primary-400">
              {product.hasVariants ? 'From ' : ''}₹{inr(product.displayPrice)}
            </Text>
            {product.mrp && product.mrp > Number(product.displayPrice) ? (
              <Text className="text-xs leading-tight text-foreground-muted line-through">₹{inr(product.mrp)}</Text>
            ) : null}
          </View>
          {gstEnabled ? <Text className="mb-2 text-[10px] text-foreground-muted">Inclusive of all taxes</Text> : null}
          <View className="flex-row items-center justify-between gap-1">
            <Text className={`text-xs font-medium ${inStock ? 'text-green-600' : 'text-red-600'}`} numberOfLines={1}>
              {digital ? 'Instant access' : inStock ? 'In Stock' : 'Out of Stock'}
            </Text>
            <Text className="text-xs font-semibold text-accent-500" numberOfLines={1}>
              View Details →
            </Text>
          </View>
          {edd && !digital && inStock ? (
            <Text className="mt-0.5 text-[10px] text-foreground-muted">
              Deliver by <Text className="font-medium text-foreground">{shortDate(edd)}</Text>
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  )
}

export default memo(ProductCard)
