import { query, queryMany, queryOne } from './db'
import { aiChat, getAiProvider } from './ai-client'
import { listConversations } from './customer-conversations'
import type { ConversationItem } from './customer-conversations-shared'

export interface AiCustomerSummary {
  summary: string | null
  generatedAt: string | null
}

export interface ProfileFacts {
  firstName: string | null
  userType: string | null
  memberSince: string | null
  orderCount: number
  lifetimeValue: number
  lastOrderAt: string | null
  topProducts: { name: string; orders: number; quantity: number }[]
  reviews: { rating: number | null; product: string | null; title: string | null; comment: string | null; at: string }[]
  notes: { title: string | null; body: string; tags: string[]; at: string }[]
  messages: Pick<ConversationItem, 'channel' | 'direction' | 'body' | 'at' | 'subject'>[]
}

const MAX_WORDS = 120
const SNIPPET = 320

export function aiProfileConfigured(): boolean {
  return getAiProvider() === 'openai' ? !!process.env.OPENAI_API_KEY : true
}

export async function getAiSummary(userId: string): Promise<AiCustomerSummary> {
  const row = await queryOne<{ ai_summary: string | null; ai_summary_at: string | Date | null }>(
    `SELECT ai_summary, ai_summary_at FROM customer_profiles WHERE user_id = $1 ORDER BY ai_summary_at DESC NULLS LAST LIMIT 1`,
    [userId]
  )
  return { summary: row?.ai_summary || null, generatedAt: toIso(row?.ai_summary_at) }
}

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function day(value: string | Date | null | undefined): string {
  const iso = toIso(value)
  return iso ? iso.slice(0, 10) : 'unknown date'
}

