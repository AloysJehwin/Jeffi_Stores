import type { Attention, FunnelStep, PeriodInfo } from './types'

// Response shapes of a Showcase's analytics (GET /api/ecom/showcase/<siteId>/analytics?tab=…): the admin Traffic tabs
// that fit a one-page lead site, plus Leads. A session "converts" when it sent an enquiry through the form or tapped
// to call, WhatsApp or email.

export const SHOWCASE_TABS = ['overview', 'acquisition', 'behaviour', 'funnel', 'leads', 'audience', 'realtime'] as const
export type ShowcaseTab = (typeof SHOWCASE_TABS)[number]

export function parseShowcaseTab(v: string | null | undefined): ShowcaseTab {
  return v && (SHOWCASE_TABS as readonly string[]).includes(v) ? (v as ShowcaseTab) : 'overview'
}

export interface ShowcaseTotals {
  visitors: number
  sessions: number
  newVisitors: number
  pageviews: number
  engagedSessions: number
  engagedMs: number
  scrollSum: number
  contactSessions: number
  formStarts: number
  formSubmits: number
  leadSessions: number
  convertedSessions: number
  /** Every enquiry received in the period, with or without a tracked visit. */
  leads: number
}

export interface ShowcaseChannelRow {
  channel: string
  label: string
  paid: boolean
  sessions: number
  newVisitors: number
  convertedSessions: number
  leads: number
}

export interface ShowcaseDrillRow {
  key: string
  sessions: number
  convertedSessions: number
  leads: number
}

export interface ClickRow {
  target: string
  clicks: number
  sessions: number
}

export interface ShowcaseOverview {
  period: PeriodInfo
  current: ShowcaseTotals
  previous: ShowcaseTotals
  trend: { bucket: string; sessions: number; pageviews: number; leads: number; contacts: number }[]
  topSources: ShowcaseChannelRow[]
  topReferrers: ShowcaseDrillRow[]
  clicks: ClickRow[]
  unreadLeads: number
  attention: Attention[]
}

export interface ShowcaseAcquisition {
  period: PeriodInfo
  channels: ShowcaseChannelRow[]
  previousChannels: ShowcaseChannelRow[]
  sourceMedium: ShowcaseDrillRow[]
  campaigns: ShowcaseDrillRow[]
  terms: ShowcaseDrillRow[]
  contents: ShowcaseDrillRow[]
  referrers: ShowcaseDrillRow[]
  paidTrend: { bucket: string; paid: number; organic: number }[]
  totals: { sessions: number; leads: number; linkedLeads: number; taggedSessions: number }
}

export interface ShowcaseBehaviour {
  period: PeriodInfo
  scroll: { bucket: string; sessions: number }[]
  engagement: { bucket: string; sessions: number }[]
  clicks: ClickRow[]
  links: { target: string; label: string; clicks: number; sessions: number }[]
  landing: { path: string; sessions: number; engaged: number; convertedSessions: number; leads: number }[]
  pages: { path: string; views: number; sessions: number }[]
  heatmap: { dow: number; hour: number; views: number }[]
}

export interface ShowcaseFunnelRow {
  key: string
  sessions: number
  engaged: number
  contact: number
  formStarted: number
  formSubmitted: number
  lead: number
}

export interface ShowcaseFunnel {
  period: PeriodInfo
  steps: FunnelStep[]
  contact: { sessions: number; prevSessions: number; byTarget: ClickRow[] }
  byDevice: ShowcaseFunnelRow[]
  byChannel: ShowcaseFunnelRow[]
  abandoned: number
}

export interface LeadRow {
  id: string
  name: string
  phone: string | null
  email: string | null
  message: string | null
  createdAt: string
  readAt: string | null
  /** Attribution from the visit it came from; null when no visit matched. */
  channel: string | null
  source: string | null
  campaign: string | null
  landing: string | null
  device: string | null
  country: string | null
}

export interface ShowcaseLeads {
  period: PeriodInfo
  totals: { leads: number; previous: number; linked: number; unread: number; sessions: number; contactSessions: number }
  trend: { bucket: string; leads: number }[]
  byChannel: { key: string; leads: number }[]
  bySource: { key: string; leads: number }[]
  byCampaign: { key: string; leads: number }[]
  byDevice: { key: string; leads: number }[]
  byHour: { hour: number; leads: number }[]
  rows: LeadRow[]
  /** More leads in the period than `rows` lists; the CSV export has them all. */
  truncated: boolean
}

export interface ShowcaseShareRow {
  key: string
  sessions: number
  convertedSessions: number
}

export interface ShowcaseAudience {
  period: PeriodInfo
  devices: ShowcaseShareRow[]
  browsers: ShowcaseShareRow[]
  os: ShowcaseShareRow[]
  newReturning: ShowcaseShareRow[]
  countries: ShowcaseShareRow[]
  regions: ShowcaseShareRow[]
  cities: ShowcaseShareRow[]
  timezones: ShowcaseShareRow[]
  languages: ShowcaseShareRow[]
  screens: ShowcaseShareRow[]
  networks: ShowcaseShareRow[]
}

export interface ShowcaseRealtime {
  at: string
  activeSessions: number
  pageviews: number
  perMinute: { minute: string; views: number }[]
  sessions: {
    sessionId: string
    path: string
    source: string
    channel: string
    device: string
    country: string | null
    pageviews: number
    scroll: number
    contacted: boolean
    formStarted: boolean
    lastSeen: string
    startedAt: string
  }[]
  sources: { key: string; sessions: number }[]
  events: { type: string; target: string | null; label: string | null; at: string }[]
  leads: { id: string; name: string; createdAt: string; channel: string | null }[]
}

export type ShowcaseTabData = {
  overview: ShowcaseOverview
  realtime: ShowcaseRealtime
  acquisition: ShowcaseAcquisition
  audience: ShowcaseAudience
  behaviour: ShowcaseBehaviour
  funnel: ShowcaseFunnel
  leads: ShowcaseLeads
}
