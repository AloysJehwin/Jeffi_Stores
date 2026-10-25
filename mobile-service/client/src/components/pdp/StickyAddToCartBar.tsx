import { View } from 'react-native'
import { Image } from 'expo-image'
import Animated, { SlideInDown, SlideOutDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ShoppingCart, Zap } from 'lucide-react-native'
import { Button, Text, elevationClass, useElevation, useEntering } from '../../ui'
import { unitText, type StickyBarAction } from './pdp'
import { inr } from '../../lib/format'

// Mirror of controller-service components/visitor/pdp/StickyAddToCartBar.tsx: shown once the main buttons scroll away.

export const COMPARE_BAR_HEIGHT = 73

export default function StickyAddToCartBar({
  action,
  visible,
  name,
  image,
  price,
  unitLabel,
  quantity,
  adding,
  onAdd,
  onChoose,
  buyNow = false,
  aboveCompareBar = false,
}: {
  action: StickyBarAction
  visible: boolean
  name: string
  image?: string | null
  price: number
  unitLabel?: string | null
  quantity: number
  adding: boolean
  onAdd: () => void
  onChoose: () => void
  buyNow?: boolean
  aboveCompareBar?: boolean
}) {
  const insets = useSafeAreaInsets()
  const shadow = useElevation('floating')
  const entering = useEntering(SlideInDown.duration(250))
  const exiting = useEntering(SlideOutDown.duration(200))
  if (!action || !visible) return null
  const unit = unitLabel ? unitText(unitLabel) : null

  return (
    <Animated.View
      entering={entering}
      exiting={exiting}
      accessibilityLabel={buyNow ? 'Quick buy' : 'Quick add to cart'}
      className={`absolute inset-x-0 z-30 rounded-t-sheet bg-surface-elevated ${elevationClass('floating')}`}
      style={[
        shadow,
        {
          bottom: aboveCompareBar ? COMPARE_BAR_HEIGHT + insets.bottom : 0,
          paddingBottom: aboveCompareBar ? 0 : insets.bottom,
        },
      ]}
    >
      <View className="flex-row items-center gap-3 px-4 py-3">
        <View className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-border-default bg-surface-secondary">
          {image ? <Image recyclingKey={image} source={{ uri: image }} style={{ width: '100%', height: '100%' }} contentFit="contain" /> : null}
        </View>
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-sm font-semibold text-foreground">
            {name}
          </Text>
          <View className="flex-row items-baseline gap-x-2 overflow-hidden">
            <Text numberOfLines={1} className="text-base font-extrabold text-primary-600 dark:text-primary-400">
              Rs. {inr(price)}
            </Text>
            {unit ? <Text className="text-xs text-foreground-secondary">/ {unit}</Text> : null}
            {quantity !== 1 ? <Text className="text-xs text-foreground-muted">Qty {quantity}</Text> : null}
          </View>
        </View>
        {action === 'add' ? (
          <Button
            label={buyNow ? 'Buy Now' : 'Add to Cart'}
            loadingLabel={buyNow ? 'Processing...' : 'Adding...'}
            icon={buyNow ? Zap : ShoppingCart}
            loading={adding}
            size="md"
            block={false}
            haptics
            onPress={onAdd}
          />
        ) : (
          <Button label="Choose options" size="md" block={false} onPress={onChoose} />
        )}
      </View>
    </Animated.View>
  )
}
