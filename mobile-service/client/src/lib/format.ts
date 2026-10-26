// toLocaleString builds a new Intl formatter on every call (slow on Hermes); list rows share these.
const formatter = <T>(make: () => T): T | null => {
  try {
    return typeof Intl === 'undefined' ? null : make()
  } catch {
    return null
  }
}
const INR = formatter(() => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const NUM = formatter(() => new Intl.NumberFormat('en-IN'))
const MONTH = formatter(() => new Intl.DateTimeFormat('en-IN', { month: 'short' }))

/** "1,504.50" — the web's toLocaleString('en-IN', 2 decimals). */
export function inr(n: number | string | null | undefined): string {
  const v = Number(n ?? 0)
  return INR ? INR.format(v) : v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** "1,504.5" — toLocaleString('en-IN') with its defaults. */
export function num(n: number | string | null | undefined): string {
  const v = Number(n ?? 0)
  return NUM ? NUM.format(v) : v.toLocaleString('en-IN')
}

/** A cached Intl.DateTimeFormat('en-IN', options), for rows that format many dates. */
export function dateFormat(options: Intl.DateTimeFormatOptions): (d: Date) => string {
  const f = formatter(() => new Intl.DateTimeFormat('en-IN', options))
  return d => (f ? f.format(d) : d.toLocaleString('en-IN', options))
}

/** A cached Intl.NumberFormat('en-IN', options). */
export function numberFormat(options: Intl.NumberFormatOptions): (n: number) => string {
  const f = formatter(() => new Intl.NumberFormat('en-IN', options))
  return n => (f ? f.format(n) : n.toLocaleString('en-IN', options))
}

/** "29 Oct" from a YYYY-MM-DD date. */
export function shortDate(ymd: string): string {
  const d = new Date(ymd + 'T00:00:00')
  return `${d.getDate()} ${MONTH ? MONTH.format(d) : d.toLocaleString('en-IN', { month: 'short' })}`
}

/** "Just now", "5m", "3h", "Yesterday", "4d", then "12 Oct" (with the year if it isn't this one). */
export function timeAgo(iso: string, now = Date.now()): string {
  const d = new Date(iso)
  const s = Math.max(0, Math.round((now - d.getTime()) / 1000))
  if (s < 60) return 'Just now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  const days = Math.floor(s / 86400)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d`
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}
