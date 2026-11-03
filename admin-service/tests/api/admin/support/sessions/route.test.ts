import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn(), authenticateAnyUser: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/support/sessions', () => ({ listInbox: vi.fn(), inboxCounts: vi.fn(), getSessionRow: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/support/sessions/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { listInbox, inboxCounts } from '@/lib/support/sessions'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockList = vi.mocked(listInbox)
const mockCounts = vi.mocked(inboxCounts)

const admin = { adminId: 'a1', email: 'a@x.com', role: 'admin', scopes: ['customers:read'] }
const COUNTS = { needs_human: 2, mine: 1, ai: 3, open: 5, closed: 0, approval: 0 }

const makeReq = (query = '') => new NextRequest(`http://localhost/api/admin/support/sessions${query}`)

beforeEach(() => {
  vi.resetAllMocks()
  mockAuth.mockResolvedValue(admin)
  mockHasScope.mockReturnValue(true)
  mockList.mockResolvedValue([])
  mockCounts.mockResolvedValue(COUNTS)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/admin/support/sessions', () => {
  it('401 when unauthenticated (passive auth, no session touch)', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), { passive: true })
  })

  it('403 without customers:read', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeReq())
    expect(res.status).toBe(403)
    expect(mockHasScope).toHaveBeenCalledWith('admin', ['customers:read'], 'customers:read')
    expect(mockList).not.toHaveBeenCalled()
  })

  it('defaults to the open inbox and returns counts', async () => {
    const sessions = [{ id: 's1', ticket: 'SUP-2610-0001' }] as any
    mockList.mockResolvedValue(sessions)
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sessions, counts: COUNTS })
    expect(mockList).toHaveBeenCalledWith({ filter: 'open', adminId: 'a1', channel: undefined, search: undefined, customerId: undefined, limit: 100 })
    expect(mockCounts).toHaveBeenCalledWith('a1')
  })

  it('passes filter, channel, search and customer through; caps the limit at 200', async () => {
    await GET(makeReq('?filter=needs_human&channel=whatsapp&q=%20ravi%20&customerId=u1&limit=500'))
    expect(mockList).toHaveBeenCalledWith({ filter: 'needs_human', adminId: 'a1', channel: 'whatsapp', search: 'ravi', customerId: 'u1', limit: 200 })
  })

  it('ignores an unknown filter or channel and a blank search', async () => {
    await GET(makeReq('?filter=everything&channel=fax&q=%20%20&limit=abc'))
    expect(mockList).toHaveBeenCalledWith({ filter: 'open', adminId: 'a1', channel: undefined, search: undefined, customerId: undefined, limit: 100 })
  })

  it('500 when the inbox query fails', async () => {
    mockList.mockRejectedValue(new Error('DB down'))
    const res = await GET(makeReq())
    expect(res.status).toBe(500)
  })
})
