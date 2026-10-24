import { Pressable, Text, View } from 'react-native'
import { Glyph, P } from './Glyph'

// Variant / sub-variant choice chips, shared by the product page and the quick-add sheet.

const VARIANT_COLLAPSE_LIMIT = 12

interface Option {
  id: string
  name: string
  stock_status: string
}

export function OptionChips({
  options,
  selectedId,
  onSelect,
  showAll,
  onToggle,
  pill = false,
}: {
  options: Option[]
  selectedId: string | null
  onSelect: (id: string) => void
  showAll: boolean
  onToggle: () => void
  /** Rounded-full chips (the sheet); the product page keeps its squarer ones. */
  pill?: boolean
}) {
  const selectedIndex = options.findIndex(o => o.id === selectedId)
  const mustExpand = !showAll && selectedIndex >= VARIANT_COLLAPSE_LIMIT
  const collapsed = !showAll && !mustExpand && options.length > VARIANT_COLLAPSE_LIMIT
  const visible = collapsed ? options.slice(0, VARIANT_COLLAPSE_LIMIT) : options
  return (
    <>
      <View className="flex-row flex-wrap gap-2">
        {visible.map(o => {
          const selected = o.id === selectedId
          const oos = o.stock_status === 'Out of Stock'
          return (
            <Pressable
              key={o.id}
              onPress={() => onSelect(o.id)}
              className={`${pill ? 'rounded-full' : 'rounded-lg'} border px-4 py-2 ${
                selected
                  ? 'border-accent-500 bg-accent-500'
                  : !oos
                    ? 'border-border-secondary bg-surface-elevated'
                    : 'border-dashed border-border-default bg-surface-secondary'
              }`}
            >
              <Text className={`text-sm font-medium ${selected ? 'text-white' : !oos ? 'text-foreground-secondary' : 'text-foreground-muted'}`}>
                {o.name}
                {oos ? ' (Out of Stock)' : ''}
              </Text>
            </Pressable>
          )
        })}
      </View>
      {options.length > VARIANT_COLLAPSE_LIMIT ? (
        <Pressable onPress={onToggle} className="mt-2 flex-row items-center gap-1 self-start">
          <Text className="text-sm font-medium text-accent-600 dark:text-accent-400">
            {showAll ? 'Show fewer' : `Show all ${options.length} options`}
          </Text>
          <View style={{ transform: [{ rotate: showAll ? '180deg' : '0deg' }] }}>
            <Glyph d={P.chevronDown} size={16} className="text-accent-600 dark:text-accent-400" />
          </View>
        </Pressable>
      ) : null}
    </>
  )
}
