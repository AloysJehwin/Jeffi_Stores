/**
 * Tests for GET /api/business/me
 * src/app/api/business/me/route.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes!!'

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const mockAuthenticateBusiness = vi.hoisted(() => vi.fn())
const mockQueryOne = vi.hoisted(() => vi.fn())
const mockQueryMany = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/jwt', () => ({
  authenticateBusiness: mockAuthenticateBusiness,
}))

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: mockQueryOne,
  queryMany: mockQueryMany,
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/legals/policies', () => ({
  POLICY_VERSION: '2026-06-14',
}))

import { GET } from '@/app/api/business/me/route'

// ── helpers ───────────────────────────────────────────────────────────────────
function makeGet() {
  return new Request('http://localhost/api/business/me', { method: 'GET' })
}

const AUTH_PAYLOAD = { userId: 'biz-1', email: 'biz@example.com', isBusiness: true, approvalStatus: 'approved' }

const DB_USER = {
  id: 'biz-1',
  email: 'biz@example.com',
  first_name: 'Biz',
  last_name: 'Owner',
  phone: '9876543210',
  created_at: new Date().toISOString(),
  avatar_url: null,
  policies_accepted_version: '2026-06-14',
  approval_status: 'approved',
  company_name: 'Acme Ltd',
}

// ── tests ─────────────────────────────────────────────────────────────────────
describe('GET /api/business/me', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns {user:null} when not authenticated', async () => {
    mockAuthenticateBusiness.mockResolvedValue(null)
    const res = await GET(makeGet() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user).toBeNull()
  })

  it('returns {user:null} when user not found in db', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_PAYLOAD)
    mockQueryOne.mockResolvedValue(null)
    const res = await GET(makeGet() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user).toBeNull()
  })

  it('returns full user object for approved user with discounts', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_PAYLOAD)
    mockQueryOne.mockResolvedValue(DB_USER)
    mockQueryMany.mockResolvedValue([
      { category_id: 'cat-1', discount_pct: '10.00' },
      { category_id: 'cat-2', discount_pct: '5.50' },
    ])
    const res = await GET(makeGet() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user.email).toBe('biz@example.com')
    expect(body.user.isBusiness).toBe(true)
    expect(body.user.approvalStatus).toBe('approved')
    expect(body.user.businessDiscountMap).toMatchObject({ 'cat-1': 10, 'cat-2': 5.5 })
    expect(body.user.companyName).toBe('Acme Ltd')
  })

  it('does not include businessDiscountMap for non-approved user', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_PAYLOAD)
    mockQueryOne.mockResolvedValue({ ...DB_USER, approval_status: 'pending' })
    const res = await GET(makeGet() as any)
    const body = await res.json()
    expect(body.user.businessDiscountMap).toBeUndefined()
    expect(body.user.approvalStatus).toBe('pending')
  })

  it('sets requiresPolicyAcceptance=true when versions differ', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_PAYLOAD)
    mockQueryOne.mockResolvedValue({ ...DB_USER, policies_accepted_version: '2025-01-01' })
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeGet() as any)
    const body = await res.json()
    expect(body.user.requiresPolicyAcceptance).toBe(true)
    expect(body.user.policyVersion).toBe('2026-06-14')
  })

  it('sets requiresPolicyAcceptance=false when versions match', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_PAYLOAD)
    mockQueryOne.mockResolvedValue(DB_USER)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeGet() as any)
    const body = await res.json()
    expect(body.user.requiresPolicyAcceptance).toBe(false)
  })

  it('defaults approvalStatus to pending when null in db', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_PAYLOAD)
    mockQueryOne.mockResolvedValue({ ...DB_USER, approval_status: null })
    const res = await GET(makeGet() as any)
    const body = await res.json()
    expect(body.user.approvalStatus).toBe('pending')
  })

  it('returns {user:null} on exception', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_PAYLOAD)
    mockQueryOne.mockRejectedValue(new Error('db down'))
    const res = await GET(makeGet() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user).toBeNull()
  })
})
