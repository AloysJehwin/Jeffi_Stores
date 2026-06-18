import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  queryCount: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

import { GET, PATCH, DELETE } from '@/app/api/admin/mailer/[id]/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany, queryCount, query } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockQueryCount = vi.mocked(queryCount)
const mockQuery = vi.mocked(query)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['mailer'] }
const params = { id: 'camp-1' }

function makeGetReq(searchParams: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/mailer/camp-1')
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
}
function makePatchReq(body: any) {
  return new NextRequest('http://localhost/api/admin/mailer/camp-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}
function makeDeleteReq() {
  return new NextRequest('http://localhost/api/admin/mailer/camp-1', { method: 'DELETE' })
}

beforeEach(() => { vi.clearAllMocks() })

describe('GET /api/admin/mailer/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGetReq(), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGetReq(), { params })
    expect(res.status).toBe(403)
  })

  it('returns 404 when campaign not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await GET(makeGetReq(), { params })
    expect(res.status).toBe(404)
  })

  it('returns campaign with logs on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const campaign = { id: 'camp-1', title: 'Newsletter', status: 'draft' }
    mockQueryOne.mockResolvedValue(campaign)
    const logs = [{ email: 'a@a.com', status: 'sent' }]
    mockQueryMany.mockResolvedValue(logs)
    mockQueryCount.mockResolvedValue(1)
    const res = await GET(makeGetReq(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.campaign).toEqual(campaign)
    expect(body.logs).toEqual(logs)
    expect(body.logTotal).toBe(1)
    expect(body.logPage).toBe(1)
    expect(body.logPageSize).toBe(50)
  })

  it('handles logPage query param', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'camp-1', status: 'draft' })
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    const res = await GET(makeGetReq({ logPage: '3' }), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.logPage).toBe(3)
  })
})

describe('PATCH /api/admin/mailer/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(makePatchReq({ title: 'New Title' }), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(makePatchReq({ title: 'New Title' }), { params })
    expect(res.status).toBe(403)
  })

  it('returns 404 when campaign not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await PATCH(makePatchReq({ title: 'New Title' }), { params })
    expect(res.status).toBe(404)
  })

  it('returns 400 when campaign is sent', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ status: 'sent' })
    const res = await PATCH(makePatchReq({ title: 'New Title' }), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/sent/)
  })

  it('returns 400 when campaign is sending', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ status: 'sending' })
    const res = await PATCH(makePatchReq({ title: 'New Title' }), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/sending/)
  })

  it('updates campaign on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ status: 'draft' })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    const res = await PATCH(makePatchReq({
      title: 'Updated',
      subject: 'New Subject',
      template_data: { foo: 'bar' },
      audience_filter: { city: 'Mumbai' },
    }), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(mockQuery).toHaveBeenCalled()
  })
})

describe('DELETE /api/admin/mailer/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await DELETE(makeDeleteReq(), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await DELETE(makeDeleteReq(), { params })
    expect(res.status).toBe(403)
  })

  it('returns 404 when campaign not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await DELETE(makeDeleteReq(), { params })
    expect(res.status).toBe(404)
  })

  it('returns 400 when campaign is sending', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ status: 'sending' })
    const res = await DELETE(makeDeleteReq(), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/sending/)
  })

  it('allows deletion when campaign is sent', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ status: 'sent' })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    const res = await DELETE(makeDeleteReq(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('deletes campaign on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ status: 'draft' })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    const res = await DELETE(makeDeleteReq(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(mockQuery).toHaveBeenCalled()
  })
})
