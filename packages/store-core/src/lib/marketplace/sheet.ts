import * as XLSX from 'xlsx'

// Uploaded marketplace reports (SKU reports, settlement reports): the first sheet as header +
// rows, column matching by synonyms, and Indian-format numbers and dates.

export interface SheetData {
  headers: string[]
  rows: Record<string, unknown>[]
}

const MAX_ROWS = 20_000

/** First sheet of a .xlsx/.xls/.csv. The header row is the first of the top 10 with the most text cells. */
export function readSheet(buf: Buffer): SheetData {
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(buf, { type: 'buffer', cellDates: true })
  } catch {
    throw new Error('Could not read the file. Upload a .xlsx or .csv file.')
  }
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new Error('The file has no sheets.')
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: null, raw: true })
  let headerIdx = 0
  let best = -1
  for (let i = 0; i < Math.min(10, aoa.length); i++) {
    const n = (aoa[i] ?? []).filter(c => typeof c === 'string' && c.trim()).length
    if (n > best) {
      best = n
      headerIdx = i
    }
  }
  const raw = (aoa[headerIdx] ?? []).map(h => String(h ?? '').trim())
  const seen = new Map<string, number>()
  const headers = raw.map((h, i) => {
    const base = h || `Column ${i + 1}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return n ? `${base} (${n + 1})` : base
  })
  const body = aoa.slice(headerIdx + 1)
  if (body.length > MAX_ROWS) throw new Error(`The file has more than ${MAX_ROWS.toLocaleString('en-IN')} rows. Split it and upload each part.`)
  const rows = body
    .map(r => Object.fromEntries(headers.map((h, i) => [h, (r ?? [])[i] ?? null])))
    .filter(r => Object.values(r).some(v => v != null && String(v).trim() !== ''))
  return { headers, rows }
}

export const normHeader = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Best header per canonical field: exact synonym match first, then a header containing a synonym. */
export function suggestColumns<F extends string>(headers: string[], synonyms: Record<F, string[]>): Partial<Record<F, string>> {
  const out: Partial<Record<F, string>> = {}
  const used = new Set<string>()
  const norm = headers.map(h => ({ h, n: normHeader(h) }))
  for (const pass of ['exact', 'contains'] as const) {
    for (const field of Object.keys(synonyms) as F[]) {
      if (out[field]) continue
      for (const syn of synonyms[field].map(normHeader)) {
        const hit = norm.find(x => !used.has(x.h) && (pass === 'exact' ? x.n === syn : syn.length >= 4 && x.n.includes(syn)))
        if (hit) {
          out[field] = hit.h
          used.add(hit.h)
          break
        }
      }
    }
  }
  return out
}

/** ₹1,23,456.50, (450), -12, 12% → numbers; blanks and text → null. */
export function parseAmount(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = String(v).trim()
  if (!s) return null
  let neg = false
  if (/^\(.*\)$/.test(s)) {
    neg = true
    s = s.slice(1, -1)
  }
  s = s.replace(/(rs\.?|inr|₹|,|\s|%)/gi, '')
  if (s.endsWith('-')) {
    neg = !neg
    s = s.slice(0, -1)
  }
  if (!/^[-+]?\d*\.?\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? (neg ? -n : n) : null
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const ymd = (y: number, m: number, d: number) => {
  if (y < 100) y += 2000
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null
}

/** dd-mm-yyyy, dd/mm/yy, yyyy-mm-dd, 05-Nov-2026, Excel dates and serials → yyyy-mm-dd. */
export function parseDate(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? new Date(v.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) : null
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400_000).toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return ymd(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/)
  if (m) return ymd(+m[3], +m[2], +m[1])
  m = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/,]+(\d{2,4})/)
  if (m && MONTHS[m[2].toLowerCase()]) return ymd(+m[3], MONTHS[m[2].toLowerCase()], +m[1])
  return null
}

export const cellText = (v: unknown): string | null => {
  if (v == null) return null
  const s = (v instanceof Date ? v.toISOString() : String(v)).trim()
  return s || null
}
