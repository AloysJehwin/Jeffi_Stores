import { useEffect, useState } from 'react'
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { Easing, cancelAnimation, makeMutable, useAnimatedStyle, withRepeat, withTiming } from 'react-native-reanimated'
import { useColorScheme } from 'nativewind'
import { status } from '../theme'
import { cn } from './cn'
import { linearGradient } from './Gradient'
import { useMotion } from './motion'

// Placeholder blocks with a shimmer that sweeps across them. One clock drives every block on screen, so
// a page's skeleton shimmers as one; it runs only while a skeleton is mounted, and not at all with
// reduced motion on.

const sheen = (o: number) => linearGradient([[0, status.white, 0], [0.5, status.white, o], [1, status.white, 0]], 'r')
const SHEEN_LIGHT = sheen(0.55)
const SHEEN_DARK = sheen(0.07)

const clock = makeMutable(0)
let mounted = 0

function useClock(active: boolean) {
  useEffect(() => {
    if (!active) return
    if (mounted++ === 0) {
      clock.value = 0
      clock.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.quad) }), -1, false)
    }
    return () => {
      if (--mounted === 0) cancelAnimation(clock)
    }
  }, [active])
}

export interface SkeletonProps {
  width?: DimensionValue
  height?: DimensionValue
  /** A rounded-* class (default rounded-lg). */
  rounded?: string
  /** Square by width/height, e.g. 1 for an avatar, 5 / 3 for a banner. */
  aspectRatio?: number
  className?: string
  style?: StyleProp<ViewStyle>
}

export function Skeleton({ width, height = 14, rounded = 'rounded-lg', aspectRatio, className, style }: SkeletonProps) {
  const { animate } = useMotion()
  const { colorScheme } = useColorScheme()
  const [w, setW] = useState(0)
  useClock(animate)
  const band = useAnimatedStyle(() => ({ transform: [{ translateX: -w + clock.value * 2 * w }] }))
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={e => setW(e.nativeEvent.layout.width)}
      style={[{ width, height: aspectRatio ? undefined : height, aspectRatio }, style]}
      className={cn('overflow-hidden bg-surface-secondary', rounded, className)}
    >
      {animate && w > 0 ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { experimental_backgroundImage: colorScheme === 'dark' ? SHEEN_DARK : SHEEN_LIGHT }, band]} />
      ) : null}
    </View>
  )
}

/** A few lines of text, the last one shorter. */
export function SkeletonText({ lines = 3, lineHeight = 12, className }: { lines?: number; lineHeight?: number; className?: string }) {
  return (
    <View className={cn('gap-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={lineHeight} width={lines > 1 && i === lines - 1 ? '60%' : '100%'} rounded="rounded-md" />
      ))}
    </View>
  )
}
