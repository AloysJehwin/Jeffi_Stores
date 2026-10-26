import type { FieldKeys, FieldSql, FilterEntity } from '@jeffi/list-filters'
import { CATEGORY_ALIASES, CATEGORY_FIELDS } from '../fields/categories'
import { col, containsSearch, ist, nullableTs, yesNo } from './shared'

type CategoryKey = FieldKeys<typeof CATEGORY_FIELDS>

const blank = (e: string) => `NULLIF(btrim(COALESCE(${e}, '')), '') IS NULL`
const PARENT_NAME = '(SELECT pc.name FROM categories pc WHERE pc.id = c.parent_category_id)'
export const CATEGORY_PRODUCTS_SQL =
  '(SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.is_active AND NOT p.is_draft)'

const SQL: Record<CategoryKey, FieldSql> = {
  active: { kind: 'bool', expr: 'COALESCE(c.is_active, false)' },
  level: {
    kind: 'enum',
    virtual: { main: 'c.parent_category_id IS NULL', sub: 'c.parent_category_id IS NOT NULL' },
  },
  parent: { kind: 'values', lateral: { from: 'categories pc', link: 'pc.id = c.parent_category_id', expr: 'pc.name' } },
  has_image: { kind: 'bool', expr: `NOT (${blank('c.image_url')})` },
  google_category: { kind: 'bool', expr: `NOT (${blank('c.google_product_category')})` },
  return_allowed: { kind: 'bool', expr: 'COALESCE(c.return_allowed, false)' },
  replacement_allowed: { kind: 'bool', expr: 'COALESCE(c.replacement_allowed, false)' },
  products: { kind: 'range', expr: CATEGORY_PRODUCTS_SQL },
  created: { kind: 'date', expr: 'c.created_at' },
}

export const CATEGORIES_ENTITY: FilterEntity<CategoryKey> = {
  key: 'categories',
  scope: 'categories:read',
  noun: 'Categories',
  root: 'categories',
  alias: 'c',
  base: ['c.is_draft = false'],
  fields: CATEGORY_FIELDS,
  sql: SQL,
  period: 'created',
  aliases: CATEGORY_ALIASES,
  search: { build: (q, idx) => containsSearch(['c.name', 'c.slug'], q, idx) },
  facets: true,
  export: {
    columns: [
      col('name', 'Category', 'c.name'),
      col('parent', 'Parent', PARENT_NAME),
      col('slug', 'Slug', 'c.slug'),
      col('status', 'Status', "CASE WHEN c.is_active THEN 'Active' ELSE 'Inactive' END"),
      col('products', 'Active products', CATEGORY_PRODUCTS_SQL),
      col('order', 'Display order', 'c.display_order'),
      col('sku_prefix', 'SKU prefix', 'c.sku_prefix'),
      col('google_category', 'Google product category', 'c.google_product_category'),
      col('image', 'Image', yesNo(`NOT (${blank('c.image_url')})`)),
      col('returns', 'Returns allowed', yesNo('COALESCE(c.return_allowed, false)')),
      col('return_days', 'Return window (days)', 'c.return_window_days'),
      col('replacements', 'Replacements allowed', yesNo('COALESCE(c.replacement_allowed, false)')),
      col('replacement_days', 'Replacement window (days)', 'c.replacement_window_days'),
      col('created', 'Created', ist('c.created_at')),
    ],
    keyset: [nullableTs('c.created_at'), 'c.id'],
  },
}
