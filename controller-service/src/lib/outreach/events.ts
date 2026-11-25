import { outreachPool, type Queryable } from './db'
import type { OutreachEvent } from './types'

export async function recordEvent(
  contactId: string | null,
  kind: string,
  opts: { callId?: string | null; data?: unknown; actor?: string | null } = {},
  db: Queryable = outreachPool()
): Promise<void> {
  await db.query(
    `INSERT INTO outreach_events (contact_id, call_id, kind, data, actor) VALUES ($1,$2,$3,$4,$5)`,
    [contactId, opts.callId ?? null, kind, opts.data === undefined ? null : JSON.stringify(opts.data), opts.actor ?? null]
  )
}

export async function listEvents(opts: { contactId?: string; limit?: number } = {}): Promise<OutreachEvent[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500)
  const r = opts.contactId
    ? await outreachPool().query(`SELECT * FROM outreach_events WHERE contact_id = $1 ORDER BY id DESC LIMIT $2`, [opts.contactId, limit])
    : await outreachPool().query(`SELECT * FROM outreach_events ORDER BY id DESC LIMIT $1`, [limit])
  return r.rows
}
