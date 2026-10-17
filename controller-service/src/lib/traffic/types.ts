// Response shapes of GET /api/admin/traffic?tab=… (shared by the route and the tab components).

export const TRAFFIC_TABS = ['overview', 'acquisition', 'behaviour', 'funnel', 'products', 'search', 'audience', 'realtime'] as const
export type TrafficTab = (typeof TRAFFIC_TABS)[number]

export interface PeriodInfo {
  from: string
  to: string
  prevFrom: string
  prevTo: string
  bucket: 'day' | 'week'
}

export interface Attention {
  key: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  sub?: string
  href?: string
}

export interface CoreTotals {
  visitors: number
  sessions: number
  pageviews: number
  bounces: number
  checkoutSessions: number
  convertedSessions: number
  trackedOrders: number
  trackedRevenue: number
  orders: number
  revenue: number
}

export interface ChannelRow {
  channel: string
  label: string
  paid: boolean
  sessions: number
  newVisitors: number
  convertedSessions: number
  orders: number
  revenue: number
}

export interface OverviewData {
  period: PeriodInfo
  current: CoreTotals
  previous: CoreTotals
  trend: { bucket: string; sessions: number; pageviews: number; orders: number }[]
  topSources: ChannelRow[]
  topLanding: { path: string; sessions: number; convertedSessions: number }[]
  topProducts: { productId: string; name: string; views: number }[]
  attention: Attention[]
}

export interface DrillRow {
  key: string
  sessions: number
  convertedSessions: number
  orders: number
  revenue: number
}

export interface AcquisitionData {
  period: PeriodInfo
  channels: ChannelRow[]
  previousChannels: ChannelRow[]
  sourceMedium: DrillRow[]
  campaigns: DrillRow[]
  referrers: DrillRow[]
  paidTrend: { bucket: string; paid: number; organic: number }[]
  totals: { sessions: number; orders: number; revenue: number; attributedOrders: number }
}

export interface PageRow {
  path: string
  views: number
  sessions: number
  entries: number
  exits: number
}

export interface BehaviourData {
  period: PeriodInfo
  pages: PageRow[]
  landing: { path: string; sessions: number; bounces: number; convertedSessions: number; revenue: number }[]
  pageTypes: { page: string; views: number }[]
  depth: { bucket: string; sessions: number }[]
  heatmap: { dow: number; hour: number; views: number }[]
}

export interface FunnelStep {
  key: string
  label: string
  count: number
  prevCount: number
  stepRate: number | null
  prevStepRate: number | null
  overallRate: number | null
  dropOff: number
}

export interface FunnelBreakdownRow {
  key: string
  sessions: number
  product: number
  cart: number
  checkout: number
  placed: number
  paid: number
}

export interface FunnelData {
  period: PeriodInfo
  steps: FunnelStep[]
  byDevice: FunnelBreakdownRow[]
  byChannel: FunnelBreakdownRow[]
  paymentIntents: { started: number; committed: number }
  abandoned: {
    carts: number
    items: number
    value: number
    rows: { userId: string; email: string | null; name: string | null; items: number; value: number; lastAdded: string }[]
  }
}

export interface ProductRow {
  productId: string
  name: string
  slug: string
  views: number
  uniqueViewers: number
  cartAdds: number
  orders: number
  units: number
  revenue: number
  wishlisted: number
  waiting: number
}

export interface ProductsData {
  period: PeriodInfo
  products: ProductRow[]
  opportunities: ProductRow[]
  promote: ProductRow[]
  wishlisted: { productId: string; name: string; count: number }[]
  backInStock: { productId: string; name: string; count: number }[]
}

export interface SearchTerm {
  term: string
  searches: number
  zeroResults: number
  avgResults: number
  searchers: number
  signedInSearchers: number
  clickedSearchers: number
  orderedSearchers: number
}

export interface SearchTotals {
  searches: number
  searchers: number
  zeroResults: number
  signedInSearchers: number
  purchasers: number
}

export interface SearchData {
  period: PeriodInfo
  current: SearchTotals
  previous: SearchTotals
  terms: SearchTerm[]
  zeroTerms: { term: string; searches: number; lastSearched: string }[]
  noEngagement: SearchTerm[]
}

export interface ShareRow {
  key: string
  sessions: number
  convertedSessions: number
}

export interface AudienceData {
  period: PeriodInfo
  devices: ShareRow[]
  browsers: ShareRow[]
  os: ShareRow[]
  newReturning: ShareRow[]
  loggedIn: ShareRow[]
  states: { key: string; orders: number; revenue: number }[]
  cities: { key: string; orders: number; revenue: number }[]
}

export interface RealtimeData {
  at: string
  activeSessions: number
  pageviews: number
  perMinute: { minute: string; views: number }[]
  sessions: { sessionId: string; path: string; page: string; source: string; channel: string; device: string; pageviews: number; lastSeen: string; startedAt: string }[]
  pages: { path: string; sessions: number }[]
  sources: { key: string; sessions: number }[]
  orders: { id: string; orderNumber: string; total: number; status: string; paymentStatus: string; createdAt: string; source: string }[]
}

export type TrafficTabData = {
  overview: OverviewData
  acquisition: AcquisitionData
  behaviour: BehaviourData
  funnel: FunnelData
  products: ProductsData
  search: SearchData
  audience: AudienceData
  realtime: RealtimeData
}

/** Old tab ids land on their replacement; anything else falls back to Overview. */
const LEGACY_TABS: Record<string, TrafficTab> = { sources: 'acquisition', pages: 'behaviour' }

export function parseTab(v: string | null | undefined): TrafficTab {
  if (v && (TRAFFIC_TABS as readonly string[]).includes(v)) return v as TrafficTab
  return (v && LEGACY_TABS[v]) || 'overview'
}
