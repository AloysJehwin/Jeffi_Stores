import { CSV_BOM, csvRow } from '@jeffi/list-filters'
import { controlPlanePool } from '@/lib/tenant-registry/shared'
import { bucketKeys, fillSeries, istBounds, periodInfo, previousPeriod, trendBucket, type Period } from './period'
import { CHANNEL_GROUPS, classifyChannel, sourceLabel, type ChannelInput } from './channels'
import { buildFunnel, channelRows, drillDowns, paidTrend, rate, type OrderTuple, type SessionTuple } from './compute'
import type { Attention, ChannelRow, DrillRow } from './types'
import type {
  ClickRow,
  LeadRow,
  ShowcaseAcquisition,
  ShowcaseAudience,
  ShowcaseBehaviour,
  ShowcaseChannelRow,
  ShowcaseDrillRow,
  ShowcaseFunnel,
  ShowcaseFunnelRow,
  ShowcaseLeads,
  ShowcaseOverview,
  ShowcaseRealtime,
  ShowcaseShareRow,
  ShowcaseTab,
  ShowcaseTabData,
  ShowcaseTotals,
} from './showcase-types'

// A Showcase's analytics: the Traffic report's period, channel and funnel maths (period, channels, compute) over its
// own visits (showcase_sessions, one row per visit; showcase_events) with enquiries (showcase_leads) as the conversion.
// Read through the control-plane pool. Every query is the one site's ($1) and, but Real-time, bounded by the period's
// IST days ($2, $3). A lead is credited to the visit it came from (showcase_leads.session_id).

export interface ShowcaseReportContext {
  siteId: string
  /** The site's hosts; a referrer on one of them is internal (direct). */
  selfHosts: string[]
  /** The console link to a tab, for Needs attention. */
  tabHref: (tab: ShowcaseTab) => string
}

type Row = Record<string, any>
const num = (v: unknown) => (v == null ? 0 : Number(v) || 0)
const rows = async (sql: string, params: unknown[]): Promise<Row[]> => (await controlPlanePool().query(sql, params)).rows
const one = async (sql: string, params: unknown[]): Promise<Row> => (await rows(sql, params))[0] ?? {}
const bounds = (siteId: string, p: Period) => [siteId, ...istBounds(p)]
const iso = (v: unknown) => new Date(v as string).toISOString()

/** Visible this long (or more than one page, or any enquiry step) and the visit counts as engaged. */
export const ENGAGED_MS = 10_000

/** s: the period's visits ($1 site, $2..$3), each with its leads, engaged and converted (a lead or a contact tap). */
const S = `
s AS (
  SELECT ss.*, COALESCE(l.n, 0)::int AS leads,
         (COALESCE(l.n, 0) > 0 OR ss.contact_at IS NOT NULL) AS converted,
         (ss.engaged_ms >= ${ENGAGED_MS} OR ss.pageviews > 1 OR ss.contact_at IS NOT NULL OR ss.form_started_at IS NOT NULL
          OR ss.form_submitted_at IS NOT NULL OR COALESCE(l.n, 0) > 0) AS engaged
  FROM showcase_sessions ss
  LEFT JOIN (
    SELECT session_id, COUNT(*)::int AS n FROM showcase_leads
    WHERE site_id = $1 AND session_id IS NOT NULL AND created_at >= $2::timestamptz
    GROUP BY session_id
  ) l ON l.session_id = ss.session_id
  WHERE ss.site_id = $1 AND ss.started_at >= $2::timestamptz AND ss.started_at < $3::timestamptz
)`

const LEADS_IN = `site_id = $1 AND created_at >= $2::timestamptz AND created_at < $3::timestamptz`
const EVENTS_IN = `site_id = $1 AND created_at >= $2::timestamptz AND created_at < $3::timestamptz`
const ATTR_COLS = `LOWER(NULLIF(utm_source, '')) AS source, LOWER(NULLIF(utm_medium, '')) AS medium, NULLIF(utm_campaign, '') AS campaign, click_id, ref_host`
const FORM_STARTED = `(form_started_at IS NOT NULL OR form_submitted_at IS NOT NULL OR leads > 0)`
const FORM_SENT = `(form_submitted_at IS NOT NULL OR leads > 0)`

const GOOGLE_CLICKS = ['gclid', 'gbraid', 'wbraid']

