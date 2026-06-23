import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn() }))

import { GET } from '@/app/api/admin/agent/conversations/[id]/messages/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryOne } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)
const mockQueryOne = vi.mocked(queryOne)

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
  beforeEach(() => { vi.clearAllMocks() })

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
    mockQueryOne.mockResolvedValue(null)

    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/not found/i)
  })

  it('returns 403 when conversation belongs to different admin', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ admin_id: 'other-admin' })

    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/not your/i)
  })

  it('returns messages for authorized admin', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ admin_id: 'admin-1' })
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
    mockQueryOne.mockResolvedValue({ admin_id: 'admin-1' })
    mockQueryMany.mockResolvedValue([])

    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.messages).toEqual([])
  })
})
