/** "1,504.50" — the web's toLocaleString('en-IN', 2 decimals). */
export function inr(n: number | string | null | undefined): string {
  return Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** "29 Oct" from a YYYY-MM-DD date. */
export function shortDate(ymd: string): string {
  const d = new Date(ymd + 'T00:00:00')
  return `${d.getDate()} ${d.toLocaleString('en-IN', { month: 'short' })}`
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