/** A visit's landing attribution as the channel maths reads it; a Microsoft Ads click without tags is Bing paid search. */
export function attribution(r: Row): ChannelInput & { source: string | null; medium: string | null; campaign: string | null } {
  const bing = r.click_id === 'msclkid' && !r.source
  return {
    source: bing ? 'bing' : r.source ?? null,
    medium: bing ? r.medium || 'cpc' : r.medium ?? null,
    campaign: r.campaign ?? null,
    googleClick: GOOGLE_CLICKS.includes(r.click_id),
    metaClick: r.click_id === 'fbclid',
    referrerHost: r.ref_host ?? null,
  }
}

const channelOf = (r: Row, self: string[]) => CHANNEL_GROUPS.find(c => c.id === classifyChannel(attribution(r), self))!.label

/** Where a visit came from in a word: its tagged source / medium, else the referring site, else Direct. */
function sourceOf(r: Row, self: string[]): string {
  const a = attribution(r)
  if (a.source || a.googleClick) return `${sourceLabel(a)} / ${a.medium || '(none)'}`
  const host = a.referrerHost
  if (host && !self.some(h => host === h || host.endsWith('.' + h))) return host
  return a.metaClick ? 'Meta ads' : 'Direct'
}

// ── shared pieces ────────────────────────────────────────────────────────────

async function totals(siteId: string, p: Period): Promise<ShowcaseTotals> {
  const r = await one(
    `WITH ${S}
     SELECT COUNT(*)::int AS sessions,
            COUNT(DISTINCT visitor_key)::int AS visitors,
            (COUNT(*) FILTER (WHERE is_new))::int AS new_visitors,
            COALESCE(SUM(pageviews), 0)::int AS pageviews,
            (COUNT(*) FILTER (WHERE engaged))::int AS engaged,
            COALESCE(SUM(engaged_ms), 0)::float8 AS engaged_ms,
            COALESCE(SUM(max_scroll), 0)::float8 AS scroll_sum,
            (COUNT(*) FILTER (WHERE contact_at IS NOT NULL))::int AS contact,
            (COUNT(*) FILTER (WHERE ${FORM_STARTED}))::int AS form_starts,
            (COUNT(*) FILTER (WHERE ${FORM_SENT}))::int AS form_submits,
            (COUNT(*) FILTER (WHERE leads > 0))::int AS lead_sessions,
            (COUNT(*) FILTER (WHERE converted))::int AS converted,
            (SELECT COUNT(*) FROM showcase_leads WHERE ${LEADS_IN})::int AS leads
     FROM s`,
    bounds(siteId, p)
  )
  return {
    visitors: num(r.visitors),
    sessions: num(r.sessions),
    newVisitors: num(r.new_visitors),
    pageviews: num(r.pageviews),
    engagedSessions: num(r.engaged),
    engagedMs: num(r.engaged_ms),
    scrollSum: num(r.scroll_sum),
    contactSessions: num(r.contact),
    formStarts: num(r.form_starts),
    formSubmits: num(r.form_submits),
    leadSessions: num(r.lead_sessions),
    convertedSessions: num(r.converted),
    leads: num(r.leads),
  }
}

/** Visits grouped by landing attribution, as the Traffic report's session tuples (orders = their leads). */
async function sessionTuples(siteId: string, p: Period, withBucket: boolean): Promise<SessionTuple[]> {
  const params = bounds(siteId, p)
  if (withBucket) params.push(trendBucket(p))
  const bucket = withBucket ? `to_char(date_trunc($4, started_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD')` : 'NULL::text'
  const out = await rows(
    `WITH ${S}
     SELECT ${bucket} AS bucket, ${ATTR_COLS},
            COUNT(*)::int AS sessions, (COUNT(*) FILTER (WHERE is_new))::int AS new_visitors,
            (COUNT(*) FILTER (WHERE converted))::int AS converted, COALESCE(SUM(leads), 0)::int AS leads
     FROM s GROUP BY 1, 2, 3, 4, 5, 6 LIMIT 20000`,
    params
  )
  return out.map(r => {
    const a = attribution(r)
    return {
      bucket: r.bucket ?? undefined,
      source: a.source,
      medium: a.medium,
      campaign: a.campaign,
      gclick: !!a.googleClick,
      mclick: !!a.metaClick,
      refHost: a.referrerHost ?? null,
      sessions: num(r.sessions),
      newVisitors: num(r.new_visitors),
      converted: num(r.converted),
      orders: num(r.leads),
      revenue: 0,
    }
  })
}

/** Leads credited by their visit's attribution (the same visits, so channel leads add up to the visits' leads). */
const leadTuples = (ts: SessionTuple[]): OrderTuple[] =>
  ts.filter(t => t.orders > 0).map(t => ({ source: t.source, medium: t.medium, campaign: t.campaign, gclick: t.gclick, mclick: !!t.mclick, refHost: t.refHost, orders: t.orders, revenue: 0 }))

