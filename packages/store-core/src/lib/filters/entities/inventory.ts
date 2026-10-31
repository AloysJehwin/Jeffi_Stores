import type { FieldKeys, FieldSql, FilterEntity } from '@jeffi/list-filters'
import { buildProductSearchClause } from '@/lib/catalog/search'
import { LEDGER_ALIASES, LEDGER_DEFAULT_DAYS, LEDGER_FIELDS, VALUATION_ALIASES, VALUATION_FIELDS } from '../fields/inventory'

// Inventory tabs: the stock ledger (inventory_transactions, high volume: default window, capped
// count) and the valuation (one row per active product; its leaves carry the stock).

type LedgerKey = FieldKeys<typeof LEDGER_FIELDS>
type ValuationKey = FieldKeys<typeof VALUATION_FIELDS>

const IST = (col: string) => `to_char(${col} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')`
const LEAF_SKU = `COALESCE((SELECT sv.sku FROM product_sub_variants sv WHERE sv.id = it.sub_variant_id),
  (SELECT pv.sku FROM product_variants pv WHERE pv.id = it.variant_id),
  (SELECT p.sku FROM products p WHERE p.id = it.product_id))`

const productSearch = (alias: string) => (q: string, idx: number) => {
  const sc = buildProductSearchClause(q, 'p.name', 'p.sku', 'p.search_vector', idx)
  return alias === 'p'
    ? sc
    : { ...sc, clause: `EXISTS (SELECT 1 FROM products p WHERE p.id = ${alias}.product_id AND ${sc.clause})` }
}

const LEDGER_SQL: Record<LedgerKey, FieldSql> = {
  type: { kind: 'enum', expr: 'it.transaction_type' },
  direction: { kind: 'enum', virtual: { in: 'it.quantity_change > 0', out: 'it.quantity_change < 0' } },
  created: { kind: 'date', expr: 'it.created_at' },
  quantity: { kind: 'range', expr: 'abs(it.quantity_change)' },
  reference: { kind: 'values', expr: 'it.reference_type' },
  product: { kind: 'values', lateral: { from: 'products p', link: 'p.id = it.product_id', expr: 'p.name' } },
  sku: { kind: 'values', fold: 'upper', expr: LEAF_SKU },
  tracked: { kind: 'bool', expr: '(it.batch_id IS NOT NULL OR it.lot_number IS NOT NULL OR it.serial_number IS NOT NULL)' },
}

// Ledger sorts are per event (the page unit), over getStockLedger's it / p joins.
export const LEDGER_SORTS: Record<string, string> = {
  date: 'MAX(it.created_at)',
  product: 'MIN(p.name)',
  type: 'MIN(it.transaction_type)',
  change: 'SUM(it.quantity_change)',
  balance: 'MAX(it.quantity_after)',
  reference: 'MIN(it.reference_type)',
  batch: 'MIN(COALESCE(it.serial_number, it.lot_number))',
}

export const LEDGER_ENTITY: FilterEntity<LedgerKey> = {
  key: 'inventory.ledger',
  scope: 'inventory:read',
  noun: 'Movements',
  root: 'inventory_transactions',
  alias: 'it',
  base: ['it.product_id IS NOT NULL'],
  fields: LEDGER_FIELDS,
  sql: LEDGER_SQL,
  period: 'created',
  aliases: LEDGER_ALIASES,
  search: { build: productSearch('it') },
  sorts: LEDGER_SORTS,
  facets: true,
  defaultWindowDays: LEDGER_DEFAULT_DAYS,
  export: {
    columns: [
      { key: 'date', label: 'Date', sql: IST('it.created_at') },
      { key: 'type', label: 'Type', sql: 'it.transaction_type' },
      { key: 'product', label: 'Product', sql: '(SELECT p.name FROM products p WHERE p.id = it.product_id)' },
      {
        key: 'variant',
        label: 'Variant',
        sql: `concat_ws(' / ', (SELECT pv.variant_name FROM product_variants pv WHERE pv.id = it.variant_id),
          (SELECT sv.sub_variant_name FROM product_sub_variants sv WHERE sv.id = it.sub_variant_id))`,
      },
      { key: 'sku', label: 'SKU', sql: LEAF_SKU },
      { key: 'change', label: 'Change', sql: 'it.quantity_change' },
      { key: 'balance', label: 'Balance', sql: 'it.quantity_after' },
      { key: 'unit', label: 'Unit', sql: 'it.unit_label' },
      { key: 'reference_type', label: 'Reference type', sql: 'it.reference_type' },
      {
        key: 'reference',
        label: 'Reference',
        sql: `CASE it.reference_type
          WHEN 'order' THEN (SELECT o.invoice_number FROM orders o WHERE o.id = it.reference_id)
          WHEN 'cash_sale' THEN (SELECT cs.invoice_number FROM cash_sales cs WHERE cs.id = it.reference_id)
          WHEN 'grn' THEN (SELECT g.grn_number FROM grns g WHERE g.id = it.reference_id) END`,
      },
      { key: 'lot', label: 'Lot', sql: 'it.lot_number' },
      { key: 'serial', label: 'Serial', sql: 'it.serial_number' },
      { key: 'notes', label: 'Notes', sql: 'it.notes' },
    ],
    keyset: ['it.created_at', 'it.id'],
  },
}

