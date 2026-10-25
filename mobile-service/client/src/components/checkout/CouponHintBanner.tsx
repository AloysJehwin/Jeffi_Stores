import { useState } from 'react'
import { View } from 'react-native'
import { X } from 'lucide-react-native'
import { IconButton, Text, TextButton, TONES } from '../../ui'
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
    <View className={`mb-4 flex-row items-center justify-between gap-3 rounded-field py-2 pl-4 pr-1 ${TONES.warning.bg}`}>
      <Text className={`flex-1 text-sm ${TONES.warning.text}`}>
        You earned a coupon — <Text className="font-bold" style={{ fontFamily: 'monospace' }}>{coupon.code}</Text> ({discountText}).
      </Text>
      <View className="shrink-0 flex-row items-center gap-1">
        <TextButton label="Apply →" accessibilityLabel={`Apply coupon ${coupon.code}`} onPress={() => onApply(coupon.code)} className="self-center" />
        <IconButton icon={X} label="Dismiss coupon" size="sm" onPress={() => setDismissed(true)} />
      </View>
    </View>
  )
}
