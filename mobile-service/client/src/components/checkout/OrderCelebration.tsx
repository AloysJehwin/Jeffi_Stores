import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import Animated, {
  Easing, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated'
import Svg, { Circle, Path } from 'react-native-svg'
import { status } from '../../theme'

// Mirror of controller-service app/(storefront)/account/orders/confirmation/OrderCelebration.tsx.
const AnimatedCircle = Animated.createAnimatedComponent(Circle)
const AnimatedPath = Animated.createAnimatedComponent(Path)
const CIRCLE = 2 * Math.PI * 10
const CHECK = 11

// Celebrate an order once per app session (the web keeps this in localStorage).
const seen = new Set<string>()

function CheckmarkDraw({ animate }: { animate: boolean }) {
  const circle = useSharedValue(animate ? 0 : 1)
  const check = useSharedValue(animate ? 0 : 1)
  useEffect(() => {
    if (!animate) return
    circle.value = withTiming(1, { duration: 500, easing: Easing.inOut(Easing.ease) })
    check.value = withDelay(400, withTiming(1, { duration: 400, easing: Easing.out(Easing.ease) }))
  }, [animate, circle, check])
  const circleProps = useAnimatedProps(() => ({ strokeDashoffset: CIRCLE * (1 - circle.value), opacity: circle.value }))
  const checkProps = useAnimatedProps(() => ({ strokeDashoffset: CHECK * (1 - check.value) }))
  return (
    <Svg width={64} height={64} viewBox="0 0 24 24" fill="none">
      <AnimatedCircle
        cx={12}
        cy={12}
        r={10}
        stroke={status.success}
        strokeWidth={2}
        strokeDasharray={[CIRCLE, CIRCLE]}
        strokeLinecap="round"
        transform="rotate(-90 12 12)"
        animatedProps={circleProps}
      />
      <AnimatedPath
        d="M8.5 12.5l2.5 2.5 5-5"
        stroke={status.success}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={[CHECK, CHECK]}
        animatedProps={checkProps}
      />
    </Svg>
  )
}

export default function OrderCelebration({ orderId, orderNumber }: { orderId: string; orderNumber: string }) {
  const reduced = useReducedMotion()
  const [animate] = useState(() => !seen.has(orderId) && !reduced)
  useEffect(() => {
    seen.add(orderId)
  }, [orderId])

  const card = useSharedValue(animate ? 0 : 1)
  useEffect(() => {
    if (animate) card.value = withTiming(1, { duration: 450, easing: Easing.out(Easing.ease) })
  }, [animate, card])
  const cardStyle = useAnimatedStyle(() => ({ opacity: card.value, transform: [{ scale: 0.96 + 0.04 * card.value }] }))

  return (
    <Animated.View style={[{ marginBottom: 32 }, cardStyle]}>
      <View className="items-center rounded-lg border-2 border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/30">
        <View className="mb-4">
          <CheckmarkDraw animate={animate} />
        </View>
        <Text className="mb-2 text-center text-3xl font-bold text-foreground">Order Confirmed!</Text>
        <Text className="mb-4 text-center text-foreground-secondary">
          Thank you for your purchase. Your order has been successfully placed.
        </Text>
        <View className="items-center rounded-lg bg-surface-elevated p-4">
          <Text className="mb-1 text-sm text-foreground-secondary">Order Number</Text>
          <Text className="text-2xl font-bold text-accent-600 dark:text-accent-400">{orderNumber}</Text>
        </View>
      </View>
    </Animated.View>
  )
}
