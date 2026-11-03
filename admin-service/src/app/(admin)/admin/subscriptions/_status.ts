import type { StatusMap } from '@/components/admin/kit/status'

// Tones for the Razorpay subscription statuses (lib/subscriptions/intervals SUBSCRIPTION_STATUS_LABELS).
export const SUBSCRIPTION_STATUS: StatusMap = {
  active: { label: 'Active', tone: 'green' },
  authenticated: { label: 'Starting', tone: 'blue' },
  created: { label: 'Awaiting payment', tone: 'muted' },
  pending: { label: 'Payment retrying', tone: 'amber' },
  halted: { label: 'Payment failed', tone: 'red' },
  paused: { label: 'Paused', tone: 'amber' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
  completed: { label: 'Completed', tone: 'blue' },
  expired: { label: 'Expired', tone: 'muted' },
}

export const inr = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
