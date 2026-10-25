import { View } from 'react-native'
import { Flame, TriangleAlert, Wine } from 'lucide-react-native'
import { Badge, type IconComponent, type Tone } from '../../ui'

// Mirror of controller-service components/shared/ProductWarningBadges.tsx (size sm).

export default function WarningBadges({ fragile, hazardous, flammable }: { fragile?: boolean | null; hazardous?: boolean | null; flammable?: boolean | null }) {
  const badges = [
    flammable && { key: 'flammable', label: 'FLAMMABLE', icon: Flame, tone: 'danger' },
    hazardous && { key: 'hazardous', label: 'HAZARDOUS', icon: TriangleAlert, tone: 'progress' },
    fragile && { key: 'fragile', label: 'FRAGILE', icon: Wine, tone: 'info' },
  ].filter(Boolean) as { key: string; label: string; icon: IconComponent; tone: Tone }[]
  if (badges.length === 0) return null
  return (
    <View className="mb-3 flex-row flex-wrap gap-1.5">
      {badges.map(b => (
        <Badge key={b.key} label={b.label} icon={b.icon} tone={b.tone} solid size="sm" />
      ))}
    </View>
  )
}
