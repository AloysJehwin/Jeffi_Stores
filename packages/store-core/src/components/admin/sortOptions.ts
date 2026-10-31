export type SortDir = 'asc' | 'desc'

export interface SortOption {
  value: string
  label: string
}

const DEFAULT_OPTIONS: SortOption[] = [
  { value: 'asc', label: 'A → Z' },
  { value: 'desc', label: 'Z → A' },
]

const NUMERIC_OPTIONS: SortOption[] = [
  { value: 'asc', label: 'Low → High' },
  { value: 'desc', label: 'High → Low' },
]

const DATE_OPTIONS: SortOption[] = [
  { value: 'desc', label: 'Newest first' },
  { value: 'asc', label: 'Oldest first' },
]

export function sortOptions(type: 'text' | 'number' | 'date'): SortOption[] {
  if (type === 'number') return NUMERIC_OPTIONS
  if (type === 'date') return DATE_OPTIONS
  return DEFAULT_OPTIONS
}
