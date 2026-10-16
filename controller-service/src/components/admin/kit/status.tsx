import { badgeCls, type Tone } from './tones'

// Status chips from one map per domain. Unknown statuses fall back to a humanised muted chip.

export type StatusMap = Record<string, { label: string; tone: Tone }>

export const humanize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '-')

export function StatusBadge({ status, map, label }: { status: string | null | undefined; map?: StatusMap; label?: string }) {
  const key = status ?? ''
  const hit = map?.[key]
  return <span className={badgeCls(hit?.tone ?? 'muted')}>{label ?? hit?.label ?? humanize(key)}</span>
}

export const ACTIVE_STATUS: StatusMap = {
  true: { label: 'Active', tone: 'green' },
  false: { label: 'Inactive', tone: 'muted' },
}

export const ORDER_STATUS: StatusMap = {
  pending: { label: 'Pending', tone: 'amber' },
  confirmed: { label: 'Confirmed', tone: 'blue' },
  processing: { label: 'Processing', tone: 'blue' },
  shipped: { label: 'Shipped', tone: 'blue' },
  out_for_delivery: { label: 'Out for delivery', tone: 'blue' },
  delivered: { label: 'Delivered', tone: 'green' },
  granted: { label: 'Access granted', tone: 'green' },
  cancel_requested: { label: 'Cancel requested', tone: 'amber' },
  cancelled: { label: 'Cancelled', tone: 'red' },
  returned: { label: 'Returned', tone: 'muted' },
  refunded: { label: 'Refunded', tone: 'muted' },
}

export const PAYMENT_STATUS: StatusMap = {
  paid: { label: 'Paid', tone: 'green' },
  cod_collected: { label: 'COD collected', tone: 'green' },
  partial: { label: 'Partially paid', tone: 'amber' },
  pending: { label: 'Pending', tone: 'amber' },
  cod: { label: 'COD', tone: 'blue' },
  cod_pending: { label: 'COD pending', tone: 'amber' },
  unpaid: { label: 'Unpaid', tone: 'amber' },
  failed: { label: 'Failed', tone: 'red' },
  refunded: { label: 'Refunded', tone: 'muted' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
}

export const SHIPMENT_STATUS: StatusMap = {
  created: { label: 'Created', tone: 'muted' },
  picked_up: { label: 'Picked up', tone: 'blue' },
  in_transit: { label: 'In transit', tone: 'blue' },
  out_for_delivery: { label: 'Out for delivery', tone: 'blue' },
  delivery_attempted: { label: 'Delivery attempted', tone: 'amber' },
  delivered: { label: 'Delivered', tone: 'green' },
  rto_initiated: { label: 'RTO initiated', tone: 'red' },
  rto_in_transit: { label: 'RTO in transit', tone: 'red' },
  rto_out_for_return: { label: 'RTO out for return', tone: 'red' },
  rto_delivered: { label: 'RTO delivered', tone: 'muted' },
}

export const INVOICE_STATUS: StatusMap = {
  draft: { label: 'Draft', tone: 'amber' },
  finalized: { label: 'Finalized', tone: 'green' },
}

export const QUOTATION_STATUS: StatusMap = {
  draft: { label: 'Draft', tone: 'amber' },
  final: { label: 'Final', tone: 'green' },
  sent: { label: 'Sent', tone: 'blue' },
  accepted: { label: 'Accepted', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
  expired: { label: 'Expired', tone: 'muted' },
}
