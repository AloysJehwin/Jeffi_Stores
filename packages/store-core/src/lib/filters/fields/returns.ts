import { defineFields, type FilterOption } from '@jeffi/list-filters/client'
import { ORDER_SOURCE_OPTIONS } from './orders'

// Return and replacement request filters (client-safe; the SQL is in ../entities/returns.ts).

const opts = (pairs: [string, string][]): FilterOption[] => pairs.map(([value, label]) => ({ value, label }))
const YES_NO = opts([
  ['true', 'Yes'],
  ['false', 'No'],
])

export const REQUEST_STATUS_OPTIONS = opts([
  ['pending_approval', 'Pending approval'],
  ['approved', 'Approved'],
  ['received', 'Received'],
  ['completed', 'Completed'],
  ['rejected', 'Rejected'],
])

export const RETURN_REASON_OPTIONS = opts([
  ['defective', 'Defective'],
  ['wrong_item', 'Wrong item'],
  ['not_as_described', 'Not as described'],
  ['damaged', 'Damaged in transit'],
  ['other', 'Other'],
])

const requestFields = (amountLabel: string) =>
  defineFields({
    reason: { label: 'Reason', type: 'multi-select', options: RETURN_REASON_OPTIONS, quick: true, section: 'Request' },
    status: { label: 'Status', type: 'multi-select', options: REQUEST_STATUS_OPTIONS, section: 'Request' },
    created: { name: ['from', 'to'], label: 'Raised on', type: 'date-range', section: 'Request' },
    amount: { label: amountLabel, type: 'range', unit: '₹', section: 'Request' },
    has_images: { label: 'Customer photos', type: 'toggle', options: YES_NO, section: 'Request' },
    valuation: {
      label: 'Inspection',
      type: 'multi-select',
      section: 'Pickup & inspection',
      options: opts([
        ['pending', 'Not inspected'],
        ['good', 'Good'],
        ['defective', 'Defective'],
        ['damaged', 'Damaged'],
      ]),
    },
    pickup: { label: 'Return pickup booked', type: 'toggle', options: YES_NO, section: 'Pickup & inspection' },
    source: {
      label: 'Order source',
      type: 'multi-select',
      options: ORDER_SOURCE_OPTIONS,
      quick: true,
      section: 'Order',
    },
  })

export const RETURN_FIELDS = requestFields('Refund amount')
export const REPLACEMENT_FIELDS = requestFields('Item value')

export const REQUEST_SEARCH = { placeholder: 'Search by order number or customer...', param: 'search' }
