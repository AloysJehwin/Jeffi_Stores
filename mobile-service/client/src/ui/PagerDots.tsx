import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import { cn } from './cn'
import { useMotion } from './motion'

// The current dot stretches into a pill. `foreground` sits on the page, `white` on media, `primary` marks
// the current dot in the brand colour over dim foreground ones.
const TONES = {
  foreground: { off: 'bg-foreground', on: null, dim: 0.25 },
  white: { off: 'bg-white', on: null, dim: 0.35 },
  primary: { off: 'bg-foreground', on: 'bg-primary-500', dim: 0.2 },
} as const
export type DotTone = keyof typeof TONES

const ACTIVE_W = 20

export interface PagerDotsProps {
  count: number
  /** The current page, when the dots follow state (a crossfade). */
  index?: number
  /** The scroll offset and snap interval, when the dots follow a scroll pager (they track the drag). */
  x?: SharedValue<number>
  page?: number
  onSelect?: (index: number) => void
  label?: (index: number) => string
  tone?: DotTone
  /** Dot height and resting width; also the gap. */
  size?: number
  className?: string
  style?: StyleProp<ViewStyle>
}

export function PagerDots({ count, index = 0, x, page = 1, onSelect, label = i => `Go to slide ${i + 1}`, tone = 'foreground', size = 8, className, style }: PagerDotsProps) {
  const [current, setCurrent] = useState(0)
  useAnimatedReaction(
    () => (x ? Math.min(count - 1, Math.max(0, Math.round(x.value / page))) : -1),
    (cur, prev) => {
      if (cur >= 0 && cur !== prev) runOnJS(setCurrent)(cur)
    },
    [x, page, count]
  )
  if (count < 2) return null
  const selected = x ? current : index
  return (
    <View className={cn('flex-row items-center justify-center', className)} style={[{ gap: size }, style]}>
      {Array.from({ length: count }, (_, i) => (
        <Dot key={i} i={i} on={i === selected} x={x} page={page} size={size} tone={tone} label={label(i)} onPress={onSelect ? () => onSelect(i) : undefined} />
      ))}
    </View>
  )
}

function Dot({
  i,
  on,
  x,
  page,
  size,
  tone,
  label,
  onPress,
}: {
  i: number
  on: boolean
  x?: SharedValue<number>
  page: number
  size: number
  tone: DotTone
  label: string
  onPress?: () => void
}) {
  const { animate } = useMotion()
  const k = TONES[tone]
  const t = useSharedValue(on ? 1 : 0)
  useEffect(() => {
    if (!x) t.value = withTiming(on ? 1 : 0, { duration: animate ? 300 : 0 })
  }, [on, x, t, animate])
  const range = [(i - 1) * page, i * page, (i + 1) * page]
  const p = useDerivedValue(() => (x ? interpolate(x.value, range, [0, 1, 0], Extrapolation.CLAMP) : t.value))
  const dim = k.dim
  const two = !!k.on

  const frame = useAnimatedStyle(() => ({ width: size + (ACTIVE_W - size) * p.value }))
  const base = useAnimatedStyle(() => ({ opacity: two ? dim : dim + (1 - dim) * p.value }))
  const lit = useAnimatedStyle(() => ({ opacity: p.value }))

  return (
    <Pressable onPress={onPress} disabled={!onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }}>
      <Animated.View style={[{ height: size, borderRadius: size / 2, overflow: 'hidden' }, frame]}>
        <Animated.View className={k.off} style={[StyleSheet.absoluteFill, base]} />
        {k.on ? <Animated.View className={k.on} style={[StyleSheet.absoluteFill, lit]} /> : null}
      </Animated.View>
    </Pressable>
  )
}