const toChannel = (r: ChannelRow): ShowcaseChannelRow => ({
  channel: r.channel,
  label: r.label,
  paid: r.paid,
  sessions: r.sessions,
  newVisitors: r.newVisitors,
  convertedSessions: r.convertedSessions,
  leads: r.orders,
})
const toDrill = (r: DrillRow): ShowcaseDrillRow => ({ key: r.key, sessions: r.sessions, convertedSessions: r.convertedSessions, leads: r.orders })

function channels(ts: SessionTuple[], self: string[]): ShowcaseChannelRow[] {
  return channelRows(ts, leadTuples(ts), self).map(toChannel)
}

async function clicksByTarget(siteId: string, p: Period): Promise<ClickRow[]> {
  const out = await rows(
    `SELECT target, COUNT(*)::int AS clicks, COUNT(DISTINCT session_id)::int AS sessions
     FROM showcase_events WHERE ${EVENTS_IN} AND type = 'click' AND target IS NOT NULL
     GROUP BY 1 ORDER BY 2 DESC`,
    bounds(siteId, p)
  )
  return out.map(r => ({ target: r.target, clicks: num(r.clicks), sessions: num(r.sessions) }))
}

const unread = async (siteId: string) =>
  num((await one(`SELECT COUNT(*)::int AS n FROM showcase_leads WHERE site_id = $1 AND read_at IS NULL`, [siteId])).n)

export interface ShowcaseAttentionInput {
  current: ShowcaseTotals
  previous: ShowcaseTotals
  channels: ShowcaseChannelRow[]
  previousChannels: ShowcaseChannelRow[]
  unread: number
  tabHref: (tab: ShowcaseTab) => string
}

/** What an owner should look at first, with where to look. */
export function showcaseAttention(i: ShowcaseAttentionInput): Attention[] {
  const out: Attention[] = []
  const c = i.current
  if (i.unread > 0)
    out.push({
      key: 'unread',
      severity: 'warning',
      title: `${i.unread} ${i.unread === 1 ? 'enquiry is' : 'enquiries are'} waiting for a reply`,
      sub: 'A quick answer wins more of them',
      href: i.tabHref('leads'),
    })
  if (c.sessions >= 30 && c.convertedSessions === 0)
    out.push({
      key: 'no-enquiries',
      severity: 'critical',
      title: `${c.sessions} visits and no enquiries`,
      sub: 'Check your phone, WhatsApp and the contact form are easy to find',
      href: i.tabHref('funnel'),
    })
  const conv = rate(c.convertedSessions, c.sessions)
  const prevConv = rate(i.previous.convertedSessions, i.previous.sessions)
  if (conv != null && prevConv && c.sessions >= 20 && conv < prevConv * 0.8)
    out.push({
      key: 'conversion-down',
      severity: 'critical',
      title: `Contact rate fell to ${(conv * 100).toFixed(1)}% from ${(prevConv * 100).toFixed(1)}%`,
      sub: 'More than 20% below the previous period',
      href: i.tabHref('funnel'),
    })
  const lost = c.formStarts - c.formSubmits
  if (c.formStarts >= 5 && c.formSubmits / c.formStarts < 0.5)
    out.push({
      key: 'form-abandoned',
      severity: 'warning',
      title: `${lost} of ${c.formStarts} visitors who started the form did not send it`,
      sub: 'Ask for fewer details, and check it is easy to fill on a phone',
      href: i.tabHref('funnel'),
    })
  const avgScroll = c.sessions ? c.scrollSum / c.sessions : null
  if (avgScroll != null && c.sessions >= 20 && avgScroll < 40)
    out.push({
      key: 'shallow',
      severity: 'info',
      title: `Visitors see ${Math.round(avgScroll)}% of the page on average`,
      sub: 'Put your call and WhatsApp buttons near the top',
      href: i.tabHref('behaviour'),
    })
  const prevBy = new Map(i.previousChannels.map(ch => [ch.channel, ch]))
  for (const ch of i.channels) {
    const before = prevBy.get(ch.channel)?.sessions ?? 0
    if (ch.sessions >= 20 && ch.sessions >= before * 1.5 && ch.convertedSessions === 0)
      out.push({
        key: `source-${ch.channel}`,
        severity: 'warning',
        title: `${ch.label} visits jumped to ${ch.sessions} (from ${before}) with no enquiries`,
        sub: 'Check what these visitors were promised',
        href: i.tabHref('acquisition'),
      })
  }
  return out
}

