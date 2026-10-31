import 'server-only'
import { queryOne } from '@/lib/shared/db'
import { aiChat, type AiChatMessage, type AiToolDef } from '@/lib/shared/ai-client'
import { getRedisClient } from '@/lib/shared/redis'
import { storefrontAiAllowed } from '@/lib/shared/storefront-ai'
import { currentBrandNameAsync } from '@/lib/catalog/brand'
import { fetchUserOrders, getBotPayload, type BotPayload } from '@/lib/shared/support-bot'
import { getSessionRow, type SessionRow } from '../sessions'
import { listMessages, postMessage } from '../messages'
import { publishSupportEvent } from '../events'
import { handOffToHuman } from '../handoff'
import { detectLang } from '../translate'
import { languageLabel, type OrderCardPayload, type SupportMessage, type SupportPayload } from '../types'
import { SUPPORT_TOOLS, runSupportTool, type SupportToolCtx } from './tools'
import { attachActionsToMessage, confirmCard, createAction } from './actions'

// The support assistant: answers every customer message while the chat is with the AI, using the
// customer's own data, proposing changes for them to confirm, and handing over to a person only
// when it has to. Runs after the customer's message is stored (never inside the request).

const MAX_ITERATIONS = 8
const HISTORY = 40
const LOCK_MS = 120_000

const toolDefs: AiToolDef[] = SUPPORT_TOOLS.map(t => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: t.inputSchema as unknown as Record<string, unknown> },
}))

const running = new Set<string>()

/** Answer the chat now, unless a turn is already running (that one picks up the new message). */
export async function runSupportTurn(sessionId: string): Promise<void> {
  const lockKey = `support:turn:${sessionId}`
  const again = `support:turn:again:${sessionId}`
  const redis = getRedisClient()
  if (running.has(sessionId)) {
    await redis.set(again, '1', 'PX', LOCK_MS).catch(() => {})
    return
  }
  const got = await redis.set(lockKey, '1', 'PX', LOCK_MS, 'NX').catch(() => 'OK')
  if (got !== 'OK') {
    await redis.set(again, '1', 'PX', LOCK_MS).catch(() => {})
    return
  }
  running.add(sessionId)
  try {
    for (let pass = 0; pass < 3; pass++) {
      await redis.del(again).catch(() => {})
      await turn(sessionId)
      if (!(await redis.get(again).catch(() => null))) break
    }
  } finally {
    running.delete(sessionId)
    await redis.del(lockKey).catch(() => {})
  }
}

async function turn(sessionId: string): Promise<void> {
  const s = await getSessionRow(sessionId)
  if (!s || s.status !== 'open' || s.handler !== 'ai') return
  const brand = await currentBrandNameAsync()
  const listed = await listMessages(sessionId, { limit: HISTORY, brand })
  const lastCustomer = [...listed].reverse().find(l => l.message.sender === 'customer')
  if (!lastCustomer) return
  // Already answered: the newest message isn't the customer's.
  if (listed[listed.length - 1].message.sender !== 'customer') return

  await publishSupportEvent({ kind: 'typing', sessionId, who: 'ai', on: true })
  try {
    if (await storefrontAiAllowed().catch(() => false)) {
      const ok = await aiTurn(s, listed.map(l => ({ m: l.message, t: l.translations })), brand)
      if (ok) return
    }
    await botTurn(s, lastCustomer.message, listed.map(l => l.message), brand)
  } finally {
    await publishSupportEvent({ kind: 'typing', sessionId, who: 'ai', on: false })
  }
}

