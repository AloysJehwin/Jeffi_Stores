import type { AnalyticsRange } from './queries'
import { queryOne, queryMany } from './db'
import {
  crmWindow,
  growthSql,
  cohortSql,
  economicsSql,
  aovBySegmentSql,
  returnRateBySegmentSql,
  healthAvgSql,
  healthTransitionsSql,
  healthGainsSql,
  serviceSql,
  lowReviewsSql,
  reachSql,
  intentSql,
  topSearchesSql,
  workloadSql,
  tasksByAssigneeSql,
  notesPerWeekSql,
  b2bSql,
  geographySql,
} from './crm-insights-sql'
import { getCrmAttention } from './crm-insights-attention'
import {
  CRM_SEGMENT_KEYS,
  CRM_RANGES,
  isCrmSegment,
  isCrmRange,
  type CrmSegment,
  type CrmSegmentKey,
  type CrmInsights,
  type Growth,
  type CohortRow,
  type Economics,
  type SegmentRate,
  type SegmentReturn,
  type Health,
  type HealthTransitions,
  type HealthGain,
  type Service,
  type LowReview,
  type Reach,
  type Intent,
  type SearchTerm,
  type Workload,
  type Assignee,
  type NotesWeek,
  type B2b,
  type GeoRow,
  type AttentionItem,
} from './crm-insights-shared'

export { CRM_SEGMENT_KEYS, CRM_RANGES }
export type {
  CrmSegment,
  CrmSegmentKey,
  CrmInsights,
  Growth,
  CohortRow,
  Economics,
  SegmentRate,
  SegmentReturn,
  Health,
  HealthTransitions,
  HealthGain,
  Service,
  LowReview,
  Reach,
  Intent,
  SearchTerm,
  Workload,
  Assignee,
  NotesWeek,
  B2b,
  GeoRow,
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}
const rate = (numer: number, denom: number): number | null => (denom > 0 ? (numer / denom) * 100 : null)

type Row = Record<string, string | null>