// ── tabs ─────────────────────────────────────────────────────────────────────

export async function showcaseOverview(p: Period, ctx: ShowcaseReportContext): Promise<ShowcaseOverview> {
  const prev = previousPeriod(p)
  const bucket = trendBucket(p)
  const b = bounds(ctx.siteId, p)
  const [current, previous, cur, prevT, trendS, trendL, clicks, waiting] = await Promise.all([
    totals(ctx.siteId, p),
    totals(ctx.siteId, prev),
    sessionTuples(ctx.siteId, p, false),
    sessionTuples(ctx.siteId, prev, false),
    rows(
      `WITH ${S}
       SELECT to_char(date_trunc($4, started_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS bucket,
              COUNT(*)::int AS sessions, COALESCE(SUM(pageviews), 0)::int AS pageviews,
              (COUNT(*) FILTER (WHERE contact_at IS NOT NULL))::int AS contacts
       FROM s GROUP BY 1`,
      [...b, bucket]
    ),
    rows(
      `SELECT to_char(date_trunc($4, created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS bucket, COUNT(*)::int AS leads
       FROM showcase_leads WHERE ${LEADS_IN} GROUP BY 1`,
      [...b, bucket]
    ),
    clicksByTarget(ctx.siteId, p),
    unread(ctx.siteId),
  ])
  const leadsBy = new Map(trendL.map(r => [r.bucket, num(r.leads)]))
  const trend = fillSeries(
    bucketKeys(p, bucket),
    trendS.map(r => ({ bucket: r.bucket, sessions: num(r.sessions), pageviews: num(r.pageviews), leads: 0, contacts: num(r.contacts) })),
    k => ({ bucket: k, sessions: 0, pageviews: 0, leads: 0, contacts: 0 })
  ).map(r => ({ ...r, leads: leadsBy.get(r.bucket) ?? 0 }))
  const ch = channels(cur, ctx.selfHosts)
  const prevCh = channels(prevT, ctx.selfHosts)
  return {
    period: periodInfo(p),
    current,
    previous,
    trend,
    topSources: ch.slice(0, 6),
    topReferrers: drillDowns(cur, leadTuples(cur), ctx.selfHosts, 5).referrers.map(toDrill),
    clicks,
    unreadLeads: waiting,
    attention: showcaseAttention({ current, previous, channels: ch, previousChannels: prevCh, unread: waiting, tabHref: ctx.tabHref }),
  }
}

async function utmDrill(siteId: string, p: Period, col: 'utm_term' | 'utm_content'): Promise<ShowcaseDrillRow[]> {
  const out = await rows(
    `WITH ${S}
     SELECT NULLIF(${col}, '') AS key, COUNT(*)::int AS sessions, (COUNT(*) FILTER (WHERE converted))::int AS converted,
            COALESCE(SUM(leads), 0)::int AS leads
     FROM s WHERE NULLIF(${col}, '') IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 100`,
    bounds(siteId, p)
  )
  return out.map(r => ({ key: r.key, sessions: num(r.sessions), convertedSessions: num(r.converted), leads: num(r.leads) }))
}

export async function showcaseAcquisition(p: Period, ctx: ShowcaseReportContext): Promise<ShowcaseAcquisition> {
  const [cur, prevT, terms, contents, linked] = await Promise.all([
    sessionTuples(ctx.siteId, p, true),
    sessionTuples(ctx.siteId, previousPeriod(p), false),
    utmDrill(ctx.siteId, p, 'utm_term'),
    utmDrill(ctx.siteId, p, 'utm_content'),
    one(
      `SELECT COUNT(*)::int AS leads, (COUNT(*) FILTER (WHERE session_id IS NOT NULL))::int AS linked FROM showcase_leads WHERE ${LEADS_IN}`,
      bounds(ctx.siteId, p)
    ),
  ])
  const sum = (f: (t: SessionTuple) => number) => cur.reduce((s, t) => s + f(t), 0)
  const d = drillDowns(cur, leadTuples(cur), ctx.selfHosts)
  return {
    period: periodInfo(p),
    channels: channels(cur, ctx.selfHosts),
    previousChannels: channels(prevT, ctx.selfHosts),
    sourceMedium: d.sourceMedium.map(toDrill),
    campaigns: d.campaigns.map(toDrill),
    terms,
    contents,
    referrers: d.referrers.map(toDrill),
    paidTrend: paidTrend(bucketKeys(p, trendBucket(p)), cur, ctx.selfHosts),
    totals: {
      sessions: sum(t => t.sessions),
      leads: num(linked.leads),
      linkedLeads: num(linked.linked),
      taggedSessions: sum(t => (t.source || t.gclick || t.mclick ? t.sessions : 0)),
    },
  }
}

