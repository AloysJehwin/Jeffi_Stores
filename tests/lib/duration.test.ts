import { describe, it, expect } from 'vitest'
import {
  UNIT_MINUTES,
  toMinutes,
  fromMinutes,
  pickDisplayUnit,
  minutesToInterval,
  readDurationParam,
  days,
  hours,
  weeks,
} from '@/lib/campaigns/duration'

describe('duration helpers', () => {
  it('toMinutes converts each unit to canonical minutes', () => {
    expect(toMinutes(1, 'minutes')).toBe(1)
    expect(toMinutes(1, 'hours')).toBe(60)
    expect(toMinutes(1, 'days')).toBe(1440)
    expect(toMinutes(2, 'weeks')).toBe(20160)
    expect(toMinutes(1, 'months')).toBe(43200)
    expect(toMinutes(1, 'years')).toBe(525600)
  })

  it('fromMinutes is the inverse of toMinutes', () => {
    for (const unit of Object.keys(UNIT_MINUTES) as (keyof typeof UNIT_MINUTES)[]) {
      expect(fromMinutes(toMinutes(3, unit), unit)).toBe(3)
    }
  })

  it('sugar helpers equal explicit conversions', () => {
    expect(days(7)).toBe(toMinutes(7, 'days'))
    expect(hours(6)).toBe(toMinutes(6, 'hours'))
    expect(weeks(2)).toBe(toMinutes(2, 'weeks'))
  })

  it('pickDisplayUnit prefers the recommended unit when it divides evenly', () => {
    expect(pickDisplayUnit(days(7), 'days')).toBe('days')
    expect(pickDisplayUnit(hours(6), 'hours')).toBe('hours')
  })

  it('pickDisplayUnit falls back to a coarser clean unit, else minutes', () => {
    // 90 minutes is not a clean number of days; recommended=days does not divide -> minutes
    expect(pickDisplayUnit(90, 'days')).toBe('minutes')
    // recommended unit wins when it divides evenly (14 days is a whole number of hours)
    expect(pickDisplayUnit(days(14), 'hours')).toBe('hours')
    // when recommended does NOT divide, fall back to the largest clean unit
    expect(pickDisplayUnit(days(14), 'months')).toBe('weeks')
  })

  it('minutesToInterval produces a Postgres-safe minutes interval', () => {
    expect(minutesToInterval(1440)).toBe('1440 minutes')
    expect(minutesToInterval(-5)).toBe('0 minutes')
    expect(minutesToInterval(60.4)).toBe('60 minutes')
  })

  describe('readDurationParam', () => {
    it('reads a plain canonical-minutes number', () => {
      expect(readDurationParam({ lookback: 1440 }, 'lookback')).toBe(1440)
    })

    it('reads a {value, unit} object and converts to minutes', () => {
      expect(readDurationParam({ lookback: { value: 2, unit: 'days' } }, 'lookback')).toBe(2880)
    })

    it('falls back to a legacy integer+unit when the new key is absent', () => {
      expect(readDurationParam({ sendCooldownDays: 7 }, 'sendCooldown', { key: 'sendCooldownDays', unit: 'days' })).toBe(
        days(7)
      )
    })

    it('returns null when nothing is set', () => {
      expect(readDurationParam({}, 'lookback')).toBeNull()
    })
  })
})
