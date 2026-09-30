export interface QuickChip {
  id: string
  slug: string | null
  name: string
}

export interface ChipCountRow extends QuickChip {
  count: number
}

export interface CategoryNode {
  id: string
  slug: string
  parent_category_id: string | null
}

export function splitList(raw: string | null | undefined): string[] {
  return raw
    ? raw
        .split(',')
        .map(v => v.trim())
        .filter(Boolean)
    : []
}

export function chipSelected(chip: QuickChip, selected: string[]): boolean {
  return selected.includes(chip.id) || (chip.slug != null && selected.includes(chip.slug))
}

/** The comma-list param after toggling a chip, matching FilterSidebar; null once the list is empty. */
export function toggleChip(raw: string | null, chip: QuickChip): string | null {
  const current = splitList(raw)
  const next = chipSelected(chip, current)
    ? current.filter(v => v !== chip.id && v !== chip.slug)
    : [...current, chip.id]
  return next.length ? next.join(',') : null
}

/**
 * Categories the category chips offer: the children of a selected parent, or the siblings of a
 * selected leaf. Null when no category is selected, so every category in the results is in play.
 */
export function categoryChipScope(selected: string[], categories: CategoryNode[]): string[] | null {
  const parents = new Set<string | null>()
  for (const value of selected) {
    const node = categories.find(c => c.id === value || c.slug === value)
    if (!node) continue
    const hasChildren = categories.some(c => c.parent_category_id === node.id)
    parents.add(hasChildren ? node.id : node.parent_category_id)
  }
  if (parents.size === 0) return null
  return categories.filter(c => parents.has(c.parent_category_id)).map(c => c.id)
}

/** The top `max` chips by count, plus any selected chip below that cut so it can still be cleared. */
export function rankChips(rows: ChipCountRow[], selected: string[], max: number): QuickChip[] {
  const sorted = [...rows].sort((a, b) => Number(b.count) - Number(a.count) || a.name.localeCompare(b.name))
  const picked = [...sorted.slice(0, max), ...sorted.slice(max).filter(r => chipSelected(r, selected))]
  if (picked.length < 2 && !picked.some(r => chipSelected(r, selected))) return []
  return picked.map(({ id, slug, name }) => ({ id, slug, name }))
}
