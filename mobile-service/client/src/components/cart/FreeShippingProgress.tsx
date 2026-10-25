import { useEffect } from 'react'
import { View } from 'react-native'
import { Card, Text } from '../../ui'
import { useQuery } from '@tanstack/react-query'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { getFreeDeliveryRule } from '../../api/cart'
import { money } from './lines'

// Mirror of controller-service components/visitor/cart/FreeShippingProgress.tsx.
export default function FreeShippingProgress({ subtotal }: { subtotal: number }) {
  const { data: rule } = useQuery({ queryKey: ['free-delivery'], queryFn: getFreeDeliveryRule, staleTime: 300_000 })
  const active = !!rule && rule.freeThreshold > 0 && subtotal > 0
  const remaining = active ? Math.max(0, Math.round((rule!.freeThreshold - subtotal) * 100) / 100) : 0
  const unlocked = active && remaining === 0
  const percent = !active ? 0 : unlocked ? 100 : Math.min(100, (subtotal / rule!.freeThreshold) * 100)

  const width = useSharedValue(percent)
  useEffect(() => {
    width.value = withTiming(percent, { duration: 500 })
  }, [percent, width])
  const barStyle = useAnimatedStyle(() => ({ width: `${width.value}%` }))

  if (!active) return null

  return (
    <Card className="mb-4">
      {unlocked ? (
        <Text className="text-sm font-semibold text-green-700 dark:text-green-400">You have unlocked free delivery</Text>
      ) : (
        <Text className="text-sm text-foreground">
          Add <Text className="font-semibold">{money(remaining)}</Text> more to get free delivery
        </Text>
      )}
      <View className="mt-2 h-2 overflow-hidden rounded-full bg-surface-secondary">
        <Animated.View style={[{ height: '100%' }, barStyle]}>
          <View className={`h-full rounded-full ${unlocked ? 'bg-green-500' : 'bg-accent-500'}`} />
        </Animated.View>
      </View>
      <Text className="mt-1.5 text-xs text-foreground-muted">
        Free delivery on orders of {money(rule!.freeThreshold)} or more, for parcels under {rule!.weightLimitKg} kg.
      </Text>
    </Card>
  )
}
