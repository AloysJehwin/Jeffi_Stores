import type { FilterScope } from '@jeffi/list-filters'
import { queryMany, queryOne } from '@/lib/shared/db'
import { bucketFor, ratio, type Period } from '@/lib/overview/period'
import type { AttentionItem } from '@/lib/overview/attention'
import {
  bucketOf,
  bucketSeriesSql,
  hoursBetween,
  kpi,
  n,
  nn,
  periodSql,
  plural,
  snapshot,
  type OverviewKpi,
} from './ops-kpi'

// B2B RFQ overview. Received/converted are by RFQ created date; quoted is the converted
// quotation's total and won the order that quotation turned into (cancelled orders excluded).

export const OPEN_RFQ_STATUSES = ['pending', 'reviewed', 'negotiating', 'offer_accepted'] as const
const OPEN = `('pending', 'reviewed', 'negotiating', 'offer_accepted')`
const INACTIVE_ORDER = `('cancelled', 'returned', 'draft', 'cancel_rejected')`
export const STALE_QUOTE_DAYS = 14

/** `f`: list filters on r. */
const rfqSql = (f = '') => `
  SELECT r.id, r.user_id, r.status, r.created_at, r.reviewed_at,
    (SELECT MIN(m.created_at) FROM rfq_messages m WHERE m.rfq_id = r.id AND m.sender = 'admin') AS first_reply,
    q.total_amount AS quoted, q.converted_order_id, o.total_amount AS won
  FROM business_rfqs r
  LEFT JOIN quotations q ON q.id = r.converted_quotation_id
  LEFT JOIN orders o ON o.id = q.converted_order_id AND o.status NOT IN ${INACTIVE_ORDER}${f ? ` WHERE TRUE${f}` : ''}`

const totals = (a = '') => `
  COUNT(*) AS received,
  COUNT(*) FILTER (WHERE ${a}status = 'converted') AS converted,
  COUNT(*) FILTER (WHERE ${a}status = 'rejected') AS rejected,
  COUNT(*) FILTER (WHERE ${a}won IS NOT NULL) AS won,
  COALESCE(SUM(${a}quoted), 0) AS quoted_value,
  COALESCE(SUM(${a}won), 0) AS won_value,
  AVG(EXTRACT(EPOCH FROM (LEAST(${a}first_reply, ${a}reviewed_at) - ${a}created_at)) / 3600) AS response_hours`

export interface RfqTotals {
  received: number
  converted: number
  rejected: number
  won: number
  quoted_value: number
  won_value: number
  conversion_rate: number | null
  response_hours: number | null
}

export function rfqTotals(r: Record<string, unknown> | null | undefined): RfqTotals {
  const received = n(r?.received)
  const converted = n(r?.converted)
  return {
    received,
    converted,
    rejected: n(r?.rejected),
    won: n(r?.won),
    quoted_value: n(r?.quoted_value),
    won_value: n(r?.won_value),
    conversion_rate: ratio(converted, received),
    response_hours: nn(r?.response_hours),
  }
}

export interface AwaitingRfq {
  id: string
  rfq_number: string
  status: string
  company_name: string | null
  waiting_since: string
}

export function rfqAttention(
  awaiting: AwaitingRfq[],
  offerAccepted: number,
  staleQuotes: number,
  now = new Date()
): AttentionItem[] {
  const out: AttentionItem[] = []
  const hrs = awaiting.map(a => hoursBetween(a.waiting_since, now) ?? 0)
  const over3d = hrs.filter(h => h > 72).length
  const over1d = hrs.filter(h => h > 24).length
  if (over1d) {
    const oldest = awaiting[hrs.indexOf(Math.max(...hrs))]
    out.push({
      key: 'awaiting',
      severity: over3d ? 'critical' : 'warning',
      title: `${plural(over1d, 'RFQ')} waiting over a day for a reply`,
      sub: `Oldest: ${oldest.rfq_number}${oldest.company_name ? ` from ${oldest.company_name}` : ''}`,
      href: `/admin/business/rfqs/${oldest.id}/view`,
    })
  } else if (awaiting.length) {
    out.push({
      key: 'awaiting',
      severity: 'info',
      title: `${plural(awaiting.length, 'RFQ')} waiting for a reply`,
      href: '/admin/business/rfqs?tab=list&status=pending',
    })
  }
  if (offerAccepted)
    out.push({
      key: 'offer_accepted',
      severity: 'warning',
      title: `${plural(offerAccepted, 'accepted offer')} to turn into a quotation`,
      href: '/admin/business/rfqs?tab=list&status=offer_accepted',
    })
  if (staleQuotes)
    out.push({
      key: 'stale_quotes',
      severity: 'info',
      title: `${plural(staleQuotes, 'RFQ quotation')} not ordered after ${STALE_QUOTE_DAYS} days`,
      sub: 'Follow up with the buyer',
      href: '/admin/business/rfqs?tab=list&status=converted',
    })
  return out
}

