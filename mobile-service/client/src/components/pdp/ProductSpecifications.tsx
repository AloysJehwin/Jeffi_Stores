import { View } from 'react-native'
import { Flame, Timer, TriangleAlert, Wine } from 'lucide-react-native'
import { Badge, Card, Overline, Text, type IconComponent, type Tone } from '../../ui'
import { buildSpecGroups, type HandlingFlag, type SpecRow } from './specGroups'

// Mirror of controller-service components/visitor/pdp/ProductSpecifications.tsx (single-column at the mobile breakpoint).

const HANDLING: Record<HandlingFlag, { label: string; icon: IconComponent; tone: Tone }> = {
  fragile: { label: 'Fragile', icon: Wine, tone: 'warning' },
  hazardous: { label: 'Hazardous', icon: TriangleAlert, tone: 'danger' },
  flammable: { label: 'Flammable', icon: Flame, tone: 'progress' },
  perishable: { label: 'Perishable', icon: Timer, tone: 'info' },
}

function RowValue({ row, codes }: { row: SpecRow; codes: boolean }) {
  if (row.chips?.length) {
    return (
      <View className="mt-1 flex-row flex-wrap gap-2">
        {row.chips.map(chip => (
          <Badge key={chip} label={chip} />
        ))}
      </View>
    )
  }
  return <Text className={`font-semibold text-foreground ${codes ? 'text-xs' : 'text-sm'}`}>{row.value}</Text>
}

export default function ProductSpecifications({ product }: { product: Record<string, any> }) {
  const { handling, groups } = buildSpecGroups(product)
  if (groups.length === 0 && handling.length === 0) return null

  return (
    <Card className="mb-6 p-5" padded={false}>
      <Text accessibilityRole="header" className="mb-5 font-display text-xl font-extrabold text-foreground">
        Specifications
      </Text>
      <View className="gap-6">
        {handling.length > 0 ? (
          <View className="flex-row flex-wrap gap-2" accessibilityLabel="Handling">
            {handling.map(flag => (
              <Badge key={flag} {...HANDLING[flag]} />
            ))}
          </View>
        ) : null}

        {groups.map((g, i) => (
          <View key={g.id} className={i > 0 ? 'border-t border-border-default pt-6' : ''}>
            <Overline className="mb-3">{g.title}</Overline>
            <View className="gap-4">
              {g.rows.map((row, j) => (
                <View key={`${row.label}:${j}`}>
                  <Text className="mb-0.5 text-xs text-foreground-muted">{row.label}</Text>
                  <RowValue row={row} codes={g.id === 'codes'} />
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>
    </Card>
  )
}