const SCROLL_ORDER = ['0-24', '25-49', '50-74', '75-99', '100']
const ENGAGE_ORDER = ['<10s', '10-30s', '30s-1m', '1-3m', '3-10m', '10m+']

export async function showcaseBehaviour(p: Period, ctx: ShowcaseReportContext): Promise<ShowcaseBehaviour> {
  const b = bounds(ctx.siteId, p)
  const [scroll, engage, clicks, links, landing, pages, heat] = await Promise.all([
    rows(
      `WITH ${S}
       SELECT CASE WHEN max_scroll < 25 THEN '0-24' WHEN max_scroll < 50 THEN '25-49' WHEN max_scroll < 75 THEN '50-74'
                   WHEN max_scroll < 100 THEN '75-99' ELSE '100' END AS bucket, COUNT(*)::int AS sessions
       FROM s GROUP BY 1`,
      b
    ),
    rows(
      `WITH ${S}
       SELECT CASE WHEN engaged_ms < 10000 THEN '<10s' WHEN engaged_ms < 30000 THEN '10-30s' WHEN engaged_ms < 60000 THEN '30s-1m'
                   WHEN engaged_ms < 180000 THEN '1-3m' WHEN engaged_ms < 600000 THEN '3-10m' ELSE '10m+' END AS bucket,
              COUNT(*)::int AS sessions
       FROM s GROUP BY 1`,
      b
    ),
    clicksByTarget(ctx.siteId, p),
    rows(
      `SELECT target, COALESCE(label, '') AS label, COUNT(*)::int AS clicks, COUNT(DISTINCT session_id)::int AS sessions
       FROM showcase_events WHERE ${EVENTS_IN} AND type = 'click' AND target IS NOT NULL
       GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 50`,
      b
    ),
    rows(
      `WITH ${S}
       SELECT landing_path AS path, COUNT(*)::int AS sessions, (COUNT(*) FILTER (WHERE engaged))::int AS engaged,
              (COUNT(*) FILTER (WHERE converted))::int AS converted, COALESCE(SUM(leads), 0)::int AS leads
       FROM s GROUP BY 1 ORDER BY 2 DESC LIMIT 50`,
      b
    ),
    rows(
      `SELECT path, COUNT(*)::int AS views, COUNT(DISTINCT session_id)::int AS sessions
       FROM showcase_events WHERE ${EVENTS_IN} AND type = 'pageview' GROUP BY 1 ORDER BY 2 DESC LIMIT 50`,
      b
    ),
    rows(
      `SELECT EXTRACT(ISODOW FROM created_at AT TIME ZONE 'Asia/Kolkata')::int AS dow,
              EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Kolkata')::int AS hour, COUNT(*)::int AS views
       FROM showcase_events WHERE ${EVENTS_IN} AND type = 'pageview' GROUP BY 1, 2`,
      b
    ),
  ])
  const ordered = (rs: Row[], order: string[]) => {
    const m = new Map(rs.map(r => [r.bucket, num(r.sessions)]))
    return order.map(k => ({ bucket: k, sessions: m.get(k) ?? 0 }))
  }
  return {
    period: periodInfo(p),
    scroll: ordered(scroll, SCROLL_ORDER),
    engagement: ordered(engage, ENGAGE_ORDER),
    clicks,
    links: links.map(r => ({ target: r.target, label: r.label, clicks: num(r.clicks), sessions: num(r.sessions) })),
    landing: landing.map(r => ({ path: r.path, sessions: num(r.sessions), engaged: num(r.engaged), convertedSessions: num(r.converted), leads: num(r.leads) })),
    pages: pages.map(r => ({ path: r.path, views: num(r.views), sessions: num(r.sessions) })),
    heatmap: heat.map(r => ({ dow: num(r.dow), hour: num(r.hour), views: num(r.views) })),
  }
}

/** A step counts visits that reached it or any later one (a lead without a form-start beacon still sent the form). */
const FUNNEL_COLS = `COUNT(*)::int AS sessions,
            (COUNT(*) FILTER (WHERE engaged))::int AS engaged,
            (COUNT(*) FILTER (WHERE contact_at IS NOT NULL))::int AS contact,
            (COUNT(*) FILTER (WHERE ${FORM_STARTED}))::int AS form_started,
            (COUNT(*) FILTER (WHERE ${FORM_SENT}))::int AS form_submitted,
            (COUNT(*) FILTER (WHERE leads > 0))::int AS lead`

