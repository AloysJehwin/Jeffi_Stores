import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryMany: vi.fn() }))

import { GET as getReturns } from '@/app/api/admin/returns/route'
import { GET as getReplacements } from '@/app/api/admin/replacements/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'

const ADMIN = { adminId: 'a1', role: 'super_admin', scopes: ['orders'] }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(queryMany).mockResolvedValue([] as any)
})

function makeReq(url: string) {
  return new NextRequest(url)
}

describe('GET /api/admin/returns', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await getReturns(makeReq('http://localhost/api/admin/returns'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await getReturns(makeReq('http://localhost/api/admin/returns'))
    expect(res.status).toBe(403)
  })

  it('returns returns list on happy path', async () => {
    const rows = [{ id: 'r1', status: 'pending_approval' }]
    vi.mocked(queryMany).mockResolvedValue(rows as any)
    const res = await getReturns(makeReq('http://localhost/api/admin/returns'))
    expect(res.status).toBe(200)
    expect((await res.json()).returns).toEqual(rows)
  })

  it('filters by status=pending_approval', async () => {
    await getReturns(makeReq('http://localhost/api/admin/returns?status=pending_approval'))
    expect(queryMany).toHaveBeenCalledWith(
      expect.stringContaining("rr.status = 'pending_approval'"),
      [],
    )
  })

  it('filters history by approved', async () => {
    await getReturns(makeReq('http://localhost/api/admin/returns?status=history&filter=approved'))
    expect(queryMany).toHaveBeenCalledWith(
      expect.stringContaining("rr.status = 'completed'"),
      [],
    )
  })

  it('filters history by rejected', async () => {
    await getReturns(makeReq('http://localhost/api/admin/returns?status=history&filter=rejected'))
    expect(queryMany).toHaveBeenCalledWith(
      expect.stringContaining("rr.status = 'rejected'"),
      [],
    )
  })

  it('filters history all by default', async () => {
    await getReturns(makeReq('http://localhost/api/admin/returns?status=history'))
    expect(queryMany).toHaveBeenCalledWith(
      expect.stringContaining("rr.status IN ('completed', 'rejected')"),
      [],
    )
  })

  it('returns 500 on db error', async () => {
    vi.mocked(queryMany).mockRejectedValue(new Error('db fail'))
    const res = await getReturns(makeReq('http://localhost/api/admin/returns'))
    expect(res.status).toBe(500)
  })
})

describe('GET /api/admin/replacements', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await getReplacements(makeReq('http://localhost/api/admin/replacements'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await getReplacements(makeReq('http://localhost/api/admin/replacements'))
    expect(res.status).toBe(403)
  })

  it('returns replacements list on happy path', async () => {
    const rows = [{ id: 'rp1', status: 'pending_approval' }]
    vi.mocked(queryMany).mockResolvedValue(rows as any)
    const res = await getReplacements(makeReq('http://localhost/api/admin/replacements'))
    expect(res.status).toBe(200)
    expect((await res.json()).replacements).toEqual(rows)
  })

  it('filters by pending_approval', async () => {
    await getReplacements(makeReq('http://localhost/api/admin/replacements?status=pending_approval'))
    expect(queryMany).toHaveBeenCalledWith(
      expect.stringContaining("rr.status = 'pending_approval'"),
      [],
    )
  })

  it('filters history by approved', async () => {
    await getReplacements(makeReq('http://localhost/api/admin/replacements?status=history&filter=approved'))
    expect(queryMany).toHaveBeenCalledWith(
      expect.stringContaining("rr.status = 'completed'"),
      [],
    )
  })

  it('filters history by rejected', async () => {
    await getReplacements(makeReq('http://localhost/api/admin/replacements?status=history&filter=rejected'))
    expect(queryMany).toHaveBeenCalledWith(
      expect.stringContaining("rr.status = 'rejected'"),
      [],
    )
  })

  it('filters history all by default', async () => {
    await getReplacements(makeReq('http://localhost/api/admin/replacements?status=history'))
    expect(queryMany).toHaveBeenCalledWith(
      expect.stringContaining("rr.status IN ('completed', 'rejected')"),
      [],
    )
  })

  it('returns 500 on db error', async () => {
    vi.mocked(queryMany).mockRejectedValue(new Error('db fail'))
    const res = await getReplacements(makeReq('http://localhost/api/admin/replacements'))
    expect(res.status).toBe(500)
  })
})
