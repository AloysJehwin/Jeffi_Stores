import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

const { mockRequireAdminScope } = vi.hoisted(() => ({ mockRequireAdminScope: vi.fn() }))
vi.mock('@/lib/jwt', () => ({ requireAdminScope: mockRequireAdminScope }))

import { NextResponse } from 'next/server'
import { GET } from '@/app/api/admin/audit/mail-log/[id]/route'
import { queryOne } from '@/lib/db'

const mockQueryOne = vi.mocked(queryOne)

function makeReq(id: string) {
  return new NextRequest(`http://localhost/api/admin/audit/mail-log/${id}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireAdminScope.mockResolvedValue({ adminId: 'admin-1', role: 'super_admin', scopes: [] })
})

describe('GET /api/admin/audit/mail-log/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    mockRequireAdminScope.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const res = await GET(makeReq('log-1'), { params: Promise.resolve({ id: 'log-1' }) })
    expect(res.status).toBe(401)
    expect(mockQueryOne).not.toHaveBeenCalled()
  })

  it('returns 404 when row not found', async () => {
    mockQueryOne.mockResolvedValue(null)
    const res = await GET(makeReq('log-1'), { params: Promise.resolve({ id: 'log-1' }) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Not found')
  })

  it('returns log row on happy path', async () => {
    const row = {
      id: 'log-1',
      email: 'a@b.com',
      subject: 'Test',
      status: 'sent',
      template_name: 'invoice',
      kind: 'transactional',
    }
    mockQueryOne.mockResolvedValue(row)
    const res = await GET(makeReq('log-1'), { params: Promise.resolve({ id: 'log-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.row).toEqual(row)
  })

  it('queries with correct id param', async () => {
    mockQueryOne.mockResolvedValue({ id: 'log-99' })
    await GET(makeReq('log-99'), { params: Promise.resolve({ id: 'log-99' }) })
    expect(mockQueryOne).toHaveBeenCalledWith(expect.any(String), ['log-99'])
  })
})
