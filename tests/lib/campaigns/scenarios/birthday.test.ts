import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/catalog/site-controls', () => ({ getFeatureFlags: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/shared/automation-emails', () => ({
  APP_URL: 'https://jeffistores.com',
  fetchUserContext: vi.fn(),
  resolveCoupon: vi.fn().mockResolvedValue({ couponCode: 'BDAY', discountPercent: '15' }),
  sendCampaignEmail: vi.fn().mockResolvedValue({ ok: true, sentId: 's1' }),
}))
vi.mock('@/lib/campaigns/whatsapp-dispatch', () => ({
  sendCampaignWhatsApp: vi.fn().mockResolvedValue({ ok: true }),
}))

import { birthday } from '@/lib/campaigns/scenarios/birthday'
import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { days } from '@/lib/campaigns/duration'

const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockFetchUser = fetchUserContext as ReturnType<typeof vi.fn>
const mockSendEmail = sendCampaignEmail as ReturnType<typeof vi.fn>
const mockSendWa = sendCampaignWhatsApp as ReturnType<typeof vi.fn>

const campaign = {
  kind: 'birthday',
  enabled: true,
  name: 'Birthday',
  coupon_id: null,
  discount_percent: 0,
  delay_hours: 0,
  parameters: {},
} as any
const defaultParams = birthday.defaultParams

describe('birthday scenario', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getFeatureFlags).mockResolvedValue({ birthdayEnabled: true } as any)
  })

  it('has kind birthday', () => {
    expect(birthday.kind).toBe('birthday')
  })

  it('windowBefore default is canonical minutes and typed as duration', () => {
    expect(defaultParams.windowBefore).toBe(days(2))
    expect(birthday.paramSchema.windowBefore.type).toBe('duration')
    expect((birthday.paramSchema.windowBefore as any).recommendedUnit).toBe('days')
  })

  describe('findEligible', () => {
    it('finds nobody, and reports no one suppressed, while Birthday rewards are off', async () => {
      vi.mocked(getFeatureFlags).mockResolvedValue({ birthdayEnabled: false } as any)
      const params = birthday.defaultParams as any
      expect(await birthday.findEligible({ campaign, params })).toEqual([])
      expect(await birthday.findSuppressed!({ campaign, params })).toEqual([])
      expect(mockQueryMany).not.toHaveBeenCalled()
    })

    it('passes the window as whole days (int) and cooldown as minutes', async () => {
      mockQueryMany.mockResolvedValue([{ user_id: 'u1' }])
      const rows = await birthday.findEligible({ campaign, params: defaultParams })
      expect(rows).toHaveLength(1)
      const [, args] = mockQueryMany.mock.calls[0]
      expect(args[0]).toBe('birthday')
      // generate_series upper bound is a whole day count, not minutes
      expect(args[1]).toBe(2)
      expect(args[2]).toBe(String(days(1)))
      expect(args[3]).toBe(defaultParams.maxRecipientsPerSweep)
    })
  })

  describe('send', () => {
    beforeEach(() => {
      mockFetchUser.mockResolvedValue({ first_name: 'Sam', baseUrl: 'https://shop.test', unsubscribe_token: 't' })
    })

    it('sends the birthday email with the coupon', async () => {
      const res = await birthday.send({ user_id: 'u1' }, { campaign, params: defaultParams })
      expect(res.ok).toBe(true)
      const arg = mockSendEmail.mock.calls[0][0]
      expect(arg.vars.couponCode).toBe('BDAY')
    })

    it('WhatsApp with day cooldown when enabled', async () => {
      await birthday.send({ user_id: 'u1' }, { campaign, params: { ...defaultParams, whatsappEnabled: true } })
      expect(mockSendWa).toHaveBeenCalledOnce()
      const [kind, , , cooldown] = mockSendWa.mock.calls[0]
      expect(kind).toBe('birthday')
      expect(cooldown).toBe(days(1))
    })
  })
})
