// Period presets for the inventory overview. All dates are IST calendar days (YYYY-MM-DD).

export type PresetId = '7d' | '30d' | 'this_month' | 'last_month' | '90d' | 'fy'
export interface Range {
  from: string
  to: string
}

const DAY = 86_400_000
const t = (d: string) => Date.parse(`${d}T00:00:00Z`)
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const shift = (d: string, n: number) => iso(t(d) + n * DAY)
const ISO = /^\d{4}-\d{2}-\d{2}$/

export function istToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now)
}

export const PRESETS: { id: PresetId; label: string }[] = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: '90d', label: '90 days' },
  { id: 'fy', label: 'This FY' },
]

export function presetRange(id: PresetId, today: string): Range {
  const [y, m] = today.split('-').map(Number)
  switch (id) {
    case '7d':
      return { from: shift(today, -6), to: today }
    case '90d':
      return { from: shift(today, -89), to: today }
    case 'this_month':
      return { from: `${today.slice(0, 7)}-01`, to: today }
    case 'last_month': {
      const firstThis = `${today.slice(0, 7)}-01`
      const lastPrev = shift(firstThis, -1)
      return { from: `${lastPrev.slice(0, 7)}-01`, to: lastPrev }
    }
    case 'fy': {
      const startYear = m >= 4 ? y : y - 1
      return { from: `${startYear}-04-01`, to: today }
    }
    default:
      return { from: shift(today, -29), to: today }
  }
}

export const DEFAULT_PRESET: PresetId = '30d'

export function matchPreset(r: Range, today: string): PresetId | null {
  return (
    PRESETS.find(p => {
      const x = presetRange(p.id, today)
      return x.from === r.from && x.to === r.to
    })?.id ?? null
  )
}

// Read ?from&to, falling back to the default preset when missing or malformed.
export function rangeFromParams(from: string | null, to: string | null, today: string): Range {
  if (from && to && ISO.test(from) && ISO.test(to) && !Number.isNaN(t(from)) && !Number.isNaN(t(to))) {
    return from <= to ? { from, to } : { from: to, to: from }
  }
  return presetRange(DEFAULT_PRESET, today)
}

export function formatRange(r: Range): string {
  const f = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })
  return r.from === r.to ? f(r.from) : `${f(r.from)} - ${f(r.to)}`
}
