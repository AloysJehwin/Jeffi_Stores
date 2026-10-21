import type { CardProduct } from '../../types/home'

// Mirrors controller-service components/visitor/pdp/pdp.ts plus the pricing helpers the PDP uses.

export type StickyBarAction = 'add' | 'choose' | null

export const round2 = (n: number) => parseFloat(n.toFixed(2))

export const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v))

/** lib/catalog/pricing pickUnitPrice. */
export function pickUnitPrice(fields: { inclusive: unknown; exGst: unknown }, gstEnabled: boolean): number {
  const incl = Number(fields.inclusive ?? 0)
  if (gstEnabled) return incl
  const ex = fields.exGst == null ? null : Number(fields.exGst)
  return ex != null && ex > 0 ? ex : incl
}

/** Items the cart accepts without a variant choice: no variants, in stock, not digital (Buy Now only). */
export function canAddDirectly(p: Pick<CardProduct, 'hasVariants' | 'effectiveStock' | 'isDigital'>): boolean {
  return !p.hasVariants && !p.isDigital && Number(p.effectiveStock) > 0
}

/** Mirrors the cart API: not before launch_date, not on or after discontinue_date. */
export function purchasableNow(launchDate?: string | null, discontinueDate?: string | null, now: Date = new Date()): boolean {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  if (launchDate && new Date(launchDate) > today) return false
  if (discontinueDate && new Date(discontinueDate) <= today) return false
  return true
}

export function sumPrices(items: Pick<CardProduct, 'displayPrice'>[]): number {
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

/** "m2" → "m²" (the web renders a <sup>2</sup>). */
export const unitText = (label: string | null | undefined): string => (label ? label.replace(/^(.+?)2$/, '$1²') : '')

/** Round to up to 6 decimals, trailing zeros stripped. */
export const fmtQty = (v: number, maxDecimals = 6) => Number(v.toFixed(maxDecimals)).toString()

// Related-products de-duplication (page.tsx nameStem / deduplicateByNameStem).
const DIMENSION_SUFFIX =
  /[\s\-]+(M\d+(\.\d+)?|[A-Z]?\d+(\.\d+)?[A-Z]*|[A-Z]{1,3}\d+(\.\d+)?)(\s+(M\d+(\.\d+)?|[A-Z]{1,3}\d+(\.\d+)?|[\d.]+[A-Z]*))*\s*$/i

export function nameStem(name: string): string {
  return name.trim().replace(DIMENSION_SUFFIX, '').toLowerCase().trim()
}

export function deduplicateByNameStem<T extends { name: string }>(products: T[], excludeStem: string): T[] {
  const seen = new Set<string>([excludeStem])
  const out: T[] = []
  for (const p of products) {
    const stem = nameStem(p.name)
    if (!seen.has(stem)) {
      seen.add(stem)
      out.push(p)
    }
  }
  return out
}
