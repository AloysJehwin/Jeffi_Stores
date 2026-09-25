export const PDP_OPTIONS_ID = 'pdp-options'
export const PDP_BUY_BUTTONS_ID = 'pdp-buy-buttons'
export const PDP_REVIEWS_ID = 'reviews'

export interface PdpCard {
  id: string
  name: string
  slug: string
  hasVariants: boolean
  displayPrice: number
  mrp: number | null
  effectiveStock: number
  primaryImage?: { image_url: string; thumbnail_url?: string; blurhash?: string | null } | null
}

export type StickyBarAction = 'add' | 'choose' | null

/** Items the cart accepts without a variant choice: no variants and in stock. */
export function canAddDirectly(p: Pick<PdpCard, 'hasVariants' | 'effectiveStock'>): boolean {
  return !p.hasVariants && Number(p.effectiveStock) > 0
}

/** Mirrors the cart API: not before launch_date, not on or after discontinue_date. */
export function purchasableNow(
  launchDate: string | Date | null | undefined,
  discontinueDate: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  if (launchDate && new Date(launchDate) > today) return false
  if (discontinueDate && new Date(discontinueDate) <= today) return false
  return true
}

export function sumPrices(items: Pick<PdpCard, 'displayPrice'>[]): number {
  return items.reduce((cents, p) => cents + Math.round(Number(p.displayPrice) * 100), 0) / 100
}

export function stickyBarAction(s: {
  purchasable: boolean
  hasVariants: boolean
  variants: { stock_status: string }[]
  selectionInStock: boolean
  needsChoice: boolean
}): StickyBarAction {
  if (!s.purchasable) return null
  if (!s.hasVariants) return s.selectionInStock ? 'add' : null
  if (!s.variants.some(v => v.stock_status !== 'Out of Stock')) return null
  return s.needsChoice || !s.selectionInStock ? 'choose' : 'add'
}

export function formatRupees(n: number): string {
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function scrollToId(id: string, block: ScrollLogicalPosition = 'start'): void {
  const el = document.getElementById(id)
  if (!el) return
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block })
}
