import { defineFields, type FilterOption } from '@jeffi/list-filters/client'
import { ORDER_SOURCE_OPTIONS, ORDER_STATUS_OPTIONS } from './orders'

// Packing slip filters over orders with something to ship (client-safe; SQL in ../entities/packing-slips.ts).

const opts = (pairs: [string, string][]): FilterOption[] => pairs.map(([value, label]) => ({ value, label }))
const YES_NO = opts([
  ['true', 'Yes'],
  ['false', 'No'],
])

export const PACKING_FIELDS = defineFields({
  status: { label: 'Status', type: 'multi-select', options: ORDER_STATUS_OPTIONS, quick: true, section: 'Order' },
  source: { label: 'Source', type: 'multi-select', options: ORDER_SOURCE_OPTIONS, quick: true, section: 'Order' },
  created: { name: ['from', 'to'], label: 'Order date', type: 'date-range', section: 'Order' },
  customer: { label: 'Customer', type: 'text', placeholder: 'Name, email or phone', section: 'Order' },
  digital: { label: 'Also has digital items', type: 'toggle', options: YES_NO, section: 'Order' },
  awb: { label: 'AWB assigned', type: 'toggle', options: YES_NO, section: 'Shipping' },
  shipment_status: {
    label: 'Courier status',
    type: 'multi-select',
    section: 'Shipping',
    options: opts([
      ['none', 'Not handed over'],
      ['created', 'Created'],
      ['picked_up', 'Picked up'],
      ['in_transit', 'In transit'],
      ['out_for_delivery', 'Out for delivery'],
      ['delivery_attempted', 'Delivery attempted'],
      ['delivered', 'Delivered'],
      ['rto_initiated', 'RTO initiated'],
      ['rto_in_transit', 'RTO in transit'],
      ['rto_out_for_return', 'RTO out for return'],
      ['rto_delivered', 'RTO delivered'],
    ]),
  },
  late_to_ship: { label: 'Late to ship', type: 'boolean', section: 'Shipping' },
  state: { label: 'State', type: 'value-help', section: 'Shipping', placeholder: 'Any state', noun: 'Orders' },
})

export const PACKING_SEARCH = { placeholder: 'Search by order number or customer...', param: 'search' }

/** Without dates the slips list shows this many days. */
export const PACKING_DEFAULT_DAYS = 30
