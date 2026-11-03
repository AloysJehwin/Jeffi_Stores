'use client'

/**
 * Lightweight, client-only session signal tracker for the on-device recap.
 * Records this-visit browsing (viewed products) and searches in sessionStorage.
 * No backend, no PII — product/category names and search terms only. Cleared
 * when the tab/session ends.
 */

const VIEWED_KEY = 'jeffi_od_viewed'
const SEARCH_KEY = 'jeffi_od_searches'
const MAX = 20

function read(key: string): string[] {
  try {
    if (typeof sessionStorage === 'undefined') return []
    return JSON.parse(sessionStorage.getItem(key) || '[]')
  } catch {
    return []
  }
}

function write(key: string, list: string[]) {
  try {
    if (typeof sessionStorage === 'undefined') return
    sessionStorage.setItem(key, JSON.stringify(list.slice(0, MAX)))
  } catch {
    /* quota / private mode — ignore */
  }
}

/** Push to the front, dedupe (case-insensitive), cap length. */
function pushFront(key: string, value: string | null | undefined) {
  const v = (value ?? '').trim()
  if (!v) return
  const cur = read(key).filter(x => x.toLowerCase() !== v.toLowerCase())
  write(key, [v, ...cur])
}

/** Call on a product detail view. */
export function trackViewedProduct(name: string | null | undefined) {
  pushFront(VIEWED_KEY, name)
}

/** Call when the user runs a search. */
export function trackSearch(term: string | null | undefined) {
  pushFront(SEARCH_KEY, term)
}

export function getViewedProducts(): string[] {
  return read(VIEWED_KEY)
}

export function getSearches(): string[] {
  return read(SEARCH_KEY)
}

export function clearSessionSignals() {
  try {
    sessionStorage.removeItem(VIEWED_KEY)
    sessionStorage.removeItem(SEARCH_KEY)
  } catch {
    /* ignore */
  }
}
