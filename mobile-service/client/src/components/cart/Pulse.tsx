import { useEffect, useRef, type ReactNode } from 'react'
import { Animated, Easing, View } from 'react-native'

/** Tailwind's animate-pulse: opacity 1 → 0.5 → 1 every 2s. */
export default function Pulse({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const opacity = useRef(new Animated.Value(1)).current
  useEffect(() => {
    const ease = Easing.bezier(0.4, 0, 0.6, 1)
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.5, duration: 1000, easing: ease, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 1000, easing: ease, useNativeDriver: true }),
      ])
    )
    const t = setTimeout(() => loop.start(), delay)
    return () => {
      clearTimeout(t)
      loop.stop()
    }
  }, [opacity, delay])
  return (
    <Animated.View style={{ opacity }}>
      <View className={className}>{children}</View>
    </Animated.View>
  )
}
