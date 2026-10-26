import { defineFields, type FilterOption } from '@jeffi/list-filters/client'

// Business RFQ filters (client-safe; the SQL is in ../entities/business-rfqs.ts).

const opts = (pairs: [string, string][]): FilterOption[] => pairs.map(([value, label]) => ({ value, label }))
const YES_NO = opts([
  ['true', 'Yes'],
  ['false', 'No'],
])

export const RFQ_STATUS_OPTIONS = opts([
  ['pending', 'Pending'],
  ['reviewed', 'Reviewed'],
  ['negotiating', 'Negotiating'],
  ['offer_accepted', 'Offer accepted'],
  ['converted', 'Converted'],
  ['rejected', 'Rejected'],
])

export const RFQ_FIELDS = defineFields({
  status: { label: 'Status', type: 'multi-select', options: RFQ_STATUS_OPTIONS, quick: true, section: 'RFQ' },
  created: { name: ['from', 'to'], label: 'Submitted on', type: 'date-range', section: 'RFQ' },
  items: { label: 'Line items', type: 'range', section: 'RFQ' },
  reviewed: { label: 'Reviewed', type: 'toggle', options: YES_NO, section: 'RFQ' },
  converted: { label: 'Turned into a quotation', type: 'toggle', options: YES_NO, section: 'RFQ' },
  company: { label: 'Company', type: 'value-help', section: 'Buyer', noun: 'RFQs' },
  industry: { label: 'Industry', type: 'value-help', section: 'Buyer', noun: 'RFQs' },
})

export const RFQ_SEARCH = { placeholder: 'Search by RFQ number, company, email...', param: 'search' }
