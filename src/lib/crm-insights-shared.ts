// Client-safe types, enum constants and guards for CRM insights (no server imports, no SQL).
// crm-insights-sql.ts and crm-insights.ts re-export from here; client components import from here
// so they never pull the server-only db/audit-context chain into the browser bundle.

import type { AnalyticsRange } from './queries'

export const CRM_SEGMENT_KEYS = [
  'vip',
  'loyal',
  'repeat',
  'one_time',
  'new',
  'at_risk',
  'dormant',
  'b2b',
  'lead',
] as const
export type CrmSegmentKey = (typeof CRM_SEGMENT_KEYS)[number]
export type CrmSegment = 'all' | CrmSegmentKey

export const CRM_RANGES: AnalyticsRange[] = ['today', '7d', '30d', '90d', 'month', 'year']

export const isCrmSegment = (v: unknown): v is CrmSegment =>
  v === 'all' || (CRM_SEGMENT_KEYS as readonly string[]).includes(String(v))
export const isCrmRange = (v: unknown): v is AnalyticsRange => (CRM_RANGES as string[]).includes(String(v))

export type AttentionSeverity = 'high' | 'medium' | 'low'
export type AttentionKind =
  | 'vip_churn'
  | 'unanswered_chat'
  | 'unanswered_message'
  | 'low_review'
  | 'address_change'
  | 'return_request'
  | 'overdue_task'

export interface AttentionItem {
  kind: AttentionKind
  label: string
  sub: string
  href: string
  severity: AttentionSeverity
}

export interface Growth {
  newCustomers: number
  returningCustomers: number
  buyers: number
  repeatBuyers: number
  repeatRate: number | null
  medianDaysToSecond: number | null
  churned: number
}

export interface CohortRow {
  cohort: string
  size: number
  retention: (number | null)[]
}

export interface Economics {
  buckets: { label: string; count: number }[]
  topDecileValue: number
  totalValue: number
  aov: number | null
  paidOrders: number
  newRevenue: number
  returningRevenue: number
  avgDaysBetween: number | null
}

export interface SegmentRate {
  key: CrmSegmentKey
  orders: number
  aov: number | null
}
export interface SegmentReturn {
  key: CrmSegmentKey
  orders: number
  returns: number
  returnRate: number | null
}

export interface Health {
  scored: number
  recency: number | null
  frequency: number | null
  monetary: number | null
  engagement: number | null
  satisfaction: number | null
}
export interface HealthTransitions {
  compared: number
  healthyToRising: number
  healthyToHigh: number
  risingToHigh: number
  recovered: number
}
export interface HealthGain {
  id: string
  name: string
  email: string | null
  score: number | null
  delta: number | null
}

export interface Service {
  opened: number
  closed: number
  medianFirstResponseMin: number | null
  medianResolutionMin: number | null
  unansweredChats: number
  unansweredInbound: number
  paidOrders: number
  reviews: number
  avgRating: number | null
}
export interface LowReview {
  id: string
  rating: number
  productName: string | null
  userId: string | null
  name: string
  createdAt: string | null
}

export interface Reach {
  emailSent: number
  emailFailed: number
  whatsappSent: number
  whatsappFailed: number
  smsSent: number
  smsFailed: number
  customers: number
  hasEmail: number
  hasPhone: number
  marketingOptIn: number
  campaignSent: number
  campaignFailed: number
}

export interface Intent {
  abandoned: { label: string; count: number; value: number }[]
  savedForLater: number
  wishlistItems: number
  wishlistInStock: number
}

export interface SearchTerm {
  query: string
  count: number
}

export interface Workload {
  open: number
  overdue: number
  openAuto: number
  medianHours: number | null
}
export interface Assignee {
  id: string | null
  name: string
  open: number
  overdue: number
}
export interface NotesWeek {
  week: string
  count: number
}

export interface B2b {
  pendingApprovals: number
  openRfqs: number
  rfqsInRange: number
  rfqsConverted: number
  conversionRate: number | null
  openQuotes: number
  openQuotesValue: number
  creditCustomers: number
  creditLimitTotal: number
  creditUsed: number
}

export interface GeoRow {
  name: string
  state?: string | null
  customers: number
  revenue: number
}

export interface CrmInsights {
  range: AnalyticsRange
  rangeLabel: string
  segment: CrmSegment
  growth: Growth
  cohorts: CohortRow[]
  economics: Economics
  aovBySegment: SegmentRate[]
  returnRateBySegment: SegmentReturn[]
  health: Health
  healthTransitions: HealthTransitions
  healthGains: HealthGain[]
  service: Service
  lowReviews: LowReview[]
  reach: Reach
  intent: Intent
  topSearches: SearchTerm[]
  workload: Workload
  tasksByAssignee: Assignee[]
  notesPerWeek: NotesWeek[]
  b2b: B2b
  geographyStates: GeoRow[]
  geographyCities: GeoRow[]
  attention: AttentionItem[]
}
