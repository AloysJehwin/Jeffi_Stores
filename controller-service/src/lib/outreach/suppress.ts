import { outreachPool } from './db'
import { recordEvent } from './events'
import { normalizePhone } from './phone'
import { transition } from './state'
import type { ContactStatus, OutreachSuppression } from './types'

export async function isSuppressed(phone: string): Promise<boolean> {
  const e164 = normalizePhone(phone)
  if (!e164) return false
  const r = await outreachPool().query(`SELECT 1 FROM outreach_suppressions WHERE phone = $1`, [e164])
  return (r.rowCount ?? r.rows.length) > 0
}

export async function suppressedAmong(phones: string[]): Promise<Set<string>> {
  if (!phones.length) return new Set()
  const r = await outreachPool().query(`SELECT phone FROM outreach_suppressions WHERE phone = ANY($1)`, [phones])
  return new Set(r.rows.map((x: { phone: string }) => x.phone))
}

export async function listSuppressions(opts: { q?: string; page?: number; pageSize?: number } = {}): Promise<{ rows: OutreachSuppression[]; total: number }> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 200)
  const page = Math.max(opts.page ?? 1, 1)
  const q = opts.q?.trim()
  const params: unknown[] = q ? [`%${q.replace(/[\\%_]/g, c => `\\${c}`)}%`] : []
  const w = q ? 'WHERE phone LIKE $1' : ''
  const pool = outreachPool()
  const [rows, count] = await Promise.all([
    pool.query(`SELECT * FROM outreach_suppressions ${w} ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params),
    pool.query(`SELECT count(*)::int AS n FROM outreach_suppressions ${w}`, params),
  ])
  return { rows: rows.rows, total: count.rows[0]?.n ?? 0 }
}

/** Adds the number to the suppression list and moves every live contact on it to `suppressed`. Honoured immediately. */
export async function addSuppression(
  phoneRaw: string,
  opts: { reason?: string | null; source?: string | null; actor: string }
): Promise<{ phone: string; contactsSuppressed: number } | null> {
  const phone = normalizePhone(phoneRaw)
  if (!phone) return null
  const pool = outreachPool()
  await pool.query(
    `INSERT INTO outreach_suppressions (phone, reason, source) VALUES ($1,$2,$3)
     ON CONFLICT (phone) DO UPDATE SET reason = COALESCE(EXCLUDED.reason, outreach_suppressions.reason), source = COALESCE(EXCLUDED.source, outreach_suppressions.source)`,
    [phone, opts.reason ?? null, opts.source ?? null]
  )
  const live = await pool.query(`SELECT id, status FROM outreach_contacts WHERE phone = $1 AND status <> 'suppressed'`, [phone])
  let n = 0
  for (const c of live.rows as { id: string; status: ContactStatus }[]) {
    await transition(c, 'suppressed', {
      actor: opts.actor,
      data: { reason: opts.reason ?? null, source: opts.source ?? null },
      set: { opted_out_at: new Date() },
    })
    n++
  }
  await recordEvent(null, 'suppression_added', { actor: opts.actor, data: { phone, reason: opts.reason ?? null, source: opts.source ?? null } })
  return { phone, contactsSuppressed: n }
}

/** Removes the number from the list. Contacts already suppressed stay so until someone requeues them. */
export async function removeSuppression(phoneRaw: string, actor: string): Promise<boolean> {
  const phone = normalizePhone(phoneRaw)
  if (!phone) return false
  const r = await outreachPool().query(`DELETE FROM outreach_suppressions WHERE phone = $1`, [phone])
  if (!r.rowCount) return false
  await recordEvent(null, 'suppression_removed', { actor, data: { phone } })
  return true
}
