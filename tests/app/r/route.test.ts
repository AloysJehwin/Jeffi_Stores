import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateUser: vi.fn() }))
vi.mock('@/lib/referrals/settings', () => ({ isReferralLive: vi.fn() }))
vi.mock('@/lib/referrals/codes', async () => {
  const actual = await vi.importActual<typeof import('@/lib/referrals/codes')>('@/lib/referrals/codes')
  return { ...actual, resolveReferralCode: vi.fn() }
})

import { GET } from '@/app/(storefront)/r/[code]/route'
import { authenticateUser } from '@/lib/auth/jwt'
import { isReferralLive } from '@/lib/referrals/settings'
import { resolveReferralCode } from '@/lib/referrals/codes'

const mockAuth = authenticateUser as ReturnType<typeof vi.fn>
const mockLive = isReferralLive as ReturnType<typeof vi.fn>
const mockResolve = resolveReferralCode as ReturnType<typeof vi.fn>

const visit = (code: string) =>
  GET(new NextRequest(`https://shop.test/r/${code}`), { params: Promise.resolve({ code }) })

describe('GET /r/[code]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(null)
    mockLive.mockResolvedValue(true)
    mockResolve.mockResolvedValue({ referralId: 'r1', referrerUserId: 'u1', referrerFirstName: 'Asha' })
  })

  it('remembers a valid code for 30 days and sends the visitor to signup', async () => {
    const res = await visit('asha7k2q')
    expect(res.headers.get('location')).toBe('https://shop.test/signup?ref=1')
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('ref_code=ASHA7K2Q')
    expect(cookie).toMatch(/Max-Age=2592000/i)
    expect(cookie).toMatch(/HttpOnly/i)
  })

  it('sends a signed-in customer home without crediting anyone', async () => {
    mockAuth.mockResolvedValue({ userId: 'u9' })
    const res = await visit('ASHA7K2Q')
    expect(res.headers.get('location')).toBe('https://shop.test/')
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('ignores unknown codes, malformed codes and a switched-off program', async () => {
    mockResolve.mockResolvedValue(null)
    expect((await visit('ASHA7K2Q')).headers.get('set-cookie')).toBeNull()
    mockResolve.mockResolvedValue({ referralId: 'r1', referrerUserId: 'u1', referrerFirstName: 'Asha' })
    expect((await visit('no!')).headers.get('location')).toBe('https://shop.test/')
    mockLive.mockResolvedValue(false)
    expect((await visit('ASHA7K2Q')).headers.get('set-cookie')).toBeNull()
  })
})
