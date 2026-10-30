import { defineFields, type FilterOption } from '@jeffi/list-filters/client'

// Customers list filters (client-safe; the SQL is in ../entities/customers.ts).

const opts = (pairs: [string, string][]): FilterOption[] => pairs.map(([value, label]) => ({ value, label }))
const YES_NO = opts([
  ['true', 'Yes'],
  ['false', 'No'],
])

export const CUSTOMER_FIELDS = defineFields({
  status: {
    label: 'Status',
    type: 'multi-select',
    quick: true,
    section: 'Account',
    options: opts([
      ['active', 'Active'],
      ['inactive', 'Inactive'],
      ['flagged', 'Flagged'],
    ]),
  },
  segment: {
    label: 'Segment',
    type: 'multi-select',
    quick: true,
    section: 'Orders',
    options: opts([
      ['vip', 'VIP (₹50k+)'],
      ['loyal', 'Loyal'],
      ['repeat', 'Repeat (3+)'],
      ['one_time', 'One-time'],
      ['new', 'New (<30d)'],
      ['at_risk', 'At Risk (90-180d)'],
      ['dormant', 'Dormant (180d+)'],
      ['b2b', 'B2B'],
      ['lead', 'Lead (no orders)'],
    ]),
  },
  health: {
    label: 'Health',
    type: 'multi-select',
    quick: true,
    section: 'Orders',
    options: opts([
      ['healthy', 'Healthy (≥70)'],
      ['at_risk', 'At Risk (40-69)'],
      ['critical', 'Critical (<40)'],
      ['unknown', 'Not scored'],
    ]),
  },
  tag: { label: 'Tag', type: 'value-help', section: 'Account', placeholder: 'Any tag', noun: 'Customers' },

  joined: { name: ['from', 'to'], label: 'Joined', type: 'date-range', section: 'Account' },
  last_order: { label: 'Last order', type: 'date-range', section: 'Orders' },
  orders: { label: 'Orders', type: 'range', section: 'Orders' },
  lifetime_value: { label: 'Lifetime value', type: 'range', unit: '₹', section: 'Orders' },

  user_type: {
    label: 'Account type',
    type: 'multi-select',
    section: 'Account',
    options: opts([
      ['customer', 'Customer'],
      ['business', 'Business'],
    ]),
  },
  auth_provider: {
    label: 'Sign-in method',
    type: 'value-help',
    section: 'Account',
    placeholder: 'Any method',
    noun: 'Customers',
  },
  phone_verified: { label: 'Phone verified', type: 'toggle', options: YES_NO, section: 'Account' },
  marketing_opt_out: { label: 'Opted out of marketing', type: 'toggle', options: YES_NO, section: 'Account' },
})

export const CUSTOMER_SEARCH = {
  placeholder: 'Search by name, email or phone...',
  param: 'search',
  suggestType: 'customers',
}
