import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Text, TextButton } from '../../ui'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { getCouponNudge } from '../../api/cart'
import { money } from './lines'

// Mirror of controller-service components/visitor/cart/CouponNudge.tsx.
export default function CouponNudge({
  subtotal,
  signedIn,
  applying,
  onApply,
}: {
  subtotal: number
  signedIn: boolean
  applying: boolean
  onApply: (code: string) => void
}) {
  const router = useRouter()
  const amount = Math.round(subtotal * 100) / 100
  const [debounced, setDebounced] = useState(amount)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(amount), 300)
    return () => clearTimeout(t)
  }, [amount])

  const { data: nudge } = useQuery({
    queryKey: ['coupon-nudge', debounced],
    queryFn: () => getCouponNudge(debounced),
    enabled: debounced > 0,
    retry: false,
  })

  if (!nudge || amount <= 0) return null
  const code = <Text className="font-bold text-accent-700 dark:text-accent-300" style={{ fontFamily: 'monospace' }}>{nudge.code}</Text>

  return (
    <View className="mt-2 flex-row items-center justify-between gap-3 rounded-field border border-dashed border-accent-300 bg-accent-50 px-3 py-2 dark:border-accent-700 dark:bg-accent-900/20">
      {nudge.shortfall > 0 ? (
        <Text className="flex-1 text-xs text-foreground-secondary">
          Add <Text className="font-semibold text-foreground">{money(nudge.shortfall)}</Text> more to unlock {code} and save{' '}
          {money(nudge.saving)}
        </Text>
      ) : (
        <>
          <Text className="flex-1 text-xs text-foreground-secondary">
            Use {code} to save <Text className="font-semibold text-foreground">{money(nudge.saving)}</Text>
          </Text>
          {signedIn ? (
            <TextButton
              label={applying ? 'Applying...' : 'Apply'}
              accessibilityLabel={`Apply coupon ${nudge.code}`}
              onPress={() => onApply(nudge.code)}
              disabled={applying}
              className="shrink-0 self-center"
            />
          ) : (
            <TextButton label="Log in to apply" onPress={() => router.push('/(auth)/login')} className="shrink-0 self-center" />
          )}
        </>
      )}
    </View>
  )
}
