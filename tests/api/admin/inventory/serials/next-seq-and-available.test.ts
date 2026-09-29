import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))

import { GET as getNextSeq } from '@/app/api/admin/inventory/serials/next-seq/route'
import { GET as getAvailable } from '@/app/api/admin/inventory/serials/available/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany } from '@/lib/db'

const ADMIN = { adminId: 'a1', role: 'super_admin', scopes: ['inventory'] }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
})

function makeReq(url: string) {
  return new NextRequest(url)
}

describe('GET /api/admin/inventory/serials/next-seq', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await getNextSeq(makeReq('http://localhost/api/admin/inventory/serials/next-seq'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await getNextSeq(makeReq('http://localhost/api/admin/inventory/serials/next-seq'))
    expect(res.status).toBe(403)
  })

  it('returns 400 when prefix missing', async () => {
    const res = await getNextSeq(makeReq('http://localhost/api/admin/inventory/serials/next-seq'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/prefix/)
  })

  it('returns next_seq = max_seq + 1', async () => {
    vi.mocked(queryOne).mockResolvedValue({ max_seq: 5 } as any)
    const res = await getNextSeq(makeReq('http://localhost/api/admin/inventory/serials/next-seq?prefix=SAF001'))
    expect(res.status).toBe(200)
    expect((await res.json()).next_seq).toBe(6)
  })

  it('returns 1 when no existing serials (null max_seq)', async () => {
    vi.mocked(queryOne).mockResolvedValue({ max_seq: 0 } as any)
    const res = await getNextSeq(makeReq('http://localhost/api/admin/inventory/serials/next-seq?prefix=SAF001'))
    expect(res.status).toBe(200)
    expect((await res.json()).next_seq).toBe(1)
  })

  it('returns 500 on db error', async () => {
    vi.mocked(queryOne).mockRejectedValue(new Error('db fail'))
    const res = await getNextSeq(makeReq('http://localhost/api/admin/inventory/serials/next-seq?prefix=SAF001'))
    expect(res.status).toBe(500)
  })
})

describe('GET /api/admin/inventory/serials/available', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await getAvailable(makeReq('http://localhost/api/admin/inventory/serials/available?product_id=p1'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await getAvailable(makeReq('http://localhost/api/admin/inventory/serials/available?product_id=p1'))
    expect(res.status).toBe(403)
  })

  it('returns 400 when product_id missing', async () => {
    const res = await getAvailable(makeReq('http://localhost/api/admin/inventory/serials/available'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/product_id/)
  })

  it('returns serials on happy path', async () => {
    const serials = [{ serial_number: 'SN001', batch_id: null, lot_number: null }]
    vi.mocked(queryMany).mockResolvedValue(serials as any)
    const res = await getAvailable(makeReq('http://localhost/api/admin/inventory/serials/available?product_id=p1'))
    expect(res.status).toBe(200)
    expect((await res.json()).serials).toEqual(serials)
  })

  it('passes variant_id and sub_variant_id to query', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)
    const res = await getAvailable(makeReq('http://localhost/api/admin/inventory/serials/available?product_id=p1&variant_id=v1&sub_variant_id=sv1'))
    expect(res.status).toBe(200)
    expect(queryMany).toHaveBeenCalledWith(expect.any(String), ['p1', 'v1', 'sv1'])
  })

  it('returns 500 on db error', async () => {
    vi.mocked(queryMany).mockRejectedValue(new Error('fail'))
    const res = await getAvailable(makeReq('http://localhost/api/admin/inventory/serials/available?product_id=p1'))
    expect(res.status).toBe(500)
  })
})
