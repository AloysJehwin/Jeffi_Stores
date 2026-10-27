import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring } from 'react-native-reanimated'
import { Plus } from 'lucide-react-native'
import { openQuickAdd, useQuickAddStore } from '../../stores/quickAddStore'
import { useTokens } from '../../theme'
import { IconButton, useMotion } from '../../ui'
import type { CardProduct } from '../../types/home'

/** The web's round "+" button: opens the quick-add sheet (options, quantity) and bounces once an item lands in the cart. */
export default function QuickAddButton({ product, inStock }: { product: CardProduct; inStock: boolean }) {
  const t = useTokens()
  const addedSeq = useQuickAddStore(s => (s.addedProductId === product.id ? s.addedSeq : 0))
  const scale = useSharedValue(1)
  const bounced = useSharedValue(false)
  const seen = useRef(addedSeq)
  const { animate } = useMotion()

  useEffect(() => {
    // 0 means another product was added last; only a new sequence for this one bounces.
    if (!addedSeq || addedSeq === seen.current) return
    seen.current = addedSeq
    if (!animate) return
    bounced.value = true
    scale.value = withSequence(withSpring(1.35, { damping: 6, stiffness: 320 }), withSpring(1, { damping: 10, stiffness: 220 }))
  }, [addedSeq, scale, bounced, animate])

  // Empty until the first bounce, like usePressScale, so a list of cards doesn't each register a style.
  const style = useAnimatedStyle(() => (bounced.value ? { transform: [{ scale: scale.value }] } : {}))

  if (!inStock) {
    return (
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden className="h-7 w-7 items-center justify-center rounded-full border border-border-default bg-surface-secondary opacity-60">
        <Plus size={14} color={t.foregroundMuted} strokeWidth={2.5} />
      </View>
    )
  }

  return (
    <Animated.View style={style}>
      <IconButton
        icon={Plus}
        label={product.hasVariants ? `Choose options for ${product.name}` : `Quick add ${product.name} to cart`}
        size="xs"
        variant="solid"
        onPress={() => openQuickAdd(product)}
      />
    </Animated.View>
  )
}
