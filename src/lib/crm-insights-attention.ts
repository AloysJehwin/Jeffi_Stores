import { queryMany } from './db'
import {
  CUSTOMER_AGG_CTE, CUSTOMER_SENDERS, OPEN_TASK, SEGMENT_PREDICATES, SESSION_STATE_CTE, UNANSWERED_INBOUND_WHERE, lowReviewsSql,
} from './crm-insights-sql'
import type { AttentionItem, AttentionKind, AttentionSeverity } from './crm-insights-shared'

export type { AttentionItem, AttentionKind, AttentionSeverity }

type Person = { first_name: string | null; last_name: string | null; email: string | null }

export const personName = (p: Person, fallback = 'Customer') =>
  [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || fallback

const DAY = 86_400_000
export function daysSince(iso: string | null | undefined, now = Date.now()): number {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((now - t) / DAY))
}
const agoStr = (iso: string | null | undefined) => {
  const d = daysSince(iso)
  return d === 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`
}
const rsStr = (n: number) => `Rs ${Math.round(n).toLocaleString('en-IN')}`

const SEVERITY_RANK: Record<AttentionSeverity, number> = { high: 0, medium: 1, low: 2 }

const vipChurnSql = `
WITH ${CUSTOMER_AGG_CTE}, vips AS (SELECT id, ltv FROM agg WHERE ${SEGMENT_PREDICATES.vip})
SELECT u.id, u.first_name, u.last_name, u.email, v.ltv, ch.score
  FROM vips v JOIN users u ON u.id = v.id JOIN customer_health ch ON ch.user_id = v.id
 WHERE ch.churn_risk = 'high'
 ORDER BY v.ltv DESC LIMIT 10
`

const unansweredChatsSql = `
WITH ${SESSION_STATE_CTE}
SELECT ss.id, ss.user_id, ss.last_customer, u.first_name, u.last_name, u.email
  FROM sess ss LEFT JOIN users u ON u.id = ss.user_id
 WHERE ss.status = 'open' AND ss.last_sender IN ${CUSTOMER_SENDERS} AND ss.last_customer < NOW() - INTERVAL '24 hours'
 ORDER BY ss.last_customer ASC LIMIT 10
`

const unansweredMessagesSql = `
SELECT DISTINCT ON (COALESCE(ml.user_id::text, ml.from_number))
       ml.id, ml.user_id, ml.channel, ml.from_number, ml.sent_at, u.first_name, u.last_name, u.email
  FROM message_logs ml LEFT JOIN users u ON u.id = ml.user_id
 WHERE ${UNANSWERED_INBOUND_WHERE} AND ml.sent_at < NOW() - INTERVAL '24 hours'
 ORDER BY COALESCE(ml.user_id::text, ml.from_number), ml.sent_at DESC LIMIT 10
`

const addressChangesSql = `
SELECT acr.id, acr.order_id, acr.created_at, o.order_number, o.customer_name, u.first_name, u.last_name, u.email
  FROM address_change_requests acr
  JOIN orders o ON o.id = acr.order_id
  LEFT JOIN users u ON u.id = acr.requested_by_user_id
 WHERE acr.status = 'pending'
 ORDER BY acr.created_at ASC LIMIT 10
`

const pendingReturnsSql = `
SELECT rr.id, rr.order_id, rr.type, rr.created_at, o.order_number, o.customer_name, u.first_name, u.last_name, u.email
  FROM return_requests rr
  LEFT JOIN orders o ON o.id = rr.order_id
  LEFT JOIN users u ON u.id = rr.user_id
 WHERE rr.status = 'pending_approval'
 ORDER BY rr.created_at ASC LIMIT 10
`

const overdueTasksSql = `
SELECT ct.id, ct.title, ct.due_date, ct.user_id, u.first_name, u.last_name, u.email
  FROM customer_tasks ct JOIN users u ON u.id = ct.user_id
 WHERE ${OPEN_TASK} AND ct.due_date < CURRENT_DATE
 ORDER BY ct.due_date ASC LIMIT 10
`

type Row = Record<string, string | null>

export async function getCrmAttention(limit = 20): Promise<AttentionItem[]> {
  const [vips, chats, messages, reviews, addresses, returns, tasks] = await Promise.all([
    queryMany<Row>(vipChurnSql),
    queryMany<Row>(unansweredChatsSql),
    queryMany<Row>(unansweredMessagesSql),
    queryMany<Row>(lowReviewsSql("NOW() - INTERVAL '30 days'", 'all', 10)),
    queryMany<Row>(addressChangesSql),
    queryMany<Row>(pendingReturnsSql),
    queryMany<Row>(overdueTasksSql),
  ])

  const items: AttentionItem[] = [
    ...vips.map(r => ({
      kind: 'vip_churn' as const, severity: 'high' as const,
      label: personName(r as Person),
      sub: `VIP at high churn risk, LTV ${rsStr(parseFloat(r.ltv || '0'))}, health ${r.score ?? 'n/a'}`,
      href: `/admin/customers/${r.id}`,
    })),
    ...chats.map(r => ({
      kind: 'unanswered_chat' as const, severity: 'high' as const,
      label: personName(r as Person, 'Anonymous chat'),
      sub: `Chat waiting for a reply since ${agoStr(r.last_customer)}`,
      href: r.user_id ? `/admin/customers/${r.user_id}?chat=true` : '/admin/customers',
    })),
    ...messages.map(r => ({
      kind: 'unanswered_message' as const, severity: 'high' as const,
      label: personName(r as Person, r.from_number || 'Unknown number'),
      sub: `Inbound ${r.channel || 'message'} unanswered since ${agoStr(r.sent_at)}`,
      href: r.user_id ? `/admin/customers/${r.user_id}` : '/admin/customers',
    })),
    ...reviews.map(r => ({
      kind: 'low_review' as const, severity: 'medium' as const,
      label: `${r.rating} star review on ${r.product_name || 'a product'}`,
      sub: `${personName(r as Person)}, ${agoStr(r.created_at)}`,
      href: r.user_id ? `/admin/customers/${r.user_id}` : '/admin/reviews?filter=all',
    })),
    ...addresses.map(r => ({
      kind: 'address_change' as const, severity: 'medium' as const,
      label: `Address change on #${r.order_number || String(r.order_id).slice(0, 8)}`,
      sub: `${personName(r as Person, r.customer_name || 'Customer')}, requested ${agoStr(r.created_at)}`,
      href: `/admin/orders/${r.order_id}`,
    })),
    ...returns.map(r => ({
      kind: 'return_request' as const, severity: 'medium' as const,
      label: `${r.type === 'replacement' ? 'Replacement' : 'Return'} on #${r.order_number || String(r.order_id || '').slice(0, 8)}`,
      sub: `${personName(r as Person, r.customer_name || 'Customer')}, pending approval since ${agoStr(r.created_at)}`,
      href: r.order_id ? `/admin/orders/${r.order_id}` : '/admin/returns',
    })),
    ...tasks.map(r => ({
      kind: 'overdue_task' as const, severity: 'low' as const,
      label: r.title || 'Task',
      sub: `${personName(r as Person)}, due ${agoStr(r.due_date)}`,
      href: `/admin/customers/${r.user_id}`,
    })),
  ]

  return items
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, limit)
}
