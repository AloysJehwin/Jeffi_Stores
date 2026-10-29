import 'server-only'
import { after } from 'next/server'
import redis from '@/lib/shared/redis'
import { query, queryMany, queryOne } from '@/lib/shared/db'
import { controlPlanePool } from '@/lib/tenant-registry'
import { lookupTenantContextById } from '@/lib/tenant-registry/host-resolution'
import { getCurrentTenant, runWithTenantContext, type TenantContext } from '@/lib/tenancy/tenant-context'
import { getTenantPlan } from '@/lib/auth/plan-gate'
import { hasScope } from '@/lib/auth/scopes'
import { normalizeAdminMobile } from '@/lib/auth/admin-mobile'
import { currentAdminBaseUrlAsync, currentBrandNameAsync } from '@/lib/catalog/brand'
import { logMessage } from '@/lib/shared/message-log'
import { markWhatsAppRead, sendWhatsAppDirect } from '@/lib/shared/whatsapp'
import { contextBySend } from '@/lib/replies/context'
import { leadingYesNo, yesNo } from '@/lib/support/agent/actions'
import { whatsappConversation } from '@/lib/admin-agent/conversations'
import { runTurn } from '@/lib/admin-agent/turn'
import { AGENT_USER_AGENT, loadAdminActor, withInternalAdminSession, type AdminActor } from '@/lib/admin-agent/internal-session'
import { approveAgentAction, rejectAgentAction } from '@/lib/admin-agent/actions/approve'
import { storeTarget, withApproveTarget } from '@/lib/admin-agent/actions/shared'

// The admin assistant on WhatsApp. A message from a number an admin verified (admin_mobiles in the
// control plane) goes to the assistant of that admin's store when the store switched it on, its plan
// has the assistant and the admin may use it; anything else, and quoted replies to our customer
// messages, stays on the customer path. Changes are approved by replying YES / NO.

const PROPOSAL_TTL_MIN = 30
const TURNS_PER_HOUR = 40
const MAX_MESSAGES = 3
const MESSAGE_CHARS = 1500
const PICK_TTL_S = 15 * 60
const STORE_TTL_S = 12 * 3600
const STOP_START = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'END', 'QUIT', 'START', 'UNSTOP', 'SUBSCRIBE'])

// Money, cancellations and mass sends need the panel.
const PANEL_ONLY = new Set([
  'refund_order',
  'pay_payable',
  'mark_invoice_paid',
  'set_payment_status',
  'cancel_order',
  'send_mailer_broadcast',
  'send_product_announcement_email',
  'google_ads_action',
  'call_admin_api',
])
const panelOnly = (kind: string, payload: any) =>
  PANEL_ONLY.has(kind) || (kind === 'update_order_status' && (payload?.newStatus === 'cancelled' || !!payload?.override))

export interface AdminWhatsAppMessage {
  providerSid: string | null
  from: string
  to: string
  text: string
  hasMedia: boolean
  /** The message this one quotes, if any. */
  repliedToSid?: string | null
}

interface Store {
  key: string
  ctx: TenantContext | null
  name: string
  actor: AdminActor
}

const inStore = <T>(ctx: TenantContext | null, fn: () => Promise<T>) => (ctx ? runWithTenantContext(ctx, fn) : fn())

/**
 * True when the message is an admin's and was taken over (answered after the response); false sends
 * it down the customer path. Runs in the context of the number that received it.
 */
export async function routeAdminWhatsApp(m: AdminWhatsAppMessage): Promise<boolean> {
  try {
    const phone = normalizeAdminMobile(m.from.replace(/^whatsapp:/i, ''))
    if (!phone || STOP_START.has(m.text.trim().toUpperCase())) return false
    const rows = await controlPlanePool()
      .query<{ tenant_id: string | null; admin_id: string }>(`SELECT tenant_id::text, admin_id::text FROM admin_mobiles WHERE phone = $1`, [phone])
      .then(r => r.rows)
      .catch(() => [])
    if (!rows.length) return false

    // A store's own number only reaches that store.
    const receiving = getCurrentTenant()
    const mine = receiving ? rows.filter(r => r.tenant_id === receiving.tenantId) : rows
    if (!mine.length) return false
    if (m.repliedToSid && (await contextBySend({ providerSid: m.repliedToSid }).catch(() => null))) return false

    const stores = (await Promise.all(mine.map(r => eligibleStore(r.tenant_id, r.admin_id, phone)))).filter((s): s is Store => !!s)
    if (!stores.length) return false

    const job = () => handle(m, phone, stores).catch(err => console.error('[admin-whatsapp]', err))
    const run = () => (receiving ? runWithTenantContext(receiving, job) : job())
    try {
      after(run)
    } catch {
      void run()
    }
    return true
  } catch (err) {
    console.error('[admin-whatsapp] route', err)
    return false
  }
}

