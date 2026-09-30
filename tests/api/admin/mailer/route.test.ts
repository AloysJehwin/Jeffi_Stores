import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
  queryCount: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET, POST } from '@/app/api/admin/mailer/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryMany, queryCount } from '@/lib/shared/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryMany = vi.mocked(queryMany)
const mockQueryCount = vi.mocked(queryCount)

// ── Helpers ───────────────────────────────────────────────────────────────────

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'admin',
  scopes: ['mailer'],
}

function makeGetRequest(searchParams: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/mailer')
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
  return new NextRequest(url.toString(), {
    method: 'GET',
    headers: { cookie: 'admin_sid=valid-token' },
  })
}

function makePostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/mailer', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'admin_sid=valid-token' },
    body: JSON.stringify(body),
  })
}

const sampleCampaigns = [
  {
    id: 'campaign-1',
    title: 'Summer Sale',
    template_key: 'summer_sale',
    subject: 'Big discounts!',
    audience_type: 'all',
    status: 'draft',
  },
]

const validPostBody = {
  title: 'New Campaign',
  template_key: 'promo',
  subject: 'Special Offer',
  audience_type: 'all',
  template_data: { discount: 20 },
  audience_filter: { city: 'Bangalore' },
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/mailer', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 403 when mailer scope is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/insufficient/i)
  })

  it('returns paginated campaigns list', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(sampleCampaigns as any)
    mockQueryCount.mockResolvedValue(1)
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.campaigns).toEqual(sampleCampaigns)
    expect(body.total).toBe(1)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(20)
  })

  it('handles pagination parameters', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    const res = await GET(makeGetRequest({ page: '2' }))
    const body = await res.json()
    expect(body.page).toBe(2)
  })

  it('defaults to page 1 when page is 0 or negative', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    const res = await GET(makeGetRequest({ page: '0' }))
    const body = await res.json()
    expect(body.page).toBe(1)
  })

  it('returns empty list when no campaigns', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.campaigns).toEqual([])
    expect(body.total).toBe(0)
  })
})

describe('POST /api/admin/mailer', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makePostRequest(validPostBody))
    expect(res.status).toBe(401)
  })

  it('returns 403 when mailer scope is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makePostRequest(validPostBody))
    expect(res.status).toBe(403)
  })

  it('returns 400 when title is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const { title, ...body } = validPostBody
    const res = await POST(makePostRequest(body))
    expect(res.status).toBe(400)
    const resBody = await res.json()
    expect(resBody.error).toMatch(/missing required fields/i)
  })

  it('returns 400 when template_key is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const { template_key, ...body } = validPostBody
    const res = await POST(makePostRequest(body))
    expect(res.status).toBe(400)
  })

  it('returns 400 when subject is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const { subject, ...body } = validPostBody
    const res = await POST(makePostRequest(body))
    expect(res.status).toBe(400)
  })

  it('returns 400 when audience_type is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const { audience_type, ...body } = validPostBody
    const res = await POST(makePostRequest(body))
    expect(res.status).toBe(400)
  })

  it('creates campaign and returns 201 with id', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [{ id: 'campaign-new-1' }], rowCount: 1 } as any)
    const res = await POST(makePostRequest(validPostBody))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe('campaign-new-1')
  })

  it('passes all fields including adminId to DB insert', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [{ id: 'campaign-2' }], rowCount: 1 } as any)
    await POST(makePostRequest(validPostBody))
    const callArgs = mockQuery.mock.calls[0]
    expect(callArgs[1]).toContain('New Campaign')
    expect(callArgs[1]).toContain('promo')
    expect(callArgs[1]).toContain('admin-1') // adminId
  })

  it('uses empty objects for missing template_data and audience_filter', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [{ id: 'campaign-3' }], rowCount: 1 } as any)
    const { template_data, audience_filter, ...minimalBody } = validPostBody
    await POST(makePostRequest(minimalBody))
    const callArgs = mockQuery.mock.calls[0]
    expect(callArgs[1]).toContain('{}') // JSON.stringify({})
  })
})
