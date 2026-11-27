import 'server-only'
import { loadCampaignList } from '@/lib/campaigns/list'
import { campaignChannels } from '@/lib/campaigns/channels'
import { listCampaignSends } from '@/lib/campaigns/sends'
import { loadCampaignsOverview } from '@/lib/overviews/campaigns-report'
import { listEnrichmentProposals } from '@/lib/catalog/enrichment-proposals'
import { listOffersAdmin } from '@/lib/catalog/product-offers'
import { getOffersWithSettings } from '@/lib/payments/razorpay-offers'
import { listLoyaltyMembers } from '@/lib/loyalty/queries'
import { TIER_KEYS, TIER_NAMES } from '@/lib/loyalty/tiers'
import { listReferralSignups } from '@/lib/referrals/queries'
import { listPosts } from '@/lib/social/data'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { trafficReport } from '@/lib/traffic/report'
import { trafficPeriod } from '@/lib/traffic/period'
import { selfHostsFor } from '@/lib/traffic/channels'
import { loadCampaigns as loadGoogleCampaigns, loadKeywords as loadGoogleKeywords, loadProducts as loadGoogleProducts, parseRange as parseGoogleRange } from '@/lib/google-ads/report'
import { loadEntities as loadMetaEntities } from '@/lib/meta-ads/console'
import { loadCampaigns as loadAmazonCampaigns, loadKeywords as loadAmazonKeywords, loadProducts as loadAmazonProducts, loadSearchTerms as loadAmazonSearchTerms } from '@/lib/amazon-ads/console'
import { loadCampaigns as loadMarketCampaigns, loadProducts as loadMarketProducts } from '@/lib/marketplace-ads/console'
import type { AdsChannel } from '@/lib/marketplace-ads/columns'
import { getGmcStatusPage } from '@/lib/merchant/gmc-status'
import { loadIssues as loadMerchantIssues, loadPerformance as loadMerchantPerformance } from '@/lib/merchant/console-data'
import { getCrmDashboardData } from '@/lib/shared/admin-crm'
import { getCrmOverview } from '@/lib/crm/overview-query'
import { parsePeriod as parseCrmPeriod, istToday as crmToday } from '@/lib/crm/period'
import { queryMany } from '@/lib/shared/db'
import { parsePeriod as parseOverviewPeriod, previousPeriod, delta } from '@/lib/overview/period'
import { periodArgs as programsArgs } from '@/lib/overviews/marketing'
import { periodArgs as catalogArgs } from '@/lib/overviews/catalog'
import { TOP_EARNERS_SQL, TOP_REFERRERS_SQL, toTopEarners, toTopReferrers } from '@/lib/overviews/customer-programs'
import { OFFERS_SQL, OFFER_TOTALS_SQL, toOfferRow } from '@/lib/overviews/offers'
import { defineExport, type ExportDefinition, type ExportRunContext, type ExportSection } from '../define'
import { narrowed, type DateRange, type ExportColumn, type ExportFilter } from '../types'

// Marketing and growth exports. Each calls the same lib function as the page's API (or server
// component) with the same period, so the exported totals are the page's totals. Include/exclude
// choices are applied to the rows before totals and summary figures are computed.

type Row = Record<string, any>
type Summary = NonNullable<ExportSection['summary']>

// ---- helpers ----------------------------------------------------------------------------------

const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

