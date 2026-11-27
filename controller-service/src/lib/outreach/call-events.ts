import { outreachPool } from './db'
import { recordEvent } from './events'
import { getProgramState } from './program-state'
import { asLanguage, isLanguage } from './prompt'
import { readVoiceSettings } from './session'
import { applyOptOut } from './tools'
import { onCallEnded } from './agent/runtime'
import { inCallingWindow, redialContact, retryOrFail } from './worker'
import type { CallOutcome, CallStatus, OutreachCall, OutreachContact, OutreachEvent } from './types'

// POST /api/internal/outreach/calls/{callId}/events (plan §8; shapes per voice-service's controller.py and calls.py).
// ringing / answered move the call row; transcript batches append; exactly one terminal event (no_answer, busy,
// voicemail, ended, error) closes it, and a repeat is acknowledged and ignored. Then the contact: a call that went
// nowhere goes back on the retry path (no_answer in 4h, failed after the 3rd attempt), an engaged one keeps its
// status, and `ended` with redialLanguage rings back in that language.

export const EVENT_TYPES = ['ringing', 'answered', 'no_answer', 'busy', 'voicemail', 'transcript', 'ended', 'error'] as const
export type CallEventType = (typeof EVENT_TYPES)[number]
const TERMINAL: Record<string, CallStatus> = { no_answer: 'no_answer', busy: 'busy', voicemail: 'voicemail', ended: 'completed', error: 'failed' }
const ENGAGED = new Set(['interested', 'building', 'preview_sent', 'published', 'claimed'])
const MAX_REDIALS_PER_HOUR = 2

export interface TranscriptTurn {
  role: 'agent' | 'caller'
  text: string
  at?: string
}

const CALLER_ROLES = new Set(['user', 'caller', 'customer', 'human'])
const AGENT_ROLES = new Set(['agent', 'assistant', 'bot', 'ai'])

/** voice-service turns ({role: user|agent, text, at}) as {role: agent|caller, text, at}; anything else dropped. */
export function normalizeTurns(raw: unknown, max = 500): TranscriptTurn[] {
  if (!Array.isArray(raw)) return []
  const out: TranscriptTurn[] = []
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue
    const o = t as Record<string, unknown>
    const role = String(o.role ?? o.speaker ?? '').toLowerCase()
    const text = typeof o.text === 'string' ? o.text : typeof o.content === 'string' ? o.content : ''
    const r = CALLER_ROLES.has(role) ? 'caller' : AGENT_ROLES.has(role) ? 'agent' : null
    if (!r || !text.trim()) continue
    out.push({ role: r, text: text.trim().slice(0, 2000), ...(typeof o.at === 'string' ? { at: o.at.slice(0, 40) } : {}) })
    if (out.length >= max) break
  }
  return out
}

const RECORDING_KEY = /^(?:[A-Za-z0-9._-]+\/)*outreach\/recordings\/[0-9a-f-]{36}\.(mp3|ogg|opus|wav|m4a)$/

/** A short-lived signed URL for the call's recording (platform bucket), or null. */
export async function recordingUrl(key: string | null | undefined): Promise<string | null> {
  if (!key || !RECORDING_KEY.test(key)) return null
  try {
    const { presignPlatformObjectGet } = await import('@/lib/shared/s3')
    return await presignPlatformObjectGet(key, 15 * 60)
  } catch {
    return null
  }
}

export interface CallDetail {
  call: Omit<OutreachCall, 'provider_call_id' | 'recording_key'> & { transcript: TranscriptTurn[]; has_recording: boolean }
  recordingUrl: string | null
  events: OutreachEvent[]
}

