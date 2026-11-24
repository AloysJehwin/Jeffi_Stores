import { mergeVoiceSettings, VOICE_PROVIDERS, type VoiceProviderName, type VoiceSettings } from '@/lib/providers/voice-settings'
import { outreachPool } from './db'
import { getProgramState } from './program-state'
import { LINES, PERSONA_NAMES, SCRIPT_VERSION, TOOL_SCHEMAS, asLanguage, greeting, systemPrompt, type KnownBrief } from './prompt'
import type { OutreachCall, OutreachContact, OutreachLanguage } from './types'

// GET /api/internal/outreach/calls/{callId}/session: what voice-service needs to run one call (plan §8).

export const MAX_DURATION_S = 720
export const SILENCE_S = 14

export interface CallContext {
  call: OutreachCall
  contact: OutreachContact
}

export async function loadCallContext(callId: string): Promise<CallContext | null> {
  const pool = outreachPool()
  const c = await pool.query(`SELECT * FROM outreach_calls WHERE id = $1`, [callId])
  const call = c.rows[0] as OutreachCall | undefined
  if (!call) return null
  const k = await pool.query(`SELECT * FROM outreach_contacts WHERE id = $1`, [call.contact_id])
  const contact = k.rows[0] as OutreachContact | undefined
  return contact ? { call, contact } : null
}

/** The non-secret voice settings (Settings → Providers): which provider, caller IDs, test numbers, voices. */
export async function readVoiceSettings(): Promise<{ provider: VoiceProviderName; settings: VoiceSettings }> {
  const r = await outreachPool().query(
    `SELECT key, value FROM platform_provider_settings WHERE tenant_id IS NULL AND key IN ('voice_provider', 'voice_config')`
  )
  const m = new Map(r.rows.map((x: { key: string; value: unknown }) => [x.key, x.value]))
  const p = m.get('voice_provider')
  return {
    provider: VOICE_PROVIDERS.includes(p as VoiceProviderName) ? (p as VoiceProviderName) : 'exotel',
    settings: mergeVoiceSettings(m.get('voice_config')),
  }
}

const text = (v: unknown, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)

/** What the contact already told us on earlier calls: the args of every addDetails that succeeded, in order. */
export async function knownBrief(contactId: string): Promise<KnownBrief> {
  const r = await outreachPool().query(
    `SELECT data FROM outreach_events
      WHERE contact_id = $1 AND kind = 'tool_call' AND data->>'tool' = 'addDetails' AND data->>'ok' = 'true'
      ORDER BY id`,
    [contactId]
  )
  const out: KnownBrief = {}
  for (const row of r.rows as { data: { args?: Record<string, unknown> } }[]) {
    const a = row.data?.args ?? {}
    const set = (k: 'whatTheyDo' | 'audience' | 'hours' | 'address' | 'style', v: unknown) => {
      const t = text(v)
      if (t) out[k] = t
    }
    set('whatTheyDo', a.what_they_do)
    set('audience', a.audience)
    set('hours', a.hours)
    set('address', a.address)
    set('style', a.style)
    if (Array.isArray(a.highlights)) {
      const all = [...(out.highlights ?? []), ...a.highlights.map(h => text(h, 200)).filter((h): h is string => !!h)]
      out.highlights = [...new Set(all)].slice(0, 8)
    }
    if (a.contact && typeof a.contact === 'object') {
      const c = a.contact as Record<string, unknown>
      out.contact = { ...out.contact, ...Object.fromEntries(['phone', 'email', 'whatsapp'].map(f => [f, text(c[f], 120)]).filter(([, v]) => v)) }
    }
  }
  return out
}

async function hadAnsweredCall(contactId: string, callId: string): Promise<boolean> {
  const r = await outreachPool().query(
    `SELECT 1 FROM outreach_calls WHERE contact_id = $1 AND id <> $2 AND answered_at IS NOT NULL LIMIT 1`,
    [contactId, callId]
  )
  return r.rows.length > 0
}

export interface CallSession {
  language: OutreachLanguage
  persona: { name: string; voiceId: string }
  systemPrompt: string
  greeting: string
  tools: typeof TOOL_SCHEMAS
  maxDurationS: number
  silenceS: number
  apology: string
  testNumbers: string[]
  scriptVersion: string
}

export async function buildSession(callId: string, now: Date = new Date()): Promise<CallSession | null> {
  const ctx = await loadCallContext(callId)
  if (!ctx) return null
  const { call, contact } = ctx
  const language = asLanguage(call.language ?? contact.language)
  const [{ settings }, testNumbers, known, continuing] = await Promise.all([
    readVoiceSettings(),
    getProgramState(contact.program).then(s => s.test_numbers ?? [], () => [] as string[]),
    knownBrief(contact.id),
    hadAnsweredCall(contact.id, call.id),
  ])
  const personaName = PERSONA_NAMES[language]
  const consentWhatsApp = !!contact.consent_whatsapp_at
  const base = {
    language,
    personaName,
    business: contact.business_name,
    owner: contact.owner_name,
    continuing,
  }
  return {
    language,
    persona: { name: personaName, voiceId: settings.sarvam.voices[language] ?? '' },
    systemPrompt: systemPrompt({
      ...base,
      category: contact.category,
      city: contact.city,
      now,
      consentWhatsApp,
      previewStarted: !!contact.showcase_site_id,
      published: contact.status === 'published' || contact.status === 'claimed',
      known,
    }),
    greeting: greeting(base),
    tools: TOOL_SCHEMAS,
    maxDurationS: MAX_DURATION_S,
    silenceS: SILENCE_S,
    // voice-service's default apology promises a WhatsApp message; only make that promise with consent.
    apology: consentWhatsApp ? LINES[language].apologyWhatsApp : LINES[language].apologyCallBack,
    testNumbers,
    scriptVersion: SCRIPT_VERSION,
  }
}
