// Shared types and helpers for the product view page.

export type ShelfRow = {
  location_display_code: string
  quantity: number
  variant_id: string | null
  sub_variant_id: string | null
}

export type HeldDraft = { ownerName: string; href: string }

// Sub-variants belong to a variant only while its "Has sub-variants" is on (an active
// sub-variant also counts: rows added outside a publish do not set the flag). Rows left
// behind by a turned-off toggle are not shown.
export function variantSubsShown(v: any): any[] {
  const subs: any[] = Array.isArray(v?.sub_variants) ? v.sub_variants : []
  return v?.sub_variant_type_on || subs.some(sv => sv?.is_active !== false) ? subs : []
}

export function shelfFor(rows: ShelfRow[], variantId: string | null, subVariantId: string | null) {
  return rows.filter(
    r =>
      (variantId ? r.variant_id === variantId : r.variant_id === null) &&
      (subVariantId ? r.sub_variant_id === subVariantId : r.sub_variant_id === null)
  )
}

export const primaryImage = (images: any[]) => images.find((i: any) => i.is_primary) || images[0] || null

export const inr2 = (v: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(v)

export const shortDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

export const listOrNull = (v: unknown) => (Array.isArray(v) && v.length ? v.join(', ') : null)

// Prefer the explicit product discount_pct; otherwise derive it from MRP vs selling price.
export function discountPct(p: any): number {
  const selling = Number(p.has_variants ? p.variant_min_price : p.base_price) || 0
  const mrp = Number(p.mrp) || 0
  return p.discount_pct != null && Number(p.discount_pct) > 0
    ? Number(p.discount_pct)
    : mrp > 0 && mrp > selling
      ? Math.round(((mrp - selling) / mrp) * 100)
      : 0
}

export const RED = 'text-red-600 dark:text-red-400'
export const ORANGE = 'text-orange-600 dark:text-orange-400'
export const GREEN = 'text-green-600 dark:text-green-400'