/** The admin call panel: the row minus provider internals, a signed recording URL, and the call's events. */
export async function getCallDetail(callId: string): Promise<CallDetail | null> {
  const pool = outreachPool()
  const r = await pool.query(`SELECT * FROM outreach_calls WHERE id = $1`, [callId])
  const row = r.rows[0] as OutreachCall | undefined
  if (!row) return null
  const ev = await pool.query(`SELECT * FROM outreach_events WHERE contact_id = $1 AND call_id = $2 ORDER BY id`, [row.contact_id, callId])
  const { provider_call_id: _pid, recording_key, ...rest } = row
  return {
    call: { ...rest, transcript: normalizeTurns(row.transcript), has_recording: !!recording_key },
    recordingUrl: await recordingUrl(recording_key),
    events: ev.rows,
  }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null)
const str = (v: unknown, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

function eventTime(at: unknown, now: Date): Date {
  const t = typeof at === 'string' ? new Date(at) : null
  // Clock skew guard: an `at` far from now is not trusted.
  return t && !Number.isNaN(t.getTime()) && Math.abs(t.getTime() - now.getTime()) < 6 * 3600_000 ? t : now
}

export interface CallEventInput {
  type: string
  at?: unknown
  data?: unknown
}

export interface CallEventResult {
  status: number
  body: Record<string, unknown>
}

export async function handleCallEvent(callId: string, input: CallEventInput, now: Date = new Date()): Promise<CallEventResult> {
  const type = input.type as CallEventType
  if (!EVENT_TYPES.includes(type)) return { status: 400, body: { error: `Unknown event type: ${String(input.type)}` } }
  const data = input.data && typeof input.data === 'object' && !Array.isArray(input.data) ? (input.data as Record<string, unknown>) : {}
  const at = eventTime(input.at, now)
  const pool = outreachPool()
  const found = await pool.query(`SELECT id, contact_id, ended_at FROM outreach_calls WHERE id = $1`, [callId])
  const row = found.rows[0] as Pick<OutreachCall, 'id' | 'contact_id' | 'ended_at'> | undefined
  if (!row) return { status: 404, body: { error: 'Unknown call' } }

  if (type === 'transcript') {
    const turns = normalizeTurns(data.turns, 200)
    if (turns.length) {
      await pool.query(`UPDATE outreach_calls SET transcript = COALESCE(transcript, '[]'::jsonb) || $2::jsonb WHERE id = $1 AND ended_at IS NULL`, [
        callId,
        JSON.stringify(turns),
      ])
    }
    return { status: 200, body: { ok: true, turns: turns.length } }
  }

  if (type === 'ringing') {
    await pool.query(
      `UPDATE outreach_calls SET status = CASE WHEN status = 'queued' THEN 'ringing' ELSE status END,
              provider = COALESCE($2, provider), provider_call_id = COALESCE(provider_call_id, $3), started_at = COALESCE(started_at, $4)
        WHERE id = $1 AND ended_at IS NULL`,
      [callId, str(data.provider, 40), str(data.providerCallId, 200), at]
    )
    await recordEvent(row.contact_id, 'call_ringing', { callId, actor: 'voice' })
    return { status: 200, body: { ok: true } }
  }

  if (type === 'answered') {
    await pool.query(
      `UPDATE outreach_calls SET status = CASE WHEN status IN ('queued', 'ringing') THEN 'in_progress' ELSE status END,
              answered_at = COALESCE(answered_at, $2), started_at = COALESCE(started_at, $2)
        WHERE id = $1 AND ended_at IS NULL`,
      [callId, at]
    )
    await recordEvent(row.contact_id, 'call_answered', { callId, actor: 'voice' })
    return { status: 200, body: { ok: true } }
  }

  // Terminal: the first one wins.
  const transcript = normalizeTurns(data.transcript)
  const reason = str(data.reason)
  const redial = type === 'ended' ? str(data.redialLanguage, 10) : null
  const upd = await pool.query(
    `UPDATE outreach_calls SET status = $2, ended_at = $3, duration_s = COALESCE($4, duration_s),
            transcript = CASE WHEN jsonb_array_length($5::jsonb) > 0 THEN $5::jsonb ELSE transcript END,
            recording_key = COALESCE($6, recording_key), error = CASE WHEN $2 = 'failed' THEN COALESCE($7, error, 'error') ELSE error END
      WHERE id = $1 AND ended_at IS NULL RETURNING *`,
    [callId, TERMINAL[type], at, num(data.durationS), JSON.stringify(transcript), str(data.recordingKey, 300), reason]
  )
  const call = upd.rows[0] as OutreachCall | undefined
  if (!call) return { status: 200, body: { ok: true, duplicate: true } }
  await recordEvent(row.contact_id, `call_${type}`, {
    callId,
    actor: 'voice',
    data: {
      durationS: num(data.durationS),
      durationSource: str(data.durationSource, 20),
      providerStatus: str(data.providerStatus, 20),
      reason,
      turns: transcript.length,
      recording: !!call.recording_key,
      ...(redial ? { redialLanguage: redial } : {}),
    },
  })
  const redialed = await settleContact(call, type, redial, now)
  // A language ring-back continues the same conversation, so nothing follows up yet.
  if (!redialed) {
    try {
      await onCallEnded(callId, type, now)
    } catch (e) {
      console.error('[outreach] onCallEnded failed:', (e as Error)?.message)
    }
  }
  return { status: 200, body: { ok: true } }
}

async function setOutcome(callId: string, outcome: CallOutcome) {
  await outreachPool().query(`UPDATE outreach_calls SET outcome = COALESCE(outcome, $2) WHERE id = $1`, [callId, outcome])
}

async function recentRedials(contactId: string, now: Date): Promise<number> {
  const r = await outreachPool().query(
    `SELECT count(*)::int AS n FROM outreach_events WHERE contact_id = $1 AND kind = 'redial' AND created_at > $2`,
    [contactId, new Date(now.getTime() - 3600_000)]
  )
  return r.rows[0]?.n ?? 0
}

async function tryRedial(contact: OutreachContact, call: OutreachCall, language: string, now: Date): Promise<boolean> {
  if (!isLanguage(language) || contact.opted_out_at || ['opted_out', 'suppressed', 'dnd'].includes(contact.status)) return false
  const state = await getProgramState(contact.program).catch(() => null)
  if (!inCallingWindow(now, state)) return false
  const sup = await outreachPool().query(`SELECT 1 FROM outreach_suppressions WHERE phone = $1`, [contact.phone])
  if (sup.rows.length) return false
  if ((await recentRedials(contact.id, now)) >= MAX_REDIALS_PER_HOUR) return false
  const { provider, settings } = await readVoiceSettings()
  const testMode = provider === 'twilio_test'
  if (testMode && !(state?.test_numbers ?? []).includes(contact.phone)) return false
  try {
    await redialContact(contact, {
      language: asLanguage(language),
      actor: 'voice',
      from: testMode ? settings.twilioTest.from : settings.exotel.callerId,
      provider,
      test: testMode,
      fromCallId: call.id,
    })
    return true
  } catch {
    return false
  }
}

/** The contact after a terminal event. Only the contact's latest call may move it. */
async function settleContact(call: OutreachCall, type: CallEventType, redial: string | null, now: Date): Promise<boolean> {
  const r = await outreachPool().query(`SELECT * FROM outreach_contacts WHERE id = $1`, [call.contact_id])
  const contact = r.rows[0] as OutreachContact | undefined
  if (!contact) return false
  if (call.outcome === 'opted_out' && contact.status !== 'opted_out' && contact.status !== 'suppressed') {
    await applyOptOut(contact, call.id, now)
    return false
  }
  if (contact.last_call_id && contact.last_call_id !== call.id) return false
  if (redial && (await tryRedial(contact, call, redial, now))) return true
  if (contact.status === 'calling') {
    if (type === 'ended') await setOutcome(call.id, 'incomplete')
    await retryOrFail(contact, now, { actor: 'voice', callId: call.id, reason: type === 'ended' ? 'incomplete' : type })
    return false
  }
  if (type === 'ended' && ENGAGED.has(contact.status)) {
    await setOutcome(call.id, contact.status === 'published' || contact.status === 'claimed' ? 'published' : 'interested')
  }
  return false
}
