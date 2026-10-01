import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn().mockReturnValue(true) }))

const mockQuery = vi.fn()
const mockQueryOne = vi.fn()
const mockQueryMany = vi.fn()
const mockClientQuery = vi.fn()
vi.mock('@/lib/shared/db', () => ({
  query: (...a: any[]) => mockQuery(...a),
  queryOne: (...a: any[]) => mockQueryOne(...a),
  queryMany: (...a: any[]) => mockQueryMany(...a),
  withTransaction: (fn: any) => fn({ query: (...a: any[]) => mockClientQuery(...a) }),
}))

import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { GET, POST } from '@/app/api/(admin)/admin/product-offers/route'

const admin = { id: 'a1', role: 'super_admin', scopes: [] }

function req(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/admin/product-offers', {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('GET /api/admin/product-offers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
    vi.mocked(hasScope).mockReturnValue(true)
  })

  it('401 unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await GET(req('GET'))
    expect(res.status).toBe(401)
  })

  it('403 insufficient scope', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await GET(req('GET'))
    expect(res.status).toBe(403)
  })

  it('returns offers with counts', async () => {
    mockQueryMany.mockResolvedValueOnce([{ id: 'o1', product_count: 2 }])
    const res = await GET(req('GET'))
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.offers).toEqual([{ id: 'o1', product_count: 2 }])
  })
})

describe('POST /api/admin/product-offers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
    vi.mocked(hasScope).mockReturnValue(true)
  })

  it('401 unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(req('POST', { title: 'Diwali' }))
    expect(res.status).toBe(401)
  })

  it('403 insufficient scope', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await POST(req('POST', { title: 'Diwali' }))
    expect(res.status).toBe(403)
  })

  it('400 validation failure (missing title)', async () => {
    const res = await POST(req('POST', {}))
    expect(res.status).toBe(400)
  })

  it('creates offer, generating slug from title when none clashes', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ next: 0 }] }) // max order
      .mockResolvedValueOnce({ rows: [] }) // slug clash check -> none
      .mockResolvedValueOnce({ rows: [{ id: 'new-id' }] }) // insert returning id
      .mockResolvedValueOnce({ rows: [{ id: 'new-id', slug: 'diwali-dhamaka', title: 'Diwali Dhamaka' }] }) // select
    const res = await POST(req('POST', { title: 'Diwali Dhamaka' }))
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.offer.id).toBe('new-id')
    const insertCall = mockClientQuery.mock.calls[2]
    expect(insertCall[1][0]).toBe('diwali-dhamaka')
  })

  it('appends -2 to slug on a conflict', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ next: 1 }] }) // max order
      .mockResolvedValueOnce({ rows: [{ id: 'existing' }] }) // base slug taken
      .mockResolvedValueOnce({ rows: [] }) // -2 free
      .mockResolvedValueOnce({ rows: [{ id: 'nid' }] }) // insert
      .mockResolvedValueOnce({ rows: [{ id: 'nid', slug: 'diwali-2' }] }) // select
    const res = await POST(req('POST', { title: 'Diwali' }))
    const data = await res.json()
    expect(res.status).toBe(200)
    const insertCall = mockClientQuery.mock.calls[3]
    expect(insertCall[1][0]).toBe('diwali-2')
  })
})
