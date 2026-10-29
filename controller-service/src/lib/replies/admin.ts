import 'server-only'
import { queryMany, queryOne } from '@/lib/shared/db'
import { getSessionRow } from '@/lib/support/sessions'
import { postMessage } from '@/lib/support/messages'
import { translateOne } from '@/lib/support/translate'
import { scenarioFor } from './scenarios'
import { markAnswered } from './context'
import { runReplyAction, type ReplyAction } from './execute'
import type { ReplyContextRow, ScenarioKey } from './types'

// The "Customer replies" card on a record page: what we asked, what came back, what the AI made of
// it, and the admin's Approve / Reject on anything waiting for them.

/** Read scope for each kind of record the replies card appears on. */
export const ENTITY_READ_SCOPE: Record<string, string> = {
  orders: 'orders:read',
  quotations: 'quotations:read',
  invoices: 'invoices:read',
  business_rfqs: 'business_rfqs:read',
  subscriptions: 'subscriptions:read',
}

export interface ReplyItem {
  id: string
  kind: 'asked' | 'message' | 'action'
  at: string
  channel?: string
  sender?: string
  text?: string
  scenario?: string
  intent?: string
  title?: string
  reading?: string | null
  confidence?: number | null
  status?: string
  awaiting?: string
  autoApplied?: boolean
  manual?: boolean
  result?: string | null
  decidedBy?: string | null
  attachments?: Array<{ id: string; kind: string; name: string; url: string }>
}

export async function listRecordReplies(entityType: string, entityId: string): Promise<{ items: ReplyItem[]; sessionIds: string[]; pending: number }> {
  const [contexts, messages, actions] = await Promise.all([
    queryMany<ReplyContextRow>(`SELECT * FROM reply_contexts WHERE entity_type = $1 AND entity_id = $2 AND scenario <> 'support' ORDER BY created_at`, [entityType, entityId]),
    queryMany<any>(
      `SELECT m.id, m.session_id, m.sender, m.message, m.channel, m.created_at, m.translations, m.lang,
              COALESCE(json_agg(json_build_object('id', a.id, 'kind', a.kind, 'name', a.name)) FILTER (WHERE a.id IS NOT NULL), '[]') AS attachments
         FROM support_messages m LEFT JOIN support_message_attachments a ON a.message_id = m.id
        WHERE m.entity_type = $1 AND m.entity_id = $2
        GROUP BY m.id ORDER BY m.created_at`,
      [entityType, entityId]
    ),
    queryMany<any>(
      `SELECT x.*, NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), '') AS decided_by
         FROM support_ai_actions x
         LEFT JOIN admins ad ON ad.id = x.decided_by_admin_id LEFT JOIN users u ON u.id = ad.user_id
        WHERE x.kind = 'reply' AND x.entity_type = $1 AND x.entity_id = $2 AND x.status <> 'expired'
        ORDER BY x.created_at`,
      [entityType, entityId]
    ),
  ])
  const items: ReplyItem[] = []
  for (const c of contexts) {
    const sc = scenarioFor(c.scenario)
    items.push({ id: `ctx:${c.id}`, kind: 'asked', at: new Date(c.created_at).toISOString(), scenario: sc?.label ?? c.scenario, status: c.status })
  }
  for (const m of messages) {
    items.push({
      id: m.id,
      kind: 'message',
      at: new Date(m.created_at).toISOString(),
      channel: m.channel,
      sender: m.sender,
      text: m.lang && m.lang !== 'en' && m.translations?.en ? m.translations.en : m.message,
      attachments: (m.attachments ?? []).map((a: any) => ({ id: a.id, kind: a.kind, name: a.name, url: `/api/support/attachments/${a.id}` })),
    })
  }
  let pending = 0
  for (const a of actions) {
    const ctx = contexts.find(c => c.id === a.context_id)
    const sc = ctx ? scenarioFor(ctx.scenario) : scenarioFor(a.args?.scenario as ScenarioKey)
    const def = sc?.intents[a.args?.intent]
    const snap = ctx && sc && a.status === 'pending' ? await sc.snapshot(ctx).catch(() => null) : null
    if (a.status === 'pending' && a.awaiting === 'admin') pending++
    items.push({
      id: a.id,
      kind: 'action',
      at: new Date(a.created_at).toISOString(),
      scenario: sc?.label,
      intent: a.args?.intent,
      title: a.args?.title ?? (def && snap ? def.title(snap, a.args?.args ?? {}) : (a.reading ?? a.args?.intent)),
      reading: a.reading,
      confidence: a.confidence != null ? Number(a.confidence) : null,
      status: a.status,
      awaiting: a.awaiting,
      autoApplied: !!a.auto_applied,
      manual: !!def?.manual,
      result: a.result?.text ?? null,
      decidedBy: a.decided_by ?? null,
    })
  }
  items.sort((x, y) => x.at.localeCompare(y.at))
  return { items, sessionIds: [...new Set(messages.map(m => m.session_id))], pending }
}

