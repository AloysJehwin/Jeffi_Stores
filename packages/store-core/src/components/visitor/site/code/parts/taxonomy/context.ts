import * as React from 'react'

/** The catalogue index a request renders: the all-categories or the all-brands page. */
export type IndexKind = 'categories' | 'brands'

// Request-scoped, like the listing parts: the index route sets it before its Site Builder page renders, so Breadcrumbs
// knows where it is (code sections on the live store don't know their page).
type Box = { current: IndexKind | null }
const reactCache = (React as unknown as { cache?: <F extends (...a: never[]) => unknown>(fn: F) => F }).cache
const fallback: Box = { current: null }
const slot: () => Box = typeof reactCache === 'function' ? reactCache((): Box => ({ current: null })) : () => fallback

export function setIndexPage(kind: IndexKind) {
  slot().current = kind
}

/** The index page being rendered, or null on any other page. */
export function indexPage(): IndexKind | null {
  return slot().current
}
