import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn() }))
vi.mock('@/lib/admin-agent/conversations', () => ({
  conversationAccess: vi.fn(),
  conversationMeta: vi.fn(async () => ({ title: 'Hello', shared: false, owner_name: 'Owner' })),
}))

import { GET } from '@controller/app/api/(admin)/admin/agent/conversations/[id]/messages/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany } from '@/lib/shared/db'
import { conversationAccess } from '@/lib/admin-agent/conversations'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)
const mockAccess = vi.mocked(conversationAccess)

const admin = { adminId: 'admin-1', username: 'admin', role: 'super_admin', scopes: ['agent'] }
const params = Promise.resolve({ id: 'conv-uuid-123' })

function makeRequest() {
  return new NextRequest('http://localhost/api/admin/agent/conversations/conv-uuid-123/messages')
}

const sampleMessages = [
  { id: 'm1', role: 'user', content: 'Hello', tool_calls: null, created_at: '2024-01-01' },
  { id: 'm2', role: 'assistant', content: 'Hi there', tool_calls: [], created_at: '2024-01-01' },
]

describe('GET /api/admin/agent/conversations/[id]/messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  it('returns 404 when conversation not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockAccess.mockResolvedValue('none')

    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/not found/i)
  })

  it('returns 403 when conversation belongs to different admin', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockAccess.mockResolvedValue('denied')

    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/not your/i)
  })

  it('returns messages for authorized admin', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockAccess.mockResolvedValue('owner')
    mockQueryMany.mockResolvedValue(sampleMessages)

    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0].role).toBe('user')
  })

  it('returns empty messages array when none exist', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockAccess.mockResolvedValue('owner')
    mockQueryMany.mockResolvedValue([])

    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.messages).toEqual([])
  })
})
