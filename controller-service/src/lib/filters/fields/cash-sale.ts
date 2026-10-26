import { defineFields, type FilterAlias, type FilterOption } from '@jeffi/list-filters/client'

// Cash sale (counter bill) filters (client-safe; the SQL is in ../entities/cash-sale.ts).

const opts = (pairs: [string, string][]): FilterOption[] => pairs.map(([value, label]) => ({ value, label }))
const YES_NO = opts([
  ['true', 'Yes'],
  ['false', 'No'],
])

export const CASH_SALE_FIELDS = defineFields({
  payment_status: {
    label: 'Payment',
    type: 'multi-select',
    quick: true,
    section: 'Sale',
    options: opts([
      ['paid', 'Paid'],
      ['unpaid', 'Unpaid'],
      ['refunded', 'Refunded'],
      ['cancelled', 'Cancelled'],
    ]),
  },
  payment_mode: {
    label: 'Payment mode',
    type: 'multi-select',
    quick: true,
    section: 'Sale',
    options: opts([
      ['cash', 'Cash'],
      ['upi', 'UPI'],
      ['upi_qr', 'UPI (QR)'],
      ['card', 'Card'],
      ['bank_transfer', 'Bank transfer'],
    ]),
  },
  status: {
    label: 'Sale status',
    type: 'multi-select',
    section: 'Sale',
    options: opts([
      ['active', 'Active'],
      ['cancelled', 'Cancelled'],
    ]),
  },
  invoice: { name: ['from', 'to'], label: 'Bill date', type: 'date-range', section: 'Sale' },
  amount: { label: 'Bill total', type: 'range', unit: '₹', section: 'Sale' },
  igst: { label: 'IGST (inter-state)', type: 'toggle', options: YES_NO, section: 'Sale' },
  customer: { label: 'Customer', type: 'text', placeholder: 'Name or phone', section: 'Sale' },
})

export const CASH_SALE_ALIASES: FilterAlias[] = [{ param: 'payment', to: 'payment_status' }]

export const CASH_SALE_SEARCH = { placeholder: 'Search receipt no, order no…', param: 'search', suggestType: 'invoices' }
