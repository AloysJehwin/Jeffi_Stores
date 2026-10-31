import { INVOICE_STATUS, ORDER_STATUS, PAYMENT_STATUS, QUOTATION_STATUS, SHIPMENT_STATUS, type StatusMap } from '@/components/admin/kit/status'
import type { StatusDomain } from '@/lib/admin/change-log-format'

const MAPS: Record<StatusDomain, StatusMap> = {
  order: ORDER_STATUS,
  payment: PAYMENT_STATUS,
  shipment: SHIPMENT_STATUS,
  invoice: INVOICE_STATUS,
  quotation: QUOTATION_STATUS,
}

export const statusMap = (domain?: StatusDomain): StatusMap | undefined => (domain ? MAPS[domain] : undefined)
