import { paramNamesOf, type Clauses, type FilterEntity, type FilterQuery } from '@jeffi/list-filters'
import { buildProductSearchClause } from '@/lib/catalog/search'
import { buildAttributeFilterClauses, getAttributeValues } from '@/lib/catalog/product-attribute-filters'
import { ADMIN_PRODUCT_FILTER_FIELDS, specKeyFromParam } from '@/lib/catalog/product-attribute-filters-shared'
import { PRODUCT_QUICK_PARAMS } from '../fields/products'

// Products keep their own filter SQL (product-attribute-filters.ts); this adapter registers it so
// the product list gets the shared toolbar, saved views, export and overview scoping.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PARAMS = new Set<string>([...PRODUCT_QUICK_PARAMS, ...ADMIN_PRODUCT_FILTER_FIELDS.flatMap(paramNamesOf)])
const MAX_RAW = 4000
const VALUES_PAGE = 50

/** Category (with its sub-categories), brand, status and stock: the product list's toolbar filters. */
export function productQuickClauses(
  f: { category_id?: string; brand_id?: string; is_active?: string; stock?: string },
  startIdx: number
): Clauses {
  const conditions: string[] = []
  const params: unknown[] = []
  let i = startIdx
  if (f.category_id) {
    conditions.push(`p.category_id IN (
      WITH RECURSIVE cat_tree AS (
        SELECT id FROM categories WHERE id = $${i}
        UNION ALL
        SELECT c.id FROM categories c JOIN cat_tree ct ON c.parent_category_id = ct.id
      )
      SELECT id FROM cat_tree
    )`)
    params.push(f.category_id)
    i++
  }
  if (f.brand_id) {
    conditions.push(`p.brand_id = $${i++}`)
    params.push(f.brand_id)
  }
  if (f.is_active === 'true' || f.is_active === 'false') {
    conditions.push(`p.is_active = $${i++}`)
    params.push(f.is_active === 'true')
  }
  if (f.stock === 'low') conditions.push(`p.stock_status = 'Low Stock'`)
  else if (f.stock === 'out') conditions.push(`p.stock_status = 'Out of Stock'`)
  return { conditions, params, nextIdx: i }
}

function normalize(params: URLSearchParams): FilterQuery {
  const q: FilterQuery = {}
  for (const [k, raw] of params) {
    if (q[k] || (!PARAMS.has(k) && !specKeyFromParam(k))) continue
    const v = raw.trim().slice(0, MAX_RAW)
    if (!v || ((k === 'category_id' || k === 'brand_id') && !UUID_RE.test(v))) continue
    q[k] = v
  }
  return q
}

function clauses(q: FilterQuery, startIdx: number): Clauses {
  const quick = productQuickClauses(q, startIdx)
  const attr = buildAttributeFilterClauses(q, quick.nextIdx)
  return {
    conditions: [...quick.conditions, ...attr.conditions],
    params: [...quick.params, ...attr.params],
    nextIdx: attr.nextIdx,
  }
}

const ist = (e: string) => `to_char(${e} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')`

export const PRODUCTS_ENTITY: FilterEntity = {
  key: 'products',
  scope: 'products:read',
  noun: 'Products',
  root: 'products',
  alias: 'p',
  // Never-published create-drafts live only in the Drafts section.
  base: ['p.is_draft = false'],
  fields: [],
  sql: {},
  search: { build: (q, idx) => buildProductSearchClause(q, 'p.name', 'p.sku', 'p.search_vector', idx) },
  custom: {
    normalize,
    clauses,
    values: async (field, { search = '', page = 1 }) => {
      const rows = await getAttributeValues(field, search, page)
      return rows ? { values: rows, hasMore: rows.length >= VALUES_PAGE } : null
    },
  },
  export: {
    columns: [
      { key: 'name', label: 'Name', sql: 'p.name' },
      { key: 'sku', label: 'SKU', sql: 'p.sku' },
      { key: 'category', label: 'Category', sql: '(SELECT c.name FROM categories c WHERE c.id = p.category_id)' },
      { key: 'brand', label: 'Brand', sql: '(SELECT b.name FROM brands b WHERE b.id = p.brand_id)' },
      { key: 'active', label: 'Active', sql: 'p.is_active' },
      { key: 'featured', label: 'Featured', sql: 'p.is_featured' },
      { key: 'variants', label: 'Has variants', sql: 'p.has_variants' },
      { key: 'price', label: 'Price', sql: 'p.base_price' },
      { key: 'mrp', label: 'MRP', sql: 'p.mrp' },
      { key: 'cost', label: 'Cost price', sql: 'p.cost_price' },
      { key: 'gst', label: 'GST %', sql: 'p.gst_percentage' },
      { key: 'hsn', label: 'HSN code', sql: 'p.hsn_code' },
      { key: 'stock', label: 'Stock', sql: 'p.inventory_quantity' },
      { key: 'stock_status', label: 'Stock status', sql: 'p.stock_status' },
      { key: 'created', label: 'Added (IST)', sql: ist('p.created_at') },
    ],
    keyset: ["COALESCE(p.created_at, '-infinity'::timestamptz)", 'p.id'],
  },
}
