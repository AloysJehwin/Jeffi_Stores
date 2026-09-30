import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryMany: vi.fn() }))

import { GET } from '@/app/api/admin/coupons/user-pool/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)

const ADMIN = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['customers'] }
const USERS = [{ id: 'u1', full_name: 'Alice', email: 'alice@example.com' }]

function makeReq(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/coupons/user-pool')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
}

describe('GET /api/admin/coupons/user-pool', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(USERS as any)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeReq())
    expect(res.status).toBe(403)
  })

  it('returns all users for mode=all (default)', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.users).toEqual(USERS)
    expect(body.count).toBe(1)
  })

  it('returns all users when mode=all is explicit', async () => {
    const res = await GET(makeReq({ mode: 'all' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(1)
  })

  it('returns 400 for invalid mode', async () => {
    const res = await GET(makeReq({ mode: 'bogus' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid mode')
  })

  it('returns 400 for mode=segment with no segment param (falls to invalid mode)', async () => {
    const res = await GET(makeReq({ mode: 'segment' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid mode')
  })

  it('returns 400 for unknown segment value', async () => {
    const res = await GET(makeReq({ mode: 'segment', segment: 'unknown_segment' }))
    expect(res.status).toBe(400)
  })

  it.each(['b2b', 'vip', 'loyal', 'repeat', 'new', 'at_risk', 'dormant', 'one_time', 'lead'])(
    'returns users for segment=%s',
    async seg => {
      const res = await GET(makeReq({ mode: 'segment', segment: seg }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.users).toEqual(USERS)
    }
  )

  it('returns users for mode=score with defaults', async () => {
    const res = await GET(makeReq({ mode: 'score' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.users).toEqual(USERS)
    expect(mockQueryMany).toHaveBeenCalledWith(expect.stringContaining('ch.score'), [0, 100])
  })

  it('returns users for mode=score with explicit score range', async () => {
    const res = await GET(makeReq({ mode: 'score', score_min: '20', score_max: '80' }))
    expect(res.status).toBe(200)
    expect(mockQueryMany).toHaveBeenCalledWith(expect.stringContaining('ch.score'), [20, 80])
  })

  it('returns 500 on unexpected error', async () => {
    mockQueryMany.mockRejectedValueOnce(new Error('DB down'))
    const res = await GET(makeReq())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('DB down')
  })
})