export type AdminDecision = { ok: true; text: string } | { ok: false; status: number; error: string }

/** An admin approves (runs it, or marks a by-hand request handled) or rejects what the customer asked. */
export async function decideAsAdmin(actionId: string, admin: { adminId: string; hasScope: (s: string) => boolean }, decision: 'approve' | 'reject', note?: string | null): Promise<AdminDecision> {
  const a = await queryOne<ReplyAction>(`SELECT * FROM support_ai_actions WHERE id = $1 AND kind = 'reply'`, [actionId])
  if (!a) return { ok: false, status: 404, error: 'Not found' }
  const ctx = a.context_id ? await queryOne<ReplyContextRow>(`SELECT * FROM reply_contexts WHERE id = $1`, [a.context_id]) : null
  const sc = ctx ? scenarioFor(ctx.scenario) : null
  if (!ctx || !sc) return { ok: false, status: 404, error: 'Not found' }
  if (!admin.hasScope(sc.scope)) return { ok: false, status: 403, error: 'Insufficient permissions' }
  const claimed = await queryOne<ReplyAction>(
    `UPDATE support_ai_actions SET status = $2, decided_at = now(), decided_by_admin_id = $3 WHERE id = $1 AND status = 'pending' AND awaiting = 'admin' RETURNING *`,
    [a.id, decision === 'approve' ? 'confirmed' : 'declined', admin.adminId]
  )
  if (!claimed) return { ok: false, status: 409, error: 'This was already decided' }
  const session = await getSessionRow(a.session_id)
  const manual = !!sc.intents[a.args.intent]?.manual

  let english: string
  if (decision === 'reject') {
    english = note?.trim() ? note.trim() : `Sorry, we can't do that this time. Our team will be in touch if anything changes.`
  } else if (manual) {
    await queryOne(`UPDATE support_ai_actions SET status = 'done', result = $2 WHERE id = $1`, [a.id, JSON.stringify({ ok: true, text: note ?? 'Handled' })])
    await markAnswered(ctx.id)
    english = note?.trim() || ''
  } else {
    const r = await runReplyAction(claimed, { userId: null, adminId: admin.adminId })
    english = r.ok ? [r.text, note?.trim()].filter(Boolean).join(' ') : ''
    if (!r.ok) return { ok: false, status: 409, error: r.text }
  }
  if (session && english) {
    const lang = session.customer_lang && session.customer_lang !== 'en' ? session.customer_lang : null
    const text = lang ? ((await translateOne(english, lang, 'en')) ?? english) : english
    await postMessage({ session, sender: 'admin', adminId: admin.adminId, text, lang: lang ?? 'en', translations: lang ? { en: english } : {}, replyContextId: ctx.id, entityType: ctx.entity_type, entityId: ctx.entity_id })
  }
  return { ok: true, text: english }
}
