import { describe, it, expect } from 'vitest'
import {
  computeEdd,
  transitDays,
  eddZone,
  parseEddSettings,
  EDD_DEFAULTS,
  computeEddBreakdown,
  METRO_PINS_3,
} from '@/lib/shipping/edd'

function daysFromToday(edd: string): number {
  const d = new Date(edd + 'T00:00:00Z')
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}

describe('transitDays', () => {
  it('own region (49…) → 7', () => expect(transitDays('490001')).toBe(7))
  it('metro (Chennai 600) → 10', () => expect(transitDays('600001')).toBe(10))
  it('rest of India → 14', () => expect(transitDays('831001')).toBe(14))
  it('missing / non-6-digit pin → 7', () => {
    expect(transitDays('')).toBe(7)
    expect(transitDays('12')).toBe(7)
  })
  it('metro SUBURB prefixes the short 7-item list missed → 10 (not 14)', () => {
    // 411 (Pune), 401 (Mumbai suburb), 711 (Kolkata) are in the full set only.
    expect(transitDays('411001')).toBe(10)
    expect(transitDays('401101')).toBe(10)
    expect(transitDays('711101')).toBe(10)
  })
  it('origin-aware: same postal-circle as origin → 7', () => {
    // Bengaluru origin (560…): a Karnataka dest (57…? no — same 2-digit 56) is own-region.
    expect(transitDays('560002', '560001')).toBe(7)
  })
  it('origin-aware: cross-region metro dest → 10', () => {
    // Bengaluru origin, Chennai (600) dest: different circle, but metro → 10.
    expect(transitDays('600001', '560001')).toBe(10)
  })
  it('origin-aware: cross-region non-metro dest → 14', () => {
    expect(transitDays('831001', '560001')).toBe(14)
  })
  it('origin-aware: invalid origin falls back to 49… own-region rule', () => {
    expect(transitDays('490001', '')).toBe(7)
    expect(transitDays('490001', 'xx')).toBe(7)
    // and a non-49 non-metro dest with an invalid origin is NOT own-region
    expect(transitDays('831001', '')).toBe(14)
  })
})

