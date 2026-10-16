import { CONTENT_LANGUAGE, getMerchantId, merchantApiRequest, productResourceId } from './client'

// Merchant API v1 calls behind the Merchant console: reports (MerchantQL), issue resolution, account
// issues and programs, shipping settings, return policies and promotions.

const LANG = { languageCode: 'en-GB', timeZone: 'Asia/Kolkata' }
const acct = (id: string) => `accounts/${id}`

export const fromMicros = (p: { amountMicros?: string | number } | null | undefined): number | null =>
  p?.amountMicros == null ? null : Number(p.amountMicros) / 1_000_000
export const toMicros = (v: number, currencyCode = 'INR') => ({ amountMicros: String(Math.round(v * 1_000_000)), currencyCode })
export const gDate = (d: { year?: number; month?: number; day?: number } | null | undefined): string | null =>
  d?.year ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : null

/** All rows of a MerchantQL query (reports:search pages through 1000 at a time). */
export async function reportSearch(query: string, maxPages = 20): Promise<any[]> {
  const id = await getMerchantId()
  const out: any[] = []
  let pageToken: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const res = await merchantApiRequest('POST', `/reports/v1/${acct(id)}/reports:search`, {
      body: { query, pageSize: 1000, ...(pageToken ? { pageToken } : {}) },
    })
    out.push(...(res?.results ?? []))
    pageToken = res?.nextPageToken
    if (!pageToken) break
  }
  return out
}

export const REPORT_QUERIES = {
  performance: (from: string, to: string) =>
    `SELECT date, offer_id, title, marketing_method, clicks, impressions, conversions, conversion_value
     FROM product_performance_view WHERE date BETWEEN '${from}' AND '${to}'`,
  priceCompetitiveness: () =>
    `SELECT offer_id, report_country_code, title, brand, price, benchmark_price FROM price_competitiveness_product_view WHERE report_country_code = 'IN'`,
  priceInsights: () =>
    // Google requires id in SELECT on this view.
    `SELECT id, offer_id, title, brand, price, suggested_price, predicted_impressions_change_fraction,
       predicted_clicks_change_fraction, predicted_conversions_change_fraction, effectiveness
     FROM price_insights_product_view`,
  bestSellers: (reportDate: string) =>
    `SELECT report_date, report_country_code, report_category_id, report_granularity, rank, previous_rank, title, brand,
       category_l1, category_l2, category_l3, relative_demand, inventory_status, brand_inventory_status, variant_gtins
     FROM best_sellers_product_cluster_view
     WHERE report_country_code = 'IN' AND report_granularity = 'WEEKLY' AND report_date = '${reportDate}'`,
}

export interface RenderedIssue {
  title: string
  severity: string | null
  impact: string | null
  html: string | null
  actions: { label: string; uri: string | null; available: boolean; reason: string | null }[]
}

function mapRendered(issues: any[] | undefined): RenderedIssue[] {
  return (issues ?? []).map(i => ({
    title: String(i?.title ?? 'Issue'),
    severity: i?.impact?.severity ?? null,
    impact: i?.impact?.message ?? null,
    html: i?.prerenderedContent ?? null,
    actions: (i?.actions ?? []).map((a: any) => ({
      label: String(a?.buttonLabel ?? 'Open'),
      uri: a?.externalAction?.uri ?? null,
      available: a?.isAvailable !== false,
      reason: a?.disabledReasons?.[0]?.message ?? null,
    })),
  }))
}

/** Google's own explanation of one product's issues, with fix links. */
export async function renderProductIssues(offerId: string): Promise<RenderedIssue[]> {
  const id = await getMerchantId()
  const qs = new URLSearchParams(LANG)
  const res = await merchantApiRequest(
    'POST',
    `/issueresolution/v1/${acct(id)}/products/${productResourceId(offerId)}:renderproductissues?${qs}`,
    { body: { contentOption: 'PRE_RENDERED_HTML' }, allow404: true }
  )
  return mapRendered(res?.renderedIssues)
}

