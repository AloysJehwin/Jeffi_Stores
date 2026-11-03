// Client-safe display helpers for the Google Ads console.

export function money(v: number | null | undefined, currency = 'INR', digits = 0): string {
  if (v == null || !Number.isFinite(v)) return '-'
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(v)
  } catch {
    return `${currency} ${v.toFixed(digits)}`
  }
}

export const count = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '-' : Math.round(v).toLocaleString('en-IN')

export const decimal = (v: number | null | undefined, d = 1) =>
  v == null || !Number.isFinite(v) ? '-' : v.toLocaleString('en-IN', { maximumFractionDigits: d })

export const pct = (v: number | null | undefined, d = 2) =>
  v == null || !Number.isFinite(v) ? '-' : `${(v * 100).toFixed(d)}%`

export const ratio = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '-' : `${v.toFixed(2)}x`)

/** Period-over-period change as a fraction; null when there is no base to compare against. */
export function change(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null
  return (cur - prev) / Math.abs(prev)
}

/** ENABLED -> Enabled, SEARCH_PARTNERS -> Search partners. */
export function humanize(v: string | null | undefined): string {
  if (!v) return '-'
  const s = v.toLowerCase().replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function formatCid(id: string | null | undefined): string {
  const d = String(id ?? '').replace(/\D/g, '')
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d || '-'
}
