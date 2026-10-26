import { defineFields, type FilterAlias, type FilterOption } from '../client'

// Invoices list filters (client-safe; the SQL is in ./invoices.ts). Orders and cash sales together.

const opts = (pairs: [string, string][]): FilterOption[] => pairs.map(([value, label]) => ({ value, label }))
const YES_NO = opts([
  ['true', 'Yes'],
  ['false', 'No'],
])

export const INVOICE_FIELDS = defineFields({
  source: {
    label: 'Source',
    type: 'multi-select',
    quick: true,
    section: 'Invoice',
    options: opts([
      ['online', 'Online'],
      ['business', 'Business'],
      ['offline', 'Offline'],
      ['amazon', 'Amazon'],
      ['cash_sale', 'Cash sale'],
    ]),
  },
  payment_status: {
    label: 'Payment',
    type: 'multi-select',
    quick: true,
    section: 'Invoice',
    options: opts([
      ['paid', 'Paid'],
      ['unpaid', 'Unpaid'],
      ['partial', 'Partially paid'],
      ['pending', 'Pending'],
      ['cod_pending', 'COD pending'],
      ['cod_collected', 'COD collected'],
      ['refunded', 'Refunded'],
      ['partially_refunded', 'Partially refunded'],
      ['failed', 'Failed'],
      ['cancelled', 'Cancelled'],
    ]),
  },
  invoiced: { name: ['from', 'to'], label: 'Invoice date', type: 'date-range', section: 'Invoice' },
  voided: { label: 'Voided (cancelled)', type: 'toggle', options: YES_NO, section: 'Invoice' },
  overdue: { label: 'Unpaid over 30 days', type: 'boolean', section: 'Invoice' },
  amount: { label: 'Invoice total', type: 'range', unit: '₹', section: 'Amounts' },
  tax: { label: 'GST', type: 'range', unit: '₹', section: 'Amounts' },
  irn_status: {
    label: 'E-invoice (IRN)',
    type: 'value-help',
    section: 'GST',
    placeholder: 'Any IRN status',
    noun: 'Invoices',
  },
  b2b: { label: 'B2B (GSTIN)', type: 'toggle', options: YES_NO, section: 'GST' },
  igst: { label: 'IGST (inter-state)', type: 'toggle', options: YES_NO, section: 'GST' },
  eway: { label: 'E-way bill', type: 'toggle', options: YES_NO, section: 'GST' },
  has_pdf: { label: 'PDF generated', type: 'toggle', options: YES_NO, section: 'GST' },
})

export const INVOICE_ALIASES: FilterAlias[] = [
  { param: 'payment', to: 'payment_status' },
  { param: 'date_from', to: 'from' },
  { param: 'date_to', to: 'to' },
]

export const INVOICE_SEARCH = {
  placeholder: 'Search invoice, order, customer…',
  param: 'search',
  suggestType: 'invoices',
}
