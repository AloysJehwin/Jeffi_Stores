import type { AdsRow } from './client'

// GAQL for the reporting sync plus row mappers into the local ads_* tables. Field names are
// snake_case in GAQL and camelCase in the REST JSON; int64 values arrive as strings.

export interface DateRange {
  from: string // YYYY-MM-DD, account time zone
  to: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function during(range: DateRange): string {
  if (!DATE_RE.test(range.from) || !DATE_RE.test(range.to)) throw new Error('Invalid date range')
  return `segments.date BETWEEN '${range.from}' AND '${range.to}'`
}

const METRICS = [
  'metrics.impressions',
  'metrics.clicks',
  'metrics.cost_micros',
  'metrics.conversions',
  'metrics.conversions_value',
  'metrics.all_conversions',
].join(', ')

export const Q = {
  customer: () =>
    `SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone,
       customer.optimization_score, customer.manager, customer.test_account, customer.status
     FROM customer LIMIT 1`,

  /** Clients reachable under a manager account (for the account picker). */
  customerClients: () =>
    `SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager,
       customer_client.level, customer_client.status, customer_client.currency_code, customer_client.test_account
     FROM customer_client
     WHERE customer_client.hidden = FALSE`,

  campaigns: () =>
    `SELECT campaign.id, campaign.name, campaign.status, campaign.serving_status, campaign.primary_status,
       campaign.advertising_channel_type, campaign.advertising_channel_sub_type, campaign.bidding_strategy_type,
       campaign.start_date_time, campaign.end_date_time, campaign_budget.amount_micros, campaign_budget.period
     FROM campaign
     WHERE campaign.status != 'REMOVED'`,

  campaignDaily: (r: DateRange) =>
    `SELECT campaign.id, segments.date, segments.device, segments.ad_network_type, ${METRICS}
     FROM campaign
     WHERE ${during(r)}`,

  adGroups: () =>
    `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type, ad_group.cpc_bid_micros, campaign.id
     FROM ad_group
     WHERE ad_group.status != 'REMOVED'`,

  adGroupDaily: (r: DateRange) =>
    `SELECT campaign.id, ad_group.id, segments.date, segments.device, segments.ad_network_type, ${METRICS}
     FROM ad_group
     WHERE ${during(r)}`,

  ads: (r: DateRange) =>
    `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.status,
       ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines,
       ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.review_status,
       ad_group_ad.policy_summary.policy_topic_entries, ad_group.id, campaign.id,
       metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
     FROM ad_group_ad
     WHERE ad_group_ad.status != 'REMOVED' AND ${during(r)}`,

  /** Ads with no traffic in the window still matter (a disapproved ad has none). */
  adsNoMetrics: () =>
    `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.status,
       ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines,
       ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.review_status,
       ad_group_ad.policy_summary.policy_topic_entries, ad_group.id, campaign.id
     FROM ad_group_ad
     WHERE ad_group_ad.status != 'REMOVED'`,

  keywords: (r: DateRange) =>
    `SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
       ad_group_criterion.status, ad_group_criterion.negative, ad_group_criterion.quality_info.quality_score,
       ad_group.id, campaign.id, ${METRICS}
     FROM keyword_view
     WHERE ad_group_criterion.status != 'REMOVED' AND ${during(r)}`,

  searchTerms: (r: DateRange) =>
    `SELECT search_term_view.search_term, search_term_view.status, segments.keyword.info.text,
       segments.date, campaign.id, ad_group.id, ${METRICS}
     FROM search_term_view
     WHERE ${during(r)}`,

  products: (r: DateRange) =>
    `SELECT segments.product_item_id, segments.product_title, segments.date, campaign.id, ${METRICS}
     FROM shopping_performance_view
     WHERE ${during(r)}`,

  geo: (r: DateRange) =>
    `SELECT user_location_view.country_criterion_id, segments.geo_target_region, segments.date, ${METRICS}
     FROM user_location_view
     WHERE ${during(r)}`,

  geoNames: (resourceNames: string[]) =>
    `SELECT geo_target_constant.resource_name, geo_target_constant.name, geo_target_constant.canonical_name
     FROM geo_target_constant
     WHERE geo_target_constant.resource_name IN (${resourceNames
       .filter(n => /^geoTargetConstants\/\d+$/.test(n))
       .map(n => `'${n}'`)
       .join(', ')})`,

  recommendations: () =>
    `SELECT recommendation.resource_name, recommendation.type, recommendation.campaign, recommendation.impact,
       recommendation.dismissed
     FROM recommendation`,

  /** change_event requires a bounded window (max 30 days) and a LIMIT. */
  changeEvents: (sinceDateTime: string, limit = 1000) =>
    `SELECT change_event.resource_name, change_event.change_date_time, change_event.change_resource_type,
       change_event.change_resource_name, change_event.client_type, change_event.user_email,
       change_event.resource_change_operation, change_event.changed_fields, change_event.campaign
     FROM change_event
     WHERE change_event.change_date_time >= '${sinceDateTime.replace(/[^0-9: -]/g, '')}'
     ORDER BY change_event.change_date_time DESC
     LIMIT ${Math.max(1, Math.min(10000, Math.floor(limit)))}`,

  accountBudget: () =>
    `SELECT account_budget.status, account_budget.approved_spending_limit_micros, account_budget.amount_served_micros,
       account_budget.approved_end_date_time
     FROM account_budget`,
}

// ── Row mappers ──────────────────────────────────────────────────────────────

const int = (v: unknown) => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? Math.round(n) : 0
}
const num = (v: unknown) => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}
const idOf = (v: unknown) => (v == null || v === '' ? null : String(v))
/** Last path segment of a resource name ("customers/1/campaigns/22" -> "22"). */
export const tailId = (rn: unknown) => (rn ? String(rn).split('/').pop()?.split('~').pop() || null : null)

