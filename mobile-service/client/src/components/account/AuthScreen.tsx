import { useEffect, useMemo, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, Text, View, useWindowDimensions } from 'react-native'
import Animated, {
  Easing,
  SlideInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'
import { KeyboardScroll } from '../../ui/KeyboardScroll'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { X } from 'lucide-react-native'
import Gradient from './Gradient'
import { GoogleLogo } from './HeroIcon'
import { listCategories } from '../../api/categories'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import { useLeaveAuth } from './hooks'
import { accent, status, useTokens } from '../../theme'

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

  return (
    <View className="flex-1 bg-accent-600">
      <Animated.View style={panelStyle} className="overflow-hidden">
        <Gradient from={accent[600]} to={accent[400]} />
        <Animated.View style={fadeStyle} pointerEvents="none" className="absolute inset-0">
          <Mosaic top={compactHeight + 8} />
        </Animated.View>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center gap-3 px-4">
          <Pressable onPress={close} hitSlop={8} accessibilityLabel="Close" className="h-10 w-10 items-center justify-center rounded-full bg-white/20">
            <X size={20} color={status.white} />
          </Pressable>
          <BrandMark logoUrl={config.identity.logoUrl} name={storeName} />
          <Text numberOfLines={1} className="flex-1 text-lg font-bold text-white">
            {storeName}
          </Text>
        </View>
      </Animated.View>

      <Animated.View entering={SlideInDown.springify().damping(20).stiffness(160)} className="-mt-6 flex-1 overflow-hidden rounded-t-[28px] bg-surface-elevated">
        <KeyboardScroll
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 22, paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
        >
          <View className="mb-5">
            <Text className="text-[26px] font-black leading-8 tracking-tight text-foreground">{title}</Text>
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
        <Image source={{ uri: logoUrl }} style={{ width: 32, height: 32 }} contentFit="contain" />
      </View>
    )
  }
  return (
    <View className="h-10 w-10 items-center justify-center rounded-xl bg-white/25">
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
  const reduceMotion = useReducedMotion()
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

/** The sheet's main action: tall, rounded, presses down a touch. */
export function BigButton({
  label,
  loadingLabel,
  loading,
  disabled,
  onPress,
}: {
  label: string
  loadingLabel?: string
  loading?: boolean
  disabled?: boolean
  onPress: () => void
}) {
  const scale = useSharedValue(1)
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  const off = disabled || loading
  return (
    <Animated.View style={style}>
      <Pressable
        onPress={onPress}
        disabled={off}
        onPressIn={() => (scale.value = withSpring(0.97, { damping: 18, stiffness: 260 }))}
        onPressOut={() => (scale.value = withSpring(1, { damping: 18, stiffness: 260 }))}
        className={`h-14 w-full flex-row items-center justify-center gap-2 rounded-2xl ${off ? 'bg-accent-500/40' : 'bg-accent-500'}`}
      >
        {loading ? <ActivityIndicator size="small" color={status.white} /> : null}
        <Text className="text-base font-bold text-white">{loading && loadingLabel ? loadingLabel : label}</Text>
      </Pressable>
    </Animated.View>
  )
}

/** "or" rule + a white Google button. */
export function GoogleRow({ label, loading, onPress }: { label: string; loading: boolean; onPress: () => void }) {
  const t = useTokens()
  return (
    <View className="mt-5">
      <View className="mb-5 flex-row items-center gap-3">
        <View className="h-px flex-1 bg-border-default" />
        <Text className="text-xs font-medium uppercase tracking-wider text-foreground-muted">or</Text>
        <View className="h-px flex-1 bg-border-default" />
      </View>
      <Pressable
        onPress={onPress}
        disabled={loading}
        className={`h-14 w-full flex-row items-center justify-center gap-3 rounded-2xl border border-border-secondary bg-surface ${loading ? 'opacity-60' : 'active:bg-surface-secondary'}`}
      >
        {loading ? <ActivityIndicator size="small" color={t.foregroundMuted} /> : <GoogleLogo size={22} />}
        <Text className="text-base font-semibold text-foreground">{label}</Text>
      </Pressable>
    </View>
  )
}

/** The form's input frame: tall, rounded, accent ring while focused. */
export function Frame({ focused, children, className = '' }: { focused: boolean; children: ReactNode; className?: string }) {
  return (
    <View className={`h-14 flex-row items-center rounded-2xl border-2 px-4 ${focused ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20' : 'border-border-secondary bg-surface'} ${className}`}>
      {children}
    </View>
  )
}

/** Soft note above a form ("No account found for …"). */
export function Note({ children }: { children: ReactNode }) {
  return (
    <View className="mb-4 rounded-2xl bg-accent-50 px-4 py-3 dark:bg-accent-900/20">
      <Text className="text-sm leading-5 text-accent-800 dark:text-accent-200">{children}</Text>
    </View>
  )
}

/** Inline error under a field or button. */
export function FieldError({ message }: { message: string }) {
  if (!message) return null
  return <Text className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">{message}</Text>
}

/** A text link row ("Use email instead"). */
export function TextAction({ label, onPress, muted }: { label: string; onPress: () => void; muted?: boolean }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} className="self-start py-1">
      <Text className={`text-sm font-semibold ${muted ? 'text-foreground-secondary' : 'text-accent-600 dark:text-accent-400'}`}>{label}</Text>
    </Pressable>
  )
}

/** "By continuing, you agree to …" footnote. */
export function TermsNote() {
  const router = useRouter()
  return (
    <Text className="mt-6 text-center text-xs leading-5 text-foreground-muted">
      By continuing, you agree to our{' '}
      <Text className="font-semibold text-foreground-secondary" onPress={() => router.push('/legal/terms-and-conditions')}>
        Terms &amp; Conditions
      </Text>{' '}
      and{' '}
      <Text className="font-semibold text-foreground-secondary" onPress={() => router.push('/legal/privacy-policy')}>
        Privacy Policy
      </Text>
      .
    </Text>
  )
}
