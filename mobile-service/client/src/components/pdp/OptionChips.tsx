import { Chip, ChipGroup, TextButton } from '../../ui'

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
}: {
  options: Option[]
  selectedId: string | null
  onSelect: (id: string) => void
  showAll: boolean
  onToggle: () => void
  /** Kept for callers; both surfaces now use the shared Chip. */
  pill?: boolean
}) {
  const selectedIndex = options.findIndex(o => o.id === selectedId)
  const mustExpand = !showAll && selectedIndex >= VARIANT_COLLAPSE_LIMIT
  const collapsed = !showAll && !mustExpand && options.length > VARIANT_COLLAPSE_LIMIT
  const visible = collapsed ? options.slice(0, VARIANT_COLLAPSE_LIMIT) : options
  return (
    <>
      <ChipGroup>
        {visible.map(o => {
          const oos = o.stock_status === 'Out of Stock'
          return (
            <Chip
              key={o.id}
              label={o.name}
              meta={oos ? 'Out of stock' : undefined}
              selected={o.id === selectedId}
              unavailable={oos}
              onPress={() => onSelect(o.id)}
            />
          )
        })}
      </ChipGroup>
      {options.length > VARIANT_COLLAPSE_LIMIT ? (
        <TextButton label={showAll ? 'Show fewer' : `Show all ${options.length} options`} onPress={onToggle} className="mt-2" />
      ) : null}
    </>
  )
}
