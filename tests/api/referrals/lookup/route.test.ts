import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/referrals/settings', () => ({ isReferralLive: vi.fn() }))
vi.mock('@/lib/referrals/codes', () => ({ resolveReferralCode: vi.fn() }))

import { GET } from '@storefront/app/api/(public)/referrals/lookup/route'
import { isReferralLive } from '@/lib/referrals/settings'
import { resolveReferralCode } from '@/lib/referrals/codes'

const mockLive = isReferralLive as ReturnType<typeof vi.fn>
const mockResolve = resolveReferralCode as ReturnType<typeof vi.fn>

// `cookie` is a forbidden header in the fetch Request constructor, so set it through the jar.
function withCookie(value?: string): NextRequest {
  const req = new NextRequest('https://shop.test/api/referrals/lookup')
  if (value) req.cookies.set('ref_code', value)
  return req
}

describe('GET /api/referrals/lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLive.mockResolvedValue(true)
  })

  it("returns only the referrer's first name", async () => {
    mockResolve.mockResolvedValue({ referralId: 'r1', referrerUserId: 'u1', referrerFirstName: 'Asha' })
    expect(await (await GET(withCookie('ASHA7K2Q'))).json()).toEqual({ firstName: 'Asha' })
  })

  it('returns null without a cookie or while the program is off', async () => {
    expect(await (await GET(withCookie())).json()).toEqual({ firstName: null })
    mockLive.mockResolvedValue(false)
    expect(await (await GET(withCookie('ASHA7K2Q'))).json()).toEqual({ firstName: null })
    expect(mockResolve).not.toHaveBeenCalled()
  })
})
