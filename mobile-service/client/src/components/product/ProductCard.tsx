import { memo, useEffect, useState } from 'react'
import { Pressable, View, useWindowDimensions, type AccessibilityActionEvent } from 'react-native'
import Animated from 'react-native-reanimated'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { Heart, ImageIcon } from 'lucide-react-native'
import QuickAddButton from './QuickAddButton'
import { openQuickAdd } from '../../stores/quickAddStore'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import { useWishlistToggle } from '../../hooks/useWishlist'
import { useImageSource } from '../../hooks/useImageSource'
import { useAuthStore } from '../../stores/authStore'
import { peekEdd, resolveEdd } from '../../lib/edd'
import { inr, shortDate } from '../../lib/format'
import { productLabel } from '../../lib/a11y'
import { status, useTokens } from '../../theme'
import { IconButton, Pill, Text, elevationClass, haptic, useElevation, usePressScale } from '../../ui'
import type { CardProduct } from '../../types/home'

// Mirror of controller-service components/visitor/ProductCard.tsx at the mobile breakpoint.

const BACKDROP = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.6, transform: [{ scale: 1.1 }] } as const
const FILL = { width: '100%', height: '100%' } as const
const PRESS_DELAY = 80

function ProductCard({ product, handlingDays = 2 }: { product: CardProduct; handlingDays?: number }) {
  const router = useRouter()
  const t = useTokens()
  const user = useAuthStore(s => s.user)
  const { gstEnabled, digitalProductsEnabled } = useStoreConfig().flags
  const digital = digitalProductsEnabled && product.isDigital
  const inStock = digital || product.effectiveStock > 0
  const { inWishlist, toggle, pending } = useWishlistToggle(product.id)
  const [edd, setEdd] = useState<string | null>(() => (digital ? null : (peekEdd(!!user, handlingDays, product.extraDeliveryDays) ?? null)))
  const img = product.primaryImage
  const imgSource = useImageSource()
  const { width: screen } = useWindowDimensions()
  // Two cards a row on phones; rails show a little less.
  const cardWidth = Math.min(screen / 2, 320)
  const shadow = useElevation('raised')
  const press = usePressScale(0.98)
  const stock = digital ? 'Digital, instant access' : inStock ? 'In stock' : 'Out of stock'
  const label = productLabel({
    name: product.name,
    price: product.displayPrice,
    from: product.hasVariants,
    mrp: product.mrp,
    discountPct: product.mrpDiscount || undefined,
    stock,
    extra: [!product.mrpDiscount && product.discountPct > 0 && 'On sale', product.badge, edd && !digital && inStock && `Deliver by ${shortDate(edd)}`],
  })
  // The "+" and heart sit inside the card, so screen readers reach them as actions on it too.
  const actions = [
    ...(inStock ? [{ name: 'quickAdd', label: product.hasVariants ? 'Choose options' : 'Quick add to cart' }] : []),
    ...(pending ? [] : [{ name: 'wishlist', label: inWishlist ? 'Remove from wishlist' : 'Add to wishlist' }]),
  ]
  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'quickAdd') openQuickAdd(product)
    else if (e.nativeEvent.actionName === 'wishlist') toggle()
  }

  useEffect(() => {
    if (digital) return
    const known = peekEdd(!!user, handlingDays, product.extraDeliveryDays)
    if (known !== undefined) return setEdd(known)
    let live = true
    resolveEdd(!!user, handlingDays, product.extraDeliveryDays).then(v => {
      if (live && v) setEdd(v)
    })
    return () => {
      live = false
    }
  }, [digital, user, handlingDays, product.extraDeliveryDays])

  return (
    <Animated.View style={[shadow, { borderRadius: 20 }, press.style]} className="grow">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityActions={actions}
        onAccessibilityAction={onAction}
        onPress={() => router.push(`/product/${product.slug}`)}
        // A scroll that starts on the card doesn't squeeze it.
        unstable_pressDelay={PRESS_DELAY}
        onLongPress={() => {
          if (!inStock) return
          haptic.tap()
          openQuickAdd(product)
        }}
        {...press.handlers}
        className={`grow flex-col overflow-hidden rounded-panel bg-surface-elevated ${elevationClass('raised')}`}
      >
        <View className="px-3 pt-3">
          <View
            className="relative w-full overflow-hidden rounded-lg border-2 border-gray-300 dark:border-gray-600"
            style={{ aspectRatio: 5 / 3 }}
          >
            {img ? (
              <>
                {/* Blurred backdrop: the blurhash when there is one (no second download or blur pass). */}
                <Image
                  source={img.blurhash ? { blurhash: img.blurhash } : imgSource(img.image_url, 64)}
                  style={BACKDROP}
                  contentFit="cover"
                  blurRadius={img.blurhash ? undefined : 24}
                  cachePolicy="memory-disk"
                  recyclingKey={img.image_url}
                  accessible={false}
                />
                <Image
                  source={imgSource(img.image_url, cardWidth)}
                  placeholder={img.blurhash ? { blurhash: img.blurhash } : undefined}
                  style={FILL}
                  contentFit="contain"
                  transition={200}
                  cachePolicy="memory-disk"
                  recyclingKey={img.image_url}
                  accessible={false}
                />
              </>
            ) : (
              <View className="flex-1 items-center justify-center" importantForAccessibility="no-hide-descendants">
                <ImageIcon size={48} color={t.foregroundMuted} strokeWidth={1} />
              </View>
            )}

            {(product.mrpDiscount > 0 || product.discountPct > 0 || product.badge || digital) && (
              <View pointerEvents="none" className="absolute left-2 top-2 items-start gap-1">
                {product.mrpDiscount > 0 ? (
                  <Pill label={`${product.mrpDiscount}% off`} tone="accent" />
                ) : product.discountPct > 0 ? (
                  <Pill label="Sale" tone="danger" />
                ) : null}
                {digital && <Pill label="Digital" tone="digital" />}
                {product.badge ? <Pill label={product.badge} tone="brand" /> : null}
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
              <IconButton
                icon={Heart}
                label={inWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
                size="xs"
                variant="tinted"
                filled={inWishlist}
                color={inWishlist ? status.heart : t.foregroundMuted}
                onPress={toggle}
                disabled={pending}
              />
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
            {gstEnabled ? <Text className="mb-2 text-[11px] text-foreground-muted">Inclusive of all taxes</Text> : null}
            <View className="flex-row items-center justify-between gap-1">
              <Text className={`text-xs font-medium ${inStock ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} numberOfLines={1}>
                {digital ? 'Instant access' : inStock ? 'In Stock' : 'Out of Stock'}
              </Text>
              <Text className="text-xs font-semibold text-accent-500" numberOfLines={1}>
                View Details →
              </Text>
            </View>
            {edd && !digital && inStock ? (
              <Text className="mt-0.5 text-[11px] text-foreground-muted">
                Deliver by <Text className="font-medium text-foreground">{shortDate(edd)}</Text>
              </Text>
            ) : null}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  )
}

export default memo(ProductCard)
