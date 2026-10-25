import { useCallback, useRef } from 'react'
import { View, useWindowDimensions } from 'react-native'
import { Badge, Button, IconButton, Text } from '../../ui'
import { Image } from 'expo-image'
import { useFocusEffect, useRouter } from 'expo-router'
import { Check, Package, Plus } from 'lucide-react-native'
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue, type SharedValue } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Eyebrow } from './layout'
import { useHomeScrollY } from './scroll-context'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import { inr } from '../../lib/format'
import { absUrl } from '../../lib/links'
import { openQuickAdd } from '../../stores/quickAddStore'
import { useTokens } from '../../theme'
import type { SectionCopy, SectionProps, SpotlightData } from '../../types/home'

// One product, large: the image settles in and the callouts rise one after another as the card
// scrolls into view (driven by the home feed's scroll offset; static under reduced motion).

const COPY = { eyebrow: 'Spotlight', ctaLabel: 'Shop now' }
const TAB_BAR = 56
const UNMEASURED = -1

export default function ProductSpotlight({ section, data }: SectionProps) {
  const spot = data.extras[section.id] as SpotlightData | null | undefined
  if (!spot) return null
  return <Card spot={spot} copy={section.copy} />
}

function Card({ spot, copy }: { spot: SpotlightData; copy: SectionCopy }) {
  const { product, headline, callouts } = spot
  const router = useRouter()
  const t = useTokens()
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const reduceMotion = useReducedMotion()
  const scrollY = useHomeScrollY()
  const { digitalProductsEnabled } = useStoreConfig().flags
  const inStock = (digitalProductsEnabled && product.isDigital) || product.effectiveStock > 0
  const animate = !!scrollY && !reduceMotion
  const img = product.primaryImage
  const uri = img ? (absUrl(img.image_url) ?? img.image_url) : null
  const showMrp = product.mrp != null && product.mrp > product.displayPrice
  const title = headline ?? product.name
  const viewportBottom = height - TAB_BAR - insets.bottom
  const imageH = width - 2 * 16 - 2 * 20 // square image inside the padded card

  // Window Y of the card at measure time, paired with the scroll offset then: the current window Y
  // is top0 − (scrollY − scroll0), with no need to know what sits above the feed.
  const ref = useRef<View>(null)
  const top0 = useSharedValue(UNMEASURED)
  const scroll0 = useSharedValue(0)
  const calloutsTop = useSharedValue(0)
  const measure = useCallback(() => {
    if (!scrollY) return
    requestAnimationFrame(() => {
      ref.current?.measureInWindow((_x, y, _w, h) => {
        if (h <= 0) return
        top0.value = y
        scroll0.value = scrollY.value
      })
    })
  }, [scrollY, top0, scroll0])
  useFocusEffect(measure)

  const cardTop = useDerivedValue(() => (scrollY ? top0.value - (scrollY.value - scroll0.value) : 0))
  const imageProgress = useDerivedValue(() => {
    if (!animate || top0.value === UNMEASURED) return 1
    return interpolate(cardTop.value, [viewportBottom - 24, viewportBottom - imageH * 0.75 - 24], [0, 1], Extrapolation.CLAMP)
  })
  const calloutProgress = useDerivedValue(() => {
    if (!animate || top0.value === UNMEASURED) return 1
    return interpolate(cardTop.value + calloutsTop.value, [viewportBottom - 8, viewportBottom - 150], [0, 1], Extrapolation.CLAMP)
  })
  const imageStyle = useAnimatedStyle(() => ({
    opacity: 0.4 + 0.6 * imageProgress.value,
    transform: [{ scale: 0.9 + 0.1 * imageProgress.value }],
  }))

  const open = () => router.push(`/product/${product.slug}`)

  return (
    <View className="bg-surface px-4 py-8">
      <View ref={ref} collapsable={false} onLayout={measure} className="overflow-hidden rounded-sheet bg-surface-secondary p-5">
        <Animated.View style={imageStyle} className="aspect-square w-full items-center justify-center overflow-hidden rounded-panel bg-surface-elevated">
          {uri ? (
            <Image
              source={{ uri }}
              placeholder={img?.blurhash ? { blurhash: img.blurhash } : undefined}
              style={{ width: '100%', height: '100%' }}
              contentFit="contain"
              transition={200}
              accessibilityLabel={product.name}
            />
          ) : (
            <Package size={72} color={t.foregroundMuted} strokeWidth={1} />
          )}
        </Animated.View>

        <View className="mt-5">
          <Eyebrow>{copy.eyebrow ?? COPY.eyebrow}</Eyebrow>
          <Text accessibilityRole="header" className="font-display text-2xl font-extrabold leading-7 tracking-tight text-foreground" onPress={open}>
            {title}
          </Text>
          {product.brandName ? (
            <Text className="mt-1 text-xs font-semibold uppercase text-foreground-muted" style={{ letterSpacing: 0.3 }}>
              {product.brandName}
            </Text>
          ) : null}
          {title !== product.name ? (
            <Text accessibilityRole="link" className="mt-1 text-sm text-foreground-secondary" numberOfLines={2} onPress={open}>
              {product.name}
            </Text>
          ) : null}
          <View className="mt-3 flex-row flex-wrap items-center gap-x-2 gap-y-1">
            <Text className="text-3xl font-black text-primary-600 dark:text-primary-400">
              {product.hasVariants ? 'From ' : ''}₹{inr(product.displayPrice)}
            </Text>
            {showMrp ? <Text className="text-base text-foreground-muted line-through">₹{inr(product.mrp)}</Text> : null}
            {product.mrpDiscount > 0 ? <Badge label={`${product.mrpDiscount}% off`} tone="accent" solid /> : null}
          </View>
        </View>

        {callouts.length > 0 ? (
          <View className="mt-4 gap-2.5" onLayout={e => (calloutsTop.value = e.nativeEvent.layout.y)}>
            {callouts.map((text, k) => (
              <Callout key={k} text={text} k={k} progress={calloutProgress} />
            ))}
          </View>
        ) : null}

        <View className="mt-5 flex-row items-center gap-3">
          <Button label={copy.ctaLabel ?? COPY.ctaLabel} size="md" onPress={open} className="flex-1" />
          <IconButton
            icon={Plus}
            label={product.hasVariants ? `Choose options for ${product.name}` : `Quick add ${product.name} to cart`}
            variant="solid"
            size="lg"
            disabled={!inStock}
            onPress={() => openQuickAdd(product)}
          />
        </View>
      </View>
    </View>
  )
}

/** Callout k rises and fades in on its own slice of the card's entrance. */
function Callout({ text, k, progress }: { text: string; k: number; progress: SharedValue<number> }) {
  const t = useTokens()
  const style = useAnimatedStyle(() => {
    const p = interpolate(progress.value, [k * 0.18, k * 0.18 + 0.4], [0, 1], Extrapolation.CLAMP)
    return { opacity: p, transform: [{ translateY: 14 * (1 - p) }] }
  })
  return (
    <Animated.View style={style} className="flex-row items-start gap-2.5">
      <View className="mt-0.5 h-5 w-5 items-center justify-center rounded-full bg-accent-500/15">
        <Check size={12} color={t.accent500} strokeWidth={3} />
      </View>
      <Text className="flex-1 text-sm leading-5 text-foreground-secondary">{text}</Text>
    </Animated.View>
  )
}
