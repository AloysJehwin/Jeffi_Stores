import 'server-only'
import { query, queryOne, queryMany } from '@/lib/shared/db'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { publishSupportEvent } from './events'
import type { SupportChannel, SupportSession, SupportSender } from './types'

export interface SessionRow {
  id: string
  user_id: string | null
  tenant_id: string | null
  status: 'open' | 'closed'
  admin_name: string | null
  created_at: string
  closed_at: string | null
  ticket_number: string | null
  channel: SupportChannel
  handler: 'ai' | 'human'
  assigned_admin_id: string | null
  handoff_reason: string | null
  handoff_summary: string | null
  handoff_at: string | null
  customer_lang: string | null
  contact_phone: string | null
  contact_name: string | null
  customer_last_seen_at: string | null
  admin_last_seen_at: string | null
  last_message_at: string | null
  customer_notified_at: string | null
  wa_window_expires_at: string | null
  contact_email: string | null
  /** Subject of the customer's latest email, so replies thread in their mail app. */
  email_subject: string | null
}

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null)

const SESSION_SELECT = `
  SELECT s.*, u.first_name, u.last_name, u.email AS user_email, u.phone AS user_phone,
         (SELECT count(*) FROM support_messages um WHERE um.session_id = s.id AND um.sender = 'customer' AND um.read_at IS NULL)::int AS unread,
         lm.sender AS lm_sender, lm.message AS lm_text, lm.created_at AS lm_at
    FROM support_sessions s
    LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN LATERAL (
      SELECT sender, message, created_at FROM support_messages m
       WHERE m.session_id = s.id ORDER BY created_at DESC, id DESC LIMIT 1
    ) lm ON true`

export function toSessionDto(r: any): SupportSession {
  const name = [r.first_name, r.last_name].filter(Boolean).join(' ').trim()
  return {
    id: r.id,
    ticket: r.ticket_number ?? null,
    status: r.status === 'closed' ? 'closed' : 'open',
    channel: r.channel ?? 'web',
    handler: r.handler ?? 'ai',
    createdAt: iso(r.created_at)!,
    closedAt: iso(r.closed_at),
    lastMessageAt: iso(r.last_message_at),
    customer: {
      id: r.user_id ?? null,
      name: name || r.contact_name || r.contact_phone || r.user_email || r.contact_email || 'Customer',
      email: r.user_email ?? r.contact_email ?? null,
      phone: r.user_phone ?? r.contact_phone ?? null,
    },
    adminName: r.admin_name ?? null,
    assignedAdminId: r.assigned_admin_id ?? null,
    customerLang: r.customer_lang ?? null,
    customerLastSeenAt: iso(r.customer_last_seen_at),
    adminLastSeenAt: iso(r.admin_last_seen_at),
    handoffReason: r.handoff_reason ?? null,
    handoffSummary: r.handoff_summary ?? null,
    handoffAt: iso(r.handoff_at),
    waWindowExpiresAt: iso(r.wa_window_expires_at),
    unread: Number(r.unread ?? 0),
    lastMessage: r.lm_at ? { sender: r.lm_sender as SupportSender, text: r.lm_text ?? '', at: iso(r.lm_at)! } : null,
  }
}

export async function getSessionRow(id: string): Promise<SessionRow | null> {
  return queryOne<SessionRow>(`SELECT * FROM support_sessions WHERE id = $1`, [id])
}

export async function getSessionDto(id: string): Promise<SupportSession | null> {
  const r = await queryOne(`${SESSION_SELECT} WHERE s.id = $1`, [id])
  return r ? toSessionDto(r) : null
}

/** The customer's open chat, if any. */
export async function openSessionFor(userId: string): Promise<SessionRow | null> {
  return queryOne<SessionRow>(
    `SELECT * FROM support_sessions WHERE user_id = $1 AND status = 'open' ORDER BY created_at DESC LIMIT 1`,
    [userId]
  )
}

/** The open WhatsApp chat for a number with no account (matched on its last 10 digits). */
export async function openContactSession(phone10: string): Promise<SessionRow | null> {
  return queryOne<SessionRow>(
    `SELECT * FROM support_sessions
      WHERE user_id IS NULL AND status = 'open' AND right(regexp_replace(contact_phone, '\\D', '', 'g'), 10) = $1
      ORDER BY created_at DESC LIMIT 1`,
    [phone10]
  )
}

/** The open email chat for an address with no account. */
export async function openEmailSession(email: string): Promise<SessionRow | null> {
  return queryOne<SessionRow>(
    `SELECT * FROM support_sessions WHERE user_id IS NULL AND status = 'open' AND lower(contact_email) = lower($1) ORDER BY created_at DESC LIMIT 1`,
    [email]
  )
}

export async function createSession(input: {
  userId: string | null
  channel: SupportChannel
  handler?: 'ai' | 'human'
  contactPhone?: string | null
  contactName?: string | null
  contactEmail?: string | null
  customerLang?: string | null
}): Promise<SessionRow> {
  const tenantId = await resolveTenantId().catch(() => null)
  const row = await queryOne<SessionRow>(
    `INSERT INTO support_sessions
       (user_id, tenant_id, channel, handler, contact_phone, contact_name, customer_lang, contact_email, last_message_at, customer_last_seen_at, ticket_number)
     VALUES ($1, $2, $3::varchar, $4, $5, $6, $7, $8, now(), CASE WHEN $3::varchar IN ('whatsapp', 'email') THEN NULL ELSE now() END,
             'SUP-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYMM') || '-' || lpad(nextval('support_ticket_seq')::text, 4, '0'))
     RETURNING *`,
    [input.userId, tenantId, input.channel, input.handler ?? 'ai', input.contactPhone ?? null, input.contactName ?? null, input.customerLang ?? null, input.contactEmail ?? null]
  )
  if (!row) throw new Error('support session insert failed')
  void emitSession(row.id)
  return row
}

