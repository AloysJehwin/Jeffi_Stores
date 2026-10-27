import { useState } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { Briefcase, ShoppingBag } from 'lucide-react-native'
import type { AuthPortal } from '../../api/client'
import { useAuthStore } from '../../stores/authStore'
import { useSwitchStore } from '../account/hooks'
import { useTokens } from '../../theme'
import { Text, cn, elevationClass, haptic, useElevation, type IconComponent } from '../../ui'

const STORES: { value: AuthPortal; label: string; icon: IconComponent }[] = [
  { value: 'customer', label: 'Store', icon: ShoppingBag },
  { value: 'business', label: 'Business', icon: Briefcase },
]

/**
 * Store ⇄ business store. `defer` runs the switch later, e.g. once the menu sheet has closed;
 * otherwise it runs here, with a spinner while the other store's session loads.
 */
export function StoreSwitch({ defer, className }: { defer?: (run: () => void) => void; className?: string }) {
  const t = useTokens()
  const shadow = useElevation('raised')
  const portal = useAuthStore(s => s.portal)
  const switchStore = useSwitchStore()
  const [busy, setBusy] = useState<AuthPortal | null>(null)

  const pick = (next: AuthPortal) => {
    if (next === portal || busy) return
    haptic.select()
    if (defer) return defer(() => void switchStore(next))
    setBusy(next)
    switchStore(next).finally(() => setBusy(null))
  }

  return (
    <View className={className} accessibilityRole="radiogroup" accessibilityLabel="Shop in">
      <View className="flex-row gap-1 rounded-2xl bg-surface-secondary p-1">
        {STORES.map(({ value, label, icon: Icon }) => {
          const on = portal === value
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, busy: busy === value }}
              accessibilityLabel={value === 'business' ? 'Business store' : 'Regular store'}
              onPress={() => pick(value)}
              style={on ? shadow : undefined}
              className={cn('min-h-[40px] flex-1 flex-row items-center justify-center gap-1.5 rounded-xl', on && cn('bg-surface-elevated', elevationClass('raised')))}
            >
              {busy === value ? <ActivityIndicator size="small" color={t.accent600} /> : <Icon size={16} color={on ? t.accent600 : t.foregroundSecondary} />}
              <Text className={cn('text-sm font-semibold', on ? 'text-foreground' : 'text-foreground-secondary')}>{label}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}
