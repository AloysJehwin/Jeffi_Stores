import { ORDER_STATUS, PAYMENT_STATUS, type StatusMap } from '@/components/admin/kit/status'
import type { Tone } from '@/components/admin/kit/tones'

// Order statuses the kit map does not carry (return flow, cancel review, payment rows).
export const ORDER_STATUS_FULL: StatusMap = {
  ...ORDER_STATUS,
  cancel_requested: { label: 'Cancellation requested', tone: 'amber' },
  cancel_rejected: { label: 'Cancellation rejected', tone: 'muted' },
  return_requested: { label: 'Return requested', tone: 'amber' },
  return_approved: { label: 'Return approved', tone: 'blue' },
  return_received: { label: 'Return received', tone: 'blue' },
  return_rejected: { label: 'Return rejected', tone: 'red' },
  returned: { label: 'Returned', tone: 'muted' },
}

export const PAYMENT_STATUS_FULL: StatusMap = {
  ...PAYMENT_STATUS,
  completed: { label: 'Completed', tone: 'green' },
}

export const SOURCE_LABEL: Record<string, string> = {
  online: 'Online',
  amazon: 'Amazon',
  business: 'Business',
  cash_sale: 'Cash Sale',
}
export const SOURCE_TONE: Record<string, Tone> = { online: 'blue', business: 'green', amazon: 'amber' }
export const sourceLabel = (s: string) => SOURCE_LABEL[s] || 'Offline'
export const sourceTone = (s: string): Tone => SOURCE_TONE[s] ?? 'muted'

export const inr = (v: unknown) =>
  `Rs. ${Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