async function eligibleStore(tenantId: string | null, adminId: string, phone: string): Promise<Store | null> {
  const ctx = tenantId ? await lookupTenantContextById(tenantId).catch(() => null) : null
  if (tenantId && !ctx) return null
  return inStore(ctx, async () => {
    const on = await queryOne<{ value: string }>(`SELECT value FROM site_settings WHERE key = 'feature_agent_whatsapp_enabled'`, [])
    if (on?.value !== 'true') return null
    if (tenantId && !(await getTenantPlan(tenantId)).scopes.has('agent:write')) return null
    const actor = await loadAdminActor(adminId, tenantId)
    if (!actor || actor.mobile !== phone || !hasScope(actor.role, actor.scopes, 'agent:write')) return null
    const name = ctx?.displayName || ctx?.slug || (await currentBrandNameAsync())
    return { key: tenantId ?? 'platform', ctx, name, actor }
  })
}

async function handle(m: AdminWhatsAppMessage, phone: string, stores: Store[]) {
  if (m.providerSid) void markWhatsAppRead(m.providerSid)
  logMessage({ channel: 'whatsapp', direction: 'inbound', to: m.to.replace(/^whatsapp:/i, ''), from: phone, body: m.text || '[attachment]', kind: 'admin_agent', status: 'received', providerSid: m.providerSid })
  const send = async (texts: string[]) => {
    for (const text of texts) await sendWhatsAppDirect({ phone, text, kind: 'admin_agent' })
  }

  const text = m.text.trim()
  const picked = await pickStore(phone, text, stores)
  if ('reply' in picked) return send([picked.reply])
  const { store, message } = picked

  const lock = `adminwa:lock:${phone}`
  if (!(await redis.set(lock, '1', 'EX', 300, 'NX'))) return send(['Still working on your last message. Send this again in a moment.'])
  try {
    const replies = await inStore(store.ctx, () => answer(store, message, message === text ? m : { ...m, providerSid: null }))
    await send(replies)
  } finally {
    await redis.del(lock).catch(() => {})
  }
}

/** Which store this message is for. An admin of several stores picks one, remembered for 12 hours. */
async function pickStore(phone: string, text: string, stores: Store[]): Promise<{ store: Store; message: string } | { reply: string }> {
  if (stores.length === 1) return { store: stores[0], message: text }
  const storeKey = `adminwa:store:${phone}`
  const pickKey = `adminwa:pick:${phone}`
  const pending = await redis.get(pickKey)
  if (pending && /^\d+$/.test(text)) {
    const { keys, text: saved } = JSON.parse(pending) as { keys: string[]; text: string }
    const store = stores.find(s => s.key === keys[Number(text) - 1])
    if (store) {
      await Promise.all([redis.set(storeKey, store.key, 'EX', STORE_TTL_S), redis.del(pickKey)])
      if (saved) return { store, message: saved }
      return { reply: `Now on ${store.name}. What do you need?` }
    }
  }
  const switching = text.toLowerCase() === 'store'
  if (!switching) {
    const remembered = await redis.get(storeKey)
    const store = stores.find(s => s.key === remembered)
    if (store) return { store, message: text }
  }
  await redis.set(pickKey, JSON.stringify({ keys: stores.map(s => s.key), text: switching ? '' : text }), 'EX', PICK_TTL_S)
  return { reply: `Which store?\n${stores.map((s, i) => `${i + 1}) ${s.name}`).join('\n')}\n\nReply with the number. Send *store* later to switch.` }
}

