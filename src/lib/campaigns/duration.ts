export type DurationUnit = 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years'

export const DURATION_UNITS: DurationUnit[] = ['minutes', 'hours', 'days', 'weeks', 'months', 'years']

export const UNIT_MINUTES: Record<DurationUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
  weeks: 10080,
  months: 43200,
  years: 525600,
}

export const UNIT_LABEL: Record<DurationUnit, string> = {
  minutes: 'min',
  hours: 'hr',
  days: 'days',
  weeks: 'weeks',
  months: 'months',
  years: 'years',
}

export function toMinutes(value: number, unit: DurationUnit): number {
  return Math.round(value * UNIT_MINUTES[unit])
}

export function fromMinutes(minutes: number, unit: DurationUnit): number {
  return minutes / UNIT_MINUTES[unit]
}

export function pickDisplayUnit(minutes: number, recommended: DurationUnit): DurationUnit {
  if (minutes <= 0) return recommended
  if (minutes % UNIT_MINUTES[recommended] === 0) return recommended
  for (const unit of [...DURATION_UNITS].reverse()) {
    if (minutes % UNIT_MINUTES[unit] === 0) return unit
  }
  return 'minutes'
}

export function minutesToInterval(minutes: number): string {
  return `${Math.max(0, Math.round(minutes))} minutes`
}

export const minutes = (n: number) => toMinutes(n, 'minutes')
export const hours = (n: number) => toMinutes(n, 'hours')
export const days = (n: number) => toMinutes(n, 'days')
export const weeks = (n: number) => toMinutes(n, 'weeks')
export const months = (n: number) => toMinutes(n, 'months')
export const years = (n: number) => toMinutes(n, 'years')

type ParamBag = Record<string, unknown>

export function readDurationParam(
  params: ParamBag,
  key: string,
  legacy?: { key: string; unit: DurationUnit }
): number | null {
  const direct = params[key]
  if (typeof direct === 'number' && Number.isFinite(direct)) return Math.round(direct)
  if (direct && typeof direct === 'object') {
    const v = (direct as ParamBag).value
    const u = (direct as ParamBag).unit
    if (typeof v === 'number' && typeof u === 'string' && (DURATION_UNITS as string[]).includes(u)) {
      return toMinutes(v, u as DurationUnit)
    }
  }
  if (legacy) {
    const legacyVal = params[legacy.key]
    if (typeof legacyVal === 'number' && Number.isFinite(legacyVal)) {
      return toMinutes(legacyVal, legacy.unit)
    }
  }
  return null
}
