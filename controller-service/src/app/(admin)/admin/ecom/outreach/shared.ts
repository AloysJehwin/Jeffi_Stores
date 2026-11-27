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
  { id: 'skills', label: 'Agents' },
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

// ---- task agents ----

export const AUDIENCE_LABEL: Record<string, string> = { lead: 'Lead', shopper: 'Shopper' }
export const PURPOSE_LABEL: Record<string, string> = { transactional: 'Transactional', promotional: 'Promotional' }
export const AGENT_STATUS_LABEL: Record<string, string> = { draft: 'Draft', active: 'Active', paused: 'Paused' }
export const AGENT_STATUS_TONE: Record<string, Tone> = { draft: 'muted', active: 'green', paused: 'amber' }
export const TRIGGER_LABEL: Record<string, string> = {
  manual: 'Manual', 'order.delivered': 'Order delivered', 'order.placed': 'Order placed', 'checkout.abandoned': 'Checkout abandoned',
  'payment.failed': 'Payment failed', 'review.missing': 'Review missing',
}
export const GROUP_LABEL: Record<string, string> = {
  core: 'Core', messaging: 'Messaging', orders: 'Orders', reviews: 'Reviews', checkout: 'Checkout', catalog: 'Catalog', support: 'Support', showcase: 'Showcase', voice: 'Voice',
}
export const EFFECT_TONE: Record<string, Tone> = { read: 'muted', write: 'blue', send: 'amber', call: 'red' }

/** 120 -> "2h", 2880 -> "2d", 0 -> "now". */
export const fmtMinutes = (m: number) => (!m ? 'now' : m % 1440 === 0 ? `${m / 1440}d` : m % 60 === 0 ? `${m / 60}h` : `${m}m`)

export const JOB_STATUS_LABEL: Record<string, string> = {
  queued: 'Queued', active: 'Active', waiting: 'Waiting', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', handed_off: 'Handed off',
}
export const JOB_STATUS_TONE: Record<string, Tone> = {
  queued: 'blue', active: 'blue', waiting: 'amber', completed: 'green', failed: 'red', cancelled: 'muted', handed_off: 'amber',
}
export const SOURCE_LABEL: Record<string, string> = { csv: 'CSV', sheet: 'Sheet', form: 'Form', api: 'API', event: 'Event', test: 'Test' }
export const slugLabel = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ') : '-')

// ---- frontmatter `tools:` editing (list form only) ----

const fenceEnd = (lines: string[]) => {
  if (lines[0]?.trim() !== '---') return -1
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '---') return i
  return -1
}

export type ToolsForm = { form: 'none' } | { form: 'list'; names: string[] } | { form: 'map' }

const splitNames = (s: string) => s.split(',').map(x => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean)

/** How the file declares its tools: an editable flat list, a per-channel map (read-only) or not at all. */
export function readToolsForm(content: string): ToolsForm {
  const lines = content.split(/\r?\n/)
  const end = fenceEnd(lines)
  if (end < 0) return { form: 'none' }
  const i = lines.findIndex((l, n) => n > 0 && n < end && /^tools:/.test(l))
  if (i < 0) return { form: 'none' }
  const rest = lines[i].slice('tools:'.length).replace(/\s+#.*$/, '').trim()
  if (rest.startsWith('[')) return rest.endsWith(']') ? { form: 'list', names: splitNames(rest.slice(1, -1)) } : { form: 'map' }
  if (rest) return rest.startsWith('{') ? { form: 'map' } : { form: 'list', names: splitNames(rest) }
  const names: string[] = []
  for (let n = i + 1; n < end && (/^\s/.test(lines[n]) || !lines[n].trim()); n++) {
    const m = /^\s*-\s*(.+?)\s*$/.exec(lines[n])
    if (m) names.push(m[1].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, ''))
    else if (lines[n].trim()) return { form: 'map' }
  }
  return { form: 'list', names }
}

/** Rewrites `tools:` as `tools: [a, b]`, replacing a block list or adding the line before the closing fence. */
export function writeToolsList(content: string, names: string[]): string {
  const lines = content.split(/\r?\n/)
  const end = fenceEnd(lines)
  if (end < 0) return content
  const line = `tools: [${names.join(', ')}]`
  const i = lines.findIndex((l, n) => n > 0 && n < end && /^tools:/.test(l))
  if (i < 0) {
    lines.splice(end, 0, line)
    return lines.join('\n')
  }
  let stop = i + 1
  if (!lines[i].slice('tools:'.length).replace(/\s+#.*$/, '').trim()) while (stop < end && (/^\s/.test(lines[stop]) || !lines[stop].trim())) stop++
  lines.splice(i, stop - i, line)
  return lines.join('\n')
}