export interface MetricValues {
  impressions: number
  clicks: number
  cost_micros: number
  conversions: number
  conversions_value: number
  all_conversions: number
}

export function metricsOf(r: AdsRow): MetricValues {
  const m = r.metrics ?? {}
  return {
    impressions: int(m.impressions),
    clicks: int(m.clicks),
    cost_micros: int(m.costMicros),
    conversions: num(m.conversions),
    conversions_value: num(m.conversionsValue),
    all_conversions: num(m.allConversions),
  }
}

export function mapCustomer(r: AdsRow) {
  const c = r.customer ?? {}
  return {
    customer_id: idOf(c.id),
    descriptive_name: c.descriptiveName ?? null,
    currency_code: c.currencyCode ?? null,
    time_zone: c.timeZone ?? null,
    optimization_score: c.optimizationScore == null ? null : num(c.optimizationScore),
    manager: !!c.manager,
    test_account: !!c.testAccount,
    status: c.status ?? null,
  }
}

export function mapCustomerClient(r: AdsRow) {
  const c = r.customerClient ?? {}
  return {
    id: idOf(c.id),
    name: c.descriptiveName ?? null,
    manager: !!c.manager,
    level: int(c.level),
    currency: c.currencyCode ?? null,
    testAccount: !!c.testAccount,
    status: (c.status as string | undefined) ?? null,
  }
}

export function mapCampaign(r: AdsRow) {
  const c = r.campaign ?? {}
  return {
    campaign_id: idOf(c.id),
    name: c.name ?? '',
    status: c.status ?? null,
    serving_status: c.servingStatus ?? null,
    primary_status: c.primaryStatus ?? null,
    channel_type: c.advertisingChannelType ?? null,
    channel_sub_type: c.advertisingChannelSubType ?? null,
    bidding_strategy_type: c.biddingStrategyType ?? null,
    budget_amount_micros: r.campaignBudget?.amountMicros == null ? null : int(r.campaignBudget.amountMicros),
    budget_period: r.campaignBudget?.period ?? null,
    start_date: c.startDateTime ? String(c.startDateTime).slice(0, 10) : null,
    end_date: c.endDateTime ? String(c.endDateTime).slice(0, 10) : null,
  }
}

export function mapDaily(r: AdsRow, withAdGroup: boolean) {
  return {
    date: String(r.segments?.date ?? ''),
    campaign_id: idOf(r.campaign?.id),
    ad_group_id: withAdGroup ? idOf(r.adGroup?.id) ?? '0' : '0',
    device: r.segments?.device ?? 'UNSPECIFIED',
    network: r.segments?.adNetworkType ?? 'UNSPECIFIED',
    ...metricsOf(r),
  }
}

export function mapAdGroup(r: AdsRow) {
  const g = r.adGroup ?? {}
  return {
    ad_group_id: idOf(g.id),
    campaign_id: idOf(r.campaign?.id),
    name: g.name ?? '',
    status: g.status ?? null,
    type: g.type ?? null,
    cpc_bid_micros: g.cpcBidMicros == null ? null : int(g.cpcBidMicros),
  }
}

