import { vi, describe, it, expect } from 'vitest'

vi.mock('@/lib/db', () => ({ queryMany: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/automation-emails', () => ({
  APP_URL: 'https://jeffistores.com',
  fetchUserContext: vi.fn(),
  resolveCoupon: vi.fn(),
  sendCampaignEmail: vi.fn(),
  renderItemRows: vi.fn().mockReturnValue(''),
}))

import { winback180 } from '@/lib/campaigns/scenarios/winback-180'

describe('winback180 scenario', () => {
  it('has correct kind', () => {
    expect(winback180.kind).toBe('winback_180')
  })

  it('has correct name', () => {
    expect(winback180.name).toBe('Win-Back (180 days, dormant)')
  })

  it('defaultParams use deep dormant window', () => {
    expect(winback180.defaultParams.minDaysSinceOrder).toBe(150)
    expect(winback180.defaultParams.maxDaysSinceOrder).toBe(365)
  })

  it('defaultParams use low health score range', () => {
    expect(winback180.defaultParams.healthScoreMin).toBe(0)
    expect(winback180.defaultParams.healthScoreMax).toBe(25)
  })

  it('uses 60-day cooldown', () => {
    expect(winback180.defaultParams.sendCooldownDays).toBe(60)
  })

  it('has findEligible function', () => {
    expect(typeof winback180.findEligible).toBe('function')
  })

  it('has send function', () => {
    expect(typeof winback180.send).toBe('function')
  })

  it('has paramSchema', () => {
    expect(winback180.paramSchema).toBeDefined()
    expect(Object.keys(winback180.paramSchema)).toHaveLength(7)
  })
})
