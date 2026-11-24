import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/queries', () => ({ getDashboardActivity: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/dashboard/activity/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getDashboardActivity } from '@/lib/queries'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockGet = vi.mocked(getDashboardActivity)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['dashboard'] }

function makeReq(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/dashboard/activity')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(admin as any)
  mockHasScope.mockReturnValue(true)
  mockGet.mockResolvedValue({ weeks: 26, channel: 'all', days: [] } as any)
})

describe('GET /api/admin/dashboard/activity', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await GET(makeReq())).status).toBe(401)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('returns 403 without dashboard:read', async () => {
    mockHasScope.mockReturnValue(false)
    expect((await GET(makeReq())).status).toBe(403)
    expect(mockHasScope).toHaveBeenCalledWith('super_admin', ['dashboard'], 'dashboard:read')
  })

  it('defaults to 26 weeks and all channels', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    expect(mockGet).toHaveBeenCalledWith({ weeks: 26, channel: 'all' })
    expect((await res.json()).activity.weeks).toBe(26)
  })

  it.each([13, 26, 52])('accepts %i weeks', async weeks => {
    expect((await GET(makeReq({ weeks: String(weeks) }))).status).toBe(200)
    expect(mockGet).toHaveBeenCalledWith({ weeks, channel: 'all' })
  })

  it.each(['online', 'cod', 'business', 'all'])('accepts channel %s', async channel => {
    expect((await GET(makeReq({ channel }))).status).toBe(200)
    expect(mockGet).toHaveBeenCalledWith({ weeks: 26, channel })
  })

  it.each([{ weeks: '12' }, { weeks: 'abc' }, { weeks: '' }, { weeks: '104' }])('400 on bad weeks %j', async p => {
    expect((await GET(makeReq(p))).status).toBe(400)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('400 on a bad channel', async () => {
    expect((await GET(makeReq({ channel: 'wholesale' }))).status).toBe(400)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('returns 500 when the query throws', async () => {
    mockGet.mockRejectedValue(new Error('db fail'))
    const res = await GET(makeReq())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('db fail')
  })
})