export async function emitSession(id: string): Promise<void> {
  const dto = await getSessionDto(id).catch(() => null)
  if (dto) await publishSupportEvent({ kind: 'session', sessionId: id, session: dto })
}

export type InboxFilter = 'needs_human' | 'mine' | 'ai' | 'open' | 'closed'

export async function listInbox(opts: {
  filter: InboxFilter
  adminId: string
  channel?: SupportChannel | null
  search?: string | null
  customerId?: string | null
  limit?: number
}): Promise<SupportSession[]> {
  const where: string[] = []
  const params: unknown[] = []
  const p = (v: unknown) => {
    params.push(v)
    return `$${params.length}`
  }
  if (opts.filter === 'closed') where.push(`s.status = 'closed'`)
  else {
    where.push(`s.status = 'open'`)
    if (opts.filter === 'needs_human') where.push(`s.handler = 'human' AND s.assigned_admin_id IS NULL`)
    if (opts.filter === 'mine') where.push(`s.assigned_admin_id = ${p(opts.adminId)}`)
    if (opts.filter === 'ai') where.push(`s.handler = 'ai'`)
  }
  if (opts.channel) where.push(`s.channel = ${p(opts.channel)}`)
  if (opts.customerId) where.push(`s.user_id = ${p(opts.customerId)}`)
  if (opts.search?.trim()) {
    const q = p(`%${opts.search.trim()}%`)
    where.push(`(s.ticket_number ILIKE ${q} OR u.email ILIKE ${q} OR concat_ws(' ', u.first_name, u.last_name) ILIKE ${q}
              OR s.contact_phone ILIKE ${q} OR u.phone ILIKE ${q} OR s.contact_name ILIKE ${q})`)
  }
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const rows = await queryMany(
    `${SESSION_SELECT} WHERE ${where.join(' AND ')}
      ORDER BY (s.handler = 'human' AND s.assigned_admin_id IS NULL) DESC, COALESCE(s.last_message_at, s.created_at) DESC
      LIMIT ${limit}`,
    params
  )
  return rows.map(toSessionDto)
}

export async function inboxCounts(adminId: string): Promise<Record<InboxFilter, number>> {
  const r = await queryOne<Record<string, string>>(
    `SELECT count(*) FILTER (WHERE status = 'open' AND handler = 'human' AND assigned_admin_id IS NULL) AS needs_human,
            count(*) FILTER (WHERE status = 'open' AND assigned_admin_id = $1) AS mine,
            count(*) FILTER (WHERE status = 'open' AND handler = 'ai') AS ai,
            count(*) FILTER (WHERE status = 'open') AS open
       FROM support_sessions`,
    [adminId]
  )
  return {
    needs_human: Number(r?.needs_human ?? 0),
    mine: Number(r?.mine ?? 0),
    ai: Number(r?.ai ?? 0),
    open: Number(r?.open ?? 0),
    closed: 0,
  }
}

export async function updateSession(id: string, set: Record<string, unknown>): Promise<SessionRow | null> {
  const keys = Object.keys(set)
  if (!keys.length) return getSessionRow(id)
  const cols = keys.map((k, i) => `${k} = $${i + 2}`).join(', ')
  const row = await queryOne<SessionRow>(`UPDATE support_sessions SET ${cols} WHERE id = $1 RETURNING *`, [id, ...keys.map(k => set[k])])
  if (row) void emitSession(id)
  return row
}

export async function closeSession(id: string): Promise<SessionRow | null> {
  const row = await queryOne<SessionRow>(
    `UPDATE support_sessions SET status = 'closed', closed_at = now() WHERE id = $1 AND status = 'open' RETURNING *`,
    [id]
  )
  if (row) {
    await query(`UPDATE support_ai_actions SET status = 'expired', decided_at = now() WHERE session_id = $1 AND status = 'pending'`, [id])
    void emitSession(id)
  }
  return row
}

/** Presence: the client's heartbeat or open stream. `leaving` reports the tab going away. */
export async function touchPresence(id: string, side: 'customer' | 'admin', leaving = false): Promise<string> {
  const col = side === 'customer' ? 'customer_last_seen_at' : 'admin_last_seen_at'
  const at = leaving ? new Date(Date.now() - 46_000) : new Date()
  await query(`UPDATE support_sessions SET ${col} = $2 WHERE id = $1`, [id, at])
  await publishSupportEvent({ kind: 'presence', sessionId: id, side, lastSeenAt: at.toISOString(), active: !leaving })
  return at.toISOString()
}

/** Customer display name for an admin-side label. */
export function customerName(r: { first_name?: string | null; last_name?: string | null; contact_name?: string | null; contact_phone?: string | null }) {
  return [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || r.contact_name || r.contact_phone || 'Customer'
}
