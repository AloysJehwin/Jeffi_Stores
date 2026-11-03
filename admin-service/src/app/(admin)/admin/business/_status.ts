import type { StatusMap } from '@/components/admin/kit/status'

// Real values: business_profiles.approval_status and business_rfqs.status.
export const APPROVAL_STATUS: StatusMap = {
  pending: { label: 'Pending', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
}

export const RFQ_STATUS: StatusMap = {
  pending: { label: 'Pending', tone: 'amber' },
  reviewed: { label: 'Reviewed', tone: 'blue' },
  negotiating: { label: 'Negotiating', tone: 'blue' },
  offer_accepted: { label: 'Offer Accepted', tone: 'green' },
  converted: { label: 'Converted', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
}

export const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