export function mapAd(r: AdsRow) {
  const a = r.adGroupAd ?? {}
  const ad = a.ad ?? {}
  const ps = a.policySummary ?? {}
  const topics = (ps.policyTopicEntries ?? []).map((t: any) => ({ topic: t?.topic ?? null, type: t?.type ?? null }))
  const headlines = (ad.responsiveSearchAd?.headlines ?? []).map((h: any) => h?.text).filter(Boolean)
  return {
    ad_id: idOf(ad.id),
    ad_group_id: idOf(r.adGroup?.id),
    campaign_id: idOf(r.campaign?.id),
    name: ad.name ?? null,
    type: ad.type ?? null,
    status: a.status ?? null,
    approval_status: ps.approvalStatus ?? null,
    review_status: ps.reviewStatus ?? null,
    policy_topics: topics,
    final_urls: ad.finalUrls ?? [],
    headlines,
    ...metricsOf(r),
  }
}

export function mapKeyword(r: AdsRow) {
  const k = r.adGroupCriterion ?? {}
  return {
    criterion_id: idOf(k.criterionId),
    ad_group_id: idOf(r.adGroup?.id),
    campaign_id: idOf(r.campaign?.id),
    text: k.keyword?.text ?? '',
    match_type: k.keyword?.matchType ?? null,
    status: k.status ?? null,
    negative: !!k.negative,
    quality_score: k.qualityInfo?.qualityScore == null ? null : int(k.qualityInfo.qualityScore),
    ...metricsOf(r),
  }
}

export function mapSearchTerm(r: AdsRow) {
  return {
    date: String(r.segments?.date ?? ''),
    campaign_id: idOf(r.campaign?.id),
    ad_group_id: idOf(r.adGroup?.id) ?? '0',
    search_term: String(r.searchTermView?.searchTerm ?? ''),
    status: r.searchTermView?.status ?? null,
    keyword_text: r.segments?.keyword?.info?.text ?? null,
    ...metricsOf(r),
  }
}

export function mapProduct(r: AdsRow) {
  return {
    date: String(r.segments?.date ?? ''),
    campaign_id: idOf(r.campaign?.id),
    item_id: String(r.segments?.productItemId ?? '').toLowerCase(),
    product_title: r.segments?.productTitle ?? null,
    ...metricsOf(r),
  }
}

export function mapGeo(r: AdsRow) {
  return {
    date: String(r.segments?.date ?? ''),
    country_criterion_id: idOf(r.userLocationView?.countryCriterionId),
    location: String(r.segments?.geoTargetRegion ?? (r.userLocationView?.countryCriterionId ? `geoTargetConstants/${r.userLocationView.countryCriterionId}` : 'unknown')),
    ...metricsOf(r),
  }
}

export function mapRecommendation(r: AdsRow) {
  const x = r.recommendation ?? {}
  return {
    resource_name: String(x.resourceName ?? ''),
    type: x.type ?? null,
    campaign_id: tailId(x.campaign),
    impact: x.impact ?? null,
    dismissed: !!x.dismissed,
  }
}

export function mapChangeEvent(r: AdsRow) {
  const e = r.changeEvent ?? {}
  return {
    resource_name: String(e.resourceName ?? ''),
    change_date_time: e.changeDateTime ?? null,
    resource_type: e.changeResourceType ?? null,
    changed_resource: e.changeResourceName ?? null,
    operation: e.resourceChangeOperation ?? null,
    client_type: e.clientType ?? null,
    user_email: e.userEmail ?? null,
    campaign_id: tailId(e.campaign),
    changed_fields: e.changedFields ? String(e.changedFields) : null,
  }
}

export function mapAccountBudget(rows: AdsRow[]) {
  // Prefer the approved, currently running budget.
  const b = (rows.find(r => r.accountBudget?.status === 'APPROVED') ?? rows[0])?.accountBudget
  if (!b) return null
  return {
    budget_status: b.status ?? null,
    budget_limit_micros: b.approvedSpendingLimitMicros == null ? null : int(b.approvedSpendingLimitMicros),
    budget_served_micros: b.amountServedMicros == null ? null : int(b.amountServedMicros),
    budget_end: b.approvedEndDateTime ?? null,
  }
}

/** Sum duplicate keys (e.g. a region reported once per targeting flag) before insert. */
export function sumByKey<T extends MetricValues>(rows: T[], key: (r: T) => string): T[] {
  const out = new Map<string, T>()
  for (const r of rows) {
    const k = key(r)
    const cur = out.get(k)
    if (!cur) {
      out.set(k, { ...r })
      continue
    }
    cur.impressions += r.impressions
    cur.clicks += r.clicks
    cur.cost_micros += r.cost_micros
    cur.conversions += r.conversions
    cur.conversions_value += r.conversions_value
    cur.all_conversions += r.all_conversions
  }
  return [...out.values()]
}
