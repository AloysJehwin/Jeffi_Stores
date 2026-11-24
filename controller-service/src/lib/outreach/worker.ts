import { randomUUID } from 'crypto'
import { outreachPool } from './db'
import { recordEvent } from './events'
import { getProgramState, WINDOW_MAX, WINDOW_MIN } from './program-state'
import { listPrograms } from './programs/_registry'
import { readVoiceSettings } from './session'
import { InvalidTransitionError, MAX_ATTEMPTS, nextAttemptAt, transition } from './state'
import { placeCall, voiceServiceUrl, VoiceServiceError } from './voice-client'
import type { OutreachContact, OutreachLanguage, OutreachProgramState } from './types'

// The outreach dialler (plan §1), run by the outreach_calls cron. Compliance is enforced here, not only defaulted:
// calls only inside 09:30–20:30 IST (and the program's own window), never DND or unknown-DND numbers, never
// suppressed or opted-out ones, at most MAX_ATTEMPTS, within daily_cap and concurrency. With the twilio_test provider
// (test mode) only the program's test numbers are dialled, and none when that list is empty.

const IST_MS = 330 * 60_000
const DAY_MS = 86_400_000

const toMin = (hhmm: string) => {
  const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number)
  return h * 60 + m
}
export const istMinutes = (d: Date) => Math.floor(((d.getTime() + IST_MS) % DAY_MS) / 60_000)

/** The instant `minute` minutes after IST midnight of `at`'s IST day, plus `days`. */
function istDayAt(at: Date, minute: number, days = 0): Date {
  const shifted = at.getTime() + IST_MS
  const midnight = shifted - (shifted % DAY_MS)
  return new Date(midnight + days * DAY_MS + minute * 60_000 - IST_MS)
}

export interface Window {
  start: string
  end: string
}
export const HARD_WINDOW: Window = { start: WINDOW_MIN, end: WINDOW_MAX }

/** The program's window clipped to the compliance bounds. */
export function effectiveWindow(state?: Pick<OutreachProgramState, 'window_start' | 'window_end'> | null): { start: number; end: number } {
  const start = Math.max(toMin(state?.window_start ?? WINDOW_MIN), toMin(WINDOW_MIN))
  const end = Math.min(toMin(state?.window_end ?? WINDOW_MAX), toMin(WINDOW_MAX))
  return { start, end }
}

export function inCallingWindow(at: Date, state?: Pick<OutreachProgramState, 'window_start' | 'window_end'> | null): boolean {
  const { start, end } = effectiveWindow(state)
  const m = istMinutes(at)
  return m >= start && m < end
}

/** `at` when it falls inside the window, else the next window opening. */
export function nextWindowTime(at: Date, state?: Pick<OutreachProgramState, 'window_start' | 'window_end'> | null): Date {
  if (inCallingWindow(at, state)) return at
  const { start } = effectiveWindow(state)
  return istMinutes(at) < start ? istDayAt(at, start) : istDayAt(at, start, 1)
}

export const istMidnight = (at: Date) => istDayAt(at, 0)

/** After an attempt that went nowhere: no_answer with the next try in RETRY_AFTER_HOURS (inside the window), or failed. */
export async function retryOrFail(
  contact: Pick<OutreachContact, 'id' | 'attempts'>,
  now: Date,
  opts: { actor: string; callId?: string | null; reason: string }
): Promise<'no_answer' | 'failed' | null> {
  const next = nextAttemptAt('no_answer', contact.attempts, now)
  try {
    if (next) {
      await transition(contact, 'no_answer', { actor: opts.actor, callId: opts.callId, data: { reason: opts.reason }, set: { next_attempt_at: nextWindowTime(next) } })
      return 'no_answer'
    }
    await transition(contact, 'failed', { actor: opts.actor, callId: opts.callId, data: { reason: opts.reason, attempts: contact.attempts } })
    return 'failed'
  } catch (e) {
    if (e instanceof InvalidTransitionError) return null
    throw e
  }
}

export interface DialOptions {
  language: string
  actor: string
  from: string
  provider: string
  test?: boolean
}

