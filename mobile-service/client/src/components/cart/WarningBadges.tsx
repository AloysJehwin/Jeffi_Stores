import { View } from 'react-native'
import { Badge, type IconComponent, type Tone } from '../../ui'
import { Diamond, Flame, TriangleAlert } from 'lucide-react-native'
import { status } from '../../theme'

// Mirror of controller-service components/shared/ProductWarningBadges.tsx.
const filled = (Icon: IconComponent): IconComponent =>
  function Filled(p) {
    return <Icon {...p} fill={status.white} />
  }

const BADGES: { key: 'flammable' | 'hazardous' | 'fragile'; label: string; icon: IconComponent; tone: Tone }[] = [
  { key: 'flammable', label: 'FLAMMABLE', icon: filled(Flame), tone: 'danger' },
  { key: 'hazardous', label: 'HAZARDOUS', icon: filled(TriangleAlert), tone: 'progress' },
  { key: 'fragile', label: 'FRAGILE', icon: filled(Diamond), tone: 'info' },
]

export default function WarningBadges({
  fragile,
  hazardous,
  flammable,
  size = 'sm',
}: {
  fragile?: boolean | null
  hazardous?: boolean | null
  flammable?: boolean | null
  size?: 'sm' | 'xs'
}) {
  const on = { flammable: !!flammable, hazardous: !!hazardous, fragile: !!fragile }
  const shown = BADGES.filter(b => on[b.key])
  if (shown.length === 0) return null
  return (
    <View className="flex-row flex-wrap gap-1">
      {shown.map(b => (
        <Badge key={b.key} label={b.label} tone={b.tone} icon={b.icon} solid size={size === 'xs' ? 'sm' : 'md'} />
      ))}
    </View>
  )
}