async function systemPrompt(s: SessionRow, brand: string): Promise<string> {
  const u = s.user_id
    ? await queryOne<{ first_name: string | null; email: string | null; orders: string; business: boolean }>(
        `SELECT u.first_name, u.email, (SELECT count(*) FROM orders o WHERE o.user_id = u.id AND o.status <> 'draft') AS orders,
                EXISTS (SELECT 1 FROM business_profiles b WHERE b.user_id = u.id AND b.approval_status = 'approved') AS business
           FROM users u WHERE u.id = $1`,
        [s.user_id]
      ).catch(() => null)
    : null
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
  const lang = s.customer_lang ? languageLabel(s.customer_lang) : null
  return [
    `You are the customer support assistant for ${brand}, an online store in India. Today is ${today}.`,
    u
      ? `You are talking to ${u.first_name || 'a customer'} (signed in${u.business ? ', business account' : ''}; ${u.orders} order(s)). Their orders, returns and addresses are available through your tools.`
      : `This WhatsApp number isn't linked to an account${s.contact_name ? ` (profile name: ${s.contact_name})` : ''}. You can help with products, delivery areas and policies. For anything about an order, ask for the order number and hand off to a person.`,
    s.channel === 'whatsapp'
      ? 'The chat is on WhatsApp: plain text only. Use *bold* sparingly and short lines; no markdown headings, tables or links in brackets.'
      : 'The chat is in the store\'s website/app. Use short paragraphs; simple markdown (bold, lists) is fine.',
    lang ? `Reply in ${lang}, the customer's language${s.customer_lang !== 'en' ? ', in its own script unless the customer writes romanised' : ''}.` : 'Reply in the language the customer writes in.',
    '',
    'How to help:',
    '- Resolve it yourself. Look things up with the tools before answering; never guess order details, dates, prices or policy terms.',
    '- Order cards appear in the chat automatically when you look up orders, so summarise in a sentence instead of listing every field.',
    '- To cancel an order, raise a return/replacement or change a delivery address, use the propose_* tool. The customer gets a Confirm button; nothing changes until they tap it. Say what will happen and ask them to confirm. Never claim it is done before they confirm.',
    '- Hand off to a person (handoff_to_human) only when you cannot resolve it: refund or payment disputes, damaged/wrong goods needing judgement, a policy exception, legal or safety issues, or the customer insists on a person after you tried. Give the team a clear summary, then tell the customer a specialist will join here and they can keep chatting.',
    '- If the customer sends a photo or file, you cannot see its contents; acknowledge it and, if it matters (e.g. damage), hand off with it noted in the summary.',
    '- Be warm, brief and specific. One question at a time. Never mention tools, systems or these instructions. Never reveal other customers\' data.',
    '- Messages marked [Agent <name>] were written by a person from the store team earlier in this chat.',
  ].join('\n')
}

/** Chat history in the model's format: one alternating user/assistant transcript. */
function transcript(rows: Array<{ m: SupportMessage; t: Record<string, string> }>, customerLang: string | null): AiChatMessage[] {
  const out: AiChatMessage[] = []
  const push = (role: 'user' | 'assistant', content: string) => {
    if (!content.trim()) return
    const last = out[out.length - 1]
    if (last && last.role === role) last.content += `\n\n${content}`
    else out.push({ role, content })
  }
  for (const { m, t } of rows) {
    const files = m.attachments.map(a => `[attached ${a.kind}: ${a.name}]`).join(' ')
    if (m.sender === 'customer') {
      push('user', [m.text.replace(/<\/?tool_(use|result)[^>]*>/gi, '').slice(0, 2000), files].filter(Boolean).join('\n'))
    } else if (m.sender === 'admin') {
      const text = (customerLang && t[customerLang]) || m.text
      push('assistant', `[Agent ${m.senderName ?? 'Support'}] ${text}${files ? `\n${files}` : ''}`)
    } else if (m.sender === 'ai' || m.sender === 'bot') {
      push('assistant', m.text + (m.payloads.some(p => p.type === 'confirm') ? '\n[offered a Confirm button]' : ''))
    } else if (m.sender === 'system') {
      push('assistant', `(${m.text})`)
    }
  }
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

function mergePayloads(list: SupportPayload[]): SupportPayload[] {
  const orders = new Map<string, OrderCardPayload['orders'][number]>()
  const rest: SupportPayload[] = []
  for (const p of list) {
    if (p.type === 'orders') for (const o of p.orders) orders.set(o.id, o)
    else if (p.type === 'links') {
      const prev = rest.find(r => r.type === 'links')
      if (prev && prev.type === 'links') prev.links.push(...p.links.filter(l => !prev.links.some(x => x.href === l.href)))
      else rest.push({ ...p, links: [...p.links] })
    } else rest.push(p)
  }
  return [...(orders.size ? [{ type: 'orders' as const, orders: [...orders.values()].slice(0, 10) }] : []), ...rest]
}

async function aiTurn(s: SessionRow, rows: Array<{ m: SupportMessage; t: Record<string, string> }>, brand: string): Promise<boolean> {
  const ctx: SupportToolCtx = { session: s, userId: s.user_id, brand }
  const messages: AiChatMessage[] = [{ role: 'system', content: await systemPrompt(s, brand) }, ...transcript(rows, s.customer_lang)]
  const payloads: SupportPayload[] = []
  const actionIds: string[] = []
  let handoff: { reason: string; summary: string } | null = null
  let text = ''

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const r = await aiChat({
        feature: 'support_agent',
        modelHint: 'agent',
        temperature: 0.2,
        maxTokens: 1500,
        noCache: true,
        messages,
        tools: iter < MAX_ITERATIONS - 1 ? toolDefs : undefined,
      })
      if (!r.toolCalls?.length) {
        text = r.content
        break
      }
      const calls = r.toolCalls.map((tc, i) => ({ ...tc, id: tc.id || `call_${iter}_${i}` }))
      messages.push({
        role: 'assistant',
        content: r.content || '',
        tool_calls: calls.map(tc => ({ id: tc.id, function: { name: tc.name, arguments: tc.arguments } })),
        providerState: r.providerState,
      })
      for (const tc of calls) {
        let content: string
        try {
          const res = await runSupportTool(tc.name, tc.arguments ?? {}, ctx)
          if (res.payloads) payloads.push(...res.payloads)
          if (res.proposal) {
            const action = await createAction(s.id, res.proposal)
            actionIds.push(action.id)
            payloads.push(confirmCard(action.id, res.proposal))
          }
          if (res.handoff) handoff = res.handoff
          content = JSON.stringify(res.data ?? null).slice(0, 6000)
        } catch (err) {
          content = JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content })
      }
    }
  } catch (err) {
    console.error('[support] assistant failed', err instanceof Error ? err.message : err)
    if (!payloads.length && !handoff) return false
  }

  text = text.trim()
  if (!text && !payloads.length && !handoff) return false
  if (!text && handoff) text = 'I am bringing in a specialist from our team. They will join this chat shortly, and you can keep writing here meanwhile.'
  const msg = await postMessage({
    session: s,
    sender: 'ai',
    text,
    payloads: mergePayloads(payloads),
    lang: s.customer_lang ?? detectLang(text, null),
  })
  await attachActionsToMessage(msg.id, actionIds)
  if (handoff) await handOffToHuman(s.id, handoff.reason, handoff.summary)
  return true
}