const FUNNEL_STEPS = [
  { key: 'sessions', label: 'Visited the site' },
  { key: 'engaged', label: 'Stayed 10 seconds or more' },
  { key: 'formStarted', label: 'Started the contact form' },
  { key: 'formSubmitted', label: 'Sent the form' },
  { key: 'lead', label: 'Enquiry received' },
] as const

const funnelRow = (key: string, r: Row): ShowcaseFunnelRow => ({
  key,
  sessions: num(r.sessions),
  engaged: num(r.engaged),
  contact: num(r.contact),
  formStarted: num(r.form_started),
  formSubmitted: num(r.form_submitted),
  lead: num(r.lead),
})

/** Funnel rows summed by a key (device, or channel label). */
export function funnelBy(rs: Row[], key: (r: Row) => string): ShowcaseFunnelRow[] {
  const m = new Map<string, ShowcaseFunnelRow>()
  for (const r of rs) {
    const k = key(r)
    const e = m.get(k) ?? funnelRow(k, {})
    const add = funnelRow(k, r)
    m.set(k, {
      key: k,
      sessions: e.sessions + add.sessions,
      engaged: e.engaged + add.engaged,
      contact: e.contact + add.contact,
      formStarted: e.formStarted + add.formStarted,
      formSubmitted: e.formSubmitted + add.formSubmitted,
      lead: e.lead + add.lead,
    })
  }
  return [...m.values()].sort((a, b) => b.sessions - a.sessions)
}

export async function showcaseFunnel(p: Period, ctx: ShowcaseReportContext): Promise<ShowcaseFunnel> {
  const counts = (q: Period) => one(`WITH ${S} SELECT ${FUNNEL_COLS} FROM s`, bounds(ctx.siteId, q)).then(r => funnelRow('all', r))
  const [cur, prev, tuples, byTarget] = await Promise.all([
    counts(p),
    counts(previousPeriod(p)),
    rows(`WITH ${S} SELECT device, ${ATTR_COLS}, ${FUNNEL_COLS} FROM s GROUP BY 1, 2, 3, 4, 5, 6 LIMIT 20000`, bounds(ctx.siteId, p)),
    clicksByTarget(ctx.siteId, p),
  ])
  return {
    period: periodInfo(p),
    steps: buildFunnel(
      FUNNEL_STEPS.map(s => ({ key: s.key, label: s.label, count: cur[s.key] })),
      Object.fromEntries(FUNNEL_STEPS.map(s => [s.key, prev[s.key]]))
    ),
    contact: { sessions: cur.contact, prevSessions: prev.contact, byTarget },
    byDevice: funnelBy(tuples, r => r.device),
    byChannel: funnelBy(tuples, r => channelOf(r, ctx.selfHosts)),
    abandoned: Math.max(0, cur.formStarted - cur.formSubmitted),
  }
}

const LEAD_ROWS = 500

/** The period's leads, newest first, each with the visit it came from. */
export async function showcaseLeadRows(siteId: string, p: Period, self: string[], limit = 10_000): Promise<LeadRow[]> {
  const out = await rows(
    `SELECT l.id, l.name, l.phone, l.email, l.message, l.created_at, l.read_at, ss.session_id AS visit,
            LOWER(NULLIF(ss.utm_source, '')) AS source, LOWER(NULLIF(ss.utm_medium, '')) AS medium,
            NULLIF(ss.utm_campaign, '') AS campaign, ss.click_id, ss.ref_host, ss.landing_path, ss.device, ss.country
     FROM showcase_leads l
     LEFT JOIN showcase_sessions ss ON ss.site_id = l.site_id AND ss.session_id = l.session_id
     WHERE l.site_id = $1 AND l.created_at >= $2::timestamptz AND l.created_at < $3::timestamptz
     ORDER BY l.created_at DESC
     LIMIT ${Math.max(1, Math.floor(limit))}`,
    bounds(siteId, p)
  )
  return out.map(r => ({
    id: r.id,
    name: r.name,
    phone: r.phone ?? null,
    email: r.email ?? null,
    message: r.message ?? null,
    createdAt: iso(r.created_at),
    readAt: r.read_at ? iso(r.read_at) : null,
    channel: r.visit ? channelOf(r, self) : null,
    source: r.visit ? sourceOf(r, self) : null,
    campaign: r.visit ? r.campaign ?? null : null,
    landing: r.visit ? r.landing_path ?? null : null,
    device: r.visit ? r.device ?? null : null,
    country: r.visit ? r.country ?? null : null,
  }))
}