const HELP = `*Admin assistant*
Ask about orders, stock, customers or sales, or ask for a change.
*YES*, *YES 2* or *YES ALL*: approve what I prepared
*NO*: cancel it
*new*: start a new conversation
*store*: switch store, when you run more than one`

async function answer(store: Store, text: string, m: AdminWhatsAppMessage): Promise<string[]> {
  const { actor } = store
  const cmd = text.toLowerCase()
  if (!text) return m.hasMedia ? ['Files can only be read in the admin panel. Send your question as text.'] : []
  if (cmd === 'help') return [HELP]

  const conversationId = await whatsappConversation(actor.adminId, text, cmd === 'new')
  if (cmd === 'new') return ['Started a new conversation. What do you need?']

  const stored = await queryOne<{ id: string }>(
    `INSERT INTO admin_agent_messages (admin_id, conversation_id, role, content, provider_sid) VALUES ($1, $2, 'user', $3, $4)
     ON CONFLICT (provider_sid) WHERE provider_sid IS NOT NULL DO NOTHING RETURNING id::text`,
    [actor.adminId, conversationId, m.hasMedia ? `${text}\n[attachment not read: sent on WhatsApp]` : text, m.providerSid]
  )
  if (!stored) return [] // a webhook retry

  const pending = await pendingProposals(conversationId, actor.adminId)
  const decision = pending.length ? parseDecision(text) : null
  if (decision) {
    const reply = await decide(store, pending, decision)
    await saveReply(actor.adminId, conversationId, reply)
    return chunks(reply)
  }

  const turns = await redis.incr(`adminwa:turns:${store.key}:${actor.adminId}`)
  if (turns === 1) await redis.expire(`adminwa:turns:${store.key}:${actor.adminId}`, 3600)
  if (turns > TURNS_PER_HOUR) return ['That is the limit of questions for this hour. Try again later or use the admin panel.']

  const out = await runTurn(
    { admin: actor, conversationId, userMessage: text, pageContext: null, cookieHeader: '', channel: 'whatsapp' },
    null,
    undefined
  )
  if (out.status >= 400) return [String(out.body.error || 'The assistant is temporarily unavailable. Please try again in a moment.')]
  const body = toWhatsApp(String(out.body.message || ''))
  const proposals = await pendingProposals(conversationId, actor.adminId)
  const list = proposals.length ? await proposalList(proposals, conversationId) : ''
  return chunks([body, list].filter(Boolean).join('\n\n') || 'Done.')
}

interface Proposal {
  id: string
  kind: string
  payload: any
  confirmation: string | null
}

async function pendingProposals(conversationId: string, adminId: string): Promise<Proposal[]> {
  return queryMany<Proposal>(
    `SELECT a.id::text, a.kind, a.payload,
            (SELECT e->>'confirmation' FROM admin_agent_messages m, jsonb_array_elements(m.proposed_actions) e
              WHERE m.conversation_id = a.conversation_id AND e->>'id' = a.id::text LIMIT 1) AS confirmation
       FROM admin_agent_actions a
      WHERE a.conversation_id = $1::uuid AND a.admin_id = $2::uuid AND a.status = 'proposed'
        AND a.proposed_at > now() - interval '${PROPOSAL_TTL_MIN} minutes'
      ORDER BY a.proposed_at, a.id`,
    [conversationId, adminId]
  )
}

const describe = (p: Proposal) => toWhatsApp(p.confirmation || p.kind.replace(/_/g, ' ')).replace(/\s+/g, ' ').slice(0, 300)

async function proposalList(proposals: Proposal[], conversationId: string): Promise<string> {
  const lines = proposals.map((p, i) => `${i + 1}) ${describe(p)}${panelOnly(p.kind, p.payload) ? ' _(approve in the admin panel)_' : ''}`)
  const approvable = proposals.filter(p => !panelOnly(p.kind, p.payload)).length
  const how = !approvable
    ? `Approve in the admin panel: ${await panelLink(conversationId)}`
    : proposals.length === 1
      ? 'Reply *YES* to go ahead or *NO* to cancel.'
      : 'Reply *YES 1*, *YES ALL* or *NO*.'
  return `*Waiting for your OK*\n${lines.join('\n')}\n${how} (expires in ${PROPOSAL_TTL_MIN} min)`
}

