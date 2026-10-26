import { defineFields, type FilterOption } from '@jeffi/list-filters/client'

// Amazon listing-status filters (client-safe; the SQL is in ../entities/amazon-listings.ts).

const opts = (pairs: [string, string][]): FilterOption[] => pairs.map(([value, label]) => ({ value, label }))
const YES_NO = opts([
  ['true', 'Yes'],
  ['false', 'No'],
])

export const AMAZON_LISTING_FIELDS = defineFields({
  status: {
    label: 'Status',
    type: 'multi-select',
    quick: true,
    section: 'Listing',
    options: opts([
      ['approved', 'Approved'],
      ['pending', 'Pending'],
      ['disapproved', 'Blocked'],
      ['unknown', 'Unknown'],
    ]),
  },
  issues: { label: 'Has issues', type: 'toggle', options: YES_NO, section: 'Listing' },
  asin: { label: 'Has ASIN', type: 'toggle', options: YES_NO, section: 'Listing' },
  parent: { label: 'Variation of a parent', type: 'toggle', options: YES_NO, section: 'Listing' },
  price: { label: 'Price', type: 'range', unit: '₹', section: 'Listing' },
  synced: { name: ['from', 'to'], label: 'Synced on', type: 'date-range', section: 'Listing' },
})

export const AMAZON_LISTING_SEARCH = { placeholder: 'Search SKU or title…', param: 'search' }
