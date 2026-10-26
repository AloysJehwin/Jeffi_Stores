import { defineFields, type FilterAlias, type FilterOption } from '@jeffi/list-filters/client'

// Orders list filters (client-safe; the SQL is in ../entities/orders.ts).

const opts = (pairs: [string, string][]): FilterOption[] => pairs.map(([value, label]) => ({ value, label }))
const YES_NO = opts([
  ['true', 'Yes'],
  ['false', 'No'],
])

export const ORDER_STATUS_OPTIONS = opts([
  ['pending', 'Pending'],
  ['confirmed', 'Confirmed'],
  ['processing', 'Processing'],
  ['shipped', 'Shipped'],
  ['out_for_delivery', 'Out for delivery'],
  ['delivered', 'Delivered'],
  ['granted', 'Access granted'],
  ['cancel_requested', 'Cancel requested'],
  ['cancelled', 'Cancelled'],
  ['return_requested', 'Return requested'],
  ['return_approved', 'Return approved'],
  ['return_received', 'Return received'],
  ['return_rejected', 'Return rejected'],
  ['returned', 'Returned'],
])

export const PAYMENT_STATUS_OPTIONS = opts([
  ['unpaid', 'Unpaid'],
  ['pending', 'Pending'],
  ['paid', 'Paid'],
  ['partial', 'Partially paid'],
  ['cod_pending', 'COD pending'],
  ['cod_collected', 'COD collected'],
  ['failed', 'Failed'],
  ['refunded', 'Refunded'],
  ['partially_refunded', 'Partially refunded'],
  ['cancelled', 'Cancelled'],
])

export const ORDER_SOURCE_OPTIONS = opts([
  ['online', 'Online'],
  ['business', 'Business'],
  ['offline', 'Offline'],
  ['cash_sale', 'Cash sale'],
  ['amazon', 'Amazon'],
])

const PAYMENT_MODE_OPTIONS = opts([
  ['razorpay', 'Razorpay'],
  ['cod', 'Cash on delivery'],
  ['manual', 'Manual / bank'],
  ['cash', 'Cash'],
  ['upi', 'UPI'],
  ['upi_qr', 'UPI (QR)'],
  ['card', 'Card'],
  ['bank_transfer', 'Bank transfer'],
  ['cheque', 'Cheque'],
  ['credit', 'Credit'],
  ['marketplace', 'Marketplace'],
])

const SHIPMENT_STATUS_OPTIONS = opts([
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
])

const vh = (label: string, section: string, noun = 'Orders') =>
  ({ label, type: 'value-help', section, placeholder: `Any ${label.toLowerCase()}`, noun }) as const

