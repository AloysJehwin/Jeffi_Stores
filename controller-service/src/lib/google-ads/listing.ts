import { queryMany } from '@/lib/shared/db'
import { buildOfferId } from '@/lib/merchant/mapper'
import { LABEL_INDEX } from '@/lib/merchant/custom-labels'
import type { ListingDimension } from './campaign-spec'
import { OpList, TempIds, rn, toMicros } from './mutate'

// Product partitions: which feed items a Shopping ad group or a Performance Max asset group serves.
// One level under the root, split by brand, one of our custom labels, or (for categories) item ids,
// with everything else excluded.

export const MAX_LISTING_VALUES = 1000

const CUSTOM_INDEX: Partial<Record<ListingDimension, string>> = {
  MARGIN: `INDEX${LABEL_INDEX.margin}`,
  VELOCITY: `INDEX${LABEL_INDEX.velocity}`,
  STOCK: `INDEX${LABEL_INDEX.stock}`,
}

/** The case value for one branch; no value = the "everything else" branch of that dimension. */
export function caseValue(dimension: ListingDimension, value?: string): Record<string, any> {
  const v = value === undefined ? {} : { value }
  if (dimension === 'BRAND') return { productBrand: v }
  if (dimension === 'CATEGORY') return { productItemId: v }
  const index = CUSTOM_INDEX[dimension]
  if (!index) throw new Error(`No listing dimension for ${dimension}`)
  return { productCustomAttribute: { index, ...v } }
}

export interface ListingTree {
  dimension: ListingDimension
  /** Brand names, label values, or item ids (categories are resolved to item ids first). */
  values: string[]
}

function distinct(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter(v => {
    const k = v.trim().toLowerCase()
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Standard Shopping: root subdivision, one unit per value, everything else excluded. */
export function shoppingTreeOps(
  customerId: string,
  adGroupId: string,
  tree: ListingTree,
  opts: { cpcBid?: number | null } = {},
  ids = new TempIds()
): OpList {
  const ops = new OpList()
  const adGroup = rn.adGroup(customerId, adGroupId)
  const bid = opts.cpcBid ? { cpcBidMicros: toMicros(opts.cpcBid) } : {}
  if (tree.dimension === 'ALL') {
    return ops.create('adGroupCriterionOperation', { adGroup, status: 'ENABLED', listingGroup: { type: 'UNIT' }, ...bid }, 'All products')
  }
  const values = distinct(tree.values).slice(0, MAX_LISTING_VALUES)
  if (!values.length) throw new Error('Pick at least one product group')
  const root = rn.adGroupCriterion(customerId, adGroupId, ids.next())
  ops.create('adGroupCriterionOperation', { resourceName: root, adGroup, status: 'ENABLED', listingGroup: { type: 'SUBDIVISION' } }, 'Product groups')
  for (const v of values) {
    ops.create(
      'adGroupCriterionOperation',
      { adGroup, status: 'ENABLED', listingGroup: { type: 'UNIT', parentAdGroupCriterion: root, caseValue: caseValue(tree.dimension, v) }, ...bid },
      `Product group ${v}`
    )
  }
  ops.create(
    'adGroupCriterionOperation',
    { adGroup, status: 'ENABLED', negative: true, listingGroup: { type: 'UNIT', parentAdGroupCriterion: root, caseValue: caseValue(tree.dimension) } },
    'Everything else (excluded)'
  )
  return ops
}

/** Performance Max: the same tree as asset group listing group filters. */
export function pmaxTreeOps(customerId: string, assetGroupId: string, tree: ListingTree, ids = new TempIds()): OpList {
  const ops = new OpList()
  const assetGroup = rn.assetGroup(customerId, assetGroupId)
  const base = { assetGroup, listingSource: 'SHOPPING' }
  if (tree.dimension === 'ALL') {
    return ops.create('assetGroupListingGroupFilterOperation', { ...base, type: 'UNIT_INCLUDED' }, 'All products')
  }
  const values = distinct(tree.values).slice(0, MAX_LISTING_VALUES)
  if (!values.length) throw new Error('Pick at least one product group')
  const root = rn.listingFilter(customerId, assetGroupId, ids.next())
  ops.create('assetGroupListingGroupFilterOperation', { ...base, resourceName: root, type: 'SUBDIVISION' }, 'Product groups')
  for (const v of values) {
    ops.create(
      'assetGroupListingGroupFilterOperation',
      { ...base, type: 'UNIT_INCLUDED', caseValue: caseValue(tree.dimension, v), parentListingGroupFilter: root },
      `Product group ${v}`
    )
  }
  ops.create(
    'assetGroupListingGroupFilterOperation',
    { ...base, type: 'UNIT_EXCLUDED', caseValue: caseValue(tree.dimension), parentListingGroupFilter: root },
    'Everything else (excluded)'
  )
  return ops
}

/** Feed item ids (lower-cased offer ids) of the active products in these categories and their children. */
export async function itemIdsForCategories(categoryIds: string[]): Promise<string[]> {
  if (!categoryIds.length) return []
  const rows = await queryMany<{ sku: string }>(
    `WITH RECURSIVE cats AS (
       SELECT id FROM categories WHERE id = ANY($1::uuid[])
       UNION
       SELECT c.id FROM categories c JOIN cats ON c.parent_category_id = cats.id
     )
     SELECT COALESCE(v.sku, p.sku) AS sku
     FROM products p
     LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_active = true AND p.has_variants = true AND v.price IS NOT NULL
     WHERE p.category_id IN (SELECT id FROM cats) AND p.is_active IS NOT FALSE AND COALESCE(p.is_digital, false) = false
       AND p.sku IS NOT NULL`,
    [categoryIds]
  )
  return distinct(rows.map(r => buildOfferId(String(r.sku)).toLowerCase()))
}
