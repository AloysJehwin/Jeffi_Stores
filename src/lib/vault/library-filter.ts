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

export function filterLibrary<T extends Pick<LibraryItem, 'title' | 'kinds'>>(
  items: readonly T[],
  { kind = 'all', query = '' }: { kind?: LibraryFilter; query?: string }
): T[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return items.filter(it => {
    if (kind !== 'all' && primaryKind(it.kinds) !== kind) return false
    const title = it.title.toLowerCase()
    return terms.every(t => title.includes(t))
  })
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
