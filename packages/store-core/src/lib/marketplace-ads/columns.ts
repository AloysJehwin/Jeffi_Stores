// Ads report columns: the canonical fields, per-marketplace header synonyms, and the cell parsers
// (rupee amounts with Indian commas, percentages, dd-mm-yyyy and other date forms). Client-safe.

export type AdsMarket = 'myntra' | 'ajio'
export type AdsChannel = 'myntra_ads' | 'ajio_ads'

export const ADS_MARKET: Record<AdsChannel, AdsMarket> = { myntra_ads: 'myntra', ajio_ads: 'ajio' }
export const adsChannelOf = (m: AdsMarket): AdsChannel => (m === 'myntra' ? 'myntra_ads' : 'ajio_ads')
export const isAdsChannel = (v: unknown): v is AdsChannel => v === 'myntra_ads' || v === 'ajio_ads'

export type AdField =
  | 'date'
  | 'campaign_id'
  | 'campaign_name'
  | 'ad_group'
  | 'sku'
  | 'style_id'
  | 'product_name'
  | 'impressions'
  | 'clicks'
  | 'spend'
  | 'orders'
  | 'units'
  | 'sales'

export type FieldType = 'date' | 'text' | 'int' | 'money'

export interface AdFieldDef {
  key: AdField
  label: string
  type: FieldType
  required?: boolean
  hint?: string
}

export const AD_FIELDS: AdFieldDef[] = [
  { key: 'date', label: 'Date', type: 'date', hint: 'Leave out for a report without a date column; you then pick its period.' },
  { key: 'campaign_name', label: 'Campaign name', type: 'text' },
  { key: 'campaign_id', label: 'Campaign ID', type: 'text' },
  { key: 'ad_group', label: 'Ad group', type: 'text' },
  { key: 'sku', label: 'Seller SKU', type: 'text', hint: 'Map a SKU or style ID for a product report.' },
  { key: 'style_id', label: 'Style ID / product code', type: 'text' },
  { key: 'product_name', label: 'Product name', type: 'text' },
  { key: 'impressions', label: 'Impressions', type: 'int' },
  { key: 'clicks', label: 'Clicks', type: 'int' },
  { key: 'spend', label: 'Spend', type: 'money', required: true },
  { key: 'orders', label: 'Orders', type: 'int' },
  { key: 'units', label: 'Units sold', type: 'int' },
  { key: 'sales', label: 'Ad sales / revenue', type: 'money' },
]

export type AdMapping = Partial<Record<AdField, string>>

const COMMON: Record<AdField, string[]> = {
  date: ['date', 'day', 'report date', 'reporting date', 'stats date', 'event date', 'txn date'],
  campaign_id: ['campaign id', 'campaignid', 'campaign code', 'campaign no'],
  campaign_name: ['campaign', 'campaign name', 'campaign title'],
  ad_group: ['ad group', 'ad group name', 'adgroup', 'ad set', 'ad set name', 'ad group id'],
  sku: ['sku', 'seller sku', 'sku code', 'sku id', 'seller sku code', 'merchant sku', 'vendor sku', 'seller sku id'],
  style_id: ['style id', 'style code', 'styleid', 'product id', 'product code'],
  product_name: ['product name', 'product', 'product title', 'title', 'item name', 'style name'],
  impressions: ['impressions', 'impression', 'views', 'ad views', 'impr', 'total impressions'],
  clicks: ['clicks', 'click', 'ad clicks', 'total clicks'],
  spend: ['spend', 'spends', 'ad spend', 'cost', 'amount spent', 'budget spent', 'total spend', 'ad cost', 'spent'],
  orders: ['orders', 'order', 'total orders', 'conversions', 'attributed orders', 'order count', 'no of orders'],
  units: ['units', 'units sold', 'quantity', 'qty', 'quantity sold', 'items sold', 'total units'],
  sales: ['sales', 'revenue', 'gmv', 'ad sales', 'ad revenue', 'attributed sales', 'attributed revenue', 'total revenue', 'sales value', 'total sales'],
}

// Report headers seen on each seller portal, on top of COMMON.
const BY_MARKET: Record<AdsMarket, Partial<Record<AdField, string[]>>> = {
  myntra: {
    style_id: ['style', 'myntra style id', 'article id'],
    sku: ['seller sku code', 'sku code'],
    spend: ['budget consumed', 'spend amount'],
    sales: ['direct revenue', 'total gmv', 'revenue generated'],
    units: ['units sold', 'quantity sold'],
  },
  ajio: {
    style_id: ['option code', 'article code', 'ajio product code', 'product option code', 'item code'],
    sku: ['seller article code', 'ean', 'vendor article code'],
    spend: ['ad spends', 'campaign spend'],
    sales: ['ad gmv', 'revenue generated'],
    orders: ['converted orders'],
  },
}

