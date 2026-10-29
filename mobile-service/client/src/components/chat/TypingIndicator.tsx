import { useEffect } from 'react'
import { View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated'
import { Text, useMotion } from '../../ui'

/** Tailwind animate-bounce dot (translateY -25% ↔ 0, 1s), staggered. */
function BounceDot({ delay }: { delay: number }) {
  const y = useSharedValue(-1.5)
  const { animate } = useMotion()
  useEffect(() => {
    if (!animate) return
    y.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(0, { duration: 500, easing: Easing.bezier(0, 0, 0.2, 1) }),
          withTiming(-1.5, { duration: 500, easing: Easing.bezier(0.8, 0, 1, 1) })
        ),
        -1
      )
    )
  }, [delay, y, animate])
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }))
  return <Animated.View className="h-1.5 w-1.5 rounded-full bg-foreground-muted" style={style} />
}

export default function TypingIndicator({ label }: { label?: string | null }) {
  return (
    <View className="flex-row justify-start pt-2" accessibilityLiveRegion="polite">
      <View accessible accessibilityLabel={label ?? 'Typing'} className="flex-row items-center gap-2 rounded-2xl rounded-bl-md border border-border-default bg-surface-elevated px-3 py-2.5">
        <View className="flex-row gap-1">
          <BounceDot delay={0} />
          <BounceDot delay={150} />
          <BounceDot delay={300} />
        </View>
        {label ? <Text className="text-[11px] text-foreground-muted">{label}</Text> : null}
      </View>
    </View>
  )
}
