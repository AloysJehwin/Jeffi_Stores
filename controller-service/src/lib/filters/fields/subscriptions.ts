import { defineFields, type FilterOption } from '@jeffi/list-filters/client'
import {
  SUBSCRIPTION_INTERVALS,
  SUBSCRIPTION_INTERVAL_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
} from '@/lib/subscriptions/intervals'

// Subscriptions list filters (client-safe; the SQL is in ../entities/subscriptions.ts).

const YES_NO: FilterOption[] = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
]

export const SUBSCRIPTION_FIELDS = defineFields({
  status: {
    label: 'Status',
    type: 'multi-select',
    quick: true,
    section: 'Status',
    options: Object.entries(SUBSCRIPTION_STATUS_LABELS).map(([value, label]) => ({ value, label })),
  },
  interval: {
    label: 'Plan',
    type: 'multi-select',
    quick: true,
    section: 'Plan',
    options: SUBSCRIPTION_INTERVALS.map(value => ({ value, label: SUBSCRIPTION_INTERVAL_LABELS[value] })),
  },
  product: { label: 'Product', type: 'value-help', section: 'Plan', placeholder: 'Any product', noun: 'Subscriptions' },
  digital: { label: 'Digital product', type: 'toggle', options: YES_NO, section: 'Plan' },
  source: { label: 'Source', type: 'value-help', section: 'Plan', placeholder: 'Any source', noun: 'Subscriptions' },
  price: { label: 'Amount per cycle', type: 'range', unit: '₹', section: 'Plan' },

  created: { name: ['from', 'to'], label: 'Started', type: 'date-range', section: 'Dates' },
  renewal: { label: 'Next renewal', type: 'date-range', section: 'Dates' },
  cancel_at_end: { label: 'Cancels at cycle end', type: 'toggle', options: YES_NO, section: 'Status' },
  paused: { label: 'Paused', type: 'toggle', options: YES_NO, section: 'Status' },
})

export const SUBSCRIPTION_SEARCH = {
  placeholder: 'Search by customer, email, product or Razorpay ID...',
  param: 'search',
}
