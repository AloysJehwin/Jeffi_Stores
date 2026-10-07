import { remoteRegionFromPincode } from '@/lib/shipping/india-pincode-state'

/**
 * Estimated Delivery Date (EDD) — the single source of truth.
 *
 * EDD = today + TAT (calendar days), where
 *   TAT = handlingDays (dispatch, floored at the store's handling days) + transitDays(pincode) + extraDays.
 *
 * Checkout preview, product cards (/api/products/edd) and every order-commit path go through
 * computeEdd() with the store's EddSettings (Site Controls > Delivery estimate), so the preview
 * and the stored order EDD always match. With nothing configured, EDD_DEFAULTS reproduce the
 * original hard-coded numbers exactly.
 */

/** 3-digit pincode prefixes treated as "metro" by default (incl. suburbs/satellite ranges). */
export const METRO_PINS_3 = new Set<string>([
  // Delhi / NCR
  '110',
  '111',
  '112',
  // Mumbai (incl. suburbs, Thane, Navi Mumbai)
  '400',
  '401',
  '402',
  '403',
  '410',
  '421',
  // Bangalore / Bengaluru
  '560',
  '561',
  '562',
  '563',
  // Chennai
  '600',
  '601',
  '602',
  '603',
  // Hyderabad / Secunderabad
  '500',
  '501',
  '502',
  '503',
  // Kolkata
  '700',
  '711',
  '712',
  // Pune
  '411',
  '412',
  '413',
  // Ahmedabad
  '380',
  '382',
  '383',
])

export type EddZone = 'same_city' | 'same_region' | 'remote' | 'metro' | 'rest' | 'unknown'

export const EDD_ZONE_LABELS: Record<EddZone, string> = {
  same_city: 'Same city',
  same_region: 'Same region',
  remote: 'Remote area',
  metro: 'Metro',
  rest: 'Rest of India',
  unknown: 'No pincode yet',
}

export interface EddSettings {
  /** Dispatch days; also the floor for a product's own handling days. */
  handlingDays: number
  sameCityDays: number
  sameRegionDays: number
  metroDays: number
  restDays: number
  remoteDays: number
  metroPrefixes: string[]
  /** Sundays are not counted as delivery days. */
  skipSundays: boolean
}

export const EDD_DEFAULTS: EddSettings = {
  handlingDays: 2,
  sameCityDays: 7,
  sameRegionDays: 7,
  metroDays: 10,
  restDays: 14,
  remoteDays: 14,
  metroPrefixes: [...METRO_PINS_3],
  skipSundays: false,
}

const int = (v: unknown, def: number, max: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n))) : def
}

/** Lenient parse of the stored `edd_settings` JSON; any missing/bad field falls back to its default. */
export function parseEddSettings(raw: unknown): EddSettings {
  let o: any = raw
  if (typeof raw === 'string') {
    try {
      o = raw ? JSON.parse(raw) : {}
    } catch {
      o = {}
    }
  }
  if (!o || typeof o !== 'object') o = {}
  const d = EDD_DEFAULTS
  const prefixes = Array.isArray(o.metroPrefixes)
    ? [...new Set(o.metroPrefixes.map((x: unknown) => String(x).trim()).filter((x: string) => /^\d{3}$/.test(x)))]
    : d.metroPrefixes
  return {
    handlingDays: int(o.handlingDays, d.handlingDays, 30),
    sameCityDays: int(o.sameCityDays, d.sameCityDays, 60),
    sameRegionDays: int(o.sameRegionDays, d.sameRegionDays, 60),
    metroDays: int(o.metroDays, d.metroDays, 60),
    restDays: int(o.restDays, d.restDays, 60),
    remoteDays: int(o.remoteDays, d.remoteDays, 60),
    metroPrefixes: prefixes as string[],
    skipSundays: o.skipSundays === true,
  }
}

/** Store EDD settings from the site-controls business values. */
export function eddSettingsFromValues(bv: { eddSettingsJson?: string } | null | undefined): EddSettings {
  return parseEddSettings(bv?.eddSettingsJson ?? '')
}