function shiftDay(day: string, n: number): string {
  const t = new Date(`${day}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

/** The consoles' default period: the last 30 days (ending `endOffset` days ago). */
function rangeOf(ctx: ExportRunContext, endOffset = 0): Required<DateRange> {
  const to = shiftDay(istToday(), -endOffset)
  return { from: ctx.range.from ?? shiftDay(to, -29), to: ctx.range.to ?? to }
}

function rangeFromQuery(q: URLSearchParams): DateRange | undefined {
  const from = q.get('from') ?? undefined
  const to = q.get('to') ?? undefined
  return from || to ? { from, to } : undefined
}

const num = (v: unknown) => Number(v ?? 0) || 0
const sum = (rows: Row[], key: string) => rows.reduce((s, r) => s + num(r[key]), 0)
const ratio = (a: number, b: number) => (b > 0 ? a / b : null)
/** A 0..1 share as the percent figure exports print (null stays empty). */
const pc = (v: unknown) => (v == null || v === '' ? null : Math.round(num(v) * 10000) / 100)
const opts = (pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }))
const multi = (key: string, label: string, options: [string, string][], help?: string, def?: string[]): ExportFilter => ({ key, label, kind: 'multi', options: opts(options), help, default: def })
const toggle = (key: string, label: string, help?: string, def = false): ExportFilter => ({ key, label, kind: 'toggle', default: def, help })

/** A multi choice's verdict on one value; values outside the known options count as "other". */
function inPick(picked: string[] | null, value: unknown, known: readonly string[]): boolean {
  if (!picked) return true
  const v = String(value ?? '')
  return known.includes(v) ? picked.includes(v) : picked.includes('other')
}

const money = (key: string, label: string, total = true, extra: Partial<ExportColumn> = {}): ExportColumn => ({ key, label, type: 'money', total: total ? 'sum' : undefined, ...extra })
const int = (key: string, label: string, total = true, extra: Partial<ExportColumn> = {}): ExportColumn => ({ key, label, type: 'int', total: total ? 'sum' : undefined, ...extra })
const pct = (key: string, label: string, extra: Partial<ExportColumn> = {}): ExportColumn => ({ key, label, type: 'percent', ...extra })
const dec = (key: string, label: string, total = false, extra: Partial<ExportColumn> = {}): ExportColumn => ({ key, label, type: 'number', total: total ? 'sum' : undefined, ...extra })

const filename = (base: string) => (ctx: ExportRunContext) => {
  const r = ctx.range
  return r.from || r.to ? `${base}_${r.from ?? ''}_to_${r.to ?? ''}` : base
}

/** Fetches every page of an offset-paged list as batches (the exports hold more than the screen's page). */
async function* paged<T>(fetch: (page: number) => Promise<{ rows: T[]; total: number }>, size: number, cap = 50_000): AsyncIterable<T[]> {
  let seen = 0
  for (let page = 1; seen < cap; page++) {
    const { rows, total } = await fetch(page)
    if (rows.length) yield rows
    seen += rows.length
    if (!rows.length || seen >= total || rows.length < size) return
  }
}

// ---- Campaigns --------------------------------------------------------------------------------

const CAMPAIGN_STATUS: [string, string][] = [['active', 'Active'], ['paused', 'Paused']]
const CAMPAIGN_CHANNELS: [string, string][] = [['email', 'Email'], ['whatsapp', 'WhatsApp'], ['push', 'App push']]
const CHANNEL_LABEL: Record<string, string> = { email: 'Email', whatsapp: 'WhatsApp', sms: 'SMS', push: 'App push' }

const CAMPAIGNS_LIST_STATUS = multi('status', 'Status', CAMPAIGN_STATUS)
const CAMPAIGNS_LIST_CHANNELS = multi('channels', 'Channels', CAMPAIGN_CHANNELS, 'Keep campaigns that send on at least one ticked channel.')

export const CAMPAIGNS_LIST_EXPORT = defineExport({
  key: 'campaigns.list',
  title: 'Campaigns',
  noun: 'Campaigns',
  scope: 'mailer:read',
  columns: [
    { key: 'name', label: 'Campaign', id: true, width: 1.6 },
    { key: 'kind', label: 'Kind', optional: true },
    { key: 'status', label: 'Status' },
    { key: 'channels', label: 'Channels' },
    { key: 'description', label: 'Description', optional: true, width: 2 },
    int('delay_hours', 'Delay (hours)', false),
    int('discount_percent', 'Discount %', false, { optional: true }),
    { key: 'last_run_at', label: 'Last run', type: 'datetime' },
    int('sent', 'Sent'),
    int('opened', 'Opened'),
    int('clicked', 'Clicked'),
    int('converted', 'Converted'),
    int('unsubscribed', 'Unsubscribed'),
    pct('open_rate', 'Open rate'),
    pct('click_rate', 'Click rate'),
    pct('conversion_rate', 'Conversion rate'),
    money('revenue', 'Revenue'),
  ],
  filters: [CAMPAIGNS_LIST_STATUS, CAMPAIGNS_LIST_CHANNELS],
  scopes: ['filtered'],
  sections: async ctx => {
    const status = narrowed(CAMPAIGNS_LIST_STATUS, ctx.filters)
    const channels = narrowed(CAMPAIGNS_LIST_CHANNELS, ctx.filters)
    const SIZE = 200
    const all: Row[] = []
    for (let offset = 0; ; offset += SIZE) {
      const { campaigns, total } = await loadCampaignList(SIZE, offset)
      all.push(...campaigns)
      if (!campaigns.length || all.length >= total) break
    }
    const rows = all
      .filter(c => c.kind !== 'broadcast')
      .map(c => ({ c, ch: campaignChannels(c.kind, c.parameters, c.scenario_kind, { whatsapp: true, push: true }) }))
      .filter(({ c, ch }) => (!status || status.includes(c.enabled ? 'active' : 'paused')) && (!channels || ch.some(x => channels.includes(x))))
      .map(({ c, ch }) => {
        const sent = num(c.total_sent)
        return {
          name: c.name,
          kind: c.kind,
          status: c.enabled ? 'Active' : 'Paused',
          channels: ch.map(x => CHANNEL_LABEL[x]).join(', '),
          description: c.description,
          delay_hours: num(c.delay_hours),
          discount_percent: num(c.discount_percent),
          last_run_at: c.last_run_at,
          sent,
          opened: num(c.total_opened),
          clicked: num(c.total_clicked),
          converted: num(c.total_converted),
          unsubscribed: num(c.total_unsubscribed),
          open_rate: pc(ratio(num(c.total_opened), sent)),
          click_rate: pc(ratio(num(c.total_clicked), sent)),
          conversion_rate: pc(ratio(num(c.total_converted), sent)),
          revenue: num(c.revenue_attributed),
        }
      })
    return [{
      key: 'campaigns',
      rows,
      summary: [
        { label: 'Campaigns', value: rows.length, type: 'int' },
        { label: 'Active', value: rows.filter(r => r.status === 'Active').length, type: 'int' },
        { label: 'Sent', value: sum(rows, 'sent'), type: 'int' },
        { label: 'Converted', value: sum(rows, 'converted'), type: 'int' },
        { label: 'Revenue', value: sum(rows, 'revenue'), type: 'money' },
      ],
    }]
  },
})

const OVERVIEW_TABLES = multi('tables', 'Tables', [['campaigns', 'By campaign'], ['channels', 'By channel'], ['idle', 'On but not sending']])
const OVERVIEW_ENABLED = multi('enabled', 'Campaigns', [['on', 'On'], ['off', 'Off']], 'Applies to the by-campaign table.')

export const CAMPAIGNS_PERFORMANCE_EXPORT = defineExport({
  key: 'campaigns.performance',
  title: 'Campaign performance',
  noun: 'Campaigns',
  scope: 'mailer:read',
  columns: [
    { key: 'name', label: 'Campaign', id: true, width: 1.6 },
    { key: 'kind', label: 'Kind', optional: true },
    { key: 'state', label: 'State' },
    int('sends', 'Sends'),
    int('emails', 'Emails', true, { optional: true }),
    int('pushes', 'App pushes'),
    int('push_opened', 'Push opened'),
    int('opened', 'Opened'),
    int('clicked', 'Clicked'),
    int('converted', 'Converted'),
    int('unsubscribed', 'Unsubscribed'),
    int('bounced', 'Bounced'),
    int('failed', 'Failed'),
    pct('open_rate', 'Open rate'),
    pct('click_rate', 'Click rate'),
    pct('conversion_rate', 'Conversion rate', { optional: true }),
    money('revenue', 'Revenue'),
  ],
  filters: [OVERVIEW_TABLES, OVERVIEW_ENABLED],
  scopes: ['filtered'],
  dateRange: true,
  rangeFromQuery,
  filename: filename('campaign-performance'),
  sections: async ctx => {
    const r = rangeOf(ctx)
    const d = await loadCampaignsOverview({ from: r.from, to: r.to })
    const tables = narrowed(OVERVIEW_TABLES, ctx.filters)
    const enabled = narrowed(OVERVIEW_ENABLED, ctx.filters)
    const out: ExportSection[] = []
    if (!tables || tables.includes('campaigns')) {
      const rows = d.campaigns
        .filter(c => !enabled || enabled.includes(c.enabled === false ? 'off' : 'on'))
        .map(c => ({
          name: c.name,
          kind: c.kind,
          state: c.enabled === false ? 'Off' : 'On',
          sends: c.sends,
          emails: c.emails,
          pushes: c.pushes,
          push_opened: c.push_opened,
          opened: c.opened,
          clicked: c.clicked,
          converted: c.converted,
          unsubscribed: c.unsubscribed,
          bounced: c.bounced,
          failed: c.failed,
          open_rate: pc(c.open_rate),
          click_rate: pc(c.click_rate),
          conversion_rate: pc(c.conversion_rate),
          revenue: c.revenue,
        }))
      out.push({
        key: 'campaigns',
        title: 'By campaign',
        rows,
        summary: [
          { label: 'Sends', value: sum(rows, 'sends'), type: 'int' },
          { label: 'Converted', value: sum(rows, 'converted'), type: 'int' },
          { label: 'Revenue', value: sum(rows, 'revenue'), type: 'money' },
          { label: 'Unsubscribed', value: sum(rows, 'unsubscribed'), type: 'int' },
        ],
      })
    }
    if (!tables || tables.includes('channels')) {
      out.push({
        key: 'channels',
        title: 'By channel',
        columns: [
          { key: 'channel', label: 'Channel', id: true },
          int('sends', 'Sends'),
          int('opened', 'Opened'),
          int('clicked', 'Clicked'),
          int('converted', 'Converted'),
          int('unsubscribed', 'Unsubscribed'),
          money('revenue', 'Revenue'),
        ],
        rows: d.channels.map(c => ({ ...c, channel: CHANNEL_LABEL[c.channel] ?? c.channel })),
      })
    }
    if (!tables || tables.includes('idle')) {
      out.push({
        key: 'idle',
        title: 'On but not sending',
        columns: [{ key: 'name', label: 'Campaign', id: true, width: 1.6 }, { key: 'kind', label: 'Kind' }, { key: 'last_run_at', label: 'Last run', type: 'datetime' }],
        rows: d.idle,
        totals: null,
      })
    }
    return out.length ? out : [{ key: 'none', title: 'Campaign performance', rows: [], totals: null }]
  },
})

const SEND_OUTCOMES: [string, string][] = [['sent', 'Sent only'], ['opened', 'Opened'], ['clicked', 'Clicked'], ['converted', 'Converted'], ['unsubscribed', 'Unsubscribed'], ['bounced', 'Bounced']]
const SEND_FILTER = multi('outcomes', 'Outcome', SEND_OUTCOMES, "The furthest step each send reached: bounced, unsubscribed, converted, clicked, opened, else sent.")

function sendOutcome(s: Row): string {
  if (s.bounced_at) return 'bounced'
  if (s.unsubscribed_at) return 'unsubscribed'
  if (s.converted_at) return 'converted'
  if (s.clicked_at) return 'clicked'
  if (s.opened_at) return 'opened'
  return 'sent'
}

export const CAMPAIGNS_SENDS_EXPORT = defineExport({
  key: 'campaigns.sends',
  title: 'Campaign sends',
  noun: 'Sends',
  scope: 'mailer:read',
  columns: [
    { key: 'sent_at', label: 'Sent', type: 'datetime', id: true },
    { key: 'customer', label: 'Customer', id: true, width: 1.5 },
    { key: 'email', label: 'Email', width: 1.6 },
    { key: 'outcome', label: 'Outcome' },
    int('send_count', 'Times sent to customer', false),
    { key: 'opened_at', label: 'Opened', type: 'datetime', optional: true },
    { key: 'clicked_at', label: 'Clicked', type: 'datetime', optional: true },
    { key: 'converted_at', label: 'Converted', type: 'datetime', optional: true },
    { key: 'unsubscribed_at', label: 'Unsubscribed', type: 'datetime', optional: true },
    { key: 'bounced_at', label: 'Bounced', type: 'datetime', optional: true },
  ],
  filters: [SEND_FILTER],
  scopes: ['filtered'],
  filename: ctx => `campaign-sends_${ctx.query.get('kind') ?? 'all'}`,
  describe: ctx => (ctx.query.get('kind') ? [`Campaign: ${ctx.query.get('kind')}`] : []),
  sections: async ctx => {
    const kind = ctx.query.get('kind')
    if (!kind) return [{ key: 'sends', title: 'Campaign sends', rows: [], totals: null }]
    const picked = narrowed(SEND_FILTER, ctx.filters)
    const SIZE = 1000
    const label = Object.fromEntries(SEND_OUTCOMES.map(([v, l]) => [v, l])) as Record<string, string>
    async function* gen(): AsyncIterable<Row[]> {
      for await (const batch of paged(async page => ({ rows: (await listCampaignSends(kind as string, SIZE, (page - 1) * SIZE)) as Row[], total: Infinity }), SIZE)) {
        const rows = batch
          .map(s => ({ s, o: sendOutcome(s) }))
          .filter(({ o }) => !picked || picked.includes(o))
          .map(({ s, o }) => ({
            sent_at: s.sent_at,
            customer: s.user_name || s.user_email,
            email: s.user_email,
            outcome: label[o],
            send_count: num(s.send_count),
            opened_at: s.opened_at,
            clicked_at: s.clicked_at,
            converted_at: s.converted_at,
            unsubscribed_at: s.unsubscribed_at,
            bounced_at: s.bounced_at,
          }))
        if (rows.length) yield rows
      }
    }
    return [{ key: 'sends', rows: gen(), totals: null }]
  },
})

// ---- Loyalty and referrals --------------------------------------------------------------------

const TIER_FILTER = multi('tiers', 'Tiers', TIER_KEYS.map(k => [k, TIER_NAMES[k]] as [string, string]), 'Untick a tier to leave its members out.')

export const LOYALTY_MEMBERS_EXPORT = defineExport({
  key: 'loyalty.members',
  title: 'Loyalty members',
  noun: 'Members',
  scope: 'campaigns:read',
  columns: [
    { key: 'name', label: 'Customer', id: true, width: 1.5 },
    { key: 'email', label: 'Email', width: 1.6 },
    { key: 'phone', label: 'Phone', optional: true },
    { key: 'tier', label: 'Tier' },
    int('points', 'Points'),
    int('lifetime_points', 'Ever earned'),
    { key: 'updated_at', label: 'Updated', type: 'date' },
    { key: 'user_id', label: 'Customer ID', optional: true },
  ],
  filters: [TIER_FILTER],
  scopes: ['filtered'],
  sections: async ctx => {
    const tiers = narrowed(TIER_FILTER, ctx.filters)
    const SIZE = 500
    async function* gen(): AsyncIterable<Row[]> {
      for (const tier of tiers ?? [null]) {
        const rows = paged(async page => {
          const { members, total } = await listLoyaltyMembers({ page, pageSize: SIZE, tier })
          return { rows: members, total }
        }, SIZE)
        for await (const batch of rows)
          yield batch.map(m => ({ name: m.name, email: m.email, phone: m.phone, tier: TIER_NAMES[m.tier as keyof typeof TIER_NAMES] ?? m.tier, points: m.points, lifetime_points: m.lifetimePoints, updated_at: m.updatedAt, user_id: m.userId }))
      }
    }
    return [{ key: 'members', rows: gen() }]
  },
})

const REFERRAL_STATUS: [string, string][] = [['joined', 'Joined'], ['rewarded', 'Rewarded'], ['reversed', 'Taken back'], ['capped', 'Yearly limit'], ['rejected', 'Rejected']]
const REFERRAL_FILTER = multi('statuses', 'Statuses', REFERRAL_STATUS, 'Untick a status to leave those referrals out.')
const REJECT_REASON: Record<string, string> = {
  self: 'Referred themselves',
  same_phone: 'Same phone as referrer',
  same_email: 'Same email as referrer',
  same_device: "Signed up on the referrer's device",
}

export const REFERRALS_LIST_EXPORT = defineExport({
  key: 'referrals.list',
  title: 'Referrals',
  noun: 'Referrals',
  scope: 'campaigns:read',
  columns: [
    { key: 'referrer', label: 'Referrer', id: true, width: 1.5 },
    { key: 'referrer_email', label: 'Referrer email', width: 1.6 },
    { key: 'friend', label: 'Friend', width: 1.5 },
    { key: 'friend_email', label: 'Friend email', width: 1.6 },
    { key: 'status', label: 'Status' },
    { key: 'reject_reason', label: 'Reject reason', optional: true },
    int('points', 'Points'),
    { key: 'signed_up_at', label: 'Joined', type: 'date', id: true },
    { key: 'rewarded_at', label: 'Rewarded', type: 'date', optional: true },
  ],
  filters: [REFERRAL_FILTER],
  scopes: ['filtered'],
  sections: async ctx => {
    const statuses = narrowed(REFERRAL_FILTER, ctx.filters)
    const SIZE = 500
    const label = Object.fromEntries(REFERRAL_STATUS) as Record<string, string>
    async function* gen(): AsyncIterable<Row[]> {
      for (const status of statuses ?? [null]) {
        const rows = paged(async page => {
          const { rows, total } = await listReferralSignups({ page, pageSize: SIZE, status })
          return { rows, total }
        }, SIZE)
        for await (const batch of rows)
          yield batch.map(r => ({
            referrer: r.referrer.name,
            referrer_email: r.referrer.email,
            friend: r.friend.name,
            friend_email: r.friend.email,
            status: label[r.status] ?? r.status,
            reject_reason: r.rejectReason ? (REJECT_REASON[r.rejectReason] ?? r.rejectReason) : null,
            points: r.points,
            signed_up_at: r.signedUpAt,
            rewarded_at: r.rewardedAt,
          }))
      }
    }
    return [{ key: 'referrals', rows: gen() }]
  },
})

// ---- Offers -----------------------------------------------------------------------------------

const OFFER_STATE = multi('states', 'Offer state', [['live', 'Live'], ['scheduled', 'Scheduled'], ['ended', 'Ended'], ['paused', 'Paused']], 'Live = active and inside its dates.')

function offerState(o: Row, now = Date.now()): string {
  if (!o.is_active) return 'paused'
  if (o.starts_at && new Date(o.starts_at).getTime() > now) return 'scheduled'
  if (o.ends_at && new Date(o.ends_at).getTime() < now) return 'ended'
  return 'live'
}

export const OFFERS_LIST_EXPORT = defineExport({
  key: 'offers.list',
  title: 'Product offers',
  noun: 'Offers',
  scope: 'coupons:write',
  columns: [
    { key: 'title', label: 'Offer', id: true, width: 1.6 },
    { key: 'slug', label: 'Slug', optional: true },
    { key: 'state', label: 'State' },
    { key: 'starts_at', label: 'Starts', type: 'datetime' },
    { key: 'ends_at', label: 'Ends', type: 'datetime' },
    int('product_count', 'Products'),
    { key: 'badge_text', label: 'Badge', optional: true },
    { key: 'subtitle', label: 'Subtitle', optional: true, width: 2 },
  ],
  filters: [OFFER_STATE],
  scopes: ['filtered'],
  sections: async ctx => {
    const states = narrowed(OFFER_STATE, ctx.filters)
    const label: Record<string, string> = { live: 'Live', scheduled: 'Scheduled', ended: 'Ended', paused: 'Paused' }
    const rows = (await listOffersAdmin(null) as Row[])
      .map(o => ({ o, s: offerState(o) }))
      .filter(({ s }) => !states || states.includes(s))
      .map(({ o, s }) => ({ title: o.title, slug: o.slug, state: label[s], starts_at: o.starts_at, ends_at: o.ends_at, product_count: num(o.product_count), badge_text: o.badge_text, subtitle: o.subtitle }))
    return [{ key: 'offers', rows, summary: [{ label: 'Offers', value: rows.length, type: 'int' }, { label: 'Live', value: rows.filter(r => r.state === 'Live').length, type: 'int' }] }]
  },
})

const BANK_VISIBILITY = multi('visibility', 'Storefront', [['shown', 'Shown'], ['hidden', 'Hidden']])

export const OFFERS_BANK_EXPORT = defineExport({
  key: 'offers.bank',
  title: 'Bank offers',
  noun: 'Offers',
  scope: 'coupons:read',
  columns: [
    { key: 'title', label: 'Offer', id: true, width: 2 },
    { key: 'razorpay_title', label: 'Razorpay title', optional: true, width: 2 },
    { key: 'visibility', label: 'Storefront' },
    { key: 'issuers', label: 'Banks' },
    { key: 'methods', label: 'Payment methods' },
    { key: 'ends_at', label: 'Ends', type: 'date' },
    int('display_order', 'Order', false, { optional: true }),
    { key: 'id', label: 'Offer ID', optional: true },
  ],
  filters: [BANK_VISIBILITY],
  scopes: ['filtered'],
  sections: async ctx => {
    const vis = narrowed(BANK_VISIBILITY, ctx.filters)
    const { offers } = await getOffersWithSettings()
    const rows = offers
      .filter(o => !vis || vis.includes(o.isVisible ? 'shown' : 'hidden'))
      .map(o => ({ title: o.titleOverride || o.title, razorpay_title: o.title, visibility: o.isVisible ? 'Shown' : 'Hidden', issuers: o.issuers.join(', '), methods: o.methods.join(', '), ends_at: o.endsAt, display_order: o.displayOrder, id: o.id }))
    return [{ key: 'offers', rows, totals: null, summary: [{ label: 'Offers', value: rows.length, type: 'int' }, { label: 'Shown', value: rows.filter(r => r.visibility === 'Shown').length, type: 'int' }] }]
  },
})

// ---- Social posts -----------------------------------------------------------------------------

const PLATFORMS: [string, string][] = [['fb', 'Facebook'], ['ig', 'Instagram'], ['ig_reel', 'Instagram Reel'], ['gbp', 'Business Profile'], ['youtube', 'YouTube Short'], ['pinterest', 'Pinterest'], ['linkedin', 'LinkedIn'], ['x', 'X']]
const POST_STATUS: [string, string][] = [['draft', 'Draft'], ['pending', 'Scheduled'], ['publishing', 'Publishing'], ['posted', 'Posted'], ['failed', 'Failed'], ['cancelled', 'Cancelled']]
const POST_PLATFORM_FILTER = multi('platforms', 'Networks', PLATFORMS)
const POST_STATUS_FILTER = multi('statuses', 'Statuses', POST_STATUS)

const dayStart = (d: string) => `${d}T00:00:00+05:30`

export const SOCIAL_POSTS_EXPORT = defineExport({
  key: 'social-posts.posts',
  title: 'Social posts',
  noun: 'Posts',
  scope: 'social:read',
  columns: [
    { key: 'scheduled_at', label: 'Scheduled', type: 'datetime', id: true },
    { key: 'network', label: 'Network', id: true },
    { key: 'status', label: 'Status' },
    { key: 'approval', label: 'Approval', optional: true },
    { key: 'caption', label: 'Caption', width: 3 },
    { key: 'title', label: 'Title', optional: true },
    { key: 'hashtags', label: 'Hashtags', optional: true },
    { key: 'link_url', label: 'Link', optional: true },
    { key: 'permalink', label: 'Post URL', optional: true },
    { key: 'source', label: 'Source', optional: true },
    int('impressions', 'Impressions'),
    int('reach', 'Reach', false),
    int('likes', 'Likes'),
    int('comments', 'Comments'),
    int('shares', 'Shares'),
    int('saves', 'Saves'),
    int('clicks', 'Clicks'),
    int('video_views', 'Video views'),
    { key: 'last_error', label: 'Last error', optional: true, width: 2 },
  ],
  filters: [POST_PLATFORM_FILTER, POST_STATUS_FILTER],
  scopes: ['filtered'],
  dateRange: { label: 'Scheduled between' },
  rangeFromQuery,
  filename: filename('social-posts'),
  sections: async ctx => {
    const platforms = narrowed(POST_PLATFORM_FILTER, ctx.filters)
    const statuses = narrowed(POST_STATUS_FILTER, ctx.filters)
    const from = ctx.range.from ? dayStart(ctx.range.from) : undefined
    const to = ctx.range.to ? dayStart(shiftDay(ctx.range.to, 1)) : undefined
    const plat = Object.fromEntries(PLATFORMS) as Record<string, string>
    const stat = Object.fromEntries(POST_STATUS) as Record<string, string>
    const approval: Record<string, string> = { none: 'Not needed', pending: 'Waiting', approved: 'Approved', rejected: 'Rejected' }
    const posts = (await listPosts(await resolveTenantId(), { from, to, limit: 5000 })) as Row[]
    const rows = posts
      .filter(p => inPick(platforms, p.platform, PLATFORMS.map(x => x[0])) && inPick(statuses, p.status, POST_STATUS.map(x => x[0])))
      .map(p => ({
        scheduled_at: p.scheduled_at,
        network: plat[p.platform] ?? p.platform,
        status: stat[p.status] ?? p.status,
        approval: approval[p.approval_status] ?? p.approval_status,
        caption: p.caption,
        title: p.title,
        hashtags: p.hashtags,
        link_url: p.link_url,
        permalink: p.permalink,
        source: p.source,
        impressions: p.impressions,
        reach: p.reach,
        likes: p.likes,
        comments: p.comments,
        shares: p.shares,
        saves: p.saves,
        clicks: p.clicks,
        video_views: p.video_views,
        last_error: p.last_error,
      }))
    return [{
      key: 'posts',
      rows,
      summary: [
        { label: 'Posts', value: rows.length, type: 'int' },
        { label: 'Posted', value: rows.filter(r => r.status === 'Posted').length, type: 'int' },
        { label: 'Impressions', value: sum(rows, 'impressions'), type: 'int' },
        { label: 'Engagements', value: sum(rows, 'likes') + sum(rows, 'comments') + sum(rows, 'shares') + sum(rows, 'saves'), type: 'int' },
      ],
    }]
  },
})

// ---- Traffic ----------------------------------------------------------------------------------

async function traffic<T extends 'acquisition' | 'behaviour' | 'products' | 'search' | 'audience'>(tab: T, ctx: ExportRunContext) {
  const period = trafficPeriod(ctx.range.from ?? null, ctx.range.to ?? null)
  return trafficReport(tab, period, { selfHosts: selfHostsFor(null, process.env.NEXT_PUBLIC_BASE_URL) })
}

const wants = (picked: string[] | null, key: string) => !picked || picked.includes(key)
const conv = (r: Row) => pc(ratio(num(r.convertedSessions), num(r.sessions)))

const SESSION_COLS: ExportColumn[] = [int('sessions', 'Sessions'), int('convertedSessions', 'Converted sessions'), pct('conversion_rate', 'Conversion rate'), int('orders', 'Orders'), money('revenue', 'Revenue')]

const SOURCES_TABLES = multi('tables', 'Tables', [['channels', 'By channel'], ['sourceMedium', 'Source / medium'], ['campaigns', 'Campaigns'], ['referrers', 'Referrers']])
const SOURCES_TYPE = multi('type', 'Traffic type', [['paid', 'Paid'], ['free', 'Free']], 'Applies to the channel table.')

export const TRAFFIC_SOURCES_EXPORT = defineExport({
  key: 'traffic.sources',
  title: 'Traffic sources',
  noun: 'Sources',
  scope: 'traffic:read',
  columns: [{ key: 'label', label: 'Channel', id: true, width: 1.5 }, { key: 'type', label: 'Type' }, int('sessions', 'Sessions'), int('newVisitors', 'New visitors'), int('convertedSessions', 'Converted sessions'), pct('conversion_rate', 'Conversion rate'), int('orders', 'Orders'), money('revenue', 'Revenue')],
  filters: [SOURCES_TABLES, SOURCES_TYPE],
  scopes: ['filtered'],
  dateRange: true,
  rangeFromQuery,
  filename: filename('traffic-sources'),
  sections: async ctx => {
    const d = await traffic('acquisition', ctx)
    const tables = narrowed(SOURCES_TABLES, ctx.filters)
    const type = narrowed(SOURCES_TYPE, ctx.filters)
    const out: ExportSection[] = []
    if (wants(tables, 'channels')) {
      const rows = d.channels.filter(c => !type || type.includes(c.paid ? 'paid' : 'free')).map(c => ({ ...c, type: c.paid ? 'Paid' : 'Free', conversion_rate: conv(c) }))
      out.push({ key: 'channels', title: 'By channel', rows, summary: [{ label: 'Sessions', value: sum(rows, 'sessions'), type: 'int' }, { label: 'Orders', value: sum(rows, 'orders'), type: 'int' }, { label: 'Revenue', value: sum(rows, 'revenue'), type: 'money' }] })
    }
    const drill = (key: string, title: string, label: string, rows: Row[]): ExportSection => ({ key, title, columns: [{ key: 'key', label, id: true, width: 2 }, ...SESSION_COLS], rows: rows.map(r => ({ ...r, conversion_rate: conv(r) })) })
    if (wants(tables, 'sourceMedium')) out.push(drill('sourceMedium', 'Source / medium', 'Source / medium', d.sourceMedium))
    if (wants(tables, 'campaigns')) out.push(drill('campaigns', 'Campaigns', 'Campaign', d.campaigns))
    if (wants(tables, 'referrers')) out.push(drill('referrers', 'Referrers', 'Referrer', d.referrers))
    return out.length ? out : [{ key: 'none', title: 'Traffic sources', rows: [], totals: null }]
  },
})

const BEHAVIOUR_TABLES = multi('tables', 'Tables', [['pages', 'Top pages'], ['landing', 'Landing pages']])

export const TRAFFIC_PAGES_EXPORT = defineExport({
  key: 'traffic.pages',
  title: 'Traffic pages',
  noun: 'Pages',
  scope: 'traffic:read',
  columns: [{ key: 'path', label: 'Page', id: true, width: 3 }, int('views', 'Views'), int('sessions', 'Sessions', false), int('entries', 'Entries'), int('exits', 'Exits')],
  filters: [BEHAVIOUR_TABLES],
  scopes: ['filtered'],
  dateRange: true,
  rangeFromQuery,
  filename: filename('traffic-pages'),
  sections: async ctx => {
    const d = await traffic('behaviour', ctx)
    const tables = narrowed(BEHAVIOUR_TABLES, ctx.filters)
    const out: ExportSection[] = []
    if (wants(tables, 'pages')) out.push({ key: 'pages', title: 'Top pages', rows: d.pages })
    if (wants(tables, 'landing')) {
      out.push({
        key: 'landing',
        title: 'Landing pages',
        columns: [{ key: 'path', label: 'Landing page', id: true, width: 3 }, int('sessions', 'Sessions'), int('bounces', 'Bounces'), int('convertedSessions', 'Converted sessions'), money('revenue', 'Revenue')],
        rows: d.landing,
      })
    }
    return out.length ? out : [{ key: 'none', title: 'Traffic pages', rows: [], totals: null }]
  },
})

const PRODUCT_BOUGHT = toggle('bought', 'Only products that were bought', 'Leave out products that were viewed but had no orders.')
const PRODUCT_CARTED = toggle('carted', 'Only products added to a cart')

export const TRAFFIC_PRODUCTS_EXPORT = defineExport({
  key: 'traffic.products',
  title: 'Product traffic',
  noun: 'Products',
  scope: 'traffic:read',
  columns: [
    { key: 'name', label: 'Product', id: true, width: 2 },
    int('views', 'Views'),
    int('uniqueViewers', 'Unique viewers', false),
    int('cartAdds', 'Cart adds'),
    int('orders', 'Orders'),
    int('units', 'Units'),
    money('revenue', 'Revenue'),
    int('wishlisted', 'Wishlisted'),
    int('waiting', 'Back-in-stock requests'),
    { key: 'slug', label: 'Slug', optional: true },
  ],
  filters: [PRODUCT_BOUGHT, PRODUCT_CARTED],
  scopes: ['filtered'],
  dateRange: true,
  rangeFromQuery,
  filename: filename('traffic-products'),
  sections: async ctx => {
    const d = await traffic('products', ctx)
    const rows = d.products.filter(p => (ctx.filters.bought !== true || p.orders > 0) && (ctx.filters.carted !== true || p.cartAdds > 0))
    return [{ key: 'products', rows, summary: [{ label: 'Products', value: rows.length, type: 'int' }, { label: 'Views', value: sum(rows, 'views'), type: 'int' }, { label: 'Orders', value: sum(rows, 'orders'), type: 'int' }, { label: 'Revenue', value: sum(rows, 'revenue'), type: 'money' }] }]
  },
})

const SEARCH_TABLES = multi('tables', 'Tables', [['terms', 'Top search terms'], ['zero', 'Zero-result terms'], ['noEngagement', 'Results shown, nothing clicked or bought']])

const TERM_COLS: ExportColumn[] = [{ key: 'term', label: 'Search term', id: true, width: 2 }, int('searches', 'Searches'), int('zeroResults', 'Zero results'), dec('avgResults', 'Avg results'), int('searchers', 'Searchers', false), int('signedInSearchers', 'Signed-in searchers', false), int('clickedSearchers', 'Clicked', false), int('orderedSearchers', 'Ordered', false)]

export const TRAFFIC_SEARCH_EXPORT = defineExport({
  key: 'traffic.search',
  title: 'Site search',
  noun: 'Terms',
  scope: 'traffic:read',
  columns: TERM_COLS,
  filters: [SEARCH_TABLES],
  scopes: ['filtered'],
  dateRange: true,
  rangeFromQuery,
  filename: filename('traffic-search'),
  sections: async ctx => {
    const d = await traffic('search', ctx)
    const tables = narrowed(SEARCH_TABLES, ctx.filters)
    const out: ExportSection[] = []
    if (wants(tables, 'terms')) out.push({ key: 'terms', title: 'Top search terms', rows: d.terms, summary: [{ label: 'Searches', value: d.current.searches, type: 'int' }, { label: 'Searchers', value: d.current.searchers, type: 'int' }, { label: 'Zero-result searches', value: d.current.zeroResults, type: 'int' }, { label: 'Purchasers', value: d.current.purchasers, type: 'int' }] })
    if (wants(tables, 'zero')) out.push({ key: 'zero', title: 'Zero-result terms', columns: [{ key: 'term', label: 'Search term', id: true, width: 2 }, int('searches', 'Searches'), { key: 'lastSearched', label: 'Last searched', type: 'datetime' }], rows: d.zeroTerms })
    if (wants(tables, 'noEngagement')) out.push({ key: 'noEngagement', title: 'Results shown, nothing clicked or bought', rows: d.noEngagement })
    return out.length ? out : [{ key: 'none', title: 'Site search', rows: [], totals: null }]
  },
})

const AUDIENCE_TABLES = multi('tables', 'Tables', [['devices', 'Devices'], ['browsers', 'Browsers'], ['os', 'Operating systems'], ['newReturning', 'New vs returning'], ['loggedIn', 'Signed in'], ['states', 'States'], ['cities', 'Cities']], undefined, ['devices', 'newReturning', 'states', 'cities'])

export const TRAFFIC_AUDIENCE_EXPORT = defineExport({
  key: 'traffic.audience',
  title: 'Audience',
  noun: 'Rows',
  scope: 'traffic:read',
  columns: [{ key: 'key', label: 'Segment', id: true, width: 2 }, int('sessions', 'Sessions'), int('convertedSessions', 'Converted sessions'), pct('conversion_rate', 'Conversion rate')],
  filters: [AUDIENCE_TABLES],
  scopes: ['filtered'],
  dateRange: true,
  rangeFromQuery,
  filename: filename('traffic-audience'),
  sections: async ctx => {
    const d = await traffic('audience', ctx)
    const tables = narrowed(AUDIENCE_TABLES, ctx.filters)
    const out: ExportSection[] = []
    const share = (key: string, title: string, rows: Row[]) => {
      if (wants(tables, key)) out.push({ key, title, rows: rows.map(r => ({ ...r, conversion_rate: conv(r) })) })
    }
    share('devices', 'Devices', d.devices)
    share('browsers', 'Browsers', d.browsers)
    share('os', 'Operating systems', d.os)
    share('newReturning', 'New vs returning', d.newReturning)
    share('loggedIn', 'Signed in', d.loggedIn)
    const geo = (key: string, title: string, label: string, rows: Row[]) => {
      if (wants(tables, key)) out.push({ key, title, columns: [{ key: 'key', label, id: true, width: 2 }, int('orders', 'Orders'), money('revenue', 'Revenue')], rows })
    }
    geo('states', 'States', 'State', d.states)
    geo('cities', 'Cities', 'City', d.cities)
    return out.length ? out : [{ key: 'none', title: 'Audience', rows: [], totals: null }]
  },
})

// ---- Ads --------------------------------------------------------------------------------------

function adSummary(rows: Row[], f: { spend: string; impressions?: string; clicks?: string; conversions?: string; conversionsLabel?: string; value?: string; valueLabel?: string }): Summary {
  const spend = sum(rows, f.spend)
  const impressions = f.impressions ? sum(rows, f.impressions) : 0
  const clicks = f.clicks ? sum(rows, f.clicks) : 0
  const out: Summary = [{ label: 'Spend', value: spend, type: 'money' }]
  if (f.impressions) out.push({ label: 'Impressions', value: impressions, type: 'int' })
  if (f.clicks) out.push({ label: 'Clicks', value: clicks, type: 'int' })
  if (f.impressions && f.clicks) out.push({ label: 'CTR', value: pc(ratio(clicks, impressions)), type: 'percent' })
  if (f.conversions) out.push({ label: f.conversionsLabel ?? 'Conversions', value: sum(rows, f.conversions), type: 'number' })
  if (f.value) {
    const value = sum(rows, f.value)
    out.push({ label: f.valueLabel ?? 'Conversion value', value, type: 'money' })
    out.push({ label: 'ROAS', value: ratio(value, spend), type: 'number' })
  }
  return out
}

// Google Ads

const GOOGLE_STATUS = ['ENABLED', 'PAUSED', 'REMOVED']
const GOOGLE_CHANNELS = ['SEARCH', 'SHOPPING', 'PERFORMANCE_MAX', 'DISPLAY', 'VIDEO', 'DEMAND_GEN']
const humanize = (s: unknown) => (s == null || s === '' ? '' : String(s).replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase()))
const GOOGLE_STATUS_FILTER = multi('status', 'Status', [['ENABLED', 'Enabled'], ['PAUSED', 'Paused'], ['REMOVED', 'Removed'], ['other', 'Other']])
const GOOGLE_TYPE_FILTER = multi('types', 'Campaign types', [['SEARCH', 'Search'], ['SHOPPING', 'Shopping'], ['PERFORMANCE_MAX', 'Performance Max'], ['DISPLAY', 'Display'], ['VIDEO', 'Video'], ['DEMAND_GEN', 'Demand Gen'], ['other', 'Other']])
const GOOGLE_ACTIVE = toggle('withClicks', 'Only rows with clicks', 'Leave out rows that were shown but never clicked.')

const googleRange = (ctx: ExportRunContext) => parseGoogleRange(ctx.range.from ?? null, ctx.range.to ?? null)

const GOOGLE_KPI_COLS: ExportColumn[] = [
  money('cost', 'Spend'),
  int('impressions', 'Impressions'),
  int('clicks', 'Clicks'),
  pct('ctr', 'CTR'),
  money('avgCpc', 'Avg CPC'),
  dec('conversions', 'Conversions', true),
  money('conversionsValue', 'Conv. value'),
  dec('roas', 'ROAS (Google)'),
  money('costPerConversion', 'Cost / conv.', false, { optional: true }),
]
const googleKpis = (r: Row) => ({ cost: r.cost, impressions: r.impressions, clicks: r.clicks, ctr: pc(r.ctr), avgCpc: r.avgCpc, conversions: r.conversions, conversionsValue: r.conversionsValue, roas: r.roas, costPerConversion: r.costPerConversion })
const GOOGLE_SUMMARY = { spend: 'cost', impressions: 'impressions', clicks: 'clicks', conversions: 'conversions', value: 'conversionsValue', valueLabel: 'Conv. value' }

export const GOOGLE_ADS_CAMPAIGNS_EXPORT = defineExport({
  key: 'google-ads.campaigns',
  title: 'Google Ads campaigns',
  noun: 'Campaigns',
  scope: 'google_ads:read',
  columns: [
    { key: 'name', label: 'Campaign', id: true, width: 1.8 },
    { key: 'campaignId', label: 'Campaign ID', optional: true },
    { key: 'status', label: 'Status' },
    { key: 'channelType', label: 'Type' },
    { key: 'biddingStrategy', label: 'Bid strategy', optional: true },
    money('budget', 'Budget', false),
    ...GOOGLE_KPI_COLS,
  ],
  filters: [GOOGLE_STATUS_FILTER, GOOGLE_TYPE_FILTER, GOOGLE_ACTIVE],
  scopes: ['filtered'],
  dateRange: true,
  filename: filename('google-ads-campaigns'),
  sections: async ctx => {
    const status = narrowed(GOOGLE_STATUS_FILTER, ctx.filters)
    const types = narrowed(GOOGLE_TYPE_FILTER, ctx.filters)
    const rows = (await loadGoogleCampaigns(googleRange(ctx)) as Row[])
      .filter(r => inPick(status, r.status, GOOGLE_STATUS) && inPick(types, r.channelType, GOOGLE_CHANNELS) && (ctx.filters.withClicks !== true || r.clicks > 0))
      .map(r => ({ ...r, status: humanize(r.status), channelType: humanize(r.channelType), biddingStrategy: humanize(r.biddingStrategy), ...googleKpis(r) }))
    return [{ key: 'campaigns', rows, summary: adSummary(rows, GOOGLE_SUMMARY) }]
  },
})

const GOOGLE_FLAGGED = toggle('flagged', 'Only flagged items', 'Out of stock, loss-making or other flagged Shopping items.')

export const GOOGLE_ADS_PRODUCTS_EXPORT = defineExport({
  key: 'google-ads.products',
  title: 'Google Ads Shopping items',
  noun: 'Items',
  scope: 'google_ads:read',
  columns: [
    { key: 'item', label: 'Item', id: true, width: 2 },
    { key: 'sku', label: 'SKU', id: true },
    { key: 'itemId', label: 'Item ID', optional: true },
    int('stock', 'Stock', false),
    { key: 'stockStatus', label: 'Stock status', optional: true },
    money('price', 'Price', false),
    money('costPrice', 'Cost price', false, { optional: true }),
    money('unitMargin', 'Unit margin', false),
    { key: 'flags', label: 'Flags', width: 1.5 },
    ...GOOGLE_KPI_COLS,
  ],
  filters: [GOOGLE_FLAGGED, GOOGLE_ACTIVE],
  scopes: ['filtered'],
  dateRange: true,
  filename: filename('google-ads-products'),
  sections: async ctx => {
    const { items } = (await loadGoogleProducts(googleRange(ctx))) as { items: Row[] }
    const rows = items
      .filter(r => (ctx.filters.flagged !== true || r.flags.some((f: string) => f !== 'unmatched')) && (ctx.filters.withClicks !== true || r.clicks > 0))
      .map(r => ({ ...r, item: r.productName || r.title || r.itemId, flags: r.flags.map(humanize).join(', '), ...googleKpis(r) }))
    return [{ key: 'items', rows, summary: adSummary(rows, GOOGLE_SUMMARY) }]
  },
})

const GOOGLE_CATALOGUE = multi('catalogue', 'Search terms', [['in', 'In our catalogue'], ['out', 'Not in our catalogue']])

export const GOOGLE_ADS_SEARCH_TERMS_EXPORT = defineExport({
  key: 'google-ads.search-terms',
  title: 'Google Ads search terms',
  noun: 'Search terms',
  scope: 'google_ads:read',
  columns: [
    { key: 'term', label: 'Search term', id: true, width: 2 },
    { key: 'keyword', label: 'Keyword' },
    { key: 'status', label: 'Status', optional: true },
    { key: 'inCatalogue', label: 'In our catalogue', type: 'bool' },
    { key: 'campaignChannel', label: 'Campaign type', optional: true },
    ...GOOGLE_KPI_COLS,
  ],
  filters: [GOOGLE_CATALOGUE, GOOGLE_ACTIVE],
  scopes: ['filtered'],
  dateRange: true,
  filename: filename('google-ads-search-terms'),
  sections: async ctx => {
    const cat = narrowed(GOOGLE_CATALOGUE, ctx.filters)
    const { searchTerms } = (await loadGoogleKeywords(googleRange(ctx))) as { searchTerms: Row[] }
    const rows = searchTerms
      .filter(r => (!cat || cat.includes(r.inCatalogue ? 'in' : 'out')) && (ctx.filters.withClicks !== true || r.clicks > 0))
      .map(r => ({ ...r, status: humanize(r.status), campaignChannel: humanize(r.campaignChannel), ...googleKpis(r) }))
    return [{ key: 'terms', rows, summary: adSummary(rows, GOOGLE_SUMMARY) }]
  },
})

// Meta Ads

const META_STATUS = ['ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED']
const META_STATUS_FILTER = multi('status', 'Status', [['ACTIVE', 'Active'], ['PAUSED', 'Paused'], ['ARCHIVED', 'Archived'], ['DELETED', 'Deleted'], ['other', 'Other']])
const META_SPENT = toggle('withSpend', 'Only rows with spend')

function metaExport(tab: 'campaigns' | 'adsets' | 'ads', title: string, noun: string): ExportDefinition {
  return defineExport({
    key: `meta-ads.${tab}`,
    title,
    noun,
    scope: 'meta_ads:read',
    columns: [
      { key: 'name', label: noun.replace(/s$/, ''), id: true, width: 1.8 },
      { key: 'id', label: 'ID', optional: true },
      { key: 'status', label: 'Status' },
      { key: 'effective', label: 'Delivery', optional: true },
      { key: 'objective', label: 'Objective' },
      money('dailyBudget', 'Daily budget', false, { optional: true }),
      money('spend', 'Spend'),
      int('impressions', 'Impressions'),
      int('reach', 'Reach', false),
      int('clicks', 'Clicks'),
      int('linkClicks', 'Link clicks'),
      pct('ctr', 'CTR (link)'),
      money('cpc', 'CPC (link)'),
      int('purchases', 'Purchases'),
      money('value', 'Purchase value'),
      money('cpa', 'Cost / purchase'),
      dec('roas', 'ROAS'),
    ],
    filters: [META_STATUS_FILTER, META_SPENT],
    scopes: ['filtered'],
    dateRange: true,
    filename: filename(`meta-ads-${tab}`),
    sections: async ctx => {
      const r = rangeOf(ctx)
      const status = narrowed(META_STATUS_FILTER, ctx.filters)
      const { rows: all } = (await loadMetaEntities(tab, r)) as { rows: Row[] }
      const rows = all.filter(x => inPick(status, x.status, META_STATUS) && (ctx.filters.withSpend !== true || x.spend > 0)).map(x => ({ ...x, ctr: pc(x.ctr) }))
      return [{ key: tab, rows, summary: adSummary(rows, { spend: 'spend', impressions: 'impressions', clicks: 'linkClicks', conversions: 'purchases', conversionsLabel: 'Purchases', value: 'value', valueLabel: 'Purchase value' }) }]
    },
  })
}

export const META_ADS_CAMPAIGNS_EXPORT = metaExport('campaigns', 'Meta Ads campaigns', 'Campaigns')
export const META_ADS_ADSETS_EXPORT = metaExport('adsets', 'Meta Ads ad sets', 'Ad sets')
export const META_ADS_ADS_EXPORT = metaExport('ads', 'Meta Ads ads', 'Ads')

// Amazon Ads

const AMAZON_STATE_FILTER = multi('state', 'State', [['ENABLED', 'Enabled'], ['PAUSED', 'Paused'], ['ARCHIVED', 'Archived'], ['other', 'Other']])
const AMAZON_TARGETING_FILTER = multi('targeting', 'Targeting', [['AUTO', 'Automatic'], ['MANUAL', 'Manual'], ['other', 'Other']])
const AMAZON_SPENT = toggle('withSpend', 'Only rows with spend')

const AMAZON_KPI_COLS: ExportColumn[] = [
  money('cost', 'Spend'),
  int('impressions', 'Impressions'),
  int('clicks', 'Clicks'),
  pct('ctr', 'CTR'),
  money('cpc', 'CPC'),
  int('orders', 'Orders'),
  money('sales', 'Sales'),
  pct('acos', 'ACoS'),
  dec('roas', 'ROAS'),
]
const amazonKpis = (r: Row) => ({ cost: r.cost, impressions: r.impressions, clicks: r.clicks, ctr: pc(r.ctr), cpc: r.cpc, orders: r.orders, sales: r.sales, acos: pc(r.acos), roas: r.roas })
const AMAZON_SUMMARY = { spend: 'cost', impressions: 'impressions', clicks: 'clicks', conversions: 'orders', conversionsLabel: 'Orders', value: 'sales', valueLabel: 'Ad sales' }

export const AMAZON_ADS_CAMPAIGNS_EXPORT = defineExport({
  key: 'amazon-ads.campaigns',
  title: 'Amazon Ads campaigns',
  noun: 'Campaigns',
  scope: 'amazon_ads:read',
  columns: [
    { key: 'name', label: 'Campaign', id: true, width: 1.8 },
    { key: 'campaignId', label: 'Campaign ID', optional: true },
    { key: 'state', label: 'State' },
    { key: 'targeting', label: 'Targeting' },
    money('budget', 'Daily budget', false),
    { key: 'strategy', label: 'Bid strategy', optional: true },
    ...AMAZON_KPI_COLS,
  ],
  filters: [AMAZON_STATE_FILTER, AMAZON_TARGETING_FILTER, AMAZON_SPENT],
  scopes: ['filtered'],
  dateRange: true,
  filename: filename('amazon-ads-campaigns'),
  sections: async ctx => {
    const state = narrowed(AMAZON_STATE_FILTER, ctx.filters)
    const targeting = narrowed(AMAZON_TARGETING_FILTER, ctx.filters)
    const { rows: all } = (await loadAmazonCampaigns(rangeOf(ctx, 1))) as { rows: Row[] }
    const rows = all
      .filter(r => inPick(state, r.state, ['ENABLED', 'PAUSED', 'ARCHIVED']) && inPick(targeting, r.targeting, ['AUTO', 'MANUAL']) && (ctx.filters.withSpend !== true || r.cost > 0))
      .map(r => ({ ...r, ...amazonKpis(r) }))
    return [{ key: 'campaigns', rows, summary: adSummary(rows, AMAZON_SUMMARY) }]
  },
})

const AMAZON_MATCH_FILTER = multi('match', 'Match type', [['EXACT', 'Exact'], ['PHRASE', 'Phrase'], ['BROAD', 'Broad'], ['other', 'Other']])
const AMAZON_NEGATIVES = toggle('negatives', 'Include negative keywords', undefined, true)

export const AMAZON_ADS_KEYWORDS_EXPORT = defineExport({
  key: 'amazon-ads.keywords',
  title: 'Amazon Ads keywords',
  noun: 'Keywords',
  scope: 'amazon_ads:read',
  columns: [
    { key: 'text', label: 'Keyword', id: true, width: 2 },
    { key: 'matchType', label: 'Match type' },
    { key: 'state', label: 'State' },
    { key: 'negative', label: 'Negative', type: 'bool' },
    money('bid', 'Bid', false),
    { key: 'campaign', label: 'Campaign', width: 1.5 },
    { key: 'adGroup', label: 'Ad group', optional: true },
    ...AMAZON_KPI_COLS,
  ],
  filters: [AMAZON_STATE_FILTER, AMAZON_MATCH_FILTER, AMAZON_NEGATIVES, AMAZON_SPENT],
  scopes: ['filtered'],
  dateRange: true,
  filename: filename('amazon-ads-keywords'),
  sections: async ctx => {
    const state = narrowed(AMAZON_STATE_FILTER, ctx.filters)
    const match = narrowed(AMAZON_MATCH_FILTER, ctx.filters)
    const { rows: all } = (await loadAmazonKeywords(rangeOf(ctx, 1))) as { rows: Row[] }
    const rows = all
      .filter(r => inPick(state, r.state, ['ENABLED', 'PAUSED', 'ARCHIVED']) && inPick(match, r.matchType, ['EXACT', 'PHRASE', 'BROAD']) && (ctx.filters.negatives !== false || !r.negative) && (ctx.filters.withSpend !== true || r.cost > 0))
      .map(r => ({ ...r, ...amazonKpis(r) }))
    return [{ key: 'keywords', rows, summary: adSummary(rows, AMAZON_SUMMARY) }]
  },
})

const AMAZON_SUGGESTION = multi('suggestion', 'Suggestion', [['harvest', 'Add as exact keyword'], ['negate', 'Add as negative'], ['none', 'No suggestion']])

export const AMAZON_ADS_SEARCH_TERMS_EXPORT = defineExport({
  key: 'amazon-ads.search-terms',
  title: 'Amazon Ads search terms',
  noun: 'Search terms',
  scope: 'amazon_ads:read',
  columns: [
    { key: 'term', label: 'Search term', id: true, width: 2 },
    { key: 'suggestion', label: 'Suggestion' },
    { key: 'isExact', label: 'Already exact keyword', type: 'bool', optional: true },
    { key: 'isNegative', label: 'Already negative', type: 'bool', optional: true },
    { key: 'campaign', label: 'Campaign', width: 1.5 },
    { key: 'adGroup', label: 'Ad group', optional: true },
    ...AMAZON_KPI_COLS,
  ],
  filters: [AMAZON_SUGGESTION, AMAZON_SPENT],
  scopes: ['filtered'],
  dateRange: true,
  filename: filename('amazon-ads-search-terms'),
  sections: async ctx => {
    const sug = narrowed(AMAZON_SUGGESTION, ctx.filters)
    const { rows: all } = (await loadAmazonSearchTerms(rangeOf(ctx, 1))) as { rows: Row[] }
    const label: Record<string, string> = { harvest: 'Add as exact keyword', negate: 'Add as negative', none: '' }
    const rows = all
      .filter(r => (!sug || sug.includes(r.suggestion ?? 'none')) && (ctx.filters.withSpend !== true || r.cost > 0))
      .map(r => ({ ...r, suggestion: label[r.suggestion ?? 'none'], ...amazonKpis(r) }))
    return [{ key: 'terms', rows, summary: adSummary(rows, AMAZON_SUMMARY) }]
  },
})

export const AMAZON_ADS_PRODUCTS_EXPORT = defineExport({
  key: 'amazon-ads.products',
  title: 'Amazon Ads products',
  noun: 'Products',
  scope: 'amazon_ads:read',
  columns: [
    { key: 'name', label: 'Product', id: true, width: 2 },
    { key: 'sku', label: 'SKU', id: true },
    { key: 'asin', label: 'ASIN', optional: true },
    { key: 'stockStatus', label: 'Stock status', optional: true },
    int('units', 'Units'),
    ...AMAZON_KPI_COLS,
    money('profitAfterAds', 'Profit after ads'),
  ],
  filters: [AMAZON_SPENT],
  scopes: ['filtered'],
  dateRange: true,
  filename: filename('amazon-ads-products'),
  sections: async ctx => {
    const { rows: all } = (await loadAmazonProducts(rangeOf(ctx, 1))) as { rows: Row[] }
    const rows = all.filter(r => ctx.filters.withSpend !== true || r.cost > 0).map(r => ({ ...r, name: r.name ?? r.sku, ...amazonKpis(r) }))
    return [{ key: 'products', rows, summary: [...adSummary(rows, AMAZON_SUMMARY), { label: 'Profit after ads', value: sum(rows, 'profitAfterAds'), type: 'money' as const }] }]
  },
})

// Myntra, AJIO and Flipkart Ads (imported reports)

const MARKET_SPENT = toggle('withSpend', 'Only rows with spend')
const MARKET_MATCH = multi('match', 'Products', [['matched', 'Matched to the catalogue'], ['unmatched', 'Not matched']])
const MARKET_KPI_COLS: ExportColumn[] = [
  money('cost', 'Spend'),
  money('sales', 'Sales'),
  pct('acos', 'ACoS'),
  int('clicks', 'Clicks'),
  int('impressions', 'Impressions'),
  pct('ctr', 'CTR'),
  money('cpc', 'CPC'),
  int('orders', 'Orders'),
  int('units', 'Units'),
]
const marketKpis = (r: Row) => ({ cost: r.cost, sales: r.sales, acos: pc(r.acos), clicks: r.clicks, impressions: r.impressions, ctr: pc(r.ctr), cpc: r.cpc, orders: r.orders, units: r.units })
const MARKET_SUMMARY = { spend: 'cost', impressions: 'impressions', clicks: 'clicks', conversions: 'orders', conversionsLabel: 'Orders', value: 'sales', valueLabel: 'Ad sales' }

function marketplaceExports(channel: AdsChannel, title: string): ExportDefinition[] {
  const prefix = channel.replace('_', '-')
  const campaigns = defineExport({
    key: `${prefix}.campaigns`,
    title: `${title} campaigns`,
    noun: 'Campaigns',
    scope: `${channel}:read`,
    columns: [{ key: 'name', label: 'Campaign', id: true, width: 2 }, int('adGroups', 'Ad groups', false), int('days', 'Days', false), ...MARKET_KPI_COLS],
    filters: [MARKET_SPENT],
    scopes: ['filtered'],
    dateRange: true,
    filename: filename(`${prefix}-campaigns`),
    sections: async ctx => {
      const { rows: all } = (await loadMarketCampaigns(channel, rangeOf(ctx, 1))) as { rows: Row[] }
      const rows = all.filter(r => ctx.filters.withSpend !== true || r.cost > 0).map(r => ({ ...r, ...marketKpis(r) }))
      return [{ key: 'campaigns', rows, summary: adSummary(rows, MARKET_SUMMARY) }]
    },
  })
  const products = defineExport({
    key: `${prefix}.products`,
    title: `${title} advertised products`,
    noun: 'Products',
    scope: `${channel}:read`,
    columns: [
      { key: 'name', label: 'Product', id: true, width: 2 },
      { key: 'sku', label: 'SKU', id: true },
      { key: 'styleId', label: 'Style ID', optional: true },
      { key: 'matched', label: 'Matched', type: 'bool', optional: true },
      { key: 'stockStatus', label: 'Stock status', optional: true },
      money('unitCost', 'Unit cost', false, { optional: true }),
      ...MARKET_KPI_COLS,
      money('profitAfterAds', 'Profit after ads'),
    ],
    filters: [MARKET_MATCH, MARKET_SPENT],
    scopes: ['filtered'],
    dateRange: true,
    filename: filename(`${prefix}-products`),
    sections: async ctx => {
      const match = narrowed(MARKET_MATCH, ctx.filters)
      const { rows: all } = (await loadMarketProducts(channel, rangeOf(ctx, 1))) as { rows: Row[] }
      const rows = all
        .filter(r => (!match || match.includes(r.matched ? 'matched' : 'unmatched')) && (ctx.filters.withSpend !== true || r.cost > 0))
        .map(r => ({ ...r, name: r.name ?? r.productKey, ...marketKpis(r) }))
      return [{ key: 'products', rows, summary: [...adSummary(rows, MARKET_SUMMARY), { label: 'Profit after ads', value: sum(rows, 'profitAfterAds'), type: 'money' as const }] }]
    },
  })
  return [campaigns, products]
}

// ---- Google Merchant Center -------------------------------------------------------------------

const GMC_STATUS = ['approved', 'pending', 'disapproved']
const GMC_STATUS_FILTER = multi('status', 'Status', [['approved', 'Approved'], ['pending', 'Pending'], ['disapproved', 'Disapproved'], ['other', 'Unknown']])

export const MERCHANT_PRODUCTS_EXPORT = defineExport({
  key: 'merchant.products',
  title: 'Google Merchant products',
  noun: 'Products',
  scope: 'merchant_sync:read',
  columns: [
    { key: 'offer_id', label: 'Offer ID', id: true },
    { key: 'title', label: 'Title', width: 2.5 },
    { key: 'status', label: 'Status' },
    { key: 'top_issue', label: 'Top issue', width: 2 },
    int('issue_count', 'Issues', false),
    { key: 'price', label: 'Price', optional: true },
    { key: 'item_group_id', label: 'Item group', optional: true },
    { key: 'link', label: 'Link', optional: true },
    { key: 'synced_at', label: 'Synced', type: 'datetime', optional: true },
  ],
  filters: [GMC_STATUS_FILTER],
  scopes: ['filtered'],
  sections: async ctx => {
    const status = narrowed(GMC_STATUS_FILTER, ctx.filters)
    const SIZE = 200
    async function* gen(): AsyncIterable<Row[]> {
      for await (const batch of paged(async page => getGmcStatusPage({ page, pageSize: SIZE }) as Promise<{ rows: Row[]; total: number }>, SIZE)) {
        const rows = batch
          .filter(r => inPick(status, (r.status || 'unknown').toLowerCase(), GMC_STATUS))
          .map(r => ({
            offer_id: r.offer_id,
            title: r.title,
            status: r.status ? r.status.toLowerCase() : 'unknown',
            top_issue: r.item_issues?.[0]?.description ?? '',
            issue_count: r.item_issues?.length ?? 0,
            price: r.price,
            item_group_id: r.item_group_id,
            link: r.link,
            synced_at: r.synced_at,
          }))
        if (rows.length) yield rows
      }
    }
    return [{ key: 'products', rows: gen(), totals: null }]
  },
})

const GMC_SOURCE = multi('clicks', 'Clicks from', [['organic', 'Free listings'], ['ads', 'Shopping ads'], ['none', 'No clicks (impressions only)']])

export const MERCHANT_PERFORMANCE_EXPORT = defineExport({
  key: 'merchant.performance',
  title: 'Google Merchant performance',
  noun: 'Products',
  scope: 'merchant_sync:read',
  columns: [
    { key: 'title', label: 'Product', id: true, width: 2.5 },
    { key: 'offerId', label: 'Offer ID', id: true },
    int('organicClicks', 'Free clicks'),
    int('adsClicks', 'Ad clicks'),
    int('impressions', 'Impressions'),
    int('clicks', 'Clicks'),
    pct('ctr', 'CTR'),
    dec('conversions', 'Conversions', true),
    money('value', 'Value'),
  ],
  filters: [GMC_SOURCE],
  scopes: ['filtered'],
  dateRange: true,
  filename: filename('merchant-performance'),
  sections: async ctx => {
    const src = narrowed(GMC_SOURCE, ctx.filters)
    const { rows: all } = (await loadMerchantPerformance(rangeOf(ctx, 1))) as { rows: Row[] }
    const rows = all
      .filter(r => !src || (src.includes('organic') && r.organicClicks > 0) || (src.includes('ads') && r.adsClicks > 0) || (src.includes('none') && r.clicks === 0))
      .map(r => ({ ...r, title: r.title ?? r.offerId, ctr: pc(ratio(r.clicks, r.impressions)) }))
    const clicks = sum(rows, 'clicks')
    const impressions = sum(rows, 'impressions')
    return [{
      key: 'products',
      rows,
      summary: [
        { label: 'Clicks', value: clicks, type: 'int' },
        { label: 'Impressions', value: impressions, type: 'int' },
        { label: 'CTR', value: pc(ratio(clicks, impressions)), type: 'percent' },
        { label: 'Conversions', value: sum(rows, 'conversions'), type: 'number' },
        { label: 'Value', value: sum(rows, 'value'), type: 'money' },
      ],
    }]
  },
})

const GMC_SERVABILITY = multi('servability', 'Effect on listings', [['disapproved', 'Disapproved'], ['demoted', 'Demoted'], ['unaffected', 'Unaffected'], ['other', 'Other']])

export const MERCHANT_ISSUES_EXPORT = defineExport({
  key: 'merchant.issues',
  title: 'Google Merchant product issues',
  noun: 'Issues',
  scope: 'merchant_sync:read',
  columns: [
    { key: 'description', label: 'Issue', id: true, width: 2.5 },
    { key: 'code', label: 'Code', id: true },
    { key: 'servability', label: 'Effect' },
    int('products', 'Products affected', false),
    { key: 'detail', label: 'Detail', optional: true, width: 2.5 },
    { key: 'offers', label: 'Example offers', optional: true, width: 2 },
    { key: 'documentation', label: 'Documentation', optional: true },
  ],
  filters: [GMC_SERVABILITY],
  scopes: ['filtered'],
  sections: async ctx => {
    const sv = narrowed(GMC_SERVABILITY, ctx.filters)
    const { groups } = (await loadMerchantIssues()) as { groups: Row[] }
    const rows = groups.filter(g => inPick(sv, g.servability, ['disapproved', 'demoted', 'unaffected'])).map(g => ({ ...g, offers: (g.offers ?? []).join(', ') }))
    return [{ key: 'issues', rows, totals: null, summary: [{ label: 'Issue types', value: rows.length, type: 'int' }] }]
  },
})

// ---- Catalog enrichment -----------------------------------------------------------------------

const ENRICH_STATUS_FILTER = multi('status', 'Status', [['proposed', 'Proposed'], ['approved', 'Approved'], ['rejected', 'Rejected']], undefined, ['proposed'])

export const CATALOG_ENRICHMENT_EXPORT = defineExport({
  key: 'catalog-enrichment.proposals',
  title: 'AI enrichment proposals',
  noun: 'Proposals',
  scope: 'catalog_enrichment:read',
  columns: [
    { key: 'product_name', label: 'Product', id: true, width: 1.8 },
    { key: 'proposed_at', label: 'Proposed', type: 'datetime', id: true },
    { key: 'status', label: 'Status' },
    { key: 'ai_product_type', label: 'Product type', optional: true },
    { key: 'ai_description', label: 'AI description', width: 3 },
    { key: 'ai_use_cases', label: 'Use cases', width: 2, optional: true },
    { key: 'ai_keywords', label: 'Keywords', optional: true },
    { key: 'meta_title', label: 'Meta title', optional: true },
    { key: 'meta_description', label: 'Meta description', optional: true },
    { key: 'promoted_at', label: 'Promoted', type: 'datetime', optional: true },
    { key: 'model', label: 'Model', optional: true },
    { key: 'error', label: 'Error', optional: true, width: 2 },
  ],
  filters: [ENRICH_STATUS_FILTER],
  scopes: ['filtered'],
  sections: async ctx => {
    const statuses = narrowed(ENRICH_STATUS_FILTER, ctx.filters)
    const SIZE = 200
    async function* gen(): AsyncIterable<Row[]> {
      for (const status of statuses ?? ['all']) {
        yield* paged(async page => {
          const { items, total } = await listEnrichmentProposals(status, SIZE, page)
          return { rows: items as Row[], total }
        }, SIZE)
      }
    }
    return [{ key: 'proposals', rows: gen(), totals: null }]
  },
})

// ---- CRM --------------------------------------------------------------------------------------

const CRM_TABLES = multi('tables', 'Lists', [['churn', 'Top churn risks'], ['drops', 'Biggest health drops'], ['atRisk', 'Just crossed into at-risk'], ['dormant', 'Just crossed into dormant'], ['signups', 'Recent sign-ups']])

const CRM_COLS: ExportColumn[] = [
  { key: 'name', label: 'Customer', id: true, width: 1.5 },
  { key: 'email', label: 'Email', width: 1.8 },
  int('score', 'Health score', false),
  int('delta', 'Score change (7 days)', false),
  int('daysSinceLastOrder', 'Days since last order', false),
  { key: 'lastOrderAt', label: 'Last order', type: 'date' },
  money('ltv', 'Lifetime value'),
  { key: 'createdAt', label: 'Joined', type: 'date' },
]

export const CRM_WATCHLIST_EXPORT = defineExport({
  key: 'crm.watchlist',
  title: 'CRM watchlist',
  noun: 'Customers',
  scope: 'customers:read',
  columns: CRM_COLS,
  filters: [CRM_TABLES],
  scopes: ['filtered'],
  sections: async ctx => {
    const tables = narrowed(CRM_TABLES, ctx.filters)
    const d = await getCrmDashboardData(ctx.admin.adminId)
    const out: ExportSection[] = []
    const list = (key: string, title: string, rows: Row[], columns: string[]): void => {
      if (!wants(tables, key)) return
      const keep = new Set(['name', 'email', ...columns])
      out.push({ key, title, columns: CRM_COLS.filter(c => keep.has(c.key)), rows })
    }
    list('churn', 'Top churn risks', d.health.topChurnRisks, ['score', 'daysSinceLastOrder', 'ltv'])
    list('drops', 'Biggest health drops', d.health.biggestDrops, ['score', 'delta'])
    list('atRisk', 'Just crossed into at-risk', d.crossingAtRisk, ['lastOrderAt', 'ltv'])
    list('dormant', 'Just crossed into dormant', d.crossingDormant, ['lastOrderAt', 'ltv'])
    list('signups', 'Recent sign-ups', d.recentSignups, ['createdAt'])
    return out.length ? out : [{ key: 'none', title: 'CRM watchlist', rows: [], totals: null }]
  },
})

// ---- CRM overview: top customers and cohorts --------------------------------------------------

const HEALTH_BAND: [string, string][] = [['healthy', 'Healthy (60+)'], ['watch', 'Watch (40-59)'], ['critical', 'Critical (under 40)'], ['unscored', 'Not scored']]
const HEALTH_BAND_FILTER = multi('bands', 'Health', HEALTH_BAND, 'Untick a health band to leave those customers out.')
const healthBand = (score: number | null) => (score == null ? 'unscored' : score >= 60 ? 'healthy' : score >= 40 ? 'watch' : 'critical')

export const CRM_TOP_CUSTOMERS_EXPORT = defineExport({
  key: 'crm.top-customers',
  title: 'Top customers by revenue',
  noun: 'Customers',
  scope: 'crm:read',
  columns: [
    { key: 'name', label: 'Customer', id: true, width: 1.4 },
    { key: 'email', label: 'Email', width: 1.6 },
    int('orders', 'Orders in period'),
    money('revenue', 'Revenue in period'),
    int('lifetimeOrders', 'Lifetime orders'),
    money('ltv', 'Lifetime value'),
    { key: 'firstAt', label: 'First order', type: 'date', optional: true },
    { key: 'lastAt', label: 'Last order', type: 'date' },
    int('healthScore', 'Health score', false),
    { key: 'churnRisk', label: 'Churn risk', optional: true },
    { key: 'id', label: 'Customer ID', optional: true },
  ],
  filters: [HEALTH_BAND_FILTER],
  scopes: ['filtered'],
  dateRange: true,
  rangeFromQuery,
  sections: async ctx => {
    const bands = narrowed(HEALTH_BAND_FILTER, ctx.filters)
    const period = parseCrmPeriod(ctx.range.from, ctx.range.to, crmToday())
    const d = await getCrmOverview(period)
    const rows = d.topCustomers.filter(c => !bands || bands.includes(healthBand(c.healthScore)))
    const k = d.current
    return [{
      key: 'top',
      rows,
      summary: [
        { label: 'Active customers in period', value: k.activeCustomers, type: 'int' },
        { label: 'Orders in period', value: k.orders, type: 'int' },
        { label: 'Revenue from customers in period', value: k.revenue, type: 'money' },
      ],
    }]
  },
})

const COHORT_MONTH_OPTIONS = async (): Promise<ExportFilter[]> => {
  const [y, m] = crmToday().slice(0, 7).split('-').map(Number)
  const months: [string, string][] = []
  for (let i = 11; i >= 0; i--) {
    const t = new Date(Date.UTC(y, m - 1 - i, 1))
    const value = t.toISOString().slice(0, 7)
    months.push([value, t.toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' })])
  }
  return [multi('months', 'First-order months', months, 'Untick a month to leave that cohort out.')]
}

export const CRM_COHORTS_EXPORT = defineExport({
  key: 'crm.cohorts',
  title: 'Retention by first-order month',
  noun: 'Cohorts',
  scope: 'crm:read',
  columns: [
    { key: 'cohort', label: 'First-order month', id: true },
    int('size', 'Customers'),
    pct('m1', 'Month 1'),
    pct('m2', 'Month 2'),
    pct('m3', 'Month 3'),
    pct('m4', 'Month 4'),
    pct('m5', 'Month 5'),
    pct('m6', 'Month 6'),
  ],
  filters: COHORT_MONTH_OPTIONS,
  scopes: ['filtered'],
  sections: async ctx => {
    const picked = ctx.filters.months
    const months = Array.isArray(picked) ? picked : null
    // The cohorts do not depend on the period; the page's default window feeds the same function.
    const d = await getCrmOverview(parseCrmPeriod(null, null, crmToday()))
    const all = d.cohorts
    const rows = all
      .filter(c => !months || months.includes(c.cohort))
      .map(c => ({ cohort: c.cohort, size: c.size, m1: pc(c.retention[0]), m2: pc(c.retention[1]), m3: pc(c.retention[2]), m4: pc(c.retention[3]), m5: pc(c.retention[4]), m6: pc(c.retention[5]) }))
    return [{ key: 'cohorts', rows, summary: [{ label: 'Customers in these cohorts', value: sum(rows, 'size'), type: 'int' }] }]
  },
})

// ---- Customer programmes overview: top earners and top referrers ------------------------------

const EARNER_TIER_FILTER = multi('tiers', 'Tiers', TIER_KEYS.map(k => [k, TIER_NAMES[k]] as [string, string]), 'Untick a tier to leave its members out.')

export const LOYALTY_TOP_EARNERS_EXPORT = defineExport({
  key: 'loyalty.top-earners',
  title: 'Top loyalty earners',
  noun: 'Customers',
  scope: 'campaigns:read',
  columns: [
    { key: 'name', label: 'Customer', id: true, width: 1.4 },
    { key: 'email', label: 'Email', width: 1.6 },
    { key: 'tier', label: 'Tier' },
    int('earned', 'Points earned'),
    int('redeemed', 'Points redeemed'),
    int('points', 'Balance'),
    { key: 'id', label: 'Customer ID', optional: true },
  ],
  filters: [EARNER_TIER_FILTER],
  scopes: ['filtered'],
  dateRange: true,
  rangeFromQuery,
  sections: async ctx => {
    const tiers = narrowed(EARNER_TIER_FILTER, ctx.filters)
    const period = parseOverviewPeriod(ctx.range.from, ctx.range.to)
    const raw = await queryMany<Record<string, unknown>>(TOP_EARNERS_SQL, programsArgs(period, previousPeriod(period)))
    const rows = toTopEarners(raw)
      .filter(r => inPick(tiers, r.tier, TIER_KEYS))
      .map(r => ({ ...r, tier: TIER_NAMES[r.tier as keyof typeof TIER_NAMES] ?? r.tier }))
    return [{ key: 'earners', rows, summary: [{ label: 'Customers listed', value: rows.length, type: 'int' }] }]
  },
})

export const REFERRALS_TOP_REFERRERS_EXPORT = defineExport({
  key: 'referrals.top-referrers',
  title: 'Top referrers',
  noun: 'Referrers',
  scope: 'campaigns:read',
  columns: [
    { key: 'name', label: 'Referrer', id: true, width: 1.4 },
    { key: 'email', label: 'Email', width: 1.6 },
    int('signups', 'Signups'),
    int('rewarded', 'Rewarded'),
    money('revenue', 'Referred revenue'),
    { key: 'id', label: 'Customer ID', optional: true },
  ],
  scopes: ['filtered'],
  dateRange: true,
  rangeFromQuery,
  sections: async ctx => {
    const period = parseOverviewPeriod(ctx.range.from, ctx.range.to)
    const raw = await queryMany<Record<string, unknown>>(TOP_REFERRERS_SQL, programsArgs(period, previousPeriod(period)))
    const rows = toTopReferrers(raw)
    return [{ key: 'referrers', rows, summary: [{ label: 'Referrers listed', value: rows.length, type: 'int' }] }]
  },
})

// ---- Offers overview: sales ranking -----------------------------------------------------------

const OFFER_RANK_STATUS: [string, string][] = [['live', 'Live'], ['scheduled', 'Scheduled'], ['ended', 'Ended'], ['hidden', 'Hidden']]
const OFFER_RANK_FILTER = multi('statuses', 'Status', OFFER_RANK_STATUS, 'Untick a status to leave those offers out.')

export const OFFERS_RANKING_EXPORT = defineExport({
  key: 'offers.ranking',
  title: 'Offer sales ranking',
  noun: 'Offers',
  scope: 'coupons:read',
  columns: [
    { key: 'title', label: 'Offer', id: true, width: 1.6 },
    { key: 'status', label: 'Status' },
    { key: 'endsAt', label: 'Ends', type: 'date' },
    { key: 'startsAt', label: 'Starts', type: 'date', optional: true },
    // An order line under two offers counts once in the page's totals, so per-offer figures are not summed.
    int('products', 'Products', false),
    money('sales', 'Sales', false),
    money('prevSales', 'Sales in previous period', false),
    pct('change', 'Change vs previous'),
    int('units', 'Units', false, { optional: true }),
    int('orders', 'Orders', false),
    { key: 'slug', label: 'Slug', optional: true },
  ],
  filters: [OFFER_RANK_FILTER],
  scopes: ['filtered'],
  dateRange: true,
  rangeFromQuery,
  sections: async ctx => {
    const statuses = narrowed(OFFER_RANK_FILTER, ctx.filters)
    const period = parseOverviewPeriod(ctx.range.from, ctx.range.to)
    const args = catalogArgs(period, previousPeriod(period))
    const [raw, totals] = await Promise.all([queryMany<Record<string, unknown>>(OFFERS_SQL, args), queryMany<Record<string, unknown>>(OFFER_TOTALS_SQL, args)])
    const label: Record<string, string> = { live: 'Live', scheduled: 'Scheduled', ended: 'Ended', hidden: 'Hidden' }
    const rows = raw
      .map(toOfferRow)
      .filter(r => r.status !== 'hidden' || r.sales > 0)
      .filter(r => !statuses || statuses.includes(r.status))
      .sort((a, b) => b.sales - a.sales)
      .map(r => ({ ...r, status: label[r.status] ?? r.status, change: pc(delta(r.sales, r.prevSales)) }))
    const cur = totals.find(x => x.cur === true)
    const offerSales = num(cur?.offer_sales)
    const sales = num(cur?.sales)
    return [{
      key: 'ranking',
      rows,
      totals: null,
      summary: [
        { label: 'Offers listed', value: rows.length, type: 'int' },
        { label: 'Sales with an offer (all offers)', value: offerSales, type: 'money' },
        { label: 'Orders with an offer (all offers)', value: num(cur?.offer_orders), type: 'int' },
        { label: 'Share of product sales (all offers)', value: pc(ratio(offerSales, sales)), type: 'percent' },
      ],
    }]
  },
})

export const MARKETING_EXPORTS: ExportDefinition[] = [
  CAMPAIGNS_LIST_EXPORT,
  CAMPAIGNS_PERFORMANCE_EXPORT,
  CAMPAIGNS_SENDS_EXPORT,
  LOYALTY_MEMBERS_EXPORT,
  REFERRALS_LIST_EXPORT,
  OFFERS_LIST_EXPORT,
  OFFERS_BANK_EXPORT,
  SOCIAL_POSTS_EXPORT,
  TRAFFIC_SOURCES_EXPORT,
  TRAFFIC_PAGES_EXPORT,
  TRAFFIC_PRODUCTS_EXPORT,
  TRAFFIC_SEARCH_EXPORT,
  TRAFFIC_AUDIENCE_EXPORT,
  GOOGLE_ADS_CAMPAIGNS_EXPORT,
  GOOGLE_ADS_PRODUCTS_EXPORT,
  GOOGLE_ADS_SEARCH_TERMS_EXPORT,
  META_ADS_CAMPAIGNS_EXPORT,
  META_ADS_ADSETS_EXPORT,
  META_ADS_ADS_EXPORT,
  AMAZON_ADS_CAMPAIGNS_EXPORT,
  AMAZON_ADS_KEYWORDS_EXPORT,
  AMAZON_ADS_SEARCH_TERMS_EXPORT,
  AMAZON_ADS_PRODUCTS_EXPORT,
  ...marketplaceExports('myntra_ads', 'Myntra Ads'),
  ...marketplaceExports('ajio_ads', 'AJIO Ads'),
  ...marketplaceExports('flipkart_ads', 'Flipkart Ads'),
  MERCHANT_PRODUCTS_EXPORT,
  MERCHANT_PERFORMANCE_EXPORT,
  MERCHANT_ISSUES_EXPORT,
  CATALOG_ENRICHMENT_EXPORT,
  CRM_WATCHLIST_EXPORT,
  CRM_TOP_CUSTOMERS_EXPORT,
  CRM_COHORTS_EXPORT,
  LOYALTY_TOP_EARNERS_EXPORT,
  REFERRALS_TOP_REFERRERS_EXPORT,
  OFFERS_RANKING_EXPORT,
]
