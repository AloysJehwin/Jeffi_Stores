import type { FieldKeys, FieldSql, FilterEntity } from '@jeffi/list-filters'
import { BRAND_ALIASES, BRAND_FIELDS } from '../fields/brands'
import { col, containsSearch, ist, nullableTs, yesNo } from './shared'

type BrandKey = FieldKeys<typeof BRAND_FIELDS>

const blank = (e: string) => `NULLIF(btrim(COALESCE(${e}, '')), '') IS NULL`
export const BRAND_PRODUCTS_SQL =
  '(SELECT COUNT(*) FROM products p WHERE p.brand_id = b.id AND p.is_active AND NOT p.is_draft)'

const SQL: Record<BrandKey, FieldSql> = {
  active: { kind: 'bool', expr: 'COALESCE(b.is_active, false)' },
  has_logo: { kind: 'bool', expr: `NOT (${blank('b.logo_url')})` },
  has_website: { kind: 'bool', expr: `NOT (${blank('b.website')})` },
  return_allowed: { kind: 'bool', expr: 'b.return_allowed' },
  replacement_allowed: { kind: 'bool', expr: 'b.replacement_allowed' },
  products: { kind: 'range', expr: BRAND_PRODUCTS_SQL },
  created: { kind: 'date', expr: 'b.created_at' },
}

export const BRANDS_ENTITY: FilterEntity<BrandKey> = {
  key: 'brands',
  scope: 'brands:read',
  noun: 'Brands',
  root: 'brands',
  alias: 'b',
  base: ['b.is_draft = false'],
  fields: BRAND_FIELDS,
  sql: SQL,
  period: 'created',
  aliases: BRAND_ALIASES,
  search: { build: (q, idx) => containsSearch(['b.name', 'b.slug'], q, idx) },
  facets: true,
  export: {
    columns: [
      col('name', 'Brand', 'b.name'),
      col('slug', 'Slug', 'b.slug'),
      col('status', 'Status', "CASE WHEN b.is_active THEN 'Active' ELSE 'Inactive' END"),
      col('products', 'Active products', BRAND_PRODUCTS_SQL),
      col('website', 'Website', 'b.website'),
      col('logo', 'Logo', yesNo(`NOT (${blank('b.logo_url')})`)),
      col('returns', 'Returns allowed', yesNo('b.return_allowed')),
      col('return_days', 'Return window (days)', 'b.return_window_days'),
      col('replacements', 'Replacements allowed', yesNo('b.replacement_allowed')),
      col('replacement_days', 'Replacement window (days)', 'b.replacement_window_days'),
      col('created', 'Created', ist('b.created_at')),
    ],
    keyset: [nullableTs('b.created_at'), 'b.id'],
  },
}
