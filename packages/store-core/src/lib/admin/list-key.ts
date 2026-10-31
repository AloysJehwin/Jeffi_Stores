// Key for a list's Suspense boundary: every param except `page`, so infinite scroll
// (which advances ?page) appends to the mounted list instead of remounting it.
export function listKey(sp: Record<string, unknown>): string {
  const { page: _page, ...rest } = sp
  return JSON.stringify(rest)
}
