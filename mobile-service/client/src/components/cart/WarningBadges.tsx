import { Text, View } from 'react-native'
import { Diamond, Flame, TriangleAlert } from 'lucide-react-native'
import { status } from '../../theme'

// Mirror of controller-service components/shared/ProductWarningBadges.tsx.
const BADGES = [
  { key: 'flammable', label: 'FLAMMABLE', Icon: Flame, bg: 'bg-red-600' },
  { key: 'hazardous', label: 'HAZARDOUS', Icon: TriangleAlert, bg: 'bg-orange-500' },
  { key: 'fragile', label: 'FRAGILE', Icon: Diamond, bg: 'bg-blue-600' },
] as const

const SIZES = {
  xs: { box: 'px-1 py-0.5 rounded gap-0.5', font: 8, icon: 6 },
  sm: { box: 'px-1.5 py-0.5 rounded gap-1', font: 10, icon: 7 },
}

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
  const on: Record<string, boolean> = { flammable: !!flammable, hazardous: !!hazardous, fragile: !!fragile }
  const shown = BADGES.filter(b => on[b.key])
  if (shown.length === 0) return null
  const s = SIZES[size]
  return (
    <View className="flex-row flex-wrap gap-1">
      {shown.map(({ key, label, Icon, bg }) => (
        <View key={key} className={`flex-row items-center ${s.box} ${bg}`}>
          <Icon size={s.icon} color={status.white} fill={status.white} />
          <Text className="font-bold text-white" style={{ fontSize: s.font }}>
            {label}
          </Text>
        </View>
      ))}
    </View>
  )
}
