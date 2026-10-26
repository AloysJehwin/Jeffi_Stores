import type { NewRfqItem } from '../../api/business'

// Lines handed to the new-quote screen (from the cart), kept in memory like the web's sessionStorage hand-off.
let prefill: NewRfqItem[] | null = null

export const setQuotePrefill = (items: NewRfqItem[]) => {
  prefill = items
}

/** The prefilled lines, once: a second visit starts empty. */
export function takeQuotePrefill(): NewRfqItem[] | null {
  const items = prefill
  prefill = null
  return items
}
