import { Text, View } from 'react-native'
import { Glyph } from './Glyph'

// Mirror of controller-service components/shared/ProductWarningBadges.tsx (size sm).

const FLAME = 'M5 0C5 0 2 4 2 7a3 3 0 006 0c0-.5-.1-1-.25-1.4.5.8.75 1.7.75 2.9a4 4 0 01-8 0C.5 5 5 0 5 0zm0 3C4.3 4.5 3.5 6 3.5 7.5a1.5 1.5 0 003 0C6.5 6.3 5.8 4.8 5 3z'
const TRIANGLE = 'M6 1L11.5 11H.5L6 1zm0 2.5L2.2 10h7.6L6 3.5zM5.4 6h1.2v2.5H5.4V6zm0 3h1.2v1.2H5.4V9z'
const DIAMOND = 'M6 .5L11.5 6 6 11.5.5 6 6 .5zm0 2L2.5 6l1.8 1.8L5.5 6l1.5 2 1-2 .8 1.8L10.5 6 6 2.5z'

export default function WarningBadges({ fragile, hazardous, flammable }: { fragile?: boolean | null; hazardous?: boolean | null; flammable?: boolean | null }) {
  const badges = [
    flammable && { key: 'flammable', label: 'FLAMMABLE', d: FLAME, viewBox: '0 0 10 14', bg: 'bg-red-600' },
    hazardous && { key: 'hazardous', label: 'HAZARDOUS', d: TRIANGLE, viewBox: '0 0 12 12', bg: 'bg-orange-500' },
    fragile && { key: 'fragile', label: 'FRAGILE', d: DIAMOND, viewBox: '0 0 12 12', bg: 'bg-blue-600' },
  ].filter(Boolean) as { key: string; label: string; d: string; viewBox: string; bg: string }[]
  if (badges.length === 0) return null
  return (
    <View className="flex-row flex-wrap gap-1">
      {badges.map(b => (
        <View key={b.key} className={`flex-row items-center gap-1 rounded px-1.5 py-0.5 ${b.bg}`}>
          <Glyph d={b.d} viewBox={b.viewBox} solid size={7} className="text-white" />
          <Text className="text-[10px] font-bold text-white">{b.label}</Text>
        </View>
      ))}
    </View>
  )
}