async function place(contact: OutreachContact, callId: string, opts: DialOptions, revert: boolean): Promise<{ callId: string; providerCallId: string }> {
  const pool = outreachPool()
  try {
    const r = await placeCall({ callId, to: contact.phone, from: opts.from, language: opts.language })
    await pool.query(
      `UPDATE outreach_calls SET provider_call_id = COALESCE(provider_call_id, $2), started_at = COALESCE(started_at, now()) WHERE id = $1`,
      [callId, r.providerCallId]
    )
    await recordEvent(contact.id, 'call_placed', { callId, actor: opts.actor, data: { language: opts.language, test: !!opts.test, provider: opts.provider } })
    return { callId, providerCallId: r.providerCallId }
  } catch (e) {
    const err = e instanceof VoiceServiceError ? e : new VoiceServiceError((e as Error)?.message || 'error', 0)
    if (err.refused) {
      // voice-service refused, so nothing rang: not an attempt.
      await pool.query(`UPDATE outreach_calls SET status = 'failed', ended_at = now(), error = $2 WHERE id = $1 AND ended_at IS NULL`, [
        callId,
        `dial_failed: ${err.message}`.slice(0, 500),
      ])
      await recordEvent(contact.id, 'dial_failed', { callId, actor: opts.actor, data: { status: err.status, error: err.message, ...err.detail } })
      if (revert) {
        await transition(contact, 'queued', {
          actor: opts.actor,
          callId,
          data: { reason: 'dial_failed' },
          set: { attempts: contact.attempts, next_attempt_at: new Date(Date.now() + 10 * 60_000) },
        }).catch(() => {})
      }
    } else {
      // No answer from voice-service: the call may still ring. Its events, or the stale sweep, settle it.
      await recordEvent(contact.id, 'dial_unconfirmed', { callId, actor: opts.actor, data: { error: err.message } })
    }
    throw err
  }
}

/** Dials a contact: a call row, the move to `calling` (one more attempt), then voice-service. */
export async function dialContact(contact: OutreachContact, opts: DialOptions): Promise<{ callId: string; providerCallId: string }> {
  const pool = outreachPool()
  const callId = randomUUID()
  await pool.query(`INSERT INTO outreach_calls (id, contact_id, provider, language, status) VALUES ($1, $2, $3, $4, 'queued')`, [
    callId,
    contact.id,
    opts.provider,
    opts.language,
  ])
  try {
    await transition(contact, 'calling', {
      actor: opts.actor,
      callId,
      data: { language: opts.language, test: !!opts.test },
      set: { attempts: contact.attempts + 1, last_call_id: callId, next_attempt_at: null },
    })
  } catch (e) {
    await pool.query(`DELETE FROM outreach_calls WHERE id = $1`, [callId]).catch(() => {})
    throw e
  }
  return place(contact, callId, opts, true)
}

/** The ring-back after switchLanguage: same conversation, so no status move and no extra attempt. */
export async function redialContact(contact: OutreachContact, opts: DialOptions & { fromCallId: string }): Promise<{ callId: string; providerCallId: string }> {
  const pool = outreachPool()
  const callId = randomUUID()
  await pool.query(`INSERT INTO outreach_calls (id, contact_id, provider, language, status) VALUES ($1, $2, $3, $4, 'queued')`, [
    callId,
    contact.id,
    opts.provider,
    opts.language,
  ])
  await pool.query(`UPDATE outreach_contacts SET last_call_id = $2, language = $3, updated_at = now() WHERE id = $1`, [contact.id, callId, opts.language])
  await recordEvent(contact.id, 'redial', { callId, actor: opts.actor, data: { fromCallId: opts.fromCallId, language: opts.language } })
  return place(contact, callId, opts, false)
}

/** Calls with no terminal event long after they should have ended: failed, and the contact back on the retry path. */
export async function sweepStaleCalls(now: Date): Promise<number> {
  const pool = outreachPool()
  const r = await pool.query(
    `UPDATE outreach_calls SET status = 'failed', ended_at = $1, error = COALESCE(error, 'stale: no terminal event')
      WHERE ended_at IS NULL
        AND ((answered_at IS NULL AND created_at < $1::timestamptz - interval '20 minutes')
          OR (answered_at IS NOT NULL AND answered_at < $1::timestamptz - interval '40 minutes'))
      RETURNING id, contact_id`,
    [now]
  )
  for (const row of r.rows as { id: string; contact_id: string }[]) {
    await recordEvent(row.contact_id, 'call_stale', { callId: row.id, actor: 'worker' })
    const c = await pool.query(`SELECT id, status, attempts, last_call_id FROM outreach_contacts WHERE id = $1`, [row.contact_id])
    const contact = c.rows[0]
    if (contact?.status === 'calling' && contact.last_call_id === row.id) {
      await retryOrFail(contact, now, { actor: 'worker', callId: row.id, reason: 'stale' })
    }
  }
  return r.rows.length
}

