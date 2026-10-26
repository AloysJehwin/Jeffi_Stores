import { defineFields, type FilterAlias, type FilterOption } from '../client'

// Purchase order list filters (client-safe; the SQL is in ./purchase-orders.ts).

const opts = (pairs: [string, string][]): FilterOption[] => pairs.map(([value, label]) => ({ value, label }))
const YES_NO = opts([
  ['true', 'Yes'],
  ['false', 'No'],
])

export const PO_FIELDS = defineFields({
  status: {
    label: 'Status',
    type: 'multi-select',
    quick: true,
    section: 'Purchase order',
    options: opts([
      ['draft', 'Draft'],
      ['sent', 'Sent'],
      ['partial', 'Partial'],
      ['received', 'Received'],
      ['cancelled', 'Cancelled'],
    ]),
  },
  supplier: {
    label: 'Supplier',
    type: 'value-help',
    section: 'Purchase order',
    placeholder: 'Any supplier',
    noun: 'Purchase orders',
  },
  ordered: { name: ['from', 'to'], label: 'Order date', type: 'date-range', section: 'Dates & amount' },
  expected: { label: 'Expected delivery', type: 'date-range', section: 'Dates & amount' },
  amount: { label: 'PO total', type: 'range', unit: '₹', section: 'Dates & amount' },
  overdue: { label: 'Past expected date', type: 'boolean', section: 'Receiving' },
  has_receipts: { label: 'Goods received (GRN)', type: 'toggle', options: YES_NO, section: 'Receiving' },
})

export const PO_ALIASES: FilterAlias[] = [
  { param: 'date_from', to: 'from' },
  { param: 'date_to', to: 'to' },
]

export const PO_SEARCH = {
  placeholder: 'PO number, supplier...',
  param: 'search',
  suggestType: 'purchase_orders',
}
