import { describe, it, expect } from 'vitest'
import { eddSettingsSchema } from '@/lib/shipping/edd-settings'
import { EDD_DEFAULTS } from '@/lib/shipping/edd'

describe('eddSettingsSchema', () => {
  it('accepts the defaults', () => expect(eddSettingsSchema.safeParse(EDD_DEFAULTS).success).toBe(true))
  it('dedupes metro prefixes', () => {
    const r = eddSettingsSchema.parse({ ...EDD_DEFAULTS, metroPrefixes: ['110', '110', ' 400 '] })
    expect(r.metroPrefixes).toEqual(['110', '400'])
  })
  it.each([
    ['negative days', { metroDays: -1 }],
    ['fractional days', { restDays: 1.5 }],
    ['too many handling days', { handlingDays: 31 }],
    ['too many transit days', { remoteDays: 61 }],
    ['bad prefix', { metroPrefixes: ['11'] }],
    ['string number', { sameCityDays: '3' }],
    ['unknown key', { originPin: '492001' }],
  ])('rejects %s', (_, patch) => expect(eddSettingsSchema.safeParse({ ...EDD_DEFAULTS, ...patch }).success).toBe(false))
  it('rejects a missing field', () => {
    const { restDays: _omit, ...rest } = EDD_DEFAULTS
    expect(eddSettingsSchema.safeParse(rest).success).toBe(false)
  })
})
