import { defineFields, type FilterAlias, type FilterOption } from '@jeffi/list-filters/client'

// Coupons list filters (client-safe; the SQL is in ../entities/coupons.ts).

const opts = (pairs: [string, string][]): FilterOption[] => pairs.map(([value, label]) => ({ value, label }))

export const COUPON_FIELDS = defineFields({
  is_active: {
    label: 'Status',
    type: 'toggle',
    quick: true,
    section: 'Status',
    options: opts([
      ['true', 'Active'],
      ['false', 'Inactive'],
    ]),
  },
  state: {
    label: 'Validity',
    type: 'multi-select',
    quick: true,
    section: 'Status',
    options: opts([
      ['live', 'Live now'],
      ['scheduled', 'Scheduled'],
      ['expired', 'Expired'],
      ['exhausted', 'Usage limit reached'],
    ]),
  },
  auto_generated: {
    label: 'Source',
    type: 'toggle',
    quick: true,
    section: 'Status',
    options: opts([
      ['false', 'Manual'],
      ['true', 'Auto-generated'],
    ]),
  },
  campaign: { label: 'Campaign', type: 'value-help', section: 'Status', placeholder: 'Any campaign', noun: 'Coupons' },

  discount_type: {
    label: 'Discount type',
    type: 'multi-select',
    section: 'Discount',
    options: opts([
      ['percentage', 'Percentage'],
      ['fixed', 'Fixed amount'],
    ]),
  },
  value: { label: 'Discount value', type: 'range', section: 'Discount' },
  min_purchase: { label: 'Minimum purchase', type: 'range', unit: '₹', section: 'Discount' },
  used: { label: 'Times used', type: 'range', section: 'Discount' },

  created: { name: ['from', 'to'], label: 'Created', type: 'date-range', section: 'Dates' },
  starts: { label: 'Valid from', type: 'date-range', section: 'Dates' },
  ends: { label: 'Valid until', type: 'date-range', section: 'Dates' },
})

export const COUPON_ALIASES: FilterAlias[] = [
  { param: 'campaign', value: '__manual__', to: 'auto_generated', set: 'false' },
]

export const COUPON_SEARCH = {
  placeholder: 'Search by code or description...',
  param: 'search',
  suggestType: 'coupons',
}