/**
 * Zone of a delivery pincode relative to the ship-from origin (the default-warehouse pin):
 * same city (3-digit match) → same region (2-digit postal circle) → remote → metro → rest.
 * When originPin is invalid, the legacy rule treats Chhattisgarh `49…` as own region.
 */
export function eddZone(destPin: string, originPin?: string, settings: EddSettings = EDD_DEFAULTS): EddZone {
  const p = String(destPin ?? '')
  if (!/^\d{6}$/.test(p)) return 'unknown'
  const o = String(originPin ?? '')
  if (/^\d{6}$/.test(o)) {
    if (p.slice(0, 3) === o.slice(0, 3)) return 'same_city'
    if (p.slice(0, 2) === o.slice(0, 2)) return 'same_region'
  } else if (p.startsWith('49')) {
    return 'same_region'
  }
  if (remoteRegionFromPincode(p)) return 'remote'
  if (settings.metroPrefixes.includes(p.slice(0, 3))) return 'metro'
  return 'rest'
}

export function zoneTransitDays(zone: EddZone, s: EddSettings = EDD_DEFAULTS): number {
  switch (zone) {
    case 'same_city':
      return s.sameCityDays
    case 'remote':
      return s.remoteDays
    case 'metro':
      return s.metroDays
    case 'rest':
      return s.restDays
    default:
      return s.sameRegionDays
  }
}

/** Courier transit days for a delivery pincode (an unknown/invalid pin uses the same-region figure). */
export function transitDays(destPin: string, originPin?: string, settings: EddSettings = EDD_DEFAULTS): number {
  return zoneTransitDays(eddZone(destPin, originPin, settings), settings)
}

function addDays(from: Date, days: number, skipSundays: boolean): Date {
  const d = new Date(from)
  if (!skipSundays) {
    d.setDate(d.getDate() + days)
    return d
  }
  let added = 0
  while (added < days) {
    d.setDate(d.getDate() + 1)
    if (d.getDay() !== 0) added++
  }
  return d
}

export interface EddBreakdown {
  zone: EddZone
  handlingDays: number
  transitDays: number
  extraDays: number
  totalDays: number
  edd: string
}

/** Site-controls business values: the ship-from pin and the stored EDD settings. */
export type EddStore = { delhiveryOriginPincode?: string; eddSettingsJson?: string } | null | undefined

export function computeEddBreakdown(opts: {
  pin: string
  originPin?: string
  handlingDays?: number
  extraDays?: number
  settings?: EddSettings
  /** Resolves originPin/settings when those are not passed explicitly. */
  store?: EddStore
  from?: Date
}): EddBreakdown {
  const s = opts.settings ?? (opts.store ? eddSettingsFromValues(opts.store) : EDD_DEFAULTS)
  const originPin = opts.originPin ?? opts.store?.delhiveryOriginPincode
  const handling = Math.max(s.handlingDays, Number(opts.handlingDays ?? s.handlingDays) || 0)
  const extra = Math.max(0, Number(opts.extraDays ?? 0) || 0)
  const zone = eddZone(opts.pin, originPin, s)
  const transit = zoneTransitDays(zone, s)
  const totalDays = handling + transit + extra
  const edd = addDays(opts.from ?? new Date(), totalDays, s.skipSundays)
    .toISOString()
    .slice(0, 10)
  return { zone, handlingDays: handling, transitDays: transit, extraDays: extra, totalDays, edd }
}

/**
 * Compute the EDD as a `YYYY-MM-DD` string (calendar days from now).
 * handlingDays is floored at the store's handling days (2 by default); extraDays at 0.
 * originPin is the default-warehouse ship-from pin.
 */
export function computeEdd(opts: {
  pin: string
  originPin?: string
  handlingDays?: number
  extraDays?: number
  settings?: EddSettings
  store?: EddStore
}): string {
  return computeEddBreakdown(opts).edd
}
