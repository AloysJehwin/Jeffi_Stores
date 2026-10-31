import type { FilterScope } from '@jeffi/list-filters'

// A list's filters bound for one overview query: `and` appends to the entity's own alias, `ids(col)`
// scopes a related id column. Both bind from the same start, so they share one params list.

export interface BoundScope {
  and: string
  ids: (col: string) => string
  params: unknown[]
}

export const NO_SCOPE: BoundScope = { and: '', ids: () => '', params: [] }

export function bindScope(scope: FilterScope | undefined, start: number): BoundScope {
  if (!scope || scope.empty) return NO_SCOPE
  const a = scope.and(start)
  return { and: a.sql, ids: col => scope.inIds(col, start).sql, params: a.params }
}

/** `path?<filters>` with `patch` set on top (attention links into the filtered list). */
export function filteredHref(path: string, patch: Record<string, string>, query = ''): string {
  const p = new URLSearchParams(query)
  for (const [k, v] of Object.entries(patch)) p.set(k, v)
  const qs = p.toString()
  return qs ? `${path}?${qs}` : path
}
