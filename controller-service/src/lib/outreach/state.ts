import { outreachPool } from './db'
import { recordEvent } from './events'
import type { ContactStatus, OutreachContact } from './types'

export const MAX_ATTEMPTS = 3
export const RETRY_AFTER_HOURS = 4

const BASE: Record<ContactStatus, ContactStatus[]> = {
  new: ['queued', 'dnd', 'failed'],
  queued: ['calling', 'dnd', 'failed'],
  calling: ['no_answer', 'callback', 'not_interested', 'wrong_number', 'interested', 'failed', 'dnd', 'queued'],
  no_answer: ['calling', 'queued', 'failed', 'dnd'],
  callback: ['calling', 'queued', 'failed', 'not_interested', 'dnd'],
  not_interested: ['queued'],
  wrong_number: ['queued'],
  opted_out: [],
  interested: ['building', 'preview_sent', 'published', 'callback', 'not_interested', 'queued', 'failed', 'calling'],
  building: ['preview_sent', 'published', 'interested', 'callback', 'failed'],
  preview_sent: ['building', 'published', 'claimed', 'callback', 'not_interested'],
  published: ['claimed', 'building'],
  claimed: [],
  dnd: [],
  failed: ['queued'],
  suppressed: [],
}

// Suppress and opt-out are allowed from anywhere that is not already final.
export function canTransition(from: ContactStatus, to: ContactStatus): boolean {
  if (from === to) return false
  if (to === 'suppressed') return from !== 'suppressed'
  if (to === 'opted_out') return from !== 'opted_out' && from !== 'suppressed'
  return BASE[from]?.includes(to) ?? false
}

export class InvalidTransitionError extends Error {
  constructor(public from: ContactStatus, public to: ContactStatus) {
    super(`Cannot move a contact from ${from} to ${to}`)
    this.name = 'InvalidTransitionError'
  }
}

export class ContactNotFoundError extends Error {
  constructor(id: string) {
    super(`Outreach contact ${id} not found`)
    this.name = 'ContactNotFoundError'
  }
}

const SETTABLE = new Set([
  'attempts', 'next_attempt_at', 'last_call_id', 'showcase_site_id', 'claim_token_hash', 'claimed_owner_id',
  'consent_whatsapp_at', 'consent_evidence', 'opted_out_at', 'dnd_status', 'dnd_checked_at', 'wa_window_expires_at',
])

export interface TransitionOpts {
  actor: string
  data?: Record<string, unknown>
  callId?: string | null
  // extra contact columns written in the same statement (whitelisted)
  set?: Record<string, unknown>
}

/** Validates against the row's locked current status, then writes the status and an outreach_events row in one transaction. */
export async function transition(
  contact: Pick<OutreachContact, 'id'>,
  to: ContactStatus,
  opts: TransitionOpts
): Promise<OutreachContact> {
  const client = await outreachPool().connect()
  try {
    await client.query('BEGIN')
    const cur = await client.query(`SELECT status FROM outreach_contacts WHERE id = $1 FOR UPDATE`, [contact.id])
    if (!cur.rows[0]) throw new ContactNotFoundError(contact.id)
    const from = cur.rows[0].status as ContactStatus
    if (!canTransition(from, to)) throw new InvalidTransitionError(from, to)

    const cols = Object.keys(opts.set ?? {})
    for (const c of cols) if (!SETTABLE.has(c)) throw new Error(`Column not settable through a transition: ${c}`)
    const params: unknown[] = [contact.id, to]
    const sets = cols.map((c, i) => {
      const v = opts.set![c]
      params.push(v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v)
      return `${c} = $${i + 3}`
    })
    const up = await client.query(
      `UPDATE outreach_contacts SET status = $2, updated_at = now()${sets.length ? ', ' + sets.join(', ') : ''} WHERE id = $1 RETURNING *`,
      params
    )
    await recordEvent(contact.id, 'status_change', { callId: opts.callId, actor: opts.actor, data: { from, to, ...opts.data } }, client)
    await client.query('COMMIT')
    return up.rows[0]
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/** When a contact that did not progress is next tried; null means no more attempts. */
export function nextAttemptAt(status: 'no_answer' | 'callback', attempts: number, now: Date, callbackAt?: Date | null): Date | null {
  if (status === 'callback') return callbackAt ?? null
  if (attempts >= MAX_ATTEMPTS) return null
  return new Date(now.getTime() + RETRY_AFTER_HOURS * 3600_000)
}