async function panelLink(conversationId: string) {
  return `${(await currentAdminBaseUrlAsync()).replace(/\/$/, '')}/agent?c=${conversationId}`
}

type Decision = { decision: 'confirm' | 'decline'; which: 'all' | number[] | null }

export function parseDecision(text: string): Decision | null {
  const t = text.trim()
  const m = t.match(/^(\S+?)[,:]?\s+(all|\d+(?:\s*(?:,|&|and)?\s*\d+)*)[.!]?$/i)
  if (m) {
    const d = yesNo(m[1])
    if (!d) return null
    return { decision: d, which: /^all$/i.test(m[2]) ? 'all' : (m[2].match(/\d+/g) ?? []).map(Number) }
  }
  const d = yesNo(t) ?? leadingYesNo(t)
  return d ? { decision: d, which: null } : null
}

async function decide(store: Store, pending: Proposal[], d: Decision): Promise<string> {
  const { actor } = store
  let picked: Proposal[]
  if (d.which === 'all' || (d.which === null && (d.decision === 'decline' || pending.length === 1))) picked = pending
  else if (d.which === null) return `Which one? Reply *YES 1*${pending.length > 1 ? `, *YES ${pending.length}*` : ''} or *YES ALL*.`
  else picked = [...new Set(d.which)].map(n => pending[n - 1]).filter((p): p is Proposal => !!p)
  if (!picked.length) return `There is no change with that number. ${pending.length} waiting: reply *YES 1* to *YES ${pending.length}*.`

  const num = (p: Proposal) => pending.indexOf(p) + 1
  if (d.decision === 'decline') {
    const out = await Promise.all(picked.map(p => rejectAgentAction(p.id, actor, 'whatsapp')))
    const n = out.filter(r => r.ok).length
    return n ? `Cancelled ${n === 1 ? 'it' : `${n} changes`}.` : 'Nothing to cancel: those were already decided.'
  }

  const lines: string[] = []
  const tenantId = store.ctx?.tenantId ?? null
  await withInternalAdminSession(actor, tenantId, cookieHeader =>
    withApproveTarget(storeTarget(store.ctx?.slug, AGENT_USER_AGENT), async () => {
      for (const p of picked) {
        if (panelOnly(p.kind, p.payload)) {
          lines.push(`${num(p)}) Needs the admin panel: ${await panelLink((await actionConversation(p.id)) ?? '')}`)
          continue
        }
        const r = await approveAgentAction(p.id, actor, { via: 'whatsapp', cookieHeader })
        lines.push(`${num(p)}) ${r.ok ? 'Done' : r.status === 'refused' ? r.error : `Failed: ${r.error}`}: ${describe(p)}`)
      }
    })
  )
  return lines.join('\n')
}

async function actionConversation(id: string) {
  return (await queryOne<{ c: string }>(`SELECT conversation_id::text AS c FROM admin_agent_actions WHERE id = $1::uuid`, [id]))?.c ?? null
}

async function saveReply(adminId: string, conversationId: string, text: string) {
  await query(`INSERT INTO admin_agent_messages (admin_id, conversation_id, role, content) VALUES ($1, $2, 'assistant', $3)`, [
    adminId,
    conversationId,
    text,
  ])
}

/** The panel's markdown in WhatsApp's own formatting. */
export function toWhatsApp(md: string): string {
  return md
    .replace(/\[\[[a-z_]+:[^|\]]+\|([^\]]+)\]\]/gi, '$1')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)')
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
    .replace(/__([^_\n]+)__/g, '_$1_')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** At most three messages, split between paragraphs or lines. */
export function chunks(text: string): string[] {
  const out: string[] = []
  let rest = text.trim()
  while (rest && out.length < MAX_MESSAGES) {
    if (rest.length <= MESSAGE_CHARS) {
      out.push(rest)
      rest = ''
      break
    }
    const cut = Math.max(rest.lastIndexOf('\n\n', MESSAGE_CHARS), rest.lastIndexOf('\n', MESSAGE_CHARS), MESSAGE_CHARS / 2)
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) out[out.length - 1] = `${out[out.length - 1].slice(0, MESSAGE_CHARS - 40).trim()}\n…(the rest is in the admin panel)`
  return out
}