/** Lower case, currency markers and bracketed units dropped, punctuation collapsed. */
export function normHeader(h: unknown): string {
  return String(h ?? '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/₹|\binr\b|\brs\.?(?=\s|$)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const compact = (h: unknown) => normHeader(h).replace(/ /g, '')

export function synonymsFor(market: AdsMarket, field: AdField): string[] {
  return [...COMMON[field], ...(BY_MARKET[market][field] ?? [])]
}

/** True when a header is a known synonym for any field (used to find the header row). */
export function isKnownHeader(market: AdsMarket, h: unknown): boolean {
  const c = compact(h)
  return !!c && AD_FIELDS.some(f => synonymsFor(market, f.key).some(s => compact(s) === c))
}

/** Suggest a mapping: a saved header for a field wins when the file has it; otherwise the first
 * synonym match. Each header maps to one field at most. */
export function autoMap(headers: string[], market: AdsMarket, saved: AdMapping = {}): AdMapping {
  const out: AdMapping = {}
  const used = new Set<string>()
  for (const f of AD_FIELDS) {
    const h = saved[f.key]
    if (h && headers.includes(h) && !used.has(h)) {
      out[f.key] = h
      used.add(h)
    }
  }
  for (const f of AD_FIELDS) {
    if (out[f.key]) continue
    for (const s of synonymsFor(market, f.key)) {
      const h = headers.find(x => !used.has(x) && compact(x) === compact(s))
      if (h) {
        out[f.key] = h
        used.add(h)
        break
      }
    }
  }
  return out
}

/** Report kind follows the mapping: a product identifier makes it a product report. */
export const reportKind = (m: AdMapping): 'campaign' | 'product' => (m.sku || m.style_id ? 'product' : 'campaign')

const BLANK = /^(|-|–|—|na|n\/a|nil|null|none)$/i
const SUFFIX: Record<string, number> = { k: 1e3, l: 1e5, lac: 1e5, lakh: 1e5, lakhs: 1e5, m: 1e6, cr: 1e7, crore: 1e7 }

/** '₹1,23,456.50' → 123456.5, '(1,200)' → -1200, '12.5%' → 0.125, '1.2L' → 120000, '-' → null.
 * Returns NaN for text that is not a number. */
export function parseNumber(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN
  let s = String(v).trim()
  if (BLANK.test(s)) return null
  let neg = false
  if (/^\(.*\)$/.test(s)) {
    neg = true
    s = s.slice(1, -1)
  }
  s = s.replace(/₹|inr|rs\.?/gi, '').replace(/[,\s]/g, '')
  const pct = s.endsWith('%')
  if (pct) s = s.slice(0, -1)
  const m = /^([+-]?\d*\.?\d+(?:e[+-]?\d+)?)([a-z]*)$/i.exec(s)
  if (!m) return NaN
  let n = Number(m[1])
  const suffix = m[2].toLowerCase()
  if (suffix) {
    if (pct || !(suffix in SUFFIX)) return NaN
    n *= SUFFIX[suffix]
  }
  if (pct) n /= 100
  return neg ? -n : n
}

/** A percentage as a fraction: '12.5%' → 0.125, 12.5 → 0.125, 0.125 → 0.125 (spreadsheet % cells). */
export function parsePercent(v: unknown): number | null {
  if (typeof v === 'string' && v.trim().endsWith('%')) return parseNumber(v)
  const n = parseNumber(v)
  if (n == null || Number.isNaN(n)) return n
  return Math.abs(n) > 1 ? n / 100 : n
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

const pad = (n: number) => String(n).padStart(2, '0')
const month = (t: string): number | undefined => MONTHS[t.toLowerCase()] ?? MONTHS[t.toLowerCase().slice(0, 3)]

function ymd(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/** YYYY-MM-DD from a report cell. Numeric day-first forms are read the Indian way (dd-mm-yyyy)
 * unless the second part cannot be a month. Spreadsheet serial numbers are accepted. */
export function parseDate(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : ymd(v.getFullYear(), v.getMonth() + 1, v.getDate())
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000)
      return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
    }
    return /^\d{8}$/.test(String(v)) ? parseDate(String(v)) : null
  }
  const s = String(v).trim().replace(/\s+/g, ' ')
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s)
  if (m) return ymd(+m[1], +m[2], +m[3])
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s)
  if (m) return ymd(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[ T,].*)?$/.exec(s)
  if (m) {
    const a = +m[1]
    const b = +m[2]
    return b > 12 && a <= 12 ? ymd(+m[3], a, b) : ymd(+m[3], b, a)
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)?[ ./-]([a-z]{3,9})[ ./,-]*(\d{2}|\d{4})(?:[ T].*)?$/i.exec(s)
  if (m && month(m[2])) return ymd(+m[3], month(m[2])!, +m[1])
  m = /^([a-z]{3,9})[ ./-](\d{1,2})(?:st|nd|rd|th)?,? (\d{4})(?:[ T].*)?$/i.exec(s)
  if (m && month(m[1])) return ymd(+m[3], month(m[1])!, +m[2])
  return null
}
