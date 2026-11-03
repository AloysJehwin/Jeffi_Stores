import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))

import { getOrCreateReferralCode, normalizeReferralCode, resolveReferralCode } from '@/lib/referrals/codes'
import { queryOne } from '@/lib/shared/db'

const mockQueryOne = queryOne as ReturnType<typeof vi.fn>

describe('referral codes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('normalizes and validates codes', () => {
    expect(normalizeReferralCode(' asha7k2q ')).toBe('ASHA7K2Q')
    expect(normalizeReferralCode('AB')).toBeNull()
    expect(normalizeReferralCode('ASHA-7K2Q')).toBeNull()
    expect(normalizeReferralCode(42)).toBeNull()
  })

  it('returns the existing code without creating one', async () => {
    mockQueryOne.mockResolvedValueOnce({ referral_code: 'ASHA7K2Q' })
    expect(await getOrCreateReferralCode('u1')).toBe('ASHA7K2Q')
    expect(mockQueryOne).toHaveBeenCalledTimes(1)
  })

  it('creates a name-prefixed code on first use', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null) // no code yet
      .mockResolvedValueOnce({ first_name: 'Asha' }) // eligible customer
      .mockResolvedValueOnce(null) // insert
      .mockImplementationOnce(async () => ({ referral_code: mockQueryOne.mock.calls[2][1][1] }))
    const code = await getOrCreateReferralCode('u1')
    expect(code).toMatch(/^ASHA[A-HJ-NP-Z2-9]{4}$/)
    expect(String(mockQueryOne.mock.calls[2][0])).toContain('ON CONFLICT DO NOTHING')
  })

  it('uses a neutral prefix when the name has no letters', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ first_name: '' })
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(async () => ({ referral_code: mockQueryOne.mock.calls[2][1][1] }))
    expect(await getOrCreateReferralCode('u1')).toMatch(/^JOIN/)
  })

  it('gives no code to an ineligible account', async () => {
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    expect(await getOrCreateReferralCode('u1')).toBeNull()
  })

  it('resolves only active codes of eligible referrers', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'r1', referrer_user_id: 'u1', first_name: 'Asha' })
    expect(await resolveReferralCode('asha7k2q')).toEqual({
      referralId: 'r1',
      referrerUserId: 'u1',
      referrerFirstName: 'Asha',
    })
    const [sql, args] = mockQueryOne.mock.calls[0]
    expect(String(sql)).toContain("r.status = 'active'")
    expect(args).toEqual(['ASHA7K2Q'])
  })

  it('does not query for a malformed code', async () => {
    expect(await resolveReferralCode('bad code!')).toBeNull()
    expect(mockQueryOne).not.toHaveBeenCalled()
  })
})