// The product's sellable leaves, as in the valuation view: the product itself when it has no
// variants, variants without active sub-variants, and sub-variants. q is NULL for a variant parent.
const LEAVES = `(SELECT CASE WHEN p.has_variants THEN NULL ELSE COALESCE(p.inventory_quantity, 0) END AS q,
         COALESCE(p.base_price, 0) AS price
  UNION ALL
  SELECT COALESCE(pv.inventory_quantity, 0), COALESCE(pv.price, p.base_price, 0)
  FROM product_variants pv
  WHERE pv.product_id = p.id AND pv.is_active
    AND NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active)
  UNION ALL
  SELECT COALESCE(sv.inventory_quantity, 0), COALESCE(sv.price, pv.price, p.base_price, 0)
  FROM product_sub_variants sv JOIN product_variants pv ON pv.id = sv.variant_id
  WHERE pv.product_id = p.id AND pv.is_active AND sv.is_active) l`
const anyLeaf = (cond: string) => `EXISTS (SELECT 1 FROM ${LEAVES} WHERE l.q IS NOT NULL AND ${cond})`
export const PRODUCT_QTY_SQL = `(SELECT COALESCE(SUM(l.q), 0) FROM ${LEAVES})`
export const PRODUCT_VALUE_SQL = `(SELECT COALESCE(SUM(l.q * ROUND(l.price / (1 + COALESCE(p.gst_percentage, 0) / 100), 2)), 0) FROM ${LEAVES})`

const VALUATION_SQL: Record<ValuationKey, FieldSql> = {
  // A product matches when any of its leaves does (the valuation pages by product).
  stock_status: {
    kind: 'enum',
    virtual: { in_stock: anyLeaf('l.q > 0'), low_stock: anyLeaf('l.q > 0 AND l.q <= 5'), out_of_stock: anyLeaf('l.q <= 0') },
  },
  below_reorder: {
    kind: 'bool',
    expr: `p.low_stock_threshold IS NOT NULL AND ${anyLeaf('l.q <= p.low_stock_threshold')}`,
  },
  quantity: { kind: 'range', expr: PRODUCT_QTY_SQL },
  value: { kind: 'range', expr: PRODUCT_VALUE_SQL },
  // A parent category matches its children's products too.
  category: {
    kind: 'values',
    lateral: {
      from: 'categories c LEFT JOIN categories pc ON pc.id = c.parent_category_id',
      link: 'c.id = p.category_id',
      expr: ['c.name', 'pc.name'],
    },
  },
  brand: { kind: 'values', lateral: { from: 'brands b', link: 'b.id = p.brand_id', expr: 'b.name' } },
  supplier: {
    kind: 'values',
    lateral: {
      from: 'suppliers su',
      link: `(su.id = p.supplier_id OR su.id IN (SELECT ps.supplier_id FROM product_suppliers ps
        WHERE ps.product_id = p.id AND ps.is_active))`,
      expr: 'su.name',
    },
  },
  tax_class: { kind: 'values', expr: 'p.tax_class' },
}

// Valuation sorts are per product (the page unit; totals sum its leaves), over the valuation query's `rows`.
export const VAL_SORTS: Record<string, string> = {
  product: 'MIN(rows.name)',
  variant: 'MIN(rows.variant_name)',
  sku: 'MIN(rows.row_sku)',
  stock: 'SUM(rows.inventory_quantity)',
  unit: 'MIN(COALESCE(rows.sell_unit_label, rows.sell_unit))',
  price: 'MIN(rows.cost_price)',
  gst: 'MIN(rows.gst_percentage)',
  value: 'SUM(rows.stock_value)',
  value_incl: 'SUM(rows.inventory_quantity * rows.selling_price)',
}

export const VALUATION_ENTITY: FilterEntity<ValuationKey> = {
  key: 'inventory.valuation',
  scope: 'inventory:read',
  noun: 'Products',
  root: 'products',
  alias: 'p',
  base: ['p.is_active = TRUE'],
  fields: VALUATION_FIELDS,
  sql: VALUATION_SQL,
  aliases: VALUATION_ALIASES,
  search: { build: productSearch('p') },
  sorts: VAL_SORTS,
  facets: true,
  export: {
    columns: [
      { key: 'product', label: 'Product', sql: 'p.name' },
      { key: 'sku', label: 'SKU', sql: 'p.sku' },
      { key: 'category', label: 'Category', sql: '(SELECT c.name FROM categories c WHERE c.id = p.category_id)' },
      { key: 'brand', label: 'Brand', sql: '(SELECT b.name FROM brands b WHERE b.id = p.brand_id)' },
      { key: 'units', label: 'Units on hand', sql: PRODUCT_QTY_SQL },
      { key: 'value', label: 'Stock value (ex-GST)', sql: PRODUCT_VALUE_SQL },
      { key: 'gst', label: 'GST %', sql: 'p.gst_percentage' },
      { key: 'reorder_level', label: 'Reorder level', sql: 'p.low_stock_threshold' },
    ],
    keyset: ['p.name', 'p.id'],
  },
}
