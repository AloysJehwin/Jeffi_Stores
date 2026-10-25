import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Text, TextButton } from '../../ui'
import { getAccountCoupons } from '../../api/account'
import { couponTerms } from '../../lib/coupons'
import { money } from './lines'

const SHOWN = 3

// Mirror of controller-service components/visitor/cart/YourCoupons.tsx.
export default function YourCoupons({
  userId,
  subtotal,
  applying,
  onApply,
}: {
  userId: string
  subtotal: number
  applying: boolean
  onApply: (code: string) => void
}) {
  const router = useRouter()
  const { data: coupons } = useQuery({
    queryKey: ['account-coupons', userId, 'usable'],
    queryFn: () => getAccountCoupons(true),
    retry: false,
  })
  if (!coupons || coupons.length === 0) return null

  return (
    <View className="mt-3">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-xs font-semibold uppercase text-foreground-muted" style={{ letterSpacing: 0.5 }}>
          Your coupons
        </Text>
        {coupons.length > SHOWN ? <TextButton label="See all" onPress={() => router.push('/account/rewards')} /> : null}
      </View>
      <View className="mt-1.5 gap-2">
        {coupons.slice(0, SHOWN).map(c => {
          const shortfall = Math.round((c.minPurchase - subtotal) * 100) / 100
          return (
            <View
              key={c.id}
              className="flex-row items-center justify-between gap-3 rounded-field border border-dashed border-accent-300 bg-accent-50 px-3 py-2 dark:border-accent-700 dark:bg-accent-900/20"
            >
              <View className="flex-1">
                <Text
                  className="font-bold text-accent-700 dark:text-accent-300"
                  style={{ fontFamily: 'monospace' }}
                  numberOfLines={1}
                >
                  {c.code}
                </Text>
                <Text className="text-xs text-foreground-secondary">{couponTerms(c)}</Text>
                {shortfall > 0 ? (
                  <Text className="text-xs text-foreground-muted">
                    Add <Text className="font-semibold text-foreground">{money(shortfall)}</Text> more to use it
                  </Text>
                ) : null}
              </View>
              <TextButton
                label={applying ? 'Applying...' : 'Apply'}
                accessibilityLabel={`Apply coupon ${c.code}`}
                onPress={() => onApply(c.code)}
                disabled={applying || shortfall > 0}
                className="shrink-0 self-center"
              />
            </View>
          )
        })}
      </View>
    </View>
  )
}
