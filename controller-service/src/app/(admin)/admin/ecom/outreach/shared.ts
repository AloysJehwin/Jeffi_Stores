import type { Tone } from '@/components/admin/kit/tones'
import type { ContactStatus } from '@controller/lib/outreach/types'
import type { SkillSummary, SkillVersionRow } from '@controller/lib/outreach/agent/skill/store'
import type { SkillValidation } from '@controller/lib/outreach/agent/types'

export type { SkillSummary, SkillVersionRow, SkillValidation }

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
  { id: 'skills', label: 'Skills' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'suppressions', label: 'Suppressions' },
] as const
export type OutreachTab = (typeof TABS)[number]['id']

export const MAX_SKILL_BYTES = 24 * 1024
export const skillBytes = (s: string) => new TextEncoder().encode(s).length
export const CHANNEL_LABEL: Record<string, string> = { voice: 'Voice', whatsapp: 'WhatsApp', follow_up: 'Follow-up' }
export const FLOW_LABEL: Record<string, string> = { one_call: 'One call', two_call: 'Two calls', whatsapp_only: 'WhatsApp only' }
export const inr = (paise: number) => `₹${(paise / 100).toFixed(2)}`
export const versionRef = (v: Pick<SkillVersionRow, 'version'>) => `v${v.version}`
