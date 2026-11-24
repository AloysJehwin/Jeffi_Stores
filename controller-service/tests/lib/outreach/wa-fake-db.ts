import { vi } from 'vitest'

// An in-memory stand-in for the outreach tables the WhatsApp code touches, routed on the SQL text.
export interface FakeDb {
  contact: Record<string, any> | null
  suppressed: Set<string>
  messages: Array<{ id: string; direction: string; template_slug: string | null; body: string; provider_message_id: string | null; status: string }>
  events: Array<{ id: number; contact_id: string | null; kind: string; data: any; actor: string | null; created_at: string }>
  query: ReturnType<typeof vi.fn>
  pool: { query: ReturnType<typeof vi.fn>; connect: () => Promise<{ query: ReturnType<typeof vi.fn>; release: () => void }> }
}

export function fakeDb(): FakeDb {
  const db = { contact: null, suppressed: new Set<string>(), messages: [], events: [] } as unknown as FakeDb
  db.query = vi.fn(async (sql: string, p: any[] = []) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] }
    if (sql.includes('FROM outreach_contacts WHERE phone')) return { rows: db.contact && db.contact.phone === p[0] ? [db.contact] : [] }
    if (sql.includes('FROM outreach_contacts WHERE id')) return { rows: db.contact && db.contact.id === p[0] ? [db.contact] : [] }
    if (sql.includes('UPDATE outreach_contacts SET status')) {
      Object.assign(db.contact!, { status: p[1] }, sql.includes('opted_out_at') ? { opted_out_at: p[2] } : {})
      return { rows: [db.contact] }
    }
    if (sql.includes('UPDATE outreach_contacts SET wa_window_expires_at')) {
      const cur = db.contact!.wa_window_expires_at ? new Date(db.contact!.wa_window_expires_at) : null
      db.contact!.wa_window_expires_at = cur && cur > p[1] ? cur : p[1]
      return { rows: [], rowCount: 1 }
    }
    if (sql.includes("direction = 'in' AND provider_message_id")) return { rows: db.messages.filter(m => m.direction === 'in' && m.provider_message_id === p[1]) }
    if (sql.includes('INSERT INTO outreach_messages')) {
      const inbound = sql.includes("'in'")
      const row = inbound
        ? { id: `m${db.messages.length + 1}`, direction: 'in', template_slug: null, body: p[1], provider_message_id: p[2], status: 'received' }
        : { id: `m${db.messages.length + 1}`, direction: 'out', template_slug: p[1], body: p[2], provider_message_id: p[3], status: p[4] }
      db.messages.push(row)
      return { rows: [{ id: row.id }] }
    }
    if (sql.includes('SELECT direction, body FROM outreach_messages')) return { rows: [...db.messages].reverse().map(m => ({ direction: m.direction, body: m.body })) }
    if (sql.includes('INSERT INTO outreach_suppressions')) {
      db.suppressed.add(p[0])
      return { rows: [], rowCount: 1 }
    }
    if (sql.includes('FROM outreach_suppressions')) return { rows: db.suppressed.has(p[0]) ? [{ '?column?': 1 }] : [], rowCount: db.suppressed.has(p[0]) ? 1 : 0 }
    if (sql.includes('INSERT INTO outreach_events')) {
      db.events.push({ id: db.events.length + 1, contact_id: p[0], kind: p[2], data: p[3] ? JSON.parse(p[3]) : null, actor: p[4], created_at: '2026-11-24T06:00:00.000Z' })
      return { rows: [] }
    }
    if (sql.includes('FROM outreach_events')) {
      let rows = db.events.filter(e => e.kind === 'whatsapp_out' && e.data?.mode === 'captured')
      if (sql.includes('contact_id = $1')) rows = rows.filter(e => e.contact_id === p[0])
      return { rows }
    }
    throw new Error(`fake db: unexpected SQL ${sql.slice(0, 80)}`)
  })
  db.pool = { query: db.query, connect: async () => ({ query: db.query, release: () => {} }) }
  return db
}

export const CONTACT = {
  id: '11111111-1111-4111-8111-111111111111',
  program: 'showcase-offer',
  phone: '+919876543210',
  business_name: 'Sharma Sweets',
  owner_name: 'Ravi',
  city: 'Jaipur',
  language: 'en',
  status: 'preview_sent',
  consent_whatsapp_at: '2026-11-24T05:00:00.000Z',
  opted_out_at: null,
  wa_window_expires_at: null,
}
