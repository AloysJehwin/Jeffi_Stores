// SQL fragments and helpers shared by the customer and marketing overviews (customers, coupons,
// programs, campaigns, messaging, review forms).
import type { Bucket, Period } from '@/lib/overview/period'

/** Same rule as the CRM overview: paid or COD collected, not cancelled or returned. */
export const realized = (a = 'o') =>
  `${a}.payment_status IN ('paid', 'cod_collected') AND ${a}.status NOT IN ('cancelled', 'returned')`

/** IST bounds CTE: p0 previous start, c0 current start, c1 current end (exclusive). Params $1..$3. */
export const BOUNDS = `b AS (
  SELECT ($1::date)::timestamp AT TIME ZONE 'Asia/Kolkata' AS p0,
         ($2::date)::timestamp AT TIME ZONE 'Asia/Kolkata' AS c0,
         ($3::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata' AS c1)`

export const periodArgs = (cur: Period, prev: Period) => [prev.from, cur.from, cur.to]

/** `'cur' | 'prev'` label for a timestamp already restricted to [p0, c1). */
export const periodCase = (col: string) => `CASE WHEN ${col} >= b.c0 THEN 'cur' ELSE 'prev' END`

const SERIES_START: Record<Bucket, string> = {
  day: '$2::date::timestamp',
  week: "date_trunc('week', $2::date::timestamp)",
  month: "date_trunc('month', $2::date::timestamp)",
}

/** CTE `k(bucket)` of IST buckets covering the current period (params $2, $3). */
export const bucketsCte = (bucket: Bucket) =>
  `k AS (SELECT generate_series(${SERIES_START[bucket]}, $3::date::timestamp, INTERVAL '1 ${bucket}') AS bucket)`

/** Join condition putting a timestamptz into its bucket. */
export const inBucket = (col: string, bucket: Bucket) =>
  `date_trunc('${bucket}', ${col} AT TIME ZONE 'Asia/Kolkata') = k.bucket`

export const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0)
export const numOrNull = (v: unknown) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)
export const str = (v: unknown) => (v == null ? '' : String(v))

type Row = Record<string, unknown>

/** Split rows tagged `period = 'cur' | 'prev'` into current and previous, mapped. */
export function byPeriod<T>(
  rows: Row[] | null | undefined,
  map: (r: Row | undefined) => T
): { current: T; previous: T } {
  return { current: map(rows?.find(r => r.period === 'cur')), previous: map(rows?.find(r => r.period === 'prev')) }
}

/** Map every numeric column of a row (missing -> 0). */
export function numbers<K extends string>(row: Row | undefined, keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map(k => [k, num(row?.[k])])) as Record<K, number>
}

export const labelOf = (v: unknown) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return str(v).slice(0, 10)
}

/** Overview is the default tab; `?tab=list` or any list-only param (filters, page, sort) from an
 * old link keeps the list. */
export function resolveListTab(
  sp: Record<string, string | string[] | undefined>,
  listKeys: readonly string[]
): 'overview' | 'list' {
  if (sp.tab === 'list') return 'list'
  if (sp.tab === 'overview') return 'overview'
  return listKeys.some(k => sp[k] != null && sp[k] !== '') ? 'list' : 'overview'
}

/** Provider error codes (Twilio / Meta), named as in messaging-service/src/delivery.ts. */
const CODE_LABELS: Record<string, string> = {
  '63049': 'WhatsApp marketing cap (Meta)',
  '63016': 'Outside the 24-hour window',
  '63024': 'Invalid WhatsApp recipient',
  '63003': 'Number not on WhatsApp',
  '63032': "Recipient's WhatsApp can't receive it",
  '63019': 'WhatsApp media failed',
  '21211': 'Invalid phone number',
  '21610': 'Recipient opted out (STOP)',
  '30003': 'Phone unreachable',
  '30005': 'Unknown or inactive number',
  '30006': 'Landline or unreachable carrier',
  '30007': 'Blocked by the carrier as spam',
}

/** Group a free-text send error into a named reason. The WhatsApp marketing cap (63049) is
 * recognised from its code or from the reason text messaging-service writes. */
export function classifyFailure(error: string | null | undefined): { key: string; label: string } {
  const e = (error ?? '').trim()
  if (!e) return { key: 'unknown', label: 'No reason recorded' }
  const code = e.match(/\b(6\d{4}|[23]\d{4})\b/)?.[1]
  if (code === '63049' || /caps marketing messages|marketing message/i.test(e))
    return { key: '63049', label: `${CODE_LABELS['63049']} (63049)` }
  if (code && CODE_LABELS[code]) return { key: code, label: `${CODE_LABELS[code]} (${code})` }
  if (/throttl|rate exceeded|too many requests|\b429\b/i.test(e))
    return { key: 'rate_limit', label: 'Sending rate limit' }
  if (/not configured|not set|missing credentials/i.test(e))
    return { key: 'not_configured', label: 'Channel not configured' }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|timeout|timed out|socket hang up/i.test(e))
    return { key: 'unreachable', label: 'Provider unreachable' }
  if (/bounce|mailbox|does not exist|invalid (email|address)|address rejected/i.test(e))
    return { key: 'bad_address', label: 'Invalid or bouncing address' }
  if (/opt(ed)?[ -]?out|unsubscribed/i.test(e) || /\bSTOP\b/.test(e))
    return { key: 'opted_out', label: 'Recipient opted out' }
  if (/statuscallback/i.test(e)) return { key: 'callback', label: 'Status callback URL rejected' }
  if (code) return { key: code, label: `Provider error ${code}` }
  return { key: 'other', label: 'Other' }
}

/** Sum failure rows `{ error, n }` into named reasons, largest first. */
export function groupFailures(
  rows: { error: unknown; n: unknown; channel?: unknown }[]
): { key: string; label: string; count: number; channels: string[] }[] {
  const m = new Map<string, { key: string; label: string; count: number; channels: Set<string> }>()
  for (const r of rows) {
    const c = classifyFailure(r.error == null ? null : String(r.error))
    const cur = m.get(c.key) ?? { ...c, count: 0, channels: new Set<string>() }
    cur.count += num(r.n)
    if (r.channel) cur.channels.add(String(r.channel))
    m.set(c.key, cur)
  }
  return [...m.values()]
    .map(x => ({ key: x.key, label: x.label, count: x.count, channels: [...x.channels].sort() }))
    .sort((a, b) => b.count - a.count)
}
