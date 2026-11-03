// Rs/number formatters shared by the dashboard and the kit charts (plain module, server-safe).
export const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-IN')}`
export const rsCompact = (n: number) => {
  const a = Math.abs(n)
  if (a >= 1e7) return `Rs ${(n / 1e7).toFixed(2)} Cr`
  if (a >= 1e5) return `Rs ${(n / 1e5).toFixed(2)} L`
  return rs(n)
}
export const numStr = (n: number) => n.toLocaleString('en-IN')
export const pctStr = (v: number | null, digits = 1) => (v == null ? 'n/a' : `${v.toFixed(digits)}%`)
export const hoursStr = (v: number | null) =>
  v == null ? 'n/a' : v < 1 ? `${Math.max(1, Math.round(v * 60))} min` : v < 48 ? `${v.toFixed(1)} h` : `${(v / 24).toFixed(1)} d`
export const daysStr = (v: number | null) => (v == null ? 'n/a' : v < 1 ? `${Math.max(1, Math.round(v * 24))} h` : `${v.toFixed(1)} d`)
/** Whole-percent change, null when there is no previous value. */
export const delta = (now: number | null, prev: number | null): number | null =>
  now == null || prev == null || prev === 0 ? null : Math.round(((now - prev) / prev) * 100)