async function dueContacts(program: string, now: Date, limit: number, maxAttempts: number, testNumbers: string[] | null): Promise<OutreachContact[]> {
  const r = await outreachPool().query(
    `SELECT c.* FROM outreach_contacts c
      WHERE c.program = $1
        AND c.status IN ('queued', 'no_answer', 'callback')
        AND (c.next_attempt_at IS NULL OR c.next_attempt_at <= $2)
        AND c.attempts < $3
        AND c.opted_out_at IS NULL
        AND c.dnd_status <> 'dnd'
        AND (CASE WHEN $5::text[] IS NULL THEN c.dnd_status = 'clear' ELSE c.phone = ANY($5::text[]) END)
        AND NOT EXISTS (SELECT 1 FROM outreach_suppressions s WHERE s.phone = c.phone)
      ORDER BY c.next_attempt_at NULLS FIRST, c.created_at
      LIMIT $4`,
    [program, now, maxAttempts, limit, testNumbers]
  )
  return r.rows
}

async function callCounts(program: string, now: Date): Promise<{ today: number; active: number }> {
  const r = await outreachPool().query(
    `SELECT count(*) FILTER (WHERE c.created_at >= $2 AND (c.error IS NULL OR c.error NOT LIKE 'dial_failed%'))::int AS today,
            count(*) FILTER (WHERE c.ended_at IS NULL)::int AS active
       FROM outreach_calls c JOIN outreach_contacts k ON k.id = c.contact_id
      WHERE k.program = $1`,
    [program, istMidnight(now)]
  )
  return { today: r.rows[0]?.today ?? 0, active: r.rows[0]?.active ?? 0 }
}

export interface ProgramRun {
  program: string
  placed: number
  failed: number
  skipped?: 'disabled' | 'outside_window' | 'test_mode_without_numbers' | 'daily_cap' | 'concurrency'
}

export interface WorkerRun {
  swept: number
  testMode?: boolean
  skipped?: 'not_configured'
  programs: ProgramRun[]
}

export const MAX_TEST_NUMBERS = 10

export class TestCallError extends Error {
  constructor(message: string, public status: number, public callId?: string) {
    super(message)
    this.name = 'TestCallError'
  }
}

/**
 * Admin test call: only to one of the program's test numbers (the first MAX_TEST_NUMBERS), whatever the program's
 * enabled flag or window. A test contact (source test_call) is reset to queued for each run; a real lead on that
 * number is dialled only from a dialable status.
 */
