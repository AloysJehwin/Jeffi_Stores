// Client-safe library classification + filtering (shared by the library grid and its tests).

export type LibraryKind = 'video' | 'audio' | 'pdf' | 'other'
export type LibraryFilter = 'all' | LibraryKind

export interface LibraryItem {
  product_id: string
  title: string
  cover_url: string | null
  source: string
  access_expires_at: string | null
  kinds: string[]
  file_count: number
  category?: string | null
  brand?: string | null
}

export const LIBRARY_FILTERS: { id: LibraryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'pdf', label: 'Books & PDFs' },
  { id: 'other', label: 'Other' },
]

export const KIND_LABEL: Record<LibraryKind, string> = {
  video: 'Video',
  audio: 'Audio',
  pdf: 'PDF',
  other: 'File',
}

/** One headline kind per product: video > audio > pdf > anything else. */
export function primaryKind(kinds: readonly string[] | null | undefined): LibraryKind {
  const k = kinds ?? []
  if (k.includes('video')) return 'video'
  if (k.includes('audio')) return 'audio'
  if (k.includes('pdf')) return 'pdf'
  return 'other'
}

export function filterLibrary<T extends Pick<LibraryItem, 'title' | 'kinds' | 'category' | 'brand'>>(
  items: readonly T[],
  { kind = 'all', query = '', category = null, brand = null }: {
    kind?: LibraryFilter
    query?: string
    category?: string | null
    brand?: string | null
  }
): T[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return items.filter(it => {
    if (kind !== 'all' && primaryKind(it.kinds) !== kind) return false
    if (category && it.category !== category) return false
    if (brand && it.brand !== brand) return false
    const hay = [it.title, it.category, it.brand].filter(Boolean).join(' ').toLowerCase()
    return terms.every(t => hay.includes(t))
  })
}

/** Distinct non-empty values of a facet with counts, most common first. */
export function facetCounts<T>(items: readonly T[], pick: (it: T) => string | null | undefined) {
  const m = new Map<string, number>()
  for (const it of items) {
    const v = pick(it)?.trim()
    if (v) m.set(v, (m.get(v) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, count]) => ({ value, count }))
}

/** Per-filter counts for the chips. */
export function countByKind(items: readonly Pick<LibraryItem, 'kinds'>[]): Record<LibraryFilter, number> {
  const out: Record<LibraryFilter, number> = { all: items.length, video: 0, audio: 0, pdf: 0, other: 0 }
  for (const it of items) out[primaryKind(it.kinds)]++
  return out
}

export function accessLabel(expiresAt: string | null, now = Date.now()): string {
  if (!expiresAt) return 'Lifetime access'
  const d = new Date(expiresAt)
  if (Number.isNaN(d.getTime()) || d.getTime() <= now) return 'Access expired'
  return `Access until ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
}
