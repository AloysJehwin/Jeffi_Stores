import { escapeLike, type FieldKeys, type FieldSql, type FilterEntity } from '@jeffi/list-filters'
import { AMAZON_LISTING_FIELDS } from '../fields/amazon-listings'

// The Amazon listing-status snapshot (amazon_listing_status al, one row per SKU).

type AmazonListingKey = FieldKeys<typeof AMAZON_LISTING_FIELDS>

const IST = (col: string) => `to_char(${col} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')`
const ISSUES = `CASE WHEN jsonb_typeof(al.issues) = 'array' THEN jsonb_array_length(al.issues) ELSE 0 END`
// price is text; only plain numbers compare.
const PRICE = `CASE WHEN al.price ~ '^\\s*[0-9]+(\\.[0-9]+)?\\s*$' THEN btrim(al.price)::numeric END`

const SQL: Record<AmazonListingKey, FieldSql> = {
  status: { kind: 'enum', expr: 'al.status', virtual: { unknown: "(al.status IS NULL OR al.status = 'unknown')" } },
  issues: { kind: 'bool', expr: `${ISSUES} > 0` },
  asin: { kind: 'bool', expr: "NULLIF(btrim(al.asin), '') IS NOT NULL" },
  parent: { kind: 'bool', expr: "NULLIF(btrim(al.parent_sku), '') IS NOT NULL" },
  price: { kind: 'range', expr: PRICE },
  synced: { kind: 'date', expr: 'al.synced_at' },
}

export const AMAZON_LISTINGS_ENTITY: FilterEntity<AmazonListingKey> = {
  key: 'amazon.listings',
  scope: 'merchant_sync:read',
  noun: 'Listings',
  root: 'amazon_listing_status',
  alias: 'al',
  pk: 'sku',
  fields: AMAZON_LISTING_FIELDS,
  sql: SQL,
  period: 'synced',
  search: {
    build: (q, idx) => ({
      clause: `(al.sku ILIKE $${idx} OR al.title ILIKE $${idx})`,
      params: [`%${escapeLike(q.trim())}%`],
      nextIdx: idx + 1,
    }),
  },
  facets: true,
  export: {
    columns: [
      { key: 'sku', label: 'SKU', sql: 'al.sku' },
      { key: 'title', label: 'Title', sql: 'al.title' },
      { key: 'status', label: 'Status', sql: 'al.status' },
      { key: 'asin', label: 'ASIN', sql: 'al.asin' },
      { key: 'parent_sku', label: 'Parent SKU', sql: 'al.parent_sku' },
      { key: 'price', label: 'Price', sql: 'al.price' },
      { key: 'issues', label: 'Issues', sql: ISSUES },
      {
        key: 'top_issue',
        label: 'Top issue',
        sql: `CASE WHEN jsonb_typeof(al.issues) = 'array' THEN al.issues->0->>'message' END`,
      },
      { key: 'synced_at', label: 'Synced on', sql: IST('al.synced_at') },
    ],
    keyset: ['al.sku'],
  },
}