/** `scope`: the RFQ list's filters, except its date. Unfiltered, every query is unchanged. */
export async function getRfqOverview(period: Period, now = new Date(), scope?: FilterScope) {
  const ps = periodSql(period)
  const bucket = bucketFor(period)
  const on = !!scope && !scope.empty
  const at = (start: number) => (on ? scope!.and(start) : { sql: '', params: [] as unknown[] })
  const sp = at(ps.params.length + 1)
  const s2 = at(3)
  const s0 = at(1)
  // Unaliased snapshot queries take the alias only when filtered.
  const rfqs = on ? `business_rfqs r WHERE TRUE${s0.sql}` : 'business_rfqs'
  const a0 = (on ? [s0.params] : []) as [] | [unknown[]]
  const [rows, open, byStatus, series, top, awaiting, stale] = await Promise.all([
    queryMany<Record<string, unknown>>(
      `SELECT CASE WHEN ${ps.cur('created_at')} THEN 'cur' ELSE 'prev' END AS p, ${totals()}
       FROM (${rfqSql(sp.sql)}) r WHERE ${ps.span('created_at')} GROUP BY 1`,
      [...ps.params, ...sp.params]
    ),
    queryOne<Record<string, unknown>>(
      `SELECT COUNT(*) FILTER (WHERE status IN ${OPEN}) AS open,
              COUNT(*) FILTER (WHERE status = 'offer_accepted') AS offer_accepted
       FROM ${rfqs}`,
      ...a0
    ),
    queryMany<{ status: string; count: string }>(
      `SELECT status, COUNT(*) AS count FROM ${rfqs} GROUP BY 1 ORDER BY 2 DESC`,
      ...a0
    ),
    queryMany<Record<string, unknown>>(
      `WITH s AS (${bucketSeriesSql(bucket)})
       SELECT s.b::text AS label, COUNT(r.id) AS received, COUNT(r.id) FILTER (WHERE r.status = 'converted') AS converted
       FROM s LEFT JOIN business_rfqs r ON ${bucketOf('r.created_at', bucket)} = s.b AND ${ps.cur('r.created_at')}${s2.sql}
       GROUP BY s.b ORDER BY s.b`,
      [...ps.params.slice(0, 2), ...s2.params]
    ),
    queryMany<Record<string, unknown>>(
      `SELECT r.user_id, COALESCE(bp.company_name, u.email) AS name, ${totals('r.')}
       FROM (${rfqSql(s2.sql)}) r JOIN users u ON u.id = r.user_id LEFT JOIN business_profiles bp ON bp.user_id = r.user_id
       WHERE ${ps.cur('r.created_at')}
       GROUP BY r.user_id, bp.company_name, u.email
       ORDER BY won_value DESC, quoted_value DESC, received DESC LIMIT 8`,
      [...ps.params.slice(0, 2), ...s2.params]
    ),
    // Open RFQs whose last word is the customer's (or that nobody has answered yet).
    queryMany<AwaitingRfq>(
      `SELECT r.id, r.rfq_number, r.status, bp.company_name,
              COALESCE(lm.created_at, r.created_at) AS waiting_since
       FROM business_rfqs r
       LEFT JOIN business_profiles bp ON bp.user_id = r.user_id
       LEFT JOIN LATERAL (SELECT m.sender, m.created_at FROM rfq_messages m WHERE m.rfq_id = r.id ORDER BY m.created_at DESC LIMIT 1) lm ON true
       WHERE r.status IN ${OPEN}
         AND (lm.sender = 'customer' OR (lm.sender IS NULL AND r.status = 'pending'))${s0.sql}
       ORDER BY waiting_since ASC LIMIT 20`,
      ...a0
    ),
    queryOne<{ n: string }>(
      `SELECT COUNT(*) AS n FROM business_rfqs r JOIN quotations q ON q.id = r.converted_quotation_id
       WHERE r.status = 'converted' AND q.converted_order_id IS NULL
         AND q.created_at < now() - interval '${STALE_QUOTE_DAYS} days'${s0.sql}`,
      ...a0
    ),
  ])

  const current = rfqTotals(rows.find(r => r.p === 'cur'))
  const previous = rfqTotals(rows.find(r => r.p === 'prev'))
  const offerAccepted = n(open?.offer_accepted)

  const kpis: OverviewKpi[] = [
    kpi('received', 'RFQs received', current.received, previous.received, 'count'),
    snapshot('open', 'Open RFQs', n(open?.open), 'count'),
    snapshot('awaiting', 'Awaiting reply', awaiting.length, 'count', { invert: true }),
    kpi('response', 'Avg first response', current.response_hours, previous.response_hours, 'hours', { invert: true }),
    kpi('conversion', 'Converted to quote', current.conversion_rate, previous.conversion_rate, 'pct', {
      sub: `${current.converted} of ${current.received}`,
    }),
    kpi('quoted', 'Quoted value', current.quoted_value, previous.quoted_value, 'money'),
    kpi('won', 'Won value', current.won_value, previous.won_value, 'money', { sub: `${plural(current.won, 'order')}` }),
    kpi('rejected', 'Rejected', current.rejected, previous.rejected, 'count', { invert: true }),
  ]

  return {
    range: period,
    previous_range: ps.previous,
    bucket,
    kpis,
    current,
    previous,
    by_status: byStatus.map(s => ({ status: s.status, count: n(s.count) })),
    series: series.map(s => ({ label: String(s.label), received: n(s.received), converted: n(s.converted) })),
    top_customers: top.map(t => ({ user_id: String(t.user_id), name: String(t.name ?? ''), ...rfqTotals(t) })),
    awaiting: awaiting.slice(0, 8).map(a => ({ ...a, waiting_hours: hoursBetween(a.waiting_since, now) })),
    attention: rfqAttention(awaiting, offerAccepted, n(stale?.n), now),
    filtered: on,
  }
}
