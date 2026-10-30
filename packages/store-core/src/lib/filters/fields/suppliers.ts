import { defineFields, type FilterOption } from '@jeffi/list-filters/client'

// Suppliers list filters (client-safe; the SQL is in ../entities/suppliers.ts).

const YES_NO: FilterOption[] = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
]

export const SUPPLIER_FIELDS = defineFields({
  active: {
    label: 'Status',
    type: 'toggle',
    quick: true,
    options: [
      { value: 'true', label: 'Active' },
      { value: 'false', label: 'Inactive' },
    ],
    section: 'Supplier',
  },
  has_gstin: { label: 'Has GSTIN', type: 'toggle', options: YES_NO, section: 'Supplier' },
  payment_terms: {
    label: 'Payment terms (days)',
    type: 'value-help',
    placeholder: 'Any terms',
    noun: 'Suppliers',
    section: 'Supplier',
  },
  pos: { label: 'Purchase orders', type: 'range', section: 'Purchasing' },
  open_pos: { label: 'Has open POs', type: 'boolean', section: 'Purchasing' },
  payable: { label: 'Payable', type: 'range', unit: '₹', section: 'Purchasing' },
  created: { name: ['from', 'to'], label: 'Added on', type: 'date-range', section: 'Purchasing' },
})

export const SUPPLIER_SEARCH = { placeholder: 'Name, GSTIN, contact...', param: 'search', suggestType: 'suppliers' }

/** The Suppliers tab opens on active suppliers. */
export const SUPPLIER_LIST_PRESET = 'active=true'
