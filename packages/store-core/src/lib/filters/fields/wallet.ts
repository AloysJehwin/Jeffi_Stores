import { defineFields, type FilterOption } from '@jeffi/list-filters/client'

// Wallet ledger filters (client-safe; the SQL is in ../entities/wallet.ts).

const opts = (pairs: [string, string][]): FilterOption[] => pairs.map(([value, label]) => ({ value, label }))

export const WALLET_FIELDS = defineFields({
  direction: {
    label: 'Direction',
    type: 'multi-select',
    quick: true,
    section: 'Entry',
    options: opts([
      ['in', 'In (credits)'],
      ['out', 'Out (debits)'],
    ]),
  },
  category: { label: 'Category', type: 'value-help', section: 'Entry', noun: 'Entries' },
  date: { name: ['from', 'to'], label: 'Date', type: 'date-range', section: 'Entry' },
  amount: { label: 'Amount (either way)', type: 'range', unit: '₹', section: 'Entry' },
  reference: { label: 'Order or AWB', type: 'value-help', section: 'Entry', noun: 'Entries' },
})

export const WALLET_SEARCH = { placeholder: 'Search order, AWB or note…', param: 'search' }