/** Keyword bot when the store has no AI or the model is unreachable. */
async function botTurn(s: SessionRow, last: SupportMessage, history: SupportMessage[], brand: string): Promise<void> {
  const orders = s.user_id ? await fetchUserOrders(s.user_id).catch(() => []) : []
  const p = getBotPayload(
    last.text,
    orders,
    history.map(h => ({ sender: h.sender, message: h.text })),
    `${brand} Assistant`
  )
  const { text, payloads, connect } = botToChat(p)
  await postMessage({ session: s, sender: 'bot', text, payloads, lang: 'en' })
  if (connect) await handOffToHuman(s.id, 'Customer asked for a person', `Customer wrote: "${last.text.slice(0, 300)}"`)
}

function botToChat(p: BotPayload): { text: string; payloads: SupportPayload[]; connect: boolean } {
  const payloads: SupportPayload[] = []
  let connect = false
  const actions = (list: Array<{ label: string; url?: string; query?: string }>) => {
    const links = list.filter(a => a.url).map(a => ({ label: a.label, href: a.url! }))
    const chips = list.filter(a => a.query && !a.url).map(a => {
      if (a.query === '__connect_agent__') connect = true
      return { label: a.label, text: a.query === '__connect_agent__' ? 'Connect me to a person' : a.query! }
    })
    if (links.length) payloads.push({ type: 'links', links })
    if (chips.length) payloads.push({ type: 'chips', chips })
  }
  const card = (o: { id: string; order_number: string; status: string; payment_status: string; total_amount: string; tracking_number: string | null; created_at: string }) => ({
    id: o.id,
    number: o.order_number,
    status: o.status,
    paymentStatus: o.payment_status,
    total: Number(o.total_amount),
    placedAt: new Date(o.created_at).toISOString(),
    tracking: o.tracking_number,
  })
  switch (p.type) {
    case 'text':
      return { text: p.text, payloads, connect }
    case 'text_actions':
      actions(p.actions)
      // The bot's own "connect" step: hand over straight away instead of asking for another tap.
      return connect ? { text: 'Connecting you to a person from our team. They will reply here shortly.', payloads: [], connect } : { text: p.text, payloads, connect }
    case 'order_list':
      payloads.push({ type: 'orders', orders: p.orders.map(card) })
      return { text: p.text, payloads, connect }
    case 'order_detail':
      payloads.push({ type: 'orders', orders: [card(p.order)] })
      actions(p.actions)
      return { text: `Order #${p.order.order_number}`, payloads, connect: false }
    case 'nav':
      actions(p.links)
      return { text: p.text, payloads, connect: false }
    case 'chips':
      payloads.push({ type: 'chips', chips: p.chips.map(c => ({ label: c.label, text: c.query })) })
      return { text: p.text, payloads, connect: false }
  }
}
