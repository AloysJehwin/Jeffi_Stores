export function rupees(n: number | string | null | undefined): string {
  const v = Number(n)
  if (!Number.isFinite(v)) return ''
  return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: Number.isInteger(v) ? 0 : 2, minimumFractionDigits: Number.isInteger(v) ? 0 : 2 }).format(v)}`
}

/** "Drill set", "Drill set and 2 more". */
export function itemsShort(names: string[]): string {
  const n = names.map(x => String(x ?? '').trim()).filter(Boolean)
  if (!n.length) return 'your items'
  const first = n[0].length > 60 ? `${n[0].slice(0, 57)}...` : n[0]
  return n.length === 1 ? first : `${first} and ${n.length - 1} more`
}

export const iso = (v: unknown): string | null => {
  if (!v) return null
  const d = new Date(v as string)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