const tally = (rs: LeadRow[], key: (r: LeadRow) => string | null, cap = 20) => {
  const m = new Map<string, number>()
  for (const r of rs) {
    const k = key(r) ?? 'Not linked to a visit'
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, cap).map(([k, leads]) => ({ key: k, leads }))
}

export async function showcaseLeads(p: Period, ctx: ShowcaseReportContext): Promise<ShowcaseLeads> {
  const bucket = trendBucket(p)
  const b = bounds(ctx.siteId, p)
  const [all, prev, trend, visits, waiting] = await Promise.all([
    showcaseLeadRows(ctx.siteId, p, ctx.selfHosts, 5_000),
    one(`SELECT COUNT(*)::int AS n FROM showcase_leads WHERE ${LEADS_IN}`, bounds(ctx.siteId, previousPeriod(p))),
    rows(
      `SELECT to_char(date_trunc($4, created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS bucket, COUNT(*)::int AS leads
       FROM showcase_leads WHERE ${LEADS_IN} GROUP BY 1`,
      [...b, bucket]
    ),
    one(`WITH ${S} SELECT COUNT(*)::int AS sessions, (COUNT(*) FILTER (WHERE contact_at IS NOT NULL))::int AS contact FROM s`, b),
    unread(ctx.siteId),
  ])
  const istHour = (at: string) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(new Date(at))) % 24
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, leads: 0 }))
  for (const r of all) hours[istHour(r.createdAt)].leads++
  return {
    period: periodInfo(p),
    totals: {
      leads: all.length,
      previous: num(prev.n),
      linked: all.filter(r => r.channel).length,
      unread: waiting,
      sessions: num(visits.sessions),
      contactSessions: num(visits.contact),
    },
    trend: fillSeries(bucketKeys(p, bucket), trend.map(r => ({ bucket: r.bucket, leads: num(r.leads) })), k => ({ bucket: k, leads: 0 })),
    byChannel: tally(all, r => r.channel),
    bySource: tally(all, r => r.source),
    byCampaign: tally(all.filter(r => r.campaign), r => r.campaign),
    byDevice: tally(all, r => r.device),
    byHour: hours,
    rows: all.slice(0, LEAD_ROWS),
    truncated: all.length > LEAD_ROWS,
  }
}

const SHARE_DIMS = {
  devices: `device`,
  browsers: `browser`,
  os: `os`,
  newReturning: `CASE WHEN is_new THEN 'New' ELSE 'Returning' END`,
  countries: `COALESCE(country, 'Unknown')`,
  regions: `region`,
  cities: `city`,
  timezones: `timezone`,
  languages: `language`,
  screens: `CASE WHEN screen_w > 0 AND screen_h > 0 THEN screen_w || '×' || screen_h END`,
  networks: `net`,
} as const

