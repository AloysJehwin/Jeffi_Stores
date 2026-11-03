// Pure period / bucketing helpers for the finance overview (shared by the page and its API route).

export type Range = { from: string; to: string }
export type PresetKey = '7d' | '30d' | 'month' | 'last_month' | '90d' | 'fy'
export type Bucket = 'day' | 'week' | 'month'
export type AgingKey = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus'

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: '90d', label: '90 days' },
  { key: 'fy', label: 'This FY' },
]

export const AGING_KEYS: { key: AgingKey; label: string }[] = [
  { key: 'current', label: 'Current' },
  { key: 'd1_30', label: '1-30 days' },
  { key: 'd31_60', label: '31-60 days' },
  { key: 'd61_90', label: '61-90 days' },
  { key: 'd90_plus', label: '90+ days' },
]

const ISO = /^\d{4}-\d{2}-\d{2}$/
const DAY = 86_400_000

export function istToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now)
}

const toUtc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10)

export const addDays = (iso: string, n: number) => fromUtc(toUtc(iso) + n * DAY)
export const spanDays = (r: Range) => Math.round((toUtc(r.to) - toUtc(r.from)) / DAY) + 1

export function isValidRange(r: Partial<Range>, maxDays = 400): r is Range {
  if (!r.from || !r.to || !ISO.test(r.from) || !ISO.test(r.to)) return false
  if (isNaN(toUtc(r.from)) || isNaN(toUtc(r.to)) || fromUtc(toUtc(r.from)) !== r.from || fromUtc(toUtc(r.to)) !== r.to)
    return false
  const n = spanDays(r as Range)
  return n >= 1 && n <= maxDays
}

/** The equal-length period ending the day before `r` starts. */
export function previousPeriod(r: Range): Range {
  const n = spanDays(r)
  return { from: addDays(r.from, -n), to: addDays(r.from, -1) }
}

export function presetRange(key: PresetKey, now = new Date()): Range {
  const today = istToday(now)
  const y = +today.slice(0, 4)
  const m = +today.slice(5, 7)
  switch (key) {
    case '7d':
      return { from: addDays(today, -6), to: today }
    case '90d':
      return { from: addDays(today, -89), to: today }
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today }
    case 'last_month': {
      const first = `${today.slice(0, 7)}-01`
      const end = addDays(first, -1)
      return { from: `${end.slice(0, 7)}-01`, to: end }
    }
    case 'fy':
      return { from: `${m >= 4 ? y : y - 1}-04-01`, to: today }
    default:
      return { from: addDays(today, -29), to: today }
  }
}

export function matchPreset(r: Range, now = new Date()): PresetKey | null {
  return PRESETS.find(p => {
    const x = presetRange(p.key, now)
    return x.from === r.from && x.to === r.to
  })?.key ?? null
}

export function bucketFor(r: Range): Bucket {
  const n = spanDays(r)
  return n <= 45 ? 'day' : n <= 200 ? 'week' : 'month'
}

/** Start of the bucket containing `iso` (weeks start Monday, as Postgres date_trunc). */
export function bucketStart(iso: string, b: Bucket): string {
  if (b === 'day') return iso
  if (b === 'month') return `${iso.slice(0, 7)}-01`
  const dow = new Date(toUtc(iso)).getUTCDay()
  return addDays(iso, -((dow + 6) % 7))
}

export function bucketStarts(r: Range, b: Bucket): string[] {
  const out: string[] = []
  let cur = bucketStart(r.from, b)
  while (cur <= r.to) {
    out.push(cur)
    if (b === 'day') cur = addDays(cur, 1)
    else if (b === 'week') cur = addDays(cur, 7)
    else {
      const y = +cur.slice(0, 4)
      const m = +cur.slice(5, 7)
      cur = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
    }
  }
  return out
}

/** Zero-filled series: one row per bucket with every key, from sparse (bucket, key, value) rows. */
export function fillSeries<K extends string>(
  r: Range,
  b: Bucket,
  keys: readonly K[],
  rows: { b: string; k: string; v: number | string }[]
): ({ label: string } & Record<K, number>)[] {
  const map = new Map<string, Record<string, number>>()
  for (const s of bucketStarts(r, b)) map.set(s, Object.fromEntries(keys.map(k => [k, 0])))
  for (const row of rows) {
    const slot = map.get(bucketStart(String(row.b).slice(0, 10), b))
    if (slot && row.k in slot) slot[row.k] += Number(row.v) || 0
  }
  return [...map.entries()].map(([label, v]) => ({ label, ...v }) as { label: string } & Record<K, number>)
}

export function agingBucket(daysPastDue: number): AgingKey {
  if (daysPastDue <= 0) return 'current'
  if (daysPastDue <= 30) return 'd1_30'
  if (daysPastDue <= 60) return 'd31_60'
  if (daysPastDue <= 90) return 'd61_90'
  return 'd90_plus'
}

/** Relative change; null when there is no base to compare with. */
export const changeOf = (cur: number, prev: number): number | null => (prev ? (cur - prev) / Math.abs(prev) : null)