export async function renderAccountIssues(): Promise<RenderedIssue[]> {
  const id = await getMerchantId()
  const qs = new URLSearchParams(LANG)
  const res = await merchantApiRequest('POST', `/issueresolution/v1/${acct(id)}:renderaccountissues?${qs}`, {
    body: { contentOption: 'PRE_RENDERED_HTML' },
  })
  return mapRendered(res?.renderedIssues)
}

export async function listAccountIssues(): Promise<any[]> {
  const id = await getMerchantId()
  const out: any[] = []
  let pageToken: string | undefined
  do {
    const qs = new URLSearchParams({ ...LANG, pageSize: '100' })
    if (pageToken) qs.set('pageToken', pageToken)
    const res = await merchantApiRequest('GET', `/accounts/v1/${acct(id)}/issues?${qs}`)
    out.push(...(res?.accountIssues ?? []))
    pageToken = res?.nextPageToken
  } while (pageToken)
  return out
}

export async function listPrograms(): Promise<any[]> {
  const id = await getMerchantId()
  const res = await merchantApiRequest('GET', `/accounts/v1/${acct(id)}/programs`)
  return res?.programs ?? []
}

export async function getShippingSettings(): Promise<any | null> {
  const id = await getMerchantId()
  return merchantApiRequest('GET', `/accounts/v1/${acct(id)}/shippingSettings`, { allow404: true })
}

/** Replaces the whole shipping settings object; Google rejects it when the etag is stale. */
export async function insertShippingSettings(settings: unknown): Promise<any> {
  const id = await getMerchantId()
  return merchantApiRequest('POST', `/accounts/v1/${acct(id)}/shippingSettings:insert`, { body: settings })
}

export async function listReturnPolicies(): Promise<any[]> {
  const id = await getMerchantId()
  const res = await merchantApiRequest('GET', `/accounts/v1/${acct(id)}/onlineReturnPolicies?pageSize=100`)
  return res?.onlineReturnPolicies ?? []
}

export async function createReturnPolicy(policy: unknown): Promise<any> {
  const id = await getMerchantId()
  return merchantApiRequest('POST', `/accounts/v1/${acct(id)}/onlineReturnPolicies`, { body: policy })
}

export async function deleteReturnPolicy(name: string): Promise<void> {
  if (!/^accounts\/\d+\/onlineReturnPolicies\/[\w-]+$/.test(name)) throw new Error('Invalid return policy')
  await merchantApiRequest('DELETE', `/accounts/v1/${name}`, { allow404: true })
}

export async function listPromotions(): Promise<any[]> {
  const id = await getMerchantId()
  const out: any[] = []
  let pageToken: string | undefined
  do {
    const qs = new URLSearchParams({ pageSize: '250' })
    if (pageToken) qs.set('pageToken', pageToken)
    const res = await merchantApiRequest('GET', `/promotions/v1/${acct(id)}/promotions?${qs}`)
    out.push(...(res?.promotions ?? []))
    pageToken = res?.nextPageToken
  } while (pageToken)
  return out
}

const PROMO_SOURCE_NAME = 'Jeffi Stores promotions'
const promoSourceCache = new Map<string, string>()

/** The store's promotions data source (promotions are inserted into one), created on first use. */
export async function promotionDataSource(): Promise<string> {
  const id = await getMerchantId()
  const cached = promoSourceCache.get(id)
  if (cached) return cached
  const base = `/datasources/v1/${acct(id)}/dataSources`
  const res = await merchantApiRequest('GET', `${base}?pageSize=1000`)
  let name: string | undefined = (res?.dataSources ?? []).find((d: any) => d?.promotionDataSource && d?.input === 'API')?.name
  if (!name) {
    const created = await merchantApiRequest('POST', base, {
      body: { displayName: PROMO_SOURCE_NAME, promotionDataSource: { targetCountry: 'IN', contentLanguage: CONTENT_LANGUAGE } },
    })
    name = created?.name
  }
  if (!name) throw new Error('Google returned no promotions data source')
  promoSourceCache.set(id, name)
  return name
}

export async function insertPromotion(promotion: unknown): Promise<any> {
  const id = await getMerchantId()
  return merchantApiRequest('POST', `/promotions/v1/${acct(id)}/promotions:insert`, {
    body: { promotion, dataSource: await promotionDataSource() },
  })
}
