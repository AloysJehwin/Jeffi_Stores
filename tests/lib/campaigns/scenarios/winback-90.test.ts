import { vi, describe, it, expect } from 'vitest'

vi.mock('@/lib/db', () => ({ queryMany: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/automation-emails', () => ({
  APP_URL: 'https://jeffistores.com',
  fetchUserContext: vi.fn(),
  resolveCoupon: vi.fn(),
  sendCampaignEmail: vi.fn(),
  renderItemRows: vi.fn().mockReturnValue(''),
}))

import { winback90 } from '@/lib/campaigns/scenarios/winback-90'
import { winback180 } from '@/lib/campaigns/scenarios/winback-180'

describe('winback90 scenario', () => {
  it('has correct kind', () => {
    expect(winback90.kind).toBe('winback_90')
  })

  it('has correct name', () => {
    expect(winback90.name).toBe('Win-Back (90 days)')
  })

  it('defaultParams use 90-day window', () => {
    expect(winback90.defaultParams.minDaysSinceOrder).toBe(60)
    expect(winback90.defaultParams.maxDaysSinceOrder).toBe(150)
  })

  it('defaultParams use mid-range health score', () => {
    expect(winback90.defaultParams.healthScoreMin).toBe(25)
    expect(winback90.defaultParams.healthScoreMax).toBe(50)
  })

  it('uses 60-day cooldown', () => {
    expect(winback90.defaultParams.sendCooldownDays).toBe(60)
  })

  it('has findEligible function', () => {
    expect(typeof winback90.findEligible).toBe('function')
  })

  it('has send function', () => {
    expect(typeof winback90.send).toBe('function')
  })

  it('has all 6 schema fields', () => {
    const keys = Object.keys(winback90.paramSchema)
    expect(keys).toContain('minDaysSinceOrder')
    expect(keys).toContain('maxDaysSinceOrder')
    expect(keys).toContain('healthScoreMin')
    expect(keys).toContain('healthScoreMax')
    expect(keys).toContain('sendCooldownDays')
    expect(keys).toContain('maxRecipientsPerSweep')
  })

  it('winback90 and winback180 target different dormancy windows', () => {
    expect(winback90.defaultParams.minDaysSinceOrder).toBeLessThan(winback180.defaultParams.minDaysSinceOrder)
    expect(winback90.defaultParams.maxDaysSinceOrder).toBeLessThan(winback180.defaultParams.maxDaysSinceOrder)
  })
})