describe('computeEdd', () => {
  it('metro: handling(2) + transit(10) + extra(0) = 12 days', () => {
    expect(daysFromToday(computeEdd({ pin: '600001' }))).toBe(12)
  })
  it('own region: 2 + 7 = 9 days', () => {
    expect(daysFromToday(computeEdd({ pin: '490001' }))).toBe(9)
  })
  it('rest of India: 2 + 14 = 16 days', () => {
    expect(daysFromToday(computeEdd({ pin: '831001' }))).toBe(16)
  })
  it('floors handling at 2 (handlingDays=0 → still +2)', () => {
    expect(computeEdd({ pin: '600001', handlingDays: 0 })).toBe(computeEdd({ pin: '600001', handlingDays: 2 }))
  })
  it('adds extraDays and larger handling', () => {
    // 3 handling + 10 metro + 4 extra = 17
    expect(daysFromToday(computeEdd({ pin: '600001', handlingDays: 3, extraDays: 4 }))).toBe(17)
  })
  it('returns a YYYY-MM-DD string', () => {
    expect(computeEdd({ pin: '600001' })).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

// The pre-settings hard-coded rule, kept verbatim to prove the defaults change nothing.
function legacyTransit(destPin: string, originPin?: string): number {
  const p = String(destPin ?? '')
  if (!/^\d{6}$/.test(p)) return 7
  const o = String(originPin ?? '')
  const own = /^\d{6}$/.test(o) ? p.slice(0, 2) === o.slice(0, 2) : p.startsWith('49')
  if (own) return 7
  if (METRO_PINS_3.has(p.slice(0, 3))) return 10
  return 14
}

describe('eddZone', () => {
  const origin = '492001' // Raipur
  it('same city: first 3 digits match the origin', () => expect(eddZone('492013', origin)).toBe('same_city'))
  it('same region: same 2-digit circle', () => expect(eddZone('495001', origin)).toBe('same_region'))
  it('metro', () => expect(eddZone('600001', origin)).toBe('metro'))
  it('rest of India', () => expect(eddZone('831001', origin)).toBe('rest'))
  it('remote: North-East, J&K, Ladakh, Sikkim, Andaman, Lakshadweep', () => {
    for (const p of ['781001', '795001', '190001', '180001', '194101', '737101', '744101', '682555']) {
      expect(eddZone(p, origin)).toBe('remote')
    }
  })
  it('Kerala outside Lakshadweep is not remote', () => expect(eddZone('682001', origin)).toBe('rest'))
  it('a remote pin in the origin circle is same region', () => expect(eddZone('782001', '781001')).toBe('same_region'))
  it('invalid dest → unknown', () => expect(eddZone('12', origin)).toBe('unknown'))
})

describe('EDD defaults reproduce the old hard-coded numbers', () => {
  const pins = [
    '',
    '12',
    '490001',
    '492013',
    '495001',
    '600001',
    '411001',
    '831001',
    '781001',
    '190001',
    '744101',
    '110001',
  ]
  const origins = [undefined, '', '492001', '560001', '781001']
  it('transitDays matches the legacy rule for every pin/origin pair', () => {
    for (const o of origins) for (const p of pins) expect(transitDays(p, o)).toBe(legacyTransit(p, o))
  })
  it('an empty / garbage stored setting parses to the defaults', () => {
    expect(parseEddSettings('')).toEqual(EDD_DEFAULTS)
    expect(parseEddSettings('{not json')).toEqual(EDD_DEFAULTS)
    expect(parseEddSettings(null)).toEqual(EDD_DEFAULTS)
  })
  it('store with no edd_settings = defaults with the store origin', () => {
    expect(computeEdd({ pin: '560002', store: { delhiveryOriginPincode: '560001' } })).toBe(
      computeEdd({ pin: '560002', originPin: '560001' })
    )
  })
})

describe('custom EDD settings', () => {
  const s = parseEddSettings({
    handlingDays: 1,
    sameCityDays: 1,
    sameRegionDays: 3,
    metroDays: 4,
    restDays: 6,
    remoteDays: 12,
    metroPrefixes: ['831', '831', 'abc'],
    skipSundays: false,
  })
  it('drops invalid metro prefixes and dedupes', () => expect(s.metroPrefixes).toEqual(['831']))
  it('uses the configured days per zone', () => {
    expect(transitDays('492013', '492001', s)).toBe(1)
    expect(transitDays('495001', '492001', s)).toBe(3)
    expect(transitDays('831001', '492001', s)).toBe(4) // now metro via the custom list
    expect(transitDays('600001', '492001', s)).toBe(6) // no longer metro
    expect(transitDays('781001', '492001', s)).toBe(12)
  })
  it('store handling days is the floor; a larger product handling wins', () => {
    expect(computeEddBreakdown({ pin: '492013', originPin: '492001', settings: s, handlingDays: 0 }).totalDays).toBe(2)
    expect(computeEddBreakdown({ pin: '492013', originPin: '492001', settings: s, handlingDays: 5 }).totalDays).toBe(6)
  })
  it('reads settings from the store JSON', () => {
    const b = computeEddBreakdown({
      pin: '781001',
      store: { delhiveryOriginPincode: '492001', eddSettingsJson: JSON.stringify({ remoteDays: 20 }) },
    })
    expect(b.zone).toBe('remote')
    expect(b.totalDays).toBe(22)
  })
  it('skipSundays does not count Sundays', () => {
    const from = new Date('2026-10-10T06:00:00Z') // Saturday
    const sk = { ...EDD_DEFAULTS, handlingDays: 0, sameCityDays: 2, skipSundays: true }
    // Sat + 2 delivery days, skipping Sunday → Tuesday
    expect(computeEddBreakdown({ pin: '492013', originPin: '492001', settings: sk, from }).edd).toBe('2026-10-13')
    expect(
      computeEddBreakdown({ pin: '492013', originPin: '492001', settings: { ...sk, skipSundays: false }, from }).edd
    ).toBe('2026-10-12')
  })
})
