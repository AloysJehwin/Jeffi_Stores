import { outreachPool } from './db'
import { MAX_ATTEMPTS } from './state'
import { normalizePhone } from './phone'
import type { ContactStatus, OutreachCall, OutreachContact, OutreachEvent, OutreachMessage } from './types'

export interface ContactFilters {
  program?: string
  statuses?: ContactStatus[]
  listId?: string
  q?: string
  page?: number
  pageSize?: number
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, c => `\\${c}`)

export async function listContacts(f: ContactFilters = {}): Promise<{ rows: OutreachContact[]; total: number; page: number; pageSize: number }> {
  const where: string[] = []
  const params: unknown[] = []
  const add = (sql: string, v: unknown) => {
    params.push(v)
    where.push(sql.replace('?', `$${params.length}`))
  }
  if (f.program) add('program = ?', f.program)
  if (f.statuses?.length) add('status = ANY(?)', f.statuses)
  if (f.listId) add('list_id = ?', f.listId)
  if (f.q?.trim()) {
    const q = f.q.trim()
    const phone = normalizePhone(q)
    params.push(`%${escapeLike(q)}%`)
    const like = `$${params.length}`
    let clause = `business_name ILIKE ${like} OR owner_name ILIKE ${like} OR city ILIKE ${like} OR phone LIKE ${like}`
    if (phone) {
      params.push(phone)
      clause += ` OR phone = $${params.length}`
    }
    where.push(`(${clause})`)
  }
  const pageSize = Math.min(Math.max(f.pageSize ?? 50, 1), 200)
  const page = Math.max(f.page ?? 1, 1)
  const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const pool = outreachPool()
  const [rows, count] = await Promise.all([
    pool.query(`SELECT * FROM outreach_contacts ${w} ORDER BY updated_at DESC, id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params),
    pool.query(`SELECT count(*)::int AS n FROM outreach_contacts ${w}`, params),
  ])
  return { rows: rows.rows, total: count.rows[0]?.n ?? 0, page, pageSize }
}

export async function getContact(id: string): Promise<OutreachContact | null> {
  const r = await outreachPool().query(`SELECT * FROM outreach_contacts WHERE id = $1`, [id])
  return r.rows[0] ?? null
}

export interface ContactDetail {
  contact: OutreachContact
  calls: OutreachCall[]
  messages: OutreachMessage[]
  events: OutreachEvent[]
}

export async function getContactDetail(id: string): Promise<ContactDetail | null> {
  const contact = await getContact(id)
  if (!contact) return null
  const pool = outreachPool()
  const [calls, messages, events] = await Promise.all([
    pool.query(`SELECT * FROM outreach_calls WHERE contact_id = $1 ORDER BY created_at DESC`, [id]),
    pool.query(`SELECT * FROM outreach_messages WHERE contact_id = $1 ORDER BY created_at DESC`, [id]),
    pool.query(`SELECT * FROM outreach_events WHERE contact_id = $1 ORDER BY id DESC LIMIT 200`, [id]),
  ])
  return { contact, calls: calls.rows, messages: messages.rows, events: events.rows }
}

export const ACTIVE_STATUSES: ContactStatus[] = ['interested', 'building', 'preview_sent', 'published', 'claimed']
export const ACTIVE_WINDOW_DAYS = 30

/** The contact an inbound WhatsApp from `phone` belongs to: engaged (interested..claimed) and touched in the last 30 days. */
export async function findActiveByPhone(phone: string, now: Date = new Date()): Promise<OutreachContact | null> {
  const e164 = normalizePhone(phone)
  if (!e164) return null
  const since = new Date(now.getTime() - ACTIVE_WINDOW_DAYS * 86400_000)
  const r = await outreachPool().query(
    `SELECT * FROM outreach_contacts WHERE phone = $1 AND status = ANY($2) AND updated_at >= $3 ORDER BY updated_at DESC LIMIT 1`,
    [e164, ACTIVE_STATUSES, since]
  )
  return r.rows[0] ?? null
}

/**
 * Contacts the worker may call now: queued, or a no-answer / callback whose retry time has come.
 * Never DND, opted out, suppressed or past the attempt cap. Window, daily cap and concurrency are the worker's job.
 */
export async function dueForCalling(program: string, now: Date, limit: number): Promise<OutreachContact[]> {
  const r = await outreachPool().query(
    `SELECT c.* FROM outreach_contacts c
      WHERE c.program = $1
        AND c.status IN ('queued', 'no_answer', 'callback')
        AND (c.next_attempt_at IS NULL OR c.next_attempt_at <= $2)
        AND c.attempts < $3
        AND c.dnd_status <> 'dnd'
        AND c.opted_out_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM outreach_suppressions s WHERE s.phone = c.phone)
      ORDER BY c.next_attempt_at NULLS FIRST, c.created_at
      LIMIT $4`,
    [program, now, MAX_ATTEMPTS, Math.max(limit, 0)]
  )
  return r.rows
}

export async function statusCounts(program: string): Promise<Record<string, number>> {
  const r = await outreachPool().query(`SELECT status, count(*)::int AS n FROM outreach_contacts WHERE program = $1 GROUP BY status`, [program])
  return Object.fromEntries(r.rows.map((x: { status: string; n: number }) => [x.status, x.n]))
}
