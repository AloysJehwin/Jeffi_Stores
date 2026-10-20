/** "1,504.50" — the web's toLocaleString('en-IN', 2 decimals). */
export function inr(n: number | string | null | undefined): string {
  return Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** "29 Oct" from a YYYY-MM-DD date. */
export function shortDate(ymd: string): string {
  const d = new Date(ymd + 'T00:00:00')
  return `${d.getDate()} ${d.toLocaleString('en-IN', { month: 'short' })}`
}
