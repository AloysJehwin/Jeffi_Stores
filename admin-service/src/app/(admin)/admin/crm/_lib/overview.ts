// Shape of GET /api/admin/crm/overview and the pure builders behind it (client-safe).
import type { Bucket, Period } from './period'

export interface CrmKpis {
  totalCustomers: number
  newCustomers: number
  activeCustomers: number
  firstTimeBuyers: number
  repeatCustomers: number
  orders: number
  revenue: number
  buyersToDate: number
  lifetimeRevenue: number
  atRisk: number
  churned: number
  repeatRate: number | null
  aov: number | null
  revenuePerCustomer: number | null
  avgClv: number | null
}

export interface TrendRow {
  label: string
  newRevenue: number
  returningRevenue: number
  newBuyers: number
  returningBuyers: number
}

export interface CohortRow {
  cohort: string
  size: number
  /** Share (0..1) of the cohort ordering again in months 1..6; null when that month has not happened yet. */
  retention: (number | null)[]
}

export interface TopCustomer {
  id: string
  name: string
  email: string | null
  orders: number
  revenue: number
  lifetimeOrders: number
  ltv: number
  firstAt: string | null
  lastAt: string | null
  healthScore: number | null
  churnRisk: string | null
}

export interface OverviewAttention {
  key: string
  severity: 'high' | 'medium' | 'low'
  label: string
  sub: string
  href: string
}

export interface CrmOverviewData {
  period: Period
  previous: Period
  bucket: Bucket
  current: CrmKpis
  prior: CrmKpis
  trend: TrendRow[]
  cohorts: CohortRow[]
  topCustomers: TopCustomer[]
  attention: OverviewAttention[]
}

type Row = Record<string, unknown>
export const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const ratio = (a: number, b: number) => (b > 0 ? a / b : null)

export function toKpis(r: Row | null | undefined): CrmKpis {
  const k = {
    totalCustomers: num(r?.total_customers),
    newCustomers: num(r?.new_customers),
    activeCustomers: num(r?.active_customers),
    firstTimeBuyers: num(r?.first_time_buyers),
    repeatCustomers: num(r?.repeat_customers),
    orders: num(r?.orders),
    revenue: num(r?.revenue),
    buyersToDate: num(r?.buyers_to_date),
    lifetimeRevenue: num(r?.lifetime_revenue),
    atRisk: num(r?.at_risk),
    churned: num(r?.churned),
  }
  return {
    ...k,
    repeatRate: ratio(k.repeatCustomers, k.activeCustomers),
    aov: ratio(k.revenue, k.orders),
    revenuePerCustomer: ratio(k.revenue, k.activeCustomers),
    avgClv: ratio(k.lifetimeRevenue, k.buyersToDate),
  }
}

export function toTrend(rows: Row[]): TrendRow[] {
  return rows.map(r => ({
    label: String(r.label),
    newRevenue: num(r.new_revenue),
    returningRevenue: num(r.returning_revenue),
    newBuyers: num(r.new_buyers),
    returningBuyers: num(r.returning_buyers),
  }))
}

const monthIndex = (ym: string) => +ym.slice(0, 4) * 12 + (+ym.slice(5, 7) - 1)

/** Rows are (cohort YYYY-MM, size, k, active) with k in 1..6 or null; `currentMonth` is YYYY-MM. */
export function buildCohorts(rows: Row[], currentMonth: string, months = 6): CohortRow[] {
  const map = new Map<string, CohortRow>()
  const now = monthIndex(currentMonth)
  for (const r of rows) {
    const cohort = String(r.cohort ?? '')
    if (!cohort) continue
    let entry = map.get(cohort)
    if (!entry) {
      const size = num(r.size)
      const start = monthIndex(cohort)
      entry = {
        cohort,
        size,
        retention: Array.from({ length: months }, (_, i) => (start + i + 1 <= now ? 0 : null)),
      }
      map.set(cohort, entry)
    }
    const k = r.k == null ? null : num(r.k)
    if (k != null && k >= 1 && k <= months && entry.retention[k - 1] != null && entry.size > 0) {
      entry.retention[k - 1] = num(r.active) / entry.size
    }
  }
  return [...map.values()].sort((a, b) => a.cohort.localeCompare(b.cohort))
}

