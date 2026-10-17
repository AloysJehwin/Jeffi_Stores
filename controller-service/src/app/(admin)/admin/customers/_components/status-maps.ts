import type { Tone } from '@/components/admin/kit/tones'

// Shared tone maps for customer rows (list, mobile list, view).

export const customerStatus = (c: { is_flagged?: boolean; is_active?: boolean }): { label: string; tone: Tone } =>
  c.is_flagged ? { label: 'Flagged', tone: 'red' } : c.is_active ? { label: 'Active', tone: 'green' } : { label: 'Inactive', tone: 'amber' }

export const businessTone = (status: string | null | undefined): Tone => (status === 'approved' ? 'blue' : status === 'rejected' ? 'red' : 'amber')

export const businessLabel = (status: string | null | undefined) =>
  status === 'approved' ? 'Business' : `Business · ${status === 'rejected' ? 'Rejected' : 'Pending'}`

export const healthTone = (score: number | null | undefined): Tone => (score == null ? 'muted' : score >= 70 ? 'green' : score >= 40 ? 'amber' : 'red')

export const fullName = (c: { first_name?: string | null; last_name?: string | null }, fallback = 'Unknown') =>
  [c.first_name, c.last_name].filter(Boolean).join(' ') || fallback

export const inr = (v: unknown) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
