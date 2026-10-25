import { useEffect, useMemo, type ReactNode } from 'react'
import { View, useWindowDimensions } from 'react-native'
import Animated, { Easing, SlideInDown, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { X } from 'lucide-react-native'
import { Button, Caption, Divider, IconButton, KeyboardScroll, Text, Title, useEntering, useMotion } from '../../ui'
import Gradient from './Gradient'
import { GoogleMark } from '../brand/Marks'
import { listCategories } from '../../api/categories'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import { useLeaveAuth } from './hooks'
import { accent } from '../../theme'

// The app's own sign-in frame (not the web card): a brand panel with a drifting mosaic of what the
// store sells, and a sheet that rises from the bottom with the form. The panel folds up while the
// keyboard is open so the form keeps the room.

const TILE = 64
const GAP = 10
const COMPACT_PANEL = 56

export function AuthScreen({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const close = useLeaveAuth()
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const config = useStoreConfig()
  const storeName = config.identity.name || 'Jeffi Stores'
  // 0 → 1 with the keyboard, frame by frame on both platforms.
  const { progress: folded } = useReanimatedKeyboardAnimation()

  const openHeight = Math.max(250, Math.round(windowHeight * 0.38))
  const compactHeight = insets.top + COMPACT_PANEL

  const panelStyle = useAnimatedStyle(() => ({ height: openHeight + (compactHeight - openHeight) * folded.value }))
  const fadeStyle = useAnimatedStyle(() => ({ opacity: 1 - folded.value }))
  const rise = useEntering(SlideInDown.springify().damping(20).stiffness(160))

  return (
    <View className="flex-1 bg-accent-600">
      <Animated.View style={panelStyle} className="overflow-hidden">
        <Gradient from={accent[600]} to={accent[400]} />
        <Animated.View style={fadeStyle} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden className="absolute inset-0">
          <Mosaic top={compactHeight + 8} />
        </Animated.View>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center gap-3 px-4">
          <IconButton icon={X} label="Close" variant="glass" onPress={close} />
          <BrandMark logoUrl={config.identity.logoUrl} name={storeName} />
          <Text numberOfLines={1} className="flex-1 text-lg font-bold text-white">
            {storeName}
          </Text>
        </View>
      </Animated.View>

      <Animated.View entering={rise} className="-mt-6 flex-1 overflow-hidden rounded-t-[28px] bg-surface-elevated">
        <KeyboardScroll
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 22, paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
        >
          <View className="mb-5">
            <Title>{title}</Title>
            {subtitle ? <Text className="mt-1.5 text-[15px] leading-5 text-foreground-secondary">{subtitle}</Text> : null}
          </View>
          {children}
        </KeyboardScroll>
      </Animated.View>
    </View>
  )
}

function BrandMark({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  if (logoUrl) {
    return (
      <View className="h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-white">
        <Image source={{ uri: logoUrl }} style={{ width: 32, height: 32 }} contentFit="contain" accessible={false} />
      </View>
    )
  }
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden className="h-10 w-10 items-center justify-center rounded-xl bg-white/25">
      <Text className="text-lg font-black text-white">{name.trim().charAt(0).toUpperCase() || 'S'}</Text>
    </View>
  )
}

/** Two rows of category images drifting in opposite directions; still when the system asks for less motion. */
function Mosaic({ top }: { top: number }) {
  const { data } = useQuery({ queryKey: ['categories'], queryFn: listCategories, staleTime: 5 * 60_000 })
  const images = useMemo(() => (data ?? []).map(c => c.image_url).filter((u): u is string => !!u), [data])
  if (images.length < 4) return null
  const half = Math.ceil(images.length / 2)
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top }} className="gap-2.5">
      <MosaicRow images={images.slice(0, half)} direction={-1} offset={0} />
      <MosaicRow images={images.slice(half).length >= 3 ? images.slice(half) : images} direction={1} offset={TILE / 2} />
    </View>
  )
}

function MosaicRow({ images, direction, offset }: { images: string[]; direction: 1 | -1; offset: number }) {
  const { reduced: reduceMotion } = useMotion()
  const span = images.length * (TILE + GAP)
  const x = useSharedValue(0)
  useEffect(() => {
    if (reduceMotion) return
    x.value = 0
    x.value = withRepeat(withTiming(direction * span, { duration: images.length * 4500, easing: Easing.linear }), -1, false)
  }, [direction, images.length, reduceMotion, span, x])
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: direction === -1 ? x.value - offset : x.value - span - offset }],
  }))
  // Three copies: the row is always covered while one span scrolls past.
  const strip = [...images, ...images, ...images]
  return (
    <Animated.View style={[{ flexDirection: 'row', gap: GAP, width: span * 3 }, style]}>
      {strip.map((uri, i) => (
        <View key={`${i}-${uri}`} style={{ width: TILE, height: TILE }} className="overflow-hidden rounded-2xl border border-white/30 bg-white/20">
          <Image source={{ uri }} style={{ width: TILE, height: TILE }} contentFit="cover" transition={200} />
        </View>
      ))}
    </Animated.View>
  )
}

/** "or" rule + a Google button. */
export function GoogleRow({ label, loading, onPress }: { label: string; loading: boolean; onPress: () => void }) {
  return (
    <View className="mt-5">
      <View className="mb-5 flex-row items-center gap-3">
        <Divider className="flex-1" />
        <Caption className="uppercase tracking-wider">or</Caption>
        <Divider className="flex-1" />
      </View>
      <Button label={label} variant="outline" icon={GoogleMark} loading={loading} onPress={onPress} />
    </View>
  )
}

/** "By continuing, you agree to …" footnote. */
export function TermsNote() {
  const router = useRouter()
  return (
    <Text className="mt-6 text-center text-xs leading-5 text-foreground-muted">
      By continuing, you agree to our{' '}
      <Text accessibilityRole="link" className="font-semibold text-foreground-secondary" onPress={() => router.push('/legal/terms-and-conditions')}>
        Terms &amp; Conditions
      </Text>{' '}
      and{' '}
      <Text accessibilityRole="link" className="font-semibold text-foreground-secondary" onPress={() => router.push('/legal/privacy-policy')}>
        Privacy Policy
      </Text>
      .
    </Text>
  )
}