export async function startTestCall(
  input: { phone: string; language: OutreachLanguage; program: string; businessName?: string; ownerName?: string },
  actor: string
): Promise<{ callId: string }> {
  const state = await getProgramState(input.program)
  if (!(state.test_numbers ?? []).slice(0, MAX_TEST_NUMBERS).includes(input.phone)) {
    throw new TestCallError("Only the program's test numbers can get a test call", 403)
  }
  if (!voiceServiceUrl()) throw new TestCallError('voice-service is not configured (VOICE_SERVICE_URL)', 503)
  const pool = outreachPool()
  const sup = await pool.query(`SELECT 1 FROM outreach_suppressions WHERE phone = $1`, [input.phone])
  if (sup.rows.length) throw new TestCallError('This number is on the suppression list; remove it there first', 409)
  const up = await pool.query(
    `INSERT INTO outreach_contacts (program, phone, business_name, owner_name, language, source, status, dnd_status)
     VALUES ($1, $2, $3, $4, $5, 'test_call', 'queued', 'clear')
     ON CONFLICT (program, phone) DO UPDATE SET language = EXCLUDED.language,
       business_name = CASE WHEN outreach_contacts.source = 'test_call' THEN EXCLUDED.business_name ELSE outreach_contacts.business_name END,
       owner_name = CASE WHEN outreach_contacts.source = 'test_call' THEN EXCLUDED.owner_name ELSE outreach_contacts.owner_name END,
       updated_at = now()
     RETURNING *`,
    [input.program, input.phone, input.businessName || 'Test Business', input.ownerName || null, input.language]
  )
  let contact = up.rows[0] as OutreachContact
  if (contact.last_call_id) {
    const live = await pool.query(`SELECT 1 FROM outreach_calls WHERE id = $1 AND ended_at IS NULL`, [contact.last_call_id])
    if (live.rows.length) throw new TestCallError('A call to this number is already in progress', 409)
  }
  if (contact.source === 'test_call' && (contact.status !== 'queued' || contact.attempts > 0 || contact.opted_out_at)) {
    const r = await pool.query(
      `UPDATE outreach_contacts SET status = 'queued', attempts = 0, next_attempt_at = NULL, opted_out_at = NULL, updated_at = now() WHERE id = $1 RETURNING *`,
      [contact.id]
    )
    await recordEvent(contact.id, 'test_reset', { actor, data: { from: contact.status, attempts: contact.attempts } })
    contact = r.rows[0]
  }
  if (!['queued', 'no_answer', 'callback'].includes(contact.status) || contact.opted_out_at) {
    throw new TestCallError(`This number belongs to a lead in status ${contact.status}; it cannot get a test call now`, 409)
  }
  const { provider, settings } = await readVoiceSettings()
  const from = provider === 'twilio_test' ? settings.twilioTest.from : settings.exotel.callerId
  let callId: string | undefined
  try {
    const r = await dialContact(contact, { language: input.language, actor, from, provider, test: true })
    callId = r.callId
  } catch (e) {
    if (e instanceof VoiceServiceError) {
      const last = await pool.query(`SELECT last_call_id FROM outreach_contacts WHERE id = $1`, [contact.id])
      throw new TestCallError(e.message, e.status === 503 ? 503 : 502, last.rows[0]?.last_call_id ?? undefined)
    }
    throw e
  }
  await recordEvent(contact.id, 'test_call', { callId, actor, data: { language: input.language } })
  return { callId }
}

export async function runOutreachWorker(now: Date = new Date()): Promise<WorkerRun> {
  const swept = await sweepStaleCalls(now)
  if (!voiceServiceUrl()) return { swept, skipped: 'not_configured', programs: [] }
  const { provider, settings } = await readVoiceSettings()
  const testMode = provider === 'twilio_test'
  const from = testMode ? settings.twilioTest.from : settings.exotel.callerId
  const programs: ProgramRun[] = []
  let stop = false
  for (const def of listPrograms()) {
    const run: ProgramRun = { program: def.key, placed: 0, failed: 0 }
    programs.push(run)
    if (stop) continue
    const state = await getProgramState(def.key)
    if (!state.enabled) {
      run.skipped = 'disabled'
      continue
    }
    if (!inCallingWindow(now, state)) {
      run.skipped = 'outside_window'
      continue
    }
    const tests = testMode ? state.test_numbers ?? [] : null
    if (tests && !tests.length) {
      run.skipped = 'test_mode_without_numbers'
      continue
    }
    const { today, active } = await callCounts(def.key, now)
    const byCap = state.daily_cap - today
    const bySlots = state.concurrency - active
    if (byCap <= 0 || bySlots <= 0) {
      run.skipped = byCap <= 0 ? 'daily_cap' : 'concurrency'
      continue
    }
    const due = await dueContacts(def.key, now, Math.min(byCap, bySlots), Math.min(def.maxAttempts, MAX_ATTEMPTS), tests)
    for (const contact of due) {
      try {
        await dialContact(contact, { language: contact.language ?? 'en', actor: 'worker', from, provider, test: testMode })
        run.placed++
      } catch (e) {
        run.failed++
        if (e instanceof InvalidTransitionError) continue
        // Not configured, or at capacity: nothing else will get through this run.
        if (e instanceof VoiceServiceError && (e.status === 503 || e.status === 429 || e.status === 0)) {
          stop = true
          break
        }
      }
    }
  }
  return { swept, testMode, programs }
}
