export const CONTACT_STATUSES = [
  'new', 'queued', 'calling', 'no_answer', 'callback', 'not_interested', 'wrong_number', 'opted_out',
  'interested', 'building', 'preview_sent', 'published', 'claimed', 'dnd', 'failed', 'suppressed',
] as const
export type ContactStatus = (typeof CONTACT_STATUSES)[number]

export const CALL_STATUSES = ['queued', 'ringing', 'in_progress', 'completed', 'no_answer', 'busy', 'failed', 'voicemail'] as const
export type CallStatus = (typeof CALL_STATUSES)[number]

export const CALL_OUTCOMES = ['interested', 'not_interested', 'callback', 'wrong_number', 'opted_out', 'published', 'incomplete', 'other'] as const
export type CallOutcome = (typeof CALL_OUTCOMES)[number]

export const DND_STATUSES = ['unknown', 'clear', 'dnd'] as const
export type DndStatus = (typeof DND_STATUSES)[number]

export const LANGUAGES = ['en', 'hi', 'ta', 'te', 'kn', 'ml', 'mr', 'bn', 'gu'] as const
export type OutreachLanguage = (typeof LANGUAGES)[number]

export const LIST_SOURCES = ['upload', 'google_sheet'] as const
export type ListSource = (typeof LIST_SOURCES)[number]

export interface OutreachProgramState {
  program: string
  enabled: boolean
  daily_cap: number
  concurrency: number
  window_start: string
  window_end: string
  test_numbers: string[]
  default_skill_id: string | null
  updated_at: string
  updated_by: string | null
}

export interface OutreachList {
  id: string
  program: string
  name: string
  source: ListSource
  spreadsheet_id: string | null
  sheet_title: string | null
  file_key: string | null
  row_count: number
  last_synced_at: string | null
  skill_id: string | null
  skill_version_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface OutreachContact {
  id: string
  list_id: string | null
  program: string
  phone: string
  /** Null for a shopper contact (kind 'shopper'): it has a name, not a business. */
  business_name: string
  /** 'lead' (a Showcase business) when absent. */
  kind?: 'lead' | 'shopper'
  user_id?: string | null
  owner_name: string | null
  category: string | null
  city: string | null
  address: string | null
  language: OutreachLanguage | null
  source: string
  extra: Record<string, unknown>
  status: ContactStatus
  attempts: number
  next_attempt_at: string | null
  last_call_id: string | null
  showcase_site_id: string | null
  claim_token_hash: string | null
  claimed_owner_id: string | null
  consent_whatsapp_at: string | null
  consent_evidence: Record<string, unknown> | null
  opted_out_at: string | null
  dnd_status: DndStatus
  dnd_checked_at: string | null
  wa_window_expires_at: string | null
  handoff_at: string | null
  handoff_reason: string | null
  created_at: string
  updated_at: string
}

export interface OutreachCall {
  id: string
  contact_id: string
  provider: string | null
  provider_call_id: string | null
  language: string | null
  status: CallStatus
  outcome: CallOutcome | null
  started_at: string | null
  answered_at: string | null
  ended_at: string | null
  duration_s: number | null
  transcript: unknown
  recording_key: string | null
  summary: string | null
  consent: Record<string, unknown> | null
  callback_at: string | null
  cost_paise: number | null
  error: string | null
  created_at: string
}

export interface OutreachMessage {
  id: string
  contact_id: string
  direction: 'in' | 'out'
  template_slug: string | null
  body: string | null
  provider_message_id: string | null
  status: string | null
  created_at: string
}

export interface OutreachSuppression {
  phone: string
  reason: string | null
  source: string | null
  created_at: string
}

export interface OutreachEvent {
  id: number
  contact_id: string | null
  call_id: string | null
  kind: string
  data: Record<string, unknown> | null
  actor: string | null
  created_at: string
}
