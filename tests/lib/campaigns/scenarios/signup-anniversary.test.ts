import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/shared/automation-emails', () => ({
  APP_URL: 'https://jeffistores.com',
  fetchUserContext: vi.fn(),
  resolveCoupon: vi.fn().mockResolvedValue({ couponCode: 'CHEERS', discountPercent: '10' }),
  sendCampaignEmail: vi.fn().mockResolvedValue({ ok: true, sentId: 's1' }),
  renderItemRows: vi.fn().mockReturnValue('<items/>'),
}))
vi.mock('@/lib/campaigns/whatsapp-dispatch', () => ({
  sendCampaignWhatsApp: vi.fn().mockResolvedValue({ ok: true }),
}))

import { signupAnniversary } from '@/lib/campaigns/scenarios/signup-anniversary'
import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days } from '@/lib/campaigns/duration'

const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockFetchUser = fetchUserContext as ReturnType<typeof vi.fn>
const mockSendEmail = sendCampaignEmail as ReturnType<typeof vi.fn>
const mockSendWa = sendCampaignWhatsApp as ReturnType<typeof vi.fn>

const campaign = {
  kind: 'signup_anniversary',
  enabled: true,
  name: 'Signup Anniversary',
  coupon_id: null,
  discount_percent: 0,
  delay_hours: 1,
  parameters: {},
} as any

const defaultParams = signupAnniversary.defaultParams

describe('signupAnniversary scenario', () => {
  beforeEach(() => vi.clearAllMocks())

  it('has kind signup_anniversary', () => {
    expect(signupAnniversary.kind).toBe('signup_anniversary')
  })

  it('default windowBefore is canonical minutes (2 days)', () => {
    expect(defaultParams.windowBefore).toBe(days(2))
  })

  it('windowBefore is a duration param with recommended days', () => {
    expect(signupAnniversary.paramSchema.windowBefore.type).toBe('duration')
    expect((signupAnniversary.paramSchema.windowBefore as any).recommendedUnit).toBe('days')
  })

  describe('findEligible', () => {
    it('matches the anniversary date and passes minute strings', async () => {
      mockQueryMany.mockResolvedValue([{ user_id: 'u1' }])
      const rows = await signupAnniversary.findEligible({ campaign, params: defaultParams })
      expect(rows).toHaveLength(1)
      const [sql, args] = mockQueryMany.mock.calls[0]
      expect(sql).toContain('next_anniversary')
      expect(args[0]).toBe('signup_anniversary')
      expect(args[1]).toBe(String(days(2)))
      expect(args[3]).toBe(defaultParams.maxRecipientsPerSweep)
    })
  })

  describe('send', () => {
    beforeEach(() => {
      mockFetchUser.mockResolvedValue({ first_name: 'Sam', baseUrl: 'https://shop.test', unsubscribe_token: 't' })
    })

    it('sends an anniversary email with the coupon', async () => {
      const res = await signupAnniversary.send({ user_id: 'u1' }, { campaign, params: defaultParams })
      expect(res.ok).toBe(true)
      expect(mockSendEmail).toHaveBeenCalledOnce()
      expect(mockSendEmail.mock.calls[0][0].vars.couponCode).toBe('CHEERS')
    })

    it('does not send WhatsApp by default', async () => {
      await signupAnniversary.send({ user_id: 'u1' }, { campaign, params: defaultParams })
      expect(mockSendWa).not.toHaveBeenCalled()
    })

    it('sends WhatsApp when enabled', async () => {
      await signupAnniversary.send({ user_id: 'u1' }, { campaign, params: { ...defaultParams, whatsappEnabled: true } })
      expect(mockSendWa).toHaveBeenCalledOnce()
      expect(mockSendWa.mock.calls[0][0]).toBe('signup_anniversary')
    })

    it('returns no_user when the user is gone', async () => {
      mockFetchUser.mockResolvedValue(null)
      const res = await signupAnniversary.send({ user_id: 'u1' }, { campaign, params: defaultParams })
      expect(res).toEqual({ ok: false, reason: 'no_user' })
    })
  })

  it('exposes findSuppressed', () => {
    expect(typeof signupAnniversary.findSuppressed).toBe('function')
  })
})
