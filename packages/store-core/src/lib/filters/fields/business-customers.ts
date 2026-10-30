import { defineFields, type FilterAlias, type FilterOption } from '@jeffi/list-filters/client'

// Business customer (B2B account) filters (client-safe; the SQL is in ../entities/business-customers.ts).

const opts = (pairs: [string, string][]): FilterOption[] => pairs.map(([value, label]) => ({ value, label }))
const YES_NO = opts([
  ['true', 'Yes'],
  ['false', 'No'],
])

export const B2B_FIELDS = defineFields({
  approval: {
    label: 'Approval',
    type: 'multi-select',
    quick: true,
    section: 'Account',
    options: opts([
      ['pending', 'Pending'],
      ['approved', 'Approved'],
      ['rejected', 'Rejected'],
    ]),
  },
  created: { name: ['from', 'to'], label: 'Applied on', type: 'date-range', section: 'Account' },
  industry: { label: 'Industry', type: 'value-help', section: 'Account', noun: 'Accounts' },
  gstin: { label: 'Has GSTIN', type: 'toggle', options: YES_NO, section: 'Account' },
  state: { label: 'State', type: 'value-help', section: 'Account', noun: 'Accounts' },
  orders: { label: 'Orders', type: 'range', section: 'Buying' },
  ltv: { label: 'Lifetime value', type: 'range', unit: '₹', section: 'Buying' },
})

// Old links (and the overview's attention items) say ?status=pending.
export const B2B_ALIASES: FilterAlias[] = [{ param: 'status', to: 'approval' }]

export const B2B_SEARCH = { placeholder: 'Search by email, company, GST...', param: 'search' }
