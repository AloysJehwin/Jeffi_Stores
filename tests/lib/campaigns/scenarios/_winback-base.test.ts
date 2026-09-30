import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  queryMany: vi.fn(),
  query: vi.fn(),
}))

vi.mock('@/lib/automation-emails', () => ({
  APP_URL: 'https://jeffistores.com',
  fetchUserContext: vi.fn(),
  resolveCoupon: vi.fn(),
  sendCampaignEmail: vi.fn(),
  renderItemRows: vi.fn().mockReturnValue('<ul><li>item</li></ul>'),
}))

import { buildWinbackScenario } from '@/lib/campaigns/scenarios/_winback-base'
import { queryMany } from '@/lib/db'
import { fetchUserContext, resolveCoupon, sendCampaignEmail } from '@/lib/automation-emails'

const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockFetchUser = fetchUserContext as ReturnType<typeof vi.fn>
const mockResolveCoupon = resolveCoupon as ReturnType<typeof vi.fn>
const mockSendEmail = sendCampaignEmail as ReturnType<typeof vi.fn>

const defaultOpts = {
  kind: 'winback_90',
  name: 'Win-Back 90',
  description: 'Test winback',
  trigger: 'Test trigger',
  defaults: {
    minDaysSinceOrder: 60,
    maxDaysSinceOrder: 150,
    healthScoreMin: 25,
    healthScoreMax: 50,
    sendCooldownDays: 60,
    maxRecipientsPerSweep: 50,
    whatsappEnabled: false,
  },
}

const campaign = {
  kind: 'winback_90',
  enabled: true,
  name: 'Win-Back 90',
  coupon_id: null,
  discount_percent: 0,
  delay_hours: 0,
  parameters: {},
} as any

describe('buildWinbackScenario', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a scenario with correct metadata', () => {
    const scenario = buildWinbackScenario(defaultOpts)
    expect(scenario.kind).toBe('winback_90')
    expect(scenario.name).toBe('Win-Back 90')
    expect(scenario.description).toBe('Test winback')
    expect(scenario.trigger).toBe('Test trigger')
  })

  it('defaultParams match provided defaults', () => {
    const scenario = buildWinbackScenario(defaultOpts)
    expect(scenario.defaultParams.minDaysSinceOrder).toBe(60)
    expect(scenario.defaultParams.maxDaysSinceOrder).toBe(150)
    expect(scenario.defaultParams.sendCooldownDays).toBe(60)
    expect(scenario.defaultParams.maxRecipientsPerSweep).toBe(50)
  })

  it('paramSchema has all required fields', () => {
    const scenario = buildWinbackScenario(defaultOpts)
    const fields = Object.keys(scenario.paramSchema)
    expect(fields).toContain('minDaysSinceOrder')
    expect(fields).toContain('maxDaysSinceOrder')
    expect(fields).toContain('healthScoreMin')
    expect(fields).toContain('healthScoreMax')
    expect(fields).toContain('sendCooldownDays')
    expect(fields).toContain('maxRecipientsPerSweep')
  })

  describe('findEligible', () => {
    it('calls queryMany with the correct number of params', async () => {
      const scenario = buildWinbackScenario(defaultOpts)
      mockQueryMany.mockResolvedValue([])
      await scenario.findEligible({ campaign, params: scenario.defaultParams })
      expect(mockQueryMany).toHaveBeenCalledOnce()
      const [, params] = mockQueryMany.mock.calls[0]
      expect(params).toHaveLength(7)
      expect(params[0]).toBe('winback_90')
    })

    it('returns rows from queryMany', async () => {
      const scenario = buildWinbackScenario(defaultOpts)
      mockQueryMany.mockResolvedValue([{ id: 'user-abc' }, { id: 'user-def' }])
      const rows = await scenario.findEligible({ campaign, params: scenario.defaultParams })
      expect(rows).toHaveLength(2)
    })
  })

  describe('send', () => {
    it('returns no_user when fetchUserContext returns null', async () => {
      const scenario = buildWinbackScenario(defaultOpts)
      mockFetchUser.mockResolvedValue(null)
      const result = await scenario.send({ id: 'user-1' }, { campaign, params: scenario.defaultParams })
      expect(result).toEqual({ ok: false, reason: 'no_user' })
    })

    it('returns coupon_failed when coupon required but not generated', async () => {
      const scenario = buildWinbackScenario(defaultOpts)
      mockFetchUser.mockResolvedValue({ id: 'user-1', first_name: 'Alice', email: 'a@x.com' })
      mockResolveCoupon.mockResolvedValue({ couponCode: null, discountPercent: 0 })
      const campaignWithCoupon = { ...campaign, coupon_id: 'coupon-123' }

      // items query
      mockQueryMany.mockResolvedValueOnce([]) // second queryMany for items

      const result = await scenario.send(
        { id: 'user-1' },
        { campaign: campaignWithCoupon, params: scenario.defaultParams }
      )
      expect(result).toEqual({ ok: false, reason: 'coupon_failed' })
    })

    it('calls sendCampaignEmail and returns its result', async () => {
      const scenario = buildWinbackScenario(defaultOpts)
      mockFetchUser.mockResolvedValue({ id: 'user-1', first_name: 'Bob', email: 'b@x.com' })
      mockResolveCoupon.mockResolvedValue({ couponCode: 'WB10', discountPercent: 10 })
      mockQueryMany.mockResolvedValue([])
      mockSendEmail.mockResolvedValue({ ok: true })

      const result = await scenario.send({ id: 'user-1' }, { campaign, params: scenario.defaultParams })
      expect(result).toEqual({ ok: true })
      expect(mockSendEmail).toHaveBeenCalledOnce()
    })

    it('includes items in email vars when queryMany returns products', async () => {
      const scenario = buildWinbackScenario(defaultOpts)
      mockFetchUser.mockResolvedValue({ id: 'u1', first_name: 'Carol', email: 'c@x.com' })
      mockResolveCoupon.mockResolvedValue({ couponCode: null, discountPercent: 0 })
      mockQueryMany.mockResolvedValue([
        { name: 'Bolt M6', product_slug: 'bolt-m6', image_url: 'https://img.com/bolt.jpg' },
      ])
      mockSendEmail.mockResolvedValue({ ok: true })

      await scenario.send({ id: 'u1' }, { campaign, params: scenario.defaultParams })
      const callArg = mockSendEmail.mock.calls[0][0]
      expect(callArg.vars.itemsHtml).toBeTruthy()
    })

    it('uses "there" as fallback when user has no first_name', async () => {
      const scenario = buildWinbackScenario(defaultOpts)
      mockFetchUser.mockResolvedValue({ id: 'u1', first_name: null, email: 'x@x.com' })
      mockResolveCoupon.mockResolvedValue({ couponCode: null, discountPercent: 0 })
      mockQueryMany.mockResolvedValue([])
      mockSendEmail.mockResolvedValue({ ok: true })

      await scenario.send({ id: 'u1' }, { campaign, params: scenario.defaultParams })
      const callArg = mockSendEmail.mock.calls[0][0]
      expect(callArg.vars.firstName).toBe('there')
    })
  })
})
