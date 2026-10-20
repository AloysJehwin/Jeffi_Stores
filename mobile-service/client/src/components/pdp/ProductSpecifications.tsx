import { Text, View } from 'react-native'
import { Flame, Timer, TriangleAlert, Wine, type LucideIcon } from 'lucide-react-native'
import { Tinted } from './Glyph'
import { buildSpecGroups, type HandlingFlag, type SpecRow } from './specGroups'

// Mirror of controller-service components/visitor/pdp/ProductSpecifications.tsx (single-column at the mobile breakpoint).

const HANDLING: Record<HandlingFlag, { label: string; Icon: LucideIcon; bg: string; fg: string }> = {
  fragile: { label: 'Fragile', Icon: Wine, bg: 'bg-yellow-100 dark:bg-yellow-900/30', fg: 'text-yellow-800 dark:text-yellow-300' },
  hazardous: { label: 'Hazardous', Icon: TriangleAlert, bg: 'bg-red-100 dark:bg-red-900/30', fg: 'text-red-800 dark:text-red-300' },
  flammable: { label: 'Flammable', Icon: Flame, bg: 'bg-orange-100 dark:bg-orange-900/30', fg: 'text-orange-800 dark:text-orange-300' },
  perishable: { label: 'Perishable', Icon: Timer, bg: 'bg-blue-100 dark:bg-blue-900/30', fg: 'text-blue-800 dark:text-blue-300' },
}

function RowValue({ row, codes }: { row: SpecRow; codes: boolean }) {
  if (row.chips?.length) {
    return (
      <View className="mt-1 flex-row flex-wrap gap-2">
        {row.chips.map(chip => (
          <View key={chip} className="rounded-md border border-border-default bg-surface-secondary px-2 py-1">
            <Text className="text-xs font-medium text-foreground">{chip}</Text>
          </View>
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
    <View className="mb-8 rounded-lg border border-border-default bg-surface-elevated p-6 shadow-sm">
      <Text className="mb-6 text-xl font-bold text-foreground">Specifications</Text>
      <View className="gap-6">
        {handling.length > 0 ? (
          <View className="flex-row flex-wrap gap-2" accessibilityLabel="Handling">
            {handling.map(flag => {
              const { label, Icon, bg, fg } = HANDLING[flag]
              return (
                <View key={flag} className={`flex-row items-center gap-1 rounded-full px-2 py-1 ${bg}`}>
                  <Tinted icon={Icon} size={14} className={fg} />
                  <Text className={`text-xs font-medium ${fg}`}>{label}</Text>
                </View>
              )
            })}
          </View>
        ) : null}

        {groups.map((g, i) => (
          <View key={g.id} className={i > 0 ? 'border-t border-border-default pt-6' : ''}>
            <Text className="mb-3 text-xs font-semibold uppercase text-foreground-muted" style={{ letterSpacing: 0.3 }}>
              {g.title}
            </Text>
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
    </View>
  )
}
