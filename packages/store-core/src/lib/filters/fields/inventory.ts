import { defineFields, type FilterAlias, type FilterOption } from '@jeffi/list-filters/client'

// Inventory list filters, one set per tab (client-safe; the SQL is in ../entities/inventory.ts).

const opts = (pairs: [string, string][]): FilterOption[] => pairs.map(([value, label]) => ({ value, label }))
const YES_NO = opts([
  ['true', 'Yes'],
  ['false', 'No'],
])
const vh = (label: string, section: string, noun: string) =>
  ({ label, type: 'value-help', section, placeholder: `Any ${label.toLowerCase()}`, noun }) as const

export const LEDGER_FIELDS = defineFields({
  type: {
    label: 'Type',
    type: 'multi-select',
    quick: true,
    section: 'Movement',
    options: opts([
      ['purchase', 'Purchase'],
      ['sale', 'Sale'],
      ['return', 'Return'],
      ['adjustment', 'Adjustment'],
    ]),
  },
  direction: {
    label: 'Direction',
    type: 'multi-select',
    quick: true,
    section: 'Movement',
    options: opts([
      ['in', 'Stock in'],
      ['out', 'Stock out'],
    ]),
  },
  created: { name: ['from', 'to'], label: 'Date', type: 'date-range', section: 'Movement' },
  quantity: { label: 'Quantity moved', type: 'range', section: 'Movement' },
  reference: vh('Reference type', 'Movement', 'Movements'),
  product: vh('Product', 'Product', 'Movements'),
  sku: vh('SKU', 'Product', 'Movements'),
  tracked: { label: 'Lot / serial recorded', type: 'toggle', options: YES_NO, section: 'Product' },
})

export const LEDGER_ALIASES: FilterAlias[] = [
  { param: 'ledger_search', to: 'search' },
  { param: 'ledger_from', to: 'from' },
  { param: 'ledger_to', to: 'to' },
]

/** Without dates (or a product) the ledger shows this many days. */
export const LEDGER_DEFAULT_DAYS = 30
export const LEDGER_COUNT_CAP = 10_000

export const VALUATION_FIELDS = defineFields({
  stock_status: {
    label: 'Stock',
    type: 'multi-select',
    quick: true,
    section: 'Stock',
    options: opts([
      ['in_stock', 'In stock'],
      ['low_stock', 'Low stock (≤5)'],
      ['out_of_stock', 'Out of stock'],
    ]),
  },
  below_reorder: { label: 'At or below reorder level', type: 'toggle', options: YES_NO, section: 'Stock' },
  quantity: { label: 'Units on hand', type: 'range', section: 'Stock' },
  value: { label: 'Stock value (ex-GST)', type: 'range', unit: '₹', section: 'Stock' },
  category: vh('Category', 'Product', 'Products'),
  brand: vh('Brand', 'Product', 'Products'),
  supplier: vh('Supplier', 'Product', 'Products'),
  tax_class: vh('Tax class', 'Product', 'Products'),
})

export const VALUATION_ALIASES: FilterAlias[] = [
  { param: 'val_search', to: 'search' },
  { param: 'val_category', to: 'category' },
  { param: 'val_brand', to: 'brand' },
  { param: 'val_stock', to: 'stock_status' },
]

export const PRODUCT_SEARCH = { placeholder: 'Name, SKU, variant...', param: 'search' }
