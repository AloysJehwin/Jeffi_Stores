import { View } from 'react-native'
import { status, useTokens } from '../theme'
import { Text } from './Text'
import { cn } from './cn'
import { TONES, type Tone } from './tones'
import type { IconComponent } from './Button'

/** A small rounded label: order status, stock, "New". */
export function Badge({ label, tone = 'neutral', solid, icon: Icon, size = 'md', className }: { label: string; tone?: Tone; solid?: boolean; icon?: IconComponent; size?: 'sm' | 'md'; className?: string }) {
  const t = TONES[tone]
  const tokens = useTokens()
  return (
    <View className={cn('flex-row items-center gap-1 self-start rounded-full', size === 'sm' ? 'px-2 py-0.5' : 'px-2.5 py-1', solid ? t.solid : t.bg, className)}>
      {Icon ? <Icon size={size === 'sm' ? 11 : 13} color={solid ? status.white : tokens.foregroundSecondary} /> : null}
      <Text numberOfLines={1} className={cn(size === 'sm' ? 'text-[11px]' : 'text-xs', 'font-bold', solid ? 'text-white' : t.text)}>
        {label}
      </Text>
    </View>
  )
}

/** A corner ribbon on an image ("20% OFF", "SALE"). */
export function Pill({ label, tone = 'danger', className }: { label: string; tone?: Tone; className?: string }) {
  return (
    <View className={cn('self-start rounded-lg px-2 py-1', TONES[tone].solid, className)}>
      <Text className="text-[11px] font-extrabold uppercase tracking-wide text-white">{label}</Text>
    </View>
  )
}
