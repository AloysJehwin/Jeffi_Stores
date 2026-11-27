import type { ColumnType, ExportColumn } from './types'

// Cell values per column type. Spreadsheets get typed values (numbers, dates) and plain CSV text;
// PDF and PPTX get display text (₹ with Indian grouping, "27 Nov 2026"). Dates are shown in IST.

const IST = 'Asia/Kolkata'
const NUMERIC: ColumnType[] = ['number', 'int', 'money', 'percent']

export const isNumeric = (t: ColumnType | undefined) => !!t && NUMERIC.includes(t)

export function toNumber(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'bigint') return Number(v)
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

export function toDate(v: unknown): Date | null {
  if (v == null || v === '') return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  const s = String(v).trim()
  // Zone-less text (entity exports print IST wall-clock time) is read as IST.
  const wall = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(:\d{2})?)?$/.exec(s)
  const d = wall ? new Date(`${wall[1]}T${wall[2] ?? '00:00'}${wall[3] ?? ':00'}+05:30`) : new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

const ymd = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: IST })
const hm = (d: Date) => d.toLocaleTimeString('en-GB', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: false })

function plain(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.map(plain).filter(Boolean).join(', ')
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** CSV cell text: machine-friendly (2-decimal money, ISO dates in IST), no grouping. */
export function csvText(v: unknown, type: ColumnType = 'text'): string {
  if (v == null || v === '') return ''
  switch (type) {
    case 'money': {
      const n = toNumber(v)
      return n == null ? plain(v) : n.toFixed(2)
    }
    case 'int': {
      const n = toNumber(v)
      return n == null ? plain(v) : String(Math.round(n))
    }
    case 'number':
    case 'percent': {
      const n = toNumber(v)
      return n == null ? plain(v) : String(Math.round(n * 10000) / 10000)
    }
    case 'date': {
      const d = toDate(v)
      return d ? ymd(d) : plain(v)
    }
    case 'datetime': {
      const d = toDate(v)
      return d ? `${ymd(d)} ${hm(d)}` : plain(v)
    }
    case 'bool':
      return v === true || v === 't' || v === 'true' ? 'Yes' : v === false || v === 'f' || v === 'false' ? 'No' : plain(v)
    default:
      return plain(v)
  }
}

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const grp = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })

/** Display text for PDF and PPTX. */
export function displayText(v: unknown, type: ColumnType = 'text'): string {
  if (v == null || v === '') return ''
  switch (type) {
    case 'money': {
      const n = toNumber(v)
      return n == null ? plain(v) : `₹${inr.format(n)}`
    }
    case 'int':
    case 'number': {
      const n = toNumber(v)
      return n == null ? plain(v) : grp.format(n)
    }
    case 'percent': {
      const n = toNumber(v)
      return n == null ? plain(v) : `${grp.format(n)}%`
    }
    case 'date': {
      const d = toDate(v)
      return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: IST }) : plain(v)
    }
    case 'datetime': {
      const d = toDate(v)
      return d ? `${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: IST })} ${hm(d)}` : plain(v)
    }
    default:
      return csvText(v, type)
  }
}

/** Typed cell for Excel: numbers as numbers, dates as Date (shown in IST), text otherwise. */
export function xlsxValue(v: unknown, type: ColumnType = 'text'): string | number | Date | null {
  if (v == null || v === '') return null
  if (isNumeric(type)) return toNumber(v) ?? plain(v)
  if (type === 'date' || type === 'datetime') {
    const d = toDate(v)
    if (!d) return plain(v)
    // Excel has no zones: shift so the sheet shows the IST wall clock.
    return new Date(d.getTime() + 5.5 * 3600_000)
  }
  if (type === 'bool') return csvText(v, type)
  return plain(v)
}

export const XLSX_NUMFMT: Partial<Record<ColumnType, string>> = {
  money: '#,##0.00',
  number: '#,##0.##',
  int: '#,##0',
  percent: '0.##"%"',
  date: 'dd-mmm-yyyy',
  datetime: 'dd-mmm-yyyy hh:mm',
}

/** Running totals for the columns that declare `total`. */
export class Totals {
  private sums = new Map<string, number>()
  private counts = new Map<string, number>()
  rows = 0
  constructor(private cols: ExportColumn[]) {}

  add(row: Record<string, unknown>) {
    this.rows++
    for (const c of this.cols) {
      if (!c.total) continue
      const v = row[c.key]
      if (c.total === 'count') {
        if (v != null && v !== '') this.counts.set(c.key, (this.counts.get(c.key) ?? 0) + 1)
        continue
      }
      const n = toNumber(v)
      if (n == null) continue
      this.sums.set(c.key, (this.sums.get(c.key) ?? 0) + n)
      this.counts.set(c.key, (this.counts.get(c.key) ?? 0) + 1)
    }
  }

  get any() {
    return this.cols.some(c => c.total)
  }

  result(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const c of this.cols) {
      if (!c.total) continue
      if (c.total === 'count') out[c.key] = this.counts.get(c.key) ?? 0
      else if (c.total === 'avg') {
        const n = this.counts.get(c.key) ?? 0
        out[c.key] = n ? round2((this.sums.get(c.key) ?? 0) / n) : null
      } else out[c.key] = round2(this.sums.get(c.key) ?? 0)
    }
    return out
  }
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** A spreadsheet-safe text cell: values that a spreadsheet would run as formulas get a leading quote. */
export function neutralise(s: string): string {
  return /^[=+\-@\t\r]/.test(s) && !/^-\d+(\.\d+)?$/.test(s) ? `'${s}` : s
}
