import * as React from 'react'
import type { ReviewSummary } from '@/lib/shared/review-summary-types'

/** What the product page's server-rendered parts read: the product row, its related products and the price basis. */
export interface ProductPartsData {
  product: any
  related: any[]
  gstEnabled: boolean
  reviewSummary: ReviewSummary | null
}

// Request-scoped: the page sets it before its Site Builder page renders, so parts in any section can read it.
type Box = { current: ProductPartsData | null }
// React's per-request cache (the App Router's React); a plain module box where it is missing (unit tests).
const reactCache = (React as unknown as { cache?: <F extends (...a: never[]) => unknown>(fn: F) => F }).cache
const fallback: Box = { current: null }
const slot: () => Box = typeof reactCache === 'function' ? reactCache((): Box => ({ current: null })) : () => fallback

export function setProductParts(data: ProductPartsData) {
  slot().current = data
}

/** The current product page's data, or null outside a product page (a preview with no product, say). */
export function productParts(): ProductPartsData | null {
  return slot().current
}
