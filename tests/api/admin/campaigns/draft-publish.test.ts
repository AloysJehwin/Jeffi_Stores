import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock auth
vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))
vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn().mockReturnValue(true),
}))

const mockQuery = vi.fn()
const mockQueryOne = vi.fn()
vi.mock('@/lib/db', () => ({
  query: (...a: any[]) => mockQuery(...a),
  queryOne: (...a: any[]) => mockQueryOne(...a),
  withTransaction: vi.fn(),
}))

import { authenticateAdmin } from '@/lib/jwt'
import { GET, PATCH, DELETE } from '@/app/api/admin/campaigns/[kind]/draft/route'
import { POST as publishPost } from '@/app/api/admin/campaigns/[kind]/publish/route'

const mockAdmin = { id: 'admin-1', role: 'super_admin', scopes: [] }

function makeReq(method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost/api/admin/campaigns/abandoned_cart/draft`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json' },
  })
}

const params = Promise.resolve({ kind: 'abandoned_cart' })

describe('campaigns draft route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(mockAdmin as any)
  })

  it('GET returns draft_fields null when no draft', async () => {
    mockQueryOne.mockResolvedValueOnce({ draft_fields: null })
    const res = await GET(makeReq(), { params })
    const data = await res.json()
    expect(data.draft_fields).toBeNull()
  })

  it('GET returns draft_fields when draft exists', async () => {
    mockQueryOne.mockResolvedValueOnce({ draft_fields: { title: 'test' } })
    const res = await GET(makeReq(), { params })
    const data = await res.json()
    expect(data.draft_fields).toEqual({ title: 'test' })
  })

  it('GET returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await GET(makeReq(), { params })
    expect(res.status).toBe(401)
  })

  it('PATCH saves draft fields', async () => {
    mockQuery.mockResolvedValueOnce({})
    const res = await PATCH(makeReq('PATCH', { enabled: true }), { params })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE campaigns'), expect.any(Array))
  })

  it('DELETE discards draft', async () => {
    mockQuery.mockResolvedValueOnce({})
    const res = await DELETE(makeReq('DELETE'), { params })
    const data = await res.json()
    expect(data.success).toBe(true)
  })
})

describe('campaigns publish route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(mockAdmin as any)
  })

  it('returns 404 when no draft', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await publishPost(makeReq('POST'), { params })
    expect(res.status).toBe(404)
  })

  it('returns 400 when campaign has no draft_fields', async () => {
    mockQueryOne.mockResolvedValueOnce({ draft_fields: null })
    const res = await publishPost(makeReq('POST'), { params })
    expect(res.status).toBe(400)
  })

  it('publishes draft when draft_fields exist', async () => {
    mockQueryOne.mockResolvedValueOnce({ draft_fields: { enabled: true, subject_template: 'test' } })
    mockQuery.mockResolvedValueOnce({})
    const res = await publishPost(makeReq('POST'), { params })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE campaigns'), expect.any(Array))
  })
})
