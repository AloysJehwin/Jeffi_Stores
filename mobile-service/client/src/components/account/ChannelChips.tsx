import { Mail, MessageCircle, Smartphone } from 'lucide-react-native'
import { BodySmall, Chip, ChipGroup, type IconComponent } from '../../ui'
import type { OtpChannel } from '../../api/auth'

const CHANNEL: Record<OtpChannel, { label: string; icon: IconComponent }> = {
  email: { label: 'Email', icon: Mail },
  sms: { label: 'SMS', icon: Smartphone },
  whatsapp: { label: 'WhatsApp', icon: MessageCircle },
}

/** Where the OTP goes ("Get the code on  [SMS] [WhatsApp]"). */
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
  return (
    <ChipGroup className="mt-3 items-center">
      <BodySmall className="mr-1">{label}</BodySmall>
      {options.map(id => (
        <Chip key={id} label={CHANNEL[id].label} icon={CHANNEL[id].icon} selected={id === value} disabled={!!isDisabled?.(id)} onPress={() => onChange(id)} />
      ))}
    </ChipGroup>
  )
}
