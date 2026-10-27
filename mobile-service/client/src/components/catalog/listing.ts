// The storefront /products listing's URL state (web: app/(storefront)/products/page.tsx and MobileFilterSheet).
// Filtering, sorting, paging and facets all happen server-side in GET /api/products/listing.

// The shared product sorts (web, business portal, app). packages/api-contracts is in metro.config.js watchFolders.
export {
  PRODUCT_SORTS,
  PRODUCT_TABLE_COLUMNS,
  nextTableSort,
  productSortKey,
  tableSortState,
  type ProductSortId,
  type ProductSortOption,
  type ProductTableColumn,
} from '../../../../../packages/api-contracts/src/product-sort'

export const LISTING_KEYS = [
  'search', 'category', 'brand', 'offer', 'sort', 'dir', 'order', 'minPrice', 'maxPrice', 'inStock', 'onSale', 'minRating',
  'color', 'grade', 'material', 'finish', 'compliance', 'origin', 'variantType', 'variantValue', 'specKey', 'specValue',
] as const
export type ListingKey = (typeof LISTING_KEYS)[number]
export type ListingParams = Partial<Record<ListingKey, string>>

export function readListingParams(raw: Record<string, string | string[] | undefined>): ListingParams {
  const out: ListingParams = {}
  for (const k of LISTING_KEYS) {
    const v = raw[k]
    const s = (Array.isArray(v) ? v[0] : v)?.trim()
    if (s) out[k] = s
  }
  // links.ts also forwards ?q= from storefront hrefs
  const q = raw.q
  if (!out.search && q) out.search = (Array.isArray(q) ? q[0] : q).trim() || undefined
  return out
}

/** Every listing key, unset ones as undefined, so router.setParams clears them. */
export function toRouteParams(p: ListingParams): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { q: undefined }
  for (const k of LISTING_KEYS) out[k] = p[k] || undefined
  return out
}

export const listingKey = (p: ListingParams) => LISTING_KEYS.map(k => `${k}=${p[k] ?? ''}`).join('&')

export const splitList = (v?: string) => (v ?? '').split(',').map(s => s.trim()).filter(Boolean)

export function activeFilterCount(p: ListingParams): number {
  return [
    p.category, p.brand, p.sort, p.minPrice, p.maxPrice, p.inStock, p.onSale, p.offer, p.minRating, p.grade, p.color,
    p.material, p.finish, p.compliance, p.origin, p.variantType, p.specKey,
  ].filter(Boolean).length
}

/** lib/shared/format humanizeLabel */
export function humanizeLabel(raw: string): string {
  if (!raw) return raw
  const tokens = raw.split(/[_\s-]+/).filter(Boolean)
  if (tokens.length === 0) return raw
  const out = tokens
    .map(t => {
      if (/^[A-Z0-9]+$/.test(t)) return t
      if (/\d/.test(t)) return t
      return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
    })
    .join(' ')
  return out || raw
}
