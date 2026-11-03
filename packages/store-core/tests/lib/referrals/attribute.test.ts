import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/referrals/settings', () => ({ isReferralLive: vi.fn() }))
vi.mock('@/lib/referrals/codes', () => ({ resolveReferralCode: vi.fn() }))

import { attributeReferral, normalizeEmailIdentity } from '@/lib/referrals/attribute'
import { queryOne } from '@/lib/shared/db'
import { isReferralLive } from '@/lib/referrals/settings'
import { resolveReferralCode } from '@/lib/referrals/codes'

const mockQueryOne = queryOne as ReturnType<typeof vi.fn>
const mockLive = isReferralLive as ReturnType<typeof vi.fn>
const mockResolve = resolveReferralCode as ReturnType<typeof vi.fn>

const referrer = { id: 'ref', email: 'asha@example.com', phone: '+91 98765 43210' }
const friend = { id: 'new', email: 'rahul@example.com', phone: '9123456789' }

// Wires the user lookups (by id) and answers every other single-row query with `others`.
function people(a: object | null, b: object | null, others: (sql: string) => unknown = () => ({ id: 'row' })) {
  mockQueryOne.mockImplementation(async (sql: string, args: unknown[]) => {
    if (String(sql).includes('FROM users u')) return args[0] === 'ref' ? a : b
    return others(String(sql))
  })
}

function insertedArgs(): unknown[] {
  return mockQueryOne.mock.calls.find(c => String(c[0]).includes('INSERT INTO referral_signups'))![1]
}

describe('normalizeEmailIdentity', () => {
  it('ignores case, plus tags and gmail dots', () => {
    expect(normalizeEmailIdentity('A.Sha+ref@GMail.com')).toBe('asha@gmail.com')
    expect(normalizeEmailIdentity('asha@googlemail.com')).toBe('asha@gmail.com')
    expect(normalizeEmailIdentity('a.sha+x@example.com')).toBe('a.sha@example.com')
    expect(normalizeEmailIdentity('nope')).toBeNull()
  })
})

describe('attributeReferral', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLive.mockResolvedValue(true)
    mockResolve.mockResolvedValue({ referralId: 'r1', referrerUserId: 'ref', referrerFirstName: 'Asha' })
  })

  it('records a genuine friend as joined', async () => {
    people(referrer, friend, sql => (sql.includes('auth_sessions') ? null : { id: 'row' }))
    expect(await attributeReferral({ newUserId: 'new', code: 'ASHA7K2Q', fpHash: 'fp-friend' })).toEqual({
      status: 'joined',
      referrerUserId: 'ref',
    })
    expect(insertedArgs()).toEqual(['r1', 'ref', 'new', 'joined', null])
  })

  it('rejects the same phone number', async () => {
    people(referrer, { ...friend, phone: '09876543210' })
    expect(await attributeReferral({ newUserId: 'new', code: 'X1Y2', fpHash: null })).toEqual({
      status: 'rejected',
      reason: 'same_phone',
    })
    expect(insertedArgs()).toEqual(['r1', 'ref', 'new', 'rejected', 'same_phone'])
  })

  it('rejects the same inbox written differently', async () => {
    people({ ...referrer, email: 'asha@gmail.com' }, { ...friend, email: 'a.s.h.a+deal@gmail.com' })
    expect((await attributeReferral({ newUserId: 'new', code: 'X1Y2', fpHash: null })).status).toBe('rejected')
    expect(insertedArgs()[4]).toBe('same_email')
  })

  it("rejects a signup from one of the referrer's devices", async () => {
    people(referrer, friend, sql => ({ id: 'row', hit: sql.includes('auth_sessions') }))
    expect(await attributeReferral({ newUserId: 'new', code: 'X1Y2', fpHash: 'fp-shared' })).toEqual({
      status: 'rejected',
      reason: 'same_device',
    })
    const deviceCall = mockQueryOne.mock.calls.find(c => String(c[0]).includes('auth_sessions'))!
    expect(String(deviceCall[0])).toContain("principal_type = 'customer'")
    expect(deviceCall[1]).toEqual(['ref', 'fp-shared'])
  })

  it('skips the device check when the friend has no fingerprint', async () => {
    people(referrer, friend)
    expect((await attributeReferral({ newUserId: 'new', code: 'X1Y2', fpHash: undefined })).status).toBe('joined')
    expect(mockQueryOne.mock.calls.some(c => String(c[0]).includes('auth_sessions'))).toBe(false)
  })

  it('rejects referring yourself', async () => {
    mockResolve.mockResolvedValue({ referralId: 'r1', referrerUserId: 'new', referrerFirstName: 'Asha' })
    people(null, friend)
    mockQueryOne.mockImplementation(async (sql: string) => (String(sql).includes('FROM users u') ? friend : { id: 'row' }))
    expect(await attributeReferral({ newUserId: 'new', code: 'X1Y2', fpHash: null })).toEqual({
      status: 'rejected',
      reason: 'self',
    })
  })

  it('skips quietly when off, the code is bad, or the friend was already referred', async () => {
    mockLive.mockResolvedValue(false)
    expect(await attributeReferral({ newUserId: 'new', code: 'X1Y2', fpHash: null })).toEqual({
      status: 'skipped',
      reason: 'disabled',
    })
    mockLive.mockResolvedValue(true)
    mockResolve.mockResolvedValue(null)
    expect((await attributeReferral({ newUserId: 'new', code: 'X1Y2', fpHash: null })).status).toBe('skipped')
    mockResolve.mockResolvedValue({ referralId: 'r1', referrerUserId: 'ref', referrerFirstName: 'Asha' })
    people(referrer, friend, () => null) // no device match, and the insert hits ON CONFLICT
    expect(await attributeReferral({ newUserId: 'new', code: 'X1Y2', fpHash: null })).toEqual({
      status: 'skipped',
      reason: 'already_referred',
    })
  })

  it('never throws into signup', async () => {
    mockResolve.mockRejectedValue(new Error('db down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await attributeReferral({ newUserId: 'new', code: 'X1Y2', fpHash: null })).toEqual({
      status: 'skipped',
      reason: 'error',
    })
  })
})
