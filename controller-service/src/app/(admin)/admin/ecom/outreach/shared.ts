import type { Tone } from '@/components/admin/kit/tones'
import type { ContactStatus } from '@controller/lib/outreach/types'

export const BASE = '/admin/ecom/outreach'
export const API = '/api/admin/ecom/outreach'

export const maskPhone = (p: string | null | undefined) => (p ? `••••${p.replace(/\D/g, '').slice(-4)}` : '-')

export const STATUS_LABEL: Record<ContactStatus, string> = {
  new: 'New', queued: 'Queued', calling: 'Calling', no_answer: 'No answer', callback: 'Callback', not_interested: 'Not interested',
  wrong_number: 'Wrong number', opted_out: 'Opted out', interested: 'Interested', building: 'Building', preview_sent: 'Preview sent',
  published: 'Published', claimed: 'Claimed', dnd: 'DND', failed: 'Failed', suppressed: 'Suppressed',
}

export const STATUS_TONE: Record<ContactStatus, Tone> = {
  new: 'muted', queued: 'blue', calling: 'blue', no_answer: 'amber', callback: 'amber', not_interested: 'muted', wrong_number: 'muted',
  opted_out: 'red', interested: 'green', building: 'blue', preview_sent: 'green', published: 'green', claimed: 'green', dnd: 'red', failed: 'red', suppressed: 'red',
}

export const LANGUAGE_LABEL: Record<string, string> = {
  en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', kn: 'Kannada', ml: 'Malayalam', mr: 'Marathi', bn: 'Bengali', gu: 'Gujarati',
}

export const isE164 = (s: string) => /^\+[1-9]\d{7,14}$/.test(s.trim())

export const TABS = [
  { id: 'program', label: 'Program' },
  { id: 'lists', label: 'Lists' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'suppressions', label: 'Suppressions' },
] as const
export type OutreachTab = (typeof TABS)[number]['id']
