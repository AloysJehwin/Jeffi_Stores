import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { getReviewCoupon } from '../../api/cart'
import { useAuthStore } from '../../stores/authStore'

// Mirror of controller-service components/visitor/CouponHintBanner.tsx: the coupon earned for a review.
export default function CouponHintBanner({ hidden, onApply }: { hidden: boolean; onApply: (code: string) => void }) {
  const user = useAuthStore(s => s.user)
  const [dismissed, setDismissed] = useState(false)
  const { data: coupon } = useQuery({
    queryKey: ['review-coupon', user?.id ?? null],
    queryFn: getReviewCoupon,
    enabled: !!user && !hidden,
    retry: false,
  })
  if (!coupon || dismissed || hidden) return null
  const discountText = coupon.discount_type === 'percentage' ? `${coupon.discount_value}% off` : `₹${coupon.discount_value} off`

  return (
    <View className="mb-4 flex-row items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <Text className="flex-1 text-sm text-amber-800">
        You earned a coupon — <Text className="font-bold" style={{ fontFamily: 'monospace' }}>{coupon.code}</Text> ({discountText}).
      </Text>
      <View className="shrink-0 flex-row items-center gap-2">
        <Pressable onPress={() => onApply(coupon.code)}>
          <Text className="text-sm font-semibold text-amber-700">Apply →</Text>
        </Pressable>
        <Pressable onPress={() => setDismissed(true)} hitSlop={6}>
          <Text className="text-sm text-amber-400">×</Text>
        </Pressable>
      </View>
    </View>
  )
}
