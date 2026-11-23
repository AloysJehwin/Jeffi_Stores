import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from '../../src/next.js'

vi.mock('@jeffi/tenancy', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
  getClient: vi.fn(),
}))

vi.mock('../../src/lib/draft-locks.js', () => ({
  lockBadges: vi.fn(async () => ({})),
}))

import { GET, POST } from '../../src/admin/invoices/cash-sale-drafts.js'
import { queryMany, queryOne } from '@jeffi/tenancy'
import { lockBadges } from '../../src/lib/draft-locks.js'

const mockQueryMany = vi.mocked(queryMany)
const mockQueryOne = vi.mocked(queryOne)
const mockLockBadges = vi.mocked(lockBadges)

const adminClaims = { internal: true, adminId: 'a1', tenantId: 't1', role: 'administrator', scopes: [] }
const noScopeClaims = { internal: true, adminId: 'a1', tenantId: 't1', role: 'staff', scopes: [] }

function makeReq(method: string, body?: any, claims?: any) {
  const req = new NextRequest('http://localhost/api/admin/invoices/cash-sale-drafts', {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
  })
  if (claims) req.claims = claims
  return req
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLockBadges.mockResolvedValue({})
})

describe('GET cash-sale-drafts', () => {
  it('401 when unauthenticated', async () => {
    const res = await GET(makeReq('GET'))
    expect(res.status).toBe(401)
  })
  it('403 when scope missing', async () => {
    const res = await GET(makeReq('GET', undefined, noScopeClaims))
    expect(res.status).toBe(403)
  })
  it('200 lists held bills with lock badges', async () => {
    mockQueryMany.mockResolvedValue([{ id: 'd1' }, { id: 'd2' }] as any)
    mockLockBadges.mockResolvedValue({ d1: { ownerId: 'a2', mine: false } } as any)
    const res = await GET(makeReq('GET', undefined, adminClaims))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.drafts).toHaveLength(2)
    expect(body.drafts[0].lock).toEqual({ ownerId: 'a2', mine: false })
    expect(body.drafts[1].lock).toBeNull()
  })
})

describe('POST cash-sale-drafts', () => {
  it('401 when unauthenticated', async () => {
    const res = await POST(makeReq('POST', {}))
    expect(res.status).toBe(401)
  })
  it('403 when scope missing', async () => {
    const res = await POST(makeReq('POST', {}, noScopeClaims))
    expect(res.status).toBe(403)
  })
  it('400 when body fails schema (bad payment_mode)', async () => {
    const res = await POST(makeReq('POST', { payment_mode: 'card' }, adminClaims))
    expect(res.status).toBe(400)
  })
  it('409 when admin already has the max held bills', async () => {
    mockQueryOne.mockResolvedValue({ n: '50' } as any)
    const res = await POST(makeReq('POST', { payment_mode: 'cash' }, adminClaims))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/held bills/)
  })
  it('201 creates a held bill', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ n: '0' } as any) // count
      .mockResolvedValueOnce({ id: 'new-1' } as any) // insert
    const res = await POST(
      makeReq('POST', { label: 'Counter 1', payment_mode: 'upi', items: [{ sku: 'X' }], total_estimate: 100 }, adminClaims)
    )
    expect(res.status).toBe(201)
    expect((await res.json()).id).toBe('new-1')
  })
  it('201 with defaults when minimal body', async () => {
    mockQueryOne.mockResolvedValueOnce({ n: '0' } as any).mockResolvedValueOnce({ id: 'new-2' } as any)
    const res = await POST(makeReq('POST', {}, adminClaims))
    expect(res.status).toBe(201)
    expect((await res.json()).id).toBe('new-2')
  })
})