function snippet(text: string | null | undefined, max = SNIPPET): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export async function collectProfileFacts(userId: string): Promise<ProfileFacts> {
  const [user, orders, topProducts, reviews, notes, conversations] = await Promise.all([
    queryOne<{ first_name: string | null; user_type: string | null; created_at: string | Date | null }>(
      `SELECT first_name, user_type, created_at FROM users WHERE id = $1`,
      [userId]
    ),
    queryOne<{ n: string; ltv: string; last_at: string | Date | null }>(
      `SELECT count(*)::text AS n, COALESCE(sum(total_amount), 0)::text AS ltv, max(created_at) AS last_at
       FROM orders WHERE user_id = $1 AND status <> 'cancelled' AND draft_of_id IS NULL`,
      [userId]
    ),
    queryMany<{ name: string; orders: string; quantity: string }>(
      `SELECT oi.product_name AS name, count(DISTINCT oi.order_id)::text AS orders, COALESCE(sum(oi.quantity), 0)::text AS quantity
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.user_id = $1 AND o.status <> 'cancelled'
       GROUP BY oi.product_name ORDER BY count(DISTINCT oi.order_id) DESC, sum(oi.quantity) DESC LIMIT 8`,
      [userId]
    ),
    queryMany<{
      rating: number | null
      product: string | null
      title: string | null
      comment: string | null
      created_at: string | Date
    }>(
      `SELECT r.rating, p.name AS product, r.title, r.comment, r.created_at
       FROM product_reviews r LEFT JOIN products p ON p.id = r.product_id
       WHERE r.user_id = $1 ORDER BY r.created_at DESC LIMIT 10`,
      [userId]
    ),
    queryMany<{ title: string | null; body: string; tags: string[] | null; created_at: string | Date }>(
      `SELECT title, body, tags, created_at FROM customer_notes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [userId]
    ),
    listConversations(userId, { channels: ['chat', 'whatsapp', 'sms', 'rfq'], limit: 60 }),
  ])
  return {
    firstName: user?.first_name || null,
    userType: user?.user_type || null,
    memberSince: toIso(user?.created_at),
    orderCount: Number(orders?.n) || 0,
    lifetimeValue: Number(orders?.ltv) || 0,
    lastOrderAt: toIso(orders?.last_at),
    topProducts: topProducts.map(p => ({
      name: p.name,
      orders: Number(p.orders) || 0,
      quantity: Number(p.quantity) || 0,
    })),
    reviews: reviews.map(r => ({
      rating: r.rating,
      product: r.product,
      title: r.title,
      comment: r.comment,
      at: toIso(r.created_at) || '',
    })),
    notes: notes.map(n => ({
      title: n.title,
      body: n.body,
      tags: Array.isArray(n.tags) ? n.tags : [],
      at: toIso(n.created_at) || '',
    })),
    messages: conversations.items.map(m => ({
      channel: m.channel,
      direction: m.direction,
      body: m.body,
      at: m.at,
      subject: m.subject,
    })),
  }
}

export function buildProfilePrompt(facts: ProfileFacts): { system: string; user: string } {
  const lines: string[] = []
  lines.push(
    `Customer: ${facts.firstName || 'name not recorded'}; account type: ${facts.userType || 'customer'}; member since ${day(facts.memberSince)}.`
  )
  lines.push(
    `Orders: ${facts.orderCount}; lifetime value INR ${Math.round(facts.lifetimeValue).toLocaleString('en-IN')}; last order ${facts.lastOrderAt ? day(facts.lastOrderAt) : 'none'}.`
  )
  lines.push(
    facts.topProducts.length
      ? `Most bought: ${facts.topProducts.map(p => `${p.name} (${p.orders} order${p.orders === 1 ? '' : 's'})`).join('; ')}.`
      : 'Most bought: nothing yet.'
  )
  lines.push('')
  lines.push('Reviews (newest first):')
  lines.push(
    ...(facts.reviews.length
      ? facts.reviews.map(
          r =>
            `- [${day(r.at)}] ${r.rating ?? '?'}/5 ${r.product || 'product'}: ${snippet([r.title, r.comment].filter(Boolean).join(' - '), 240) || 'no text'}`
        )
      : ['- none'])
  )
  lines.push('')
  lines.push('Staff notes (newest first):')
  lines.push(
    ...(facts.notes.length
      ? facts.notes.map(
          n =>
            `- [${day(n.at)}]${n.tags.length ? ` (${n.tags.join(', ')})` : ''} ${snippet([n.title, n.body].filter(Boolean).join(': '))}`
        )
      : ['- none'])
  )
  lines.push('')
  lines.push('Messages (newest first; "in" = customer wrote, "out" = store wrote):')
  lines.push(
    ...(facts.messages.length
      ? facts.messages.map(
          m =>
            `- [${day(m.at)}] ${m.channel} ${m.direction === 'inbound' ? 'in' : 'out'}${m.subject ? ` (${m.subject})` : ''}: ${snippet(m.body) || 'no text'}`
        )
      : ['- none'])
  )
  const system = [
    'You write short internal profiles of retail customers for the store staff who will talk to them next.',
    `Use only the facts provided. Plain text in one or two paragraphs, at most ${MAX_WORDS} words, no headings, bullet points, markdown, greetings or marketing language.`,
    'Cover, in this order: who they are, what they buy, preferences, complaints and open promises the store still owes them, and how to talk to them.',
    'When the facts do not support a point, say so in a few words instead of guessing. Never invent orders, products or dates.',
  ].join(' ')
  return { system, user: lines.join('\n') }
}

export function cleanSummary(raw: string): string {
  const text = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
  const words = text.split(/\s+/)
  return words.length > MAX_WORDS + 20 ? `${words.slice(0, MAX_WORDS + 20).join(' ')}…` : text
}

async function saveSummary(userId: string, summary: string): Promise<string> {
  const updated = await query<{ ai_summary_at: string | Date }>(
    `UPDATE customer_profiles SET ai_summary = $2, ai_summary_at = now(), updated_at = now() WHERE user_id = $1 RETURNING ai_summary_at`,
    [userId, summary]
  )
  if ((updated.rowCount ?? 0) > 0) return toIso(updated.rows[0]?.ai_summary_at) || new Date().toISOString()
  const inserted = await query<{ ai_summary_at: string | Date }>(
    `INSERT INTO customer_profiles (user_id, ai_summary, ai_summary_at) VALUES ($1, $2, now()) RETURNING ai_summary_at`,
    [userId, summary]
  )
  return toIso(inserted.rows[0]?.ai_summary_at) || new Date().toISOString()
}

/** Throws AiClientError when the provider is unavailable; callers map that to 503. */
export async function refreshAiSummary(userId: string): Promise<{ summary: string; generatedAt: string }> {
  const facts = await collectProfileFacts(userId)
  const prompt = buildProfilePrompt(facts)
  const res = await aiChat({
    modelHint: 'fast',
    temperature: 0.3,
    maxTokens: 400,
    noCache: true,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
  })
  const summary = cleanSummary(res.content)
  if (!summary) throw new Error('AI returned an empty profile')
  const generatedAt = await saveSummary(userId, summary)
  return { summary, generatedAt }
}