const personLabel = (r: Row, fallback = 'Customer') =>
  [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || fallback

function buildCohorts(rows: Row[]): CohortRow[] {
  const map = new Map<string, { size: number; retention: (number | null)[] }>()
  for (const r of rows) {
    const cohort = String(r.cohort ?? '')
    if (!cohort) continue
    if (!map.has(cohort)) map.set(cohort, { size: num(r.size), retention: [null, null, null, null, null, null] })
    const entry = map.get(cohort)!
    entry.size = num(r.size)
    const m = r.m === null || r.m === undefined ? null : Math.trunc(num(r.m))
    if (m !== null && m >= 0 && m <= 5) {
      entry.retention[m] = entry.size > 0 ? (num(r.active) / entry.size) * 100 : null
    }
  }
  return [...map.entries()].map(([cohort, v]) => ({ cohort, size: v.size, retention: v.retention }))
}

function buildEconomics(r: Row | null): Economics {
  return {
    buckets: [
      { label: 'Under Rs 1k', count: num(r?.b_lt_1k) },
      { label: 'Rs 1k to 5k', count: num(r?.b_1k_5k) },
      { label: 'Rs 5k to 25k', count: num(r?.b_5k_25k) },
      { label: 'Rs 25k to 1L', count: num(r?.b_25k_1l) },
      { label: 'Rs 1L and above', count: num(r?.b_gte_1l) },
    ],
    topDecileValue: num(r?.top_decile_value),
    totalValue: num(r?.total_value),
    aov: numOrNull(r?.aov),
    paidOrders: num(r?.paid_orders),
    newRevenue: num(r?.new_revenue),
    returningRevenue: num(r?.returning_revenue),
    avgDaysBetween: numOrNull(r?.avg_days_between),
  }
}

function buildSegmentAov(r: Row | null): SegmentRate[] {
  if (!r) return []
  return CRM_SEGMENT_KEYS.map(key => ({
    key,
    orders: num(r[`${key}_orders`]),
    aov: numOrNull(r[`${key}_aov`]),
  })).filter(s => s.orders > 0)
}

function buildSegmentReturns(r: Row | null): SegmentReturn[] {
  if (!r) return []
  return CRM_SEGMENT_KEYS.map(key => {
    const orders = num(r[`${key}_orders`])
    const returns = num(r[`${key}_returns`])
    return { key, orders, returns, returnRate: rate(returns, orders) }
  }).filter(s => s.orders > 0 || s.returns > 0)
}

function buildIntent(r: Row | null): Intent {
  return {
    abandoned: [
      { label: '1 to 3 days', count: num(r?.a_1_3), value: num(r?.v_1_3) },
      { label: '3 to 7 days', count: num(r?.a_3_7), value: num(r?.v_3_7) },
      { label: 'Over 7 days', count: num(r?.a_7p), value: num(r?.v_7p) },
    ],
    savedForLater: num(r?.saved_for_later),
    wishlistItems: num(r?.wishlist_items),
    wishlistInStock: num(r?.wishlist_in_stock),
  }
}

export async function getCrmInsights({
  range,
  segment,
}: {
  range: AnalyticsRange
  segment: CrmSegment
}): Promise<CrmInsights> {
  const r: AnalyticsRange = isCrmRange(range) ? range : '30d'
  const s: CrmSegment = isCrmSegment(segment) ? segment : 'all'
  const w = crmWindow(r)

  const [
    growth,
    cohortRows,
    economics,
    aovSeg,
    returnSeg,
    health,
    transitions,
    gains,
    service,
    lowReviews,
    reach,
    intent,
    searches,
    workload,
    assignees,
    notes,
    b2b,
    geoStates,
    geoCities,
    attention,
  ] = await Promise.all([
    queryOne<Row>(growthSql(w, s)),
    queryMany<Row>(cohortSql(s)),
    queryOne<Row>(economicsSql(w, s)),
    queryOne<Row>(aovBySegmentSql(w)),
    queryOne<Row>(returnRateBySegmentSql(w)),
    queryOne<Row>(healthAvgSql(s)),
    queryOne<Row>(healthTransitionsSql(s)),
    queryMany<Row>(healthGainsSql(s)),
    queryOne<Row>(serviceSql(w, s)),
    queryMany<Row>(lowReviewsSql(w.startExpr, s, 8)),
    queryOne<Row>(reachSql(w, s)),
    queryOne<Row>(intentSql(s)),
    queryMany<Row>(topSearchesSql(w, s)),
    queryOne<Row>(workloadSql(w, s)),
    queryMany<Row>(tasksByAssigneeSql(s)),
    queryMany<Row>(notesPerWeekSql(s)),
    queryOne<Row>(b2bSql(w)),
    queryMany<Row>(geographySql(w, s, 'state')),
    queryMany<Row>(geographySql(w, s, 'city')),
    getCrmAttention(20),
  ])

  const buyers = num(growth?.buyers)
  const returning = num(growth?.returning_customers)

  const rfqsInRange = num(b2b?.rfqs_in_range)

  return {
    range: r,
    rangeLabel: w.label,
    segment: s,
    growth: {
      newCustomers: num(growth?.new_customers),
      returningCustomers: returning,
      buyers,
      repeatBuyers: num(growth?.repeat_buyers),
      repeatRate: rate(returning, buyers),
      medianDaysToSecond: numOrNull(growth?.median_days_to_second),
      churned: num(growth?.churned),
    },
    cohorts: buildCohorts(cohortRows),
    economics: buildEconomics(economics),
    aovBySegment: buildSegmentAov(aovSeg),
    returnRateBySegment: buildSegmentReturns(returnSeg),
    health: {
      scored: num(health?.scored),
      recency: numOrNull(health?.recency),
      frequency: numOrNull(health?.frequency),
      monetary: numOrNull(health?.monetary),
      engagement: numOrNull(health?.engagement),
      satisfaction: numOrNull(health?.satisfaction),
    },
    healthTransitions: {
      compared: num(transitions?.compared),
      healthyToRising: num(transitions?.healthy_to_rising),
      healthyToHigh: num(transitions?.healthy_to_high),
      risingToHigh: num(transitions?.rising_to_high),
      recovered: num(transitions?.recovered),
    },
    healthGains: gains.map(g => ({
      id: String(g.id),
      name: personLabel(g),
      email: g.email,
      score: numOrNull(g.score),
      delta: numOrNull(g.trend_delta_30d),
    })),
    service: {
      opened: num(service?.opened),
      closed: num(service?.closed),
      medianFirstResponseMin: numOrNull(service?.median_first_response_min),
      medianResolutionMin: numOrNull(service?.median_resolution_min),
      unansweredChats: num(service?.unanswered_chats),
      unansweredInbound: num(service?.unanswered_inbound),
      paidOrders: num(service?.paid_orders),
      reviews: num(service?.reviews),
      avgRating: numOrNull(service?.avg_rating),
    },
    lowReviews: lowReviews.map(lr => ({
      id: String(lr.id),
      rating: num(lr.rating),
      productName: lr.product_name,
      userId: lr.user_id,
      name: personLabel(lr),
      createdAt: lr.created_at,
    })),
    reach: {
      emailSent: num(reach?.email_sent),
      emailFailed: num(reach?.email_failed),
      whatsappSent: num(reach?.whatsapp_sent),
      whatsappFailed: num(reach?.whatsapp_failed),
      smsSent: num(reach?.sms_sent),
      smsFailed: num(reach?.sms_failed),
      customers: num(reach?.customers),
      hasEmail: num(reach?.has_email),
      hasPhone: num(reach?.has_phone),
      marketingOptIn: num(reach?.marketing_opt_in),
      campaignSent: num(reach?.campaign_sent),
      campaignFailed: num(reach?.campaign_failed),
    },
    intent: buildIntent(intent),
    topSearches: searches.map(t => ({ query: String(t.q ?? ''), count: num(t.n) })),
    workload: {
      open: num(workload?.open),
      overdue: num(workload?.overdue),
      openAuto: num(workload?.open_auto),
      medianHours: numOrNull(workload?.median_hours),
    },
    tasksByAssignee: assignees.map(a => ({
      id: a.assigned_to,
      name: [a.first_name, a.last_name].filter(Boolean).join(' ') || 'Unassigned',
      open: num(a.open),
      overdue: num(a.overdue),
    })),
    notesPerWeek: notes.map(n => ({ week: String(n.week ?? ''), count: num(n.n) })),
    b2b: {
      pendingApprovals: num(b2b?.pending_approvals),
      openRfqs: num(b2b?.open_rfqs),
      rfqsInRange,
      rfqsConverted: num(b2b?.rfqs_converted),
      conversionRate: rate(num(b2b?.rfqs_converted), rfqsInRange),
      openQuotes: num(b2b?.open_quotes),
      openQuotesValue: num(b2b?.open_quotes_value),
      creditCustomers: num(b2b?.credit_customers),
      creditLimitTotal: num(b2b?.credit_limit_total),
      creditUsed: num(b2b?.credit_used),
    },
    geographyStates: geoStates.map(g => ({
      name: String(g.name ?? ''),
      customers: num(g.customers),
      revenue: num(g.revenue),
    })),
    geographyCities: geoCities.map(g => ({
      name: String(g.name ?? ''),
      state: g.state,
      customers: num(g.customers),
      revenue: num(g.revenue),
    })),
    attention,
  }
}
