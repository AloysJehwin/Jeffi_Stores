import { useEffect, useId, useState } from 'react'
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { Easing, cancelAnimation, makeMutable, useAnimatedStyle, withRepeat, withTiming } from 'react-native-reanimated'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { useColorScheme } from 'nativewind'
import { status } from '../theme'
import { cn } from './cn'
import { useMotion } from './motion'

// Placeholder blocks with a shimmer that sweeps across them. One clock drives every block on screen, so
// a page's skeleton shimmers as one; it runs only while a skeleton is mounted, and not at all with
// reduced motion on.

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
  const id = `s${useId().replace(/[^a-zA-Z0-9]/g, '')}`
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
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, band]}>
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={status.white} stopOpacity={0} />
                <Stop offset="0.5" stopColor={status.white} stopOpacity={colorScheme === 'dark' ? 0.07 : 0.55} />
                <Stop offset="1" stopColor={status.white} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill={`url(#${id})`} />
          </Svg>
        </Animated.View>
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
