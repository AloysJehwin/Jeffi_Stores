import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/shared/automation-emails', () => ({
  fetchUserContext: vi.fn(),
  sendCampaignEmail: vi.fn().mockResolvedValue({ ok: true, sentId: 's1' }),
}))
vi.mock('@/lib/auth/jwt', () => ({ generateBirthdayToken: vi.fn().mockResolvedValue('tok.en/1') }))

import { birthdayCollect } from '@/lib/campaigns/scenarios/birthday-collect'
import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { days } from '@/lib/campaigns/duration'

const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockFetchUser = fetchUserContext as ReturnType<typeof vi.fn>
const mockSendEmail = sendCampaignEmail as ReturnType<typeof vi.fn>

const campaign = { kind: 'birthday_collect', enabled: true, parameters: {} } as any
const defaultParams = birthdayCollect.defaultParams as any

describe('birthdayCollect scenario', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryMany.mockResolvedValue([])
  })

  it('has kind birthday_collect and asks again only after 180 days by default', () => {
    expect(birthdayCollect.kind).toBe('birthday_collect')
    expect(defaultParams.askAgainAfter).toBe(days(180))
  })

  describe('findEligible', () => {
    it('targets retail customers with no birthday and an email', async () => {
      await birthdayCollect.findEligible({ campaign, params: defaultParams })
      const sql = String(mockQueryMany.mock.calls[0][0])
      expect(sql).toContain('u.date_of_birth IS NULL')
      expect(sql).toContain('u.email IS NOT NULL')
      expect(sql).toContain("bp.approval_status != 'approved'")
      expect(mockQueryMany.mock.calls[0][1]).toEqual(['birthday_collect', String(days(180)), 100])
    })

    it('never asks more often than the universal cooldown when that is longer', async () => {
      await birthdayCollect.findEligible({
        campaign,
        params: { ...defaultParams, askAgainAfter: days(30), sendCooldown: days(400) },
      })
      expect(mockQueryMany.mock.calls[0][1][1]).toBe(String(days(400)))
    })

    it('ignores a short universal cooldown in favour of its own re-ask window', async () => {
      await birthdayCollect.findEligible({ campaign, params: { ...defaultParams, sendCooldown: days(1) } })
      expect(mockQueryMany.mock.calls[0][1][1]).toBe(String(days(180)))
    })
  })

  describe('send', () => {
    it('emails a signed one-tap link to the birthday page', async () => {
      mockFetchUser.mockResolvedValue({ first_name: 'Sam', baseUrl: 'https://shop.test' })
      const res = await birthdayCollect.send({ user_id: 'u1' }, { campaign, params: defaultParams })
      expect(res.ok).toBe(true)
      const arg = mockSendEmail.mock.calls[0][0]
      expect(arg.vars.firstName).toBe('Sam')
      expect(arg.vars.ctaUrl).toBe('https://shop.test/birthday?token=tok.en%2F1')
    })

    it('returns no_user when the user is gone', async () => {
      mockFetchUser.mockResolvedValue(null)
      expect(await birthdayCollect.send({ user_id: 'u1' }, { campaign, params: defaultParams })).toEqual({
        ok: false,
        reason: 'no_user',
      })
    })
  })
})