const personName = (r: Row) =>
  [r.first_name, r.last_name].filter(Boolean).join(' ') || (r.email as string) || 'Customer'

export function toTopCustomers(rows: Row[]): TopCustomer[] {
  const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v))
  return rows.map(r => ({
    id: String(r.id),
    name: personName(r),
    email: (r.email as string) ?? null,
    orders: num(r.orders),
    revenue: num(r.revenue),
    lifetimeOrders: num(r.lifetime_orders),
    ltv: num(r.ltv),
    firstAt: iso(r.first_at),
    lastAt: iso(r.last_at),
    healthScore: r.health_score == null ? null : num(r.health_score),
    churnRisk: (r.churn_risk as string) ?? null,
  }))
}

export interface AttentionCounts {
  highValueQuiet: number
  highValueQuietLtv: number
  noSecondOrder: number
  criticalNoTask: number
  newLeads: number
}

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-IN')}`
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`
const RANK = { high: 0, medium: 1, low: 2 } as const

export function buildAttention(c: AttentionCounts, cur: CrmKpis, prev: CrmKpis): OverviewAttention[] {
  const out: OverviewAttention[] = []
  if (c.highValueQuiet > 0)
    out.push({
      key: 'high_value_quiet',
      severity: 'high',
      label: `${plural(c.highValueQuiet, 'high-value customer has', 'high-value customers have')} gone quiet`,
      sub: `${rs(c.highValueQuietLtv)} lifetime value, no order in 90 to 180 days`,
      href: '/admin/customers?segment=at_risk',
    })
  if (c.criticalNoTask > 0)
    out.push({
      key: 'critical_no_task',
      severity: 'high',
      label: `${plural(c.criticalNoTask, 'customer', 'customers')} in critical health with no open task`,
      sub: 'Health score below 40; assign a follow-up',
      href: '/admin/customers?health=critical',
    })
  if (c.noSecondOrder > 0)
    out.push({
      key: 'no_second_order',
      severity: 'medium',
      label: `${plural(c.noSecondOrder, 'first-time buyer has', 'first-time buyers have')} not ordered again`,
      sub: 'First order 30 to 90 days ago',
      href: '/admin/customers?segment=one_time',
    })
  if (prev.activeCustomers >= 5 && cur.activeCustomers < prev.activeCustomers * 0.8)
    out.push({
      key: 'active_drop',
      severity: 'medium',
      label: `Active customers down ${Math.round((1 - cur.activeCustomers / prev.activeCustomers) * 100)}% vs previous period`,
      sub: `${cur.activeCustomers} ordered this period against ${prev.activeCustomers} before; consider a win-back campaign`,
      href: '/admin/campaigns',
    })
  if (prev.repeatRate != null && cur.repeatRate != null && prev.activeCustomers >= 5 && cur.repeatRate < prev.repeatRate - 0.1)
    out.push({
      key: 'repeat_drop',
      severity: 'medium',
      label: `Repeat purchase rate fell to ${Math.round(cur.repeatRate * 100)}%`,
      sub: `From ${Math.round(prev.repeatRate * 100)}% in the previous period`,
      href: '/admin/customers?segment=one_time',
    })
  if (c.newLeads > 0)
    out.push({
      key: 'new_leads',
      severity: 'low',
      label: `${plural(c.newLeads, 'new sign-up has', 'new sign-ups have')} not ordered yet`,
      sub: 'Joined in the last 14 days',
      href: '/admin/customers?segment=lead',
    })
  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity])
}