export const ORDER_FIELDS = defineFields({
  status: { label: 'Status', type: 'multi-select', options: ORDER_STATUS_OPTIONS, quick: true, section: 'Status' },
  payment_status: {
    label: 'Payment',
    type: 'multi-select',
    options: PAYMENT_STATUS_OPTIONS,
    quick: true,
    section: 'Status',
  },
  source: { label: 'Source', type: 'multi-select', options: ORDER_SOURCE_OPTIONS, quick: true, section: 'Status' },

  created: { name: ['from', 'to'], label: 'Order date', type: 'date-range', section: 'Date & amount' },
  shipped: { label: 'Shipped on', type: 'date-range', section: 'Date & amount' },
  delivered: { label: 'Delivered on', type: 'date-range', section: 'Date & amount' },
  amount: { label: 'Order total', type: 'range', unit: '₹', section: 'Date & amount' },
  discount: { label: 'Discount', type: 'range', unit: '₹', section: 'Date & amount' },
  units: { label: 'Units', type: 'range', section: 'Date & amount' },

  payment_mode: { label: 'Payment mode', type: 'multi-select', options: PAYMENT_MODE_OPTIONS, section: 'Payment' },
  payment_type: {
    label: 'Payment type',
    type: 'multi-select',
    section: 'Payment',
    options: opts([
      ['cod', 'COD'],
      ['prepaid', 'Prepaid'],
      ['credit', 'Credit'],
    ]),
  },
  gateway: vh('Gateway', 'Payment'),
  coupon: vh('Coupon', 'Payment'),
  has_coupon: { label: 'Coupon used', type: 'toggle', options: YES_NO, section: 'Payment' },
  cod_pending: { label: 'COD pending remittance', type: 'boolean', section: 'Payment' },
  payment_link: {
    label: 'Payment link',
    type: 'multi-select',
    section: 'Payment',
    options: opts([
      ['created', 'Sent'],
      ['paid', 'Paid'],
      ['expired', 'Expired'],
      ['cancelled', 'Cancelled'],
    ]),
  },
  unpaid_stale: { label: 'Prepaid, unpaid over a day', type: 'boolean', section: 'Payment' },

  shipment_status: {
    label: 'Shipment status',
    type: 'multi-select',
    options: SHIPMENT_STATUS_OPTIONS,
    section: 'Shipping',
  },
  awb: { label: 'AWB / tracking no.', type: 'text', placeholder: 'Starts with…', section: 'Shipping' },
  rto: { label: 'Returned to origin', type: 'boolean', section: 'Shipping' },
  courier: { label: 'Ships by courier', type: 'toggle', options: YES_NO, section: 'Shipping' },
  late_to_ship: { label: 'Late to ship', type: 'boolean', section: 'Shipping' },
  overdue: { label: 'Past promised delivery', type: 'boolean', section: 'Shipping' },
  edd: { label: 'Promised delivery', type: 'date-range', section: 'Shipping' },
  state: vh('State', 'Shipping'),
  city: vh('City', 'Shipping'),
  pincode: vh('Pincode', 'Shipping'),
  shipping_method: vh('Shipping method', 'Shipping'),

  customer: { label: 'Customer', type: 'text', placeholder: 'Name, email or phone', section: 'Customer' },
  customer_type: {
    label: 'Customer type',
    type: 'multi-select',
    section: 'Customer',
    options: opts([
      ['registered', 'Registered'],
      ['guest', 'Guest'],
      ['business', 'Business'],
    ]),
  },
  tag: vh('Customer tag', 'Customer'),
  flagged: { label: 'Flagged customer', type: 'boolean', section: 'Customer' },
  first_order: { label: 'First order', type: 'toggle', options: YES_NO, section: 'Customer' },
  b2b: { label: 'B2B (GSTIN)', type: 'toggle', options: YES_NO, section: 'Customer' },

  product: vh('Product', 'Items'),
  sku: vh('SKU', 'Items'),
  brand: vh('Brand', 'Items'),
  category: vh('Category', 'Items'),
  hsn: vh('HSN code', 'Items'),
  gst_rate: {
    label: 'GST rate',
    type: 'multi-select',
    section: 'Items',
    options: opts([
      ['0', '0%'],
      ['5', '5%'],
      ['12', '12%'],
      ['18', '18%'],
      ['28', '28%'],
    ]),
  },
  digital: {
    label: 'Digital items',
    type: 'toggle',
    section: 'Items',
    options: opts([
      ['any', 'Any digital'],
      ['only', 'Only digital'],
      ['none', 'None'],
    ]),
  },

  invoiced: { label: 'Invoiced', type: 'toggle', options: YES_NO, section: 'Documents' },
  invoice: { label: 'Invoice date', type: 'date-range', section: 'Documents' },
  irn_status: {
    label: 'E-invoice (IRN)',
    type: 'multi-select',
    section: 'Documents',
    options: opts([
      ['pending', 'Pending'],
      ['generated', 'Generated'],
      ['stub', 'Stub'],
      ['cancelled', 'Cancelled'],
    ]),
  },
  eway: { label: 'E-way bill', type: 'toggle', options: YES_NO, section: 'Documents' },
  igst: { label: 'IGST (inter-state)', type: 'toggle', options: YES_NO, section: 'Documents' },

  return_type: {
    label: 'Return',
    type: 'toggle',
    section: 'Lifecycle',
    options: opts([
      ['any', 'Any'],
      ['refund', 'Refund'],
      ['replacement', 'Replacement'],
    ]),
  },
  return_status: {
    label: 'Return status',
    type: 'multi-select',
    section: 'Lifecycle',
    options: opts([
      ['pending_approval', 'Pending approval'],
      ['approved', 'Approved'],
      ['rejected', 'Rejected'],
      ['received', 'Received'],
      ['completed', 'Completed'],
    ]),
  },
  replacement_order: { label: 'Replacement order', type: 'toggle', options: YES_NO, section: 'Lifecycle' },
  subscription: { label: 'Subscription order', type: 'toggle', options: YES_NO, section: 'Lifecycle' },
  order_type: {
    label: 'Order type',
    type: 'multi-select',
    section: 'Lifecycle',
    options: opts([
      ['cart', 'Cart checkout'],
      ['direct', 'Buy now'],
    ]),
  },
  edited: { label: 'Edited after placing', type: 'toggle', options: YES_NO, section: 'Lifecycle' },
  cancel_reason: {
    label: 'Cancel reason',
    type: 'multi-select',
    section: 'Lifecycle',
    options: opts([
      ['payment_timeout', 'Payment not completed'],
      ['customer', 'Customer cancelled'],
      ['after_dispatch', 'Cancelled after dispatch'],
      ['store', 'Cancelled by store'],
    ]),
  },

  utm_source: vh('UTM source', 'Attribution'),
  utm_medium: vh('UTM medium', 'Attribution'),
  utm_campaign: vh('UTM campaign', 'Attribution'),
  ad_click: {
    label: 'Ad click',
    type: 'multi-select',
    section: 'Attribution',
    options: opts([
      ['google', 'Google'],
      ['meta', 'Meta'],
      ['none', 'None'],
    ]),
  },

  fulfillment: {
    label: 'Amazon fulfilment',
    type: 'multi-select',
    section: 'Amazon',
    options: opts([
      ['AFN', 'Fulfilled by Amazon'],
      ['MFN', 'Merchant fulfilled'],
    ]),
  },
  prime: { label: 'Prime', type: 'toggle', options: YES_NO, section: 'Amazon' },
})

export const ORDER_ALIASES: FilterAlias[] = [
  { param: 'date_from', to: 'from' },
  { param: 'date_to', to: 'to' },
  { param: 'coupon_code', to: 'coupon' },
  { param: 'payment_mode', value: 'prepaid', to: 'payment_type' },
]

export const ORDER_SEARCH = {
  placeholder: 'Search by order number or customer...',
  param: 'search',
  suggestType: 'orders',
}
