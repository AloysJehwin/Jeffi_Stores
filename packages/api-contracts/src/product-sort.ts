// Product listing sorts, shared by the storefront, business portal, app and the listing APIs.
// Dependency-free so the app can import this file directly. URL shape: ?sort=<key>&dir=<asc|desc>;
// no sort param = Featured (the server's default order).

export type ProductSortDir = 'asc' | 'desc'
export type ProductSortId = 'featured' | 'newest' | 'price_asc' | 'price_desc' | 'name_asc'

export interface ProductSortOption {
  id: ProductSortId
  label: string
  sort?: 'created_at' | 'price' | 'name'
  dir?: ProductSortDir
}

export const PRODUCT_SORTS: readonly ProductSortOption[] = [
  { id: 'featured', label: 'Featured' },
  { id: 'newest', label: 'Newest first', sort: 'created_at', dir: 'desc' },
  { id: 'price_asc', label: 'Price: low to high', sort: 'price', dir: 'asc' },
  { id: 'price_desc', label: 'Price: high to low', sort: 'price', dir: 'desc' },
  { id: 'name_asc', label: 'Name: A to Z', sort: 'name', dir: 'asc' },
]

export const DEFAULT_PRODUCT_SORT: ProductSortId = 'featured'

// hasOwnProperty, not Object.hasOwn: this file also runs on the app's JS engine.
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

const SORT_ALIASES: Record<string, string> = { base_price: 'price', newest: 'created_at', popular: '', featured: '' }
const DEFAULT_DIR: Record<string, ProductSortDir> = { created_at: 'desc', price: 'asc', name: 'asc' }

/** A sort URL key normalised: `base_price` → `price`, `newest` → `created_at`; '' for featured/unknown aliases. */
export function normalizeProductSort(sort: string | null | undefined): string {
  const s = (sort ?? '').trim().toLowerCase()
  return own(SORT_ALIASES, s) ? SORT_ALIASES[s] : s
}

/** The option id for a ?sort / ?dir pair (callers pass `order` as dir when there is no `dir`). Unknown → featured. */
export function productSortKey(sort: string | null | undefined, dir?: string | null): ProductSortId {
  const key = normalizeProductSort(sort)
  if (!key || !own(DEFAULT_DIR, key)) return DEFAULT_PRODUCT_SORT
  const d = (dir ?? '').toLowerCase()
  const want: ProductSortDir = d === 'asc' || d === 'desc' ? d : DEFAULT_DIR[key]
  const hit = PRODUCT_SORTS.find(o => o.sort === key && o.dir === want) ?? PRODUCT_SORTS.find(o => o.sort === key)
  return hit?.id ?? DEFAULT_PRODUCT_SORT
}

export const productSortOption = (id: string | null | undefined): ProductSortOption =>
  PRODUCT_SORTS.find(o => o.id === id) ?? PRODUCT_SORTS[0]

// Table views sort by clicking their column titles instead of the PRODUCT_SORTS control.
// Every column is whitelisted server-side; `dir` is each column's natural first-click direction.
export interface ProductTableColumn {
  key: 'name' | 'price' | 'discount' | 'stock'
  label: string
  dir: ProductSortDir
}

export const PRODUCT_TABLE_COLUMNS: readonly ProductTableColumn[] = [
  { key: 'name', label: 'Product', dir: 'asc' },
  { key: 'price', label: 'Price', dir: 'asc' },
  { key: 'discount', label: 'Off', dir: 'desc' },
  { key: 'stock', label: 'Stock', dir: 'desc' },
]

/** The column's current direction, or null when the list isn't sorted by it. */
export function tableSortState(key: string, sort: string | null | undefined, dir: string | null | undefined): ProductSortDir | null {
  if (normalizeProductSort(sort) !== key) return null
  const col = PRODUCT_TABLE_COLUMNS.find(c => c.key === key)
  const d = (dir ?? '').toLowerCase()
  return d === 'asc' || d === 'desc' ? d : (col?.dir ?? 'asc')
}

/** A column-title click: natural direction → flipped → cleared (back to Featured). */
export function nextTableSort(
  key: ProductTableColumn['key'],
  sort: string | null | undefined,
  dir: string | null | undefined
): { sort?: string; dir?: ProductSortDir } {
  const col = PRODUCT_TABLE_COLUMNS.find(c => c.key === key)
  if (!col) return {}
  const state = tableSortState(key, sort, dir)
  if (!state) return { sort: key, dir: col.dir }
  if (state === col.dir) return { sort: key, dir: col.dir === 'asc' ? 'desc' : 'asc' }
  return {}
}
