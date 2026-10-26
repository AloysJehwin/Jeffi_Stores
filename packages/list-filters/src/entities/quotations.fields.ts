import { defineFields, type FilterAlias, type FilterOption } from '../client'

// Quotations list filters (client-safe; the SQL is in ./quotations.ts).

const opts = (pairs: [string, string][]): FilterOption[] => pairs.map(([value, label]) => ({ value, label }))
const YES_NO = opts([
  ['true', 'Yes'],
  ['false', 'No'],
])
const vh = (label: string, section: string) =>
  ({ label, type: 'value-help', section, placeholder: `Any ${label.toLowerCase()}`, noun: 'Quotations' }) as const

/** A finalized quote counts as open this many days from its quote date (no validity date is stored). */
export const QUOTE_VALID_DAYS = 30
export const QUOTE_STALE_DRAFT_DAYS = 3

export const QUOTATION_FIELDS = defineFields({
  status: {
    label: 'Status',
    type: 'multi-select',
    quick: true,
    section: 'Quotation',
    options: opts([
      ['draft', 'Draft'],
      ['final', 'Final'],
    ]),
  },
  quoted: { name: ['from', 'to'], label: 'Quote date', type: 'date-range', section: 'Quotation' },
  pipeline: {
    label: 'Follow-up',
    type: 'multi-select',
    section: 'Quotation',
    options: opts([
      ['open', `Open (within ${QUOTE_VALID_DAYS} days)`],
      ['expiring', 'Expiring this week'],
      ['lapsed', `Past ${QUOTE_VALID_DAYS} days, no order`],
      ['stale_draft', `Draft over ${QUOTE_STALE_DRAFT_DAYS} days`],
    ]),
  },
  converted: { label: 'Converted to invoice', type: 'toggle', options: YES_NO, section: 'Quotation' },
  from_rfq: { label: 'From an RFQ', type: 'toggle', options: YES_NO, section: 'Quotation' },
  amount: { label: 'Quote total', type: 'range', unit: '₹', section: 'Quotation' },
  created_by: vh('Created by', 'Quotation'),
  state: vh('Buyer state', 'Buyer'),
  city: vh('Consignee city', 'Buyer'),
  gstin: { label: 'Buyer has GSTIN', type: 'toggle', options: YES_NO, section: 'Buyer' },
})

export const QUOTATION_ALIASES: FilterAlias[] = [
  { param: 'q', to: 'search' },
  { param: 'date_from', to: 'from' },
  { param: 'date_to', to: 'to' },
]

export const QUOTATION_SEARCH = {
  placeholder: 'Search quote # or consignee...',
  param: 'search',
  suggestType: 'quotations',
}
