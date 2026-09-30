import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryMany: vi.fn() }))

import { POST } from '@/app/api/admin/mailer/audience-preview/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['mailer'] }

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/admin/mailer/audience-preview', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const sampleRecipients = [
  { email: 'alice@example.com', first_name: 'Alice' },
  { email: 'bob@example.com', first_name: 'Bob' },
]

describe('POST /api/admin/mailer/audience-preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest({ audience_type: 'all' }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest({ audience_type: 'all' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  it('returns all users for audience_type=all', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(sampleRecipients)

    const res = await POST(makeRequest({ audience_type: 'all' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(2)
    expect(body.recipients).toHaveLength(2)
  })

  it('returns order history segment for audience_type=order_history', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([sampleRecipients[0]])

    const res = await POST(
      makeRequest({
        audience_type: 'order_history',
        audience_filter: { daysSinceOrder: 30 },
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(1)
    expect(mockQueryMany).toHaveBeenCalledWith(expect.stringContaining('30 days'))
  })

  it('defaults to 30 days when daysSinceOrder is not provided', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])

    await POST(makeRequest({ audience_type: 'order_history' }))
    expect(mockQueryMany).toHaveBeenCalledWith(expect.stringContaining('30 days'))
  })

  it('uses custom days when daysSinceOrder is provided', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])

    await POST(
      makeRequest({
        audience_type: 'order_history',
        audience_filter: { daysSinceOrder: 60 },
      })
    )
    expect(mockQueryMany).toHaveBeenCalledWith(expect.stringContaining('60 days'))
  })

  it('returns count=0 for empty recipient list', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])

    const res = await POST(makeRequest({ audience_type: 'all' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(0)
    expect(body.recipients).toEqual([])
  })
})
