import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn(), authenticateAnyUser: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/support/sessions', () => ({ listInbox: vi.fn(), getSessionRow: vi.fn() }))

import { GET } from '@controller/app/api/(admin)/admin/support/customers/[userId]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { listInbox } from '@/lib/support/sessions'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockList = vi.mocked(listInbox)

const admin = { adminId: 'a1', email: 'a@x.com', role: 'admin', scopes: ['customers:read'] }
const PARAMS = { params: Promise.resolve({ userId: 'u1' }) }
const makeReq = () => new NextRequest('http://localhost/api/admin/support/customers/u1')

beforeEach(() => {
  vi.resetAllMocks()
  mockAuth.mockResolvedValue(admin)
  mockHasScope.mockReturnValue(true)
})

describe('GET /api/admin/support/customers/[userId]', () => {
  it('401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeReq(), PARAMS)
    expect(res.status).toBe(401)
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), { passive: true })
  })

  it('403 without customers:read', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeReq(), PARAMS)
    expect(res.status).toBe(403)
    expect(mockList).not.toHaveBeenCalled()
  })

  it('null when the customer has no open chat', async () => {
    mockList.mockResolvedValue([])
    const res = await GET(makeReq(), PARAMS)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ session: null })
    expect(mockList).toHaveBeenCalledWith({ filter: 'open', adminId: 'a1', customerId: 'u1', limit: 1 })
  })

  it("returns the customer's open chat", async () => {
    const session = { id: 's1', status: 'open', ticket: 'SUP-2610-0001' } as any
    mockList.mockResolvedValue([session])
    const res = await GET(makeReq(), PARAMS)
    expect(await res.json()).toEqual({ session })
  })

  it('500 when the lookup fails', async () => {
    mockList.mockRejectedValue(new Error('DB down'))
    const res = await GET(makeReq(), PARAMS)
    expect(res.status).toBe(500)
  })
})
