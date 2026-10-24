import { Pressable, Text, View } from 'react-native'
import HeroIcon, { type HeroIconName } from './HeroIcon'
import { status, useTokens } from '../../theme'
import type { OtpChannel } from '../../api/auth'

const CHANNEL: Record<OtpChannel, { label: string; icon: HeroIconName }> = {
  email: { label: 'Email', icon: 'mail' },
  sms: { label: 'SMS', icon: 'phone' },
  whatsapp: { label: 'WhatsApp', icon: 'chat' },
}

/** Pill chips for where the OTP goes ("Get the code on  [SMS] [WhatsApp]"). */
export function ChannelChips({
  label,
  options,
  value,
  onChange,
  isDisabled,
}: {
  label: string
  options: readonly OtpChannel[]
  value: OtpChannel
  onChange: (c: OtpChannel) => void
  isDisabled?: (c: OtpChannel) => boolean
}) {
  const t = useTokens()
  return (
    <View className="mt-3 flex-row flex-wrap items-center gap-2">
      <Text className="mr-1 text-sm text-foreground-secondary">{label}</Text>
      {options.map(id => {
        const on = id === value
        const off = !!isDisabled?.(id)
        return (
          <Pressable
            key={id}
            disabled={off}
            onPress={() => onChange(id)}
            className={`flex-row items-center gap-1.5 rounded-full px-3.5 py-2 ${on ? 'bg-accent-500' : 'bg-surface-secondary'} ${off ? 'opacity-40' : ''}`}
          >
            <HeroIcon name={CHANNEL[id].icon} size={16} color={on ? status.white : t.foregroundSecondary} />
            <Text className={`text-sm font-semibold ${on ? 'text-white' : 'text-foreground-secondary'}`}>{CHANNEL[id].label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}