export async function showcaseAudience(p: Period, ctx: ShowcaseReportContext): Promise<ShowcaseAudience> {
  const dims = Object.entries(SHARE_DIMS)
  const out = await rows(
    `WITH ${S}
     ${dims
       .map(
         ([dim, expr]) =>
           `SELECT '${dim}' AS dim, ${expr} AS key, COUNT(*)::int AS sessions, (COUNT(*) FILTER (WHERE converted))::int AS converted
            FROM s WHERE ${expr} IS NOT NULL GROUP BY 2`
       )
       .join('\nUNION ALL\n')}`,
    bounds(ctx.siteId, p)
  )
  const by = (dim: string): ShowcaseShareRow[] =>
    out
      .filter(r => r.dim === dim)
      .map(r => ({ key: String(r.key), sessions: num(r.sessions), convertedSessions: num(r.converted) }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 50)
  return {
    period: periodInfo(p),
    devices: by('devices'),
    browsers: by('browsers'),
    os: by('os'),
    newReturning: by('newReturning'),
    countries: by('countries'),
    regions: by('regions'),
    cities: by('cities'),
    timezones: by('timezones'),
    languages: by('languages'),
    screens: by('screens'),
    networks: by('networks'),
  }
}

export async function showcaseRealtime(ctx: ShowcaseReportContext): Promise<ShowcaseRealtime> {
  const [sessions, perMinute, events, leads] = await Promise.all([
    rows(
      `SELECT session_id, landing_path, ${ATTR_COLS}, device, country, pageviews, max_scroll,
              contact_at IS NOT NULL AS contacted, form_started_at IS NOT NULL AS form_started, started_at, last_seen_at
       FROM showcase_sessions WHERE site_id = $1 AND last_seen_at >= now() - interval '30 minutes'
       ORDER BY last_seen_at DESC LIMIT 200`,
      [ctx.siteId]
    ),
    rows(
      `SELECT to_char(date_trunc('minute', created_at AT TIME ZONE 'Asia/Kolkata'), 'HH24:MI') AS minute, COUNT(*)::int AS views
       FROM showcase_events WHERE site_id = $1 AND type = 'pageview' AND created_at >= now() - interval '30 minutes'
       GROUP BY 1 ORDER BY 1`,
      [ctx.siteId]
    ),
    rows(
      `SELECT type, target, label, created_at FROM showcase_events
       WHERE site_id = $1 AND type <> 'pageview' AND created_at >= now() - interval '30 minutes'
       ORDER BY created_at DESC LIMIT 50`,
      [ctx.siteId]
    ),
    rows(
      `SELECT l.id, l.name, l.created_at, ss.session_id AS visit, LOWER(NULLIF(ss.utm_source, '')) AS source,
              LOWER(NULLIF(ss.utm_medium, '')) AS medium, NULLIF(ss.utm_campaign, '') AS campaign, ss.click_id, ss.ref_host
       FROM showcase_leads l LEFT JOIN showcase_sessions ss ON ss.site_id = l.site_id AND ss.session_id = l.session_id
       WHERE l.site_id = $1 AND l.created_at >= now() - interval '24 hours'
       ORDER BY l.created_at DESC LIMIT 20`,
      [ctx.siteId]
    ),
  ])
  const list = sessions.map(r => ({
    sessionId: r.session_id,
    path: r.landing_path,
    source: sourceOf(r, ctx.selfHosts),
    channel: channelOf(r, ctx.selfHosts),
    device: r.device,
    country: r.country ?? null,
    pageviews: num(r.pageviews),
    scroll: num(r.max_scroll),
    contacted: !!r.contacted,
    formStarted: !!r.form_started,
    lastSeen: iso(r.last_seen_at),
    startedAt: iso(r.started_at),
  }))
  const m = new Map<string, number>()
  for (const r of list) m.set(r.channel, (m.get(r.channel) ?? 0) + 1)
  return {
    at: new Date().toISOString(),
    activeSessions: list.length,
    pageviews: perMinute.reduce((s, r) => s + num(r.views), 0),
    perMinute: perMinute.map(r => ({ minute: r.minute, views: num(r.views) })),
    sessions: list.slice(0, 100),
    sources: [...m.entries()].sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ key, sessions: n })),
    events: events.map(r => ({ type: r.type, target: r.target ?? null, label: r.label ?? null, at: iso(r.created_at) })),
    leads: leads.map(r => ({ id: r.id, name: r.name, createdAt: iso(r.created_at), channel: r.visit ? channelOf(r, ctx.selfHosts) : null })),
  }
}

export async function showcaseReport<T extends ShowcaseTab>(tab: T, p: Period, ctx: ShowcaseReportContext): Promise<ShowcaseTabData[T]> {
  const run: { [K in ShowcaseTab]: () => Promise<ShowcaseTabData[K]> } = {
    overview: () => showcaseOverview(p, ctx),
    realtime: () => showcaseRealtime(ctx),
    acquisition: () => showcaseAcquisition(p, ctx),
    audience: () => showcaseAudience(p, ctx),
    behaviour: () => showcaseBehaviour(p, ctx),
    funnel: () => showcaseFunnel(p, ctx),
    leads: () => showcaseLeads(p, ctx),
  }
  return run[tab]() as Promise<ShowcaseTabData[T]>
}

const istStamp = (at: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date(at))
    .replace(',', '')

/** The leads as a spreadsheet: BOM, header, one row each (formula-leading cells neutralised by csvRow). */
export function leadsCsv(leads: LeadRow[]): string {
  const head = ['Received (IST)', 'Name', 'Phone', 'Email', 'Message', 'Status', 'Channel', 'Source', 'Campaign', 'Landing page', 'Device', 'Country']
  return (
    CSV_BOM +
    csvRow(head) +
    leads
      .map(l =>
        csvRow([istStamp(l.createdAt), l.name, l.phone, l.email, l.message, l.readAt ? 'Handled' : 'New', l.channel ?? 'Not linked to a visit', l.source, l.campaign, l.landing, l.device, l.country])
      )
      .join('')
  )
}
