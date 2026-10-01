import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/customer-conversations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/shared/customer-conversations')>('@/lib/shared/customer-conversations')
  return { ...actual, listConversations: vi.fn() }
})

import { GET } from '@/app/api/(admin)/admin/customers/[id]/conversations/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { listConversations } from '@/lib/shared/customer-conversations'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockList = vi.mocked(listConversations)

const adminPayload = { adminId: 'admin-1', username: 'a', role: 'super_admin', scopes: ['customers'] }

function makeRequest(id = 'user-1', searchParams: Record<string, string> = {}) {
  const url = new URL(`http://localhost/api/admin/customers/${id}/conversations`)
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
  return new NextRequest(url.toString(), { method: 'GET', headers: { cookie: 'admin_sid=valid' } })
}

const ctx = (id = 'user-1') => ({ params: Promise.resolve({ id }) })

describe('GET /api/admin/customers/[id]/conversations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest(), ctx())
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope is insufficient', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeRequest(), ctx())
    expect(res.status).toBe(403)
  })

  it('returns 400 on an unknown channel token', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const res = await GET(makeRequest('user-1', { channels: 'email,telepathy' }), ctx())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('telepathy')
    expect(mockList).not.toHaveBeenCalled()
  })

  it('passes parsed params through to listConversations', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockList.mockResolvedValue({ items: [], nextBefore: null })

    const res = await GET(
      makeRequest('user-42', {
        channels: 'email,chat',
        limit: '10',
        before: '2024-01-01T00:00:00Z',
        q: 'invoice',
      }),
      ctx('user-42')
    )

    expect(res.status).toBe(200)
    const [userId, opts] = mockList.mock.calls[0]
    expect(userId).toBe('user-42')
    expect(opts).toEqual({ channels: ['email', 'chat'], limit: 10, before: '2024-01-01T00:00:00Z', q: 'invoice' })
    const body = await res.json()
    expect(body).toEqual({ items: [], nextBefore: null })
  })
})
