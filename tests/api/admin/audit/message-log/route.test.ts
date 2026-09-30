import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  queryMany: vi.fn().mockResolvedValue([]),
  queryCount: vi.fn().mockResolvedValue(0),
}))

const { mockRequireAdminScope } = vi.hoisted(() => ({ mockRequireAdminScope: vi.fn() }))
vi.mock('@/lib/jwt', () => ({ requireAdminScope: mockRequireAdminScope }))

import { NextResponse } from 'next/server'
import { GET } from '@/app/api/admin/audit/message-log/route'
import { queryMany, queryCount } from '@/lib/db'

const mockQueryMany = vi.mocked(queryMany)
const mockQueryCount = vi.mocked(queryCount)

function req(qs = '') {
  return { url: `http://localhost/api/admin/audit/message-log${qs}` } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  mockQueryMany.mockResolvedValue([] as any)
  mockQueryCount.mockResolvedValue(0)
  mockRequireAdminScope.mockResolvedValue({ adminId: 'admin-1', role: 'super_admin', scopes: [] })
})

describe('GET /api/admin/audit/message-log', () => {
  it('returns 401 when not authenticated', async () => {
    mockRequireAdminScope.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(mockQueryMany).not.toHaveBeenCalled()
  })

  it('returns rows, total, page, pageSize with defaults', async () => {
    mockQueryMany.mockResolvedValue([{ id: 'm1' }] as any)
    mockQueryCount.mockResolvedValue(1)
    const res = await GET(req())
    const body = await res.json()
    expect(body).toEqual({ rows: [{ id: 'm1' }], total: 1, page: 1, pageSize: 25 })
  })

  it('applies channel filter (sms)', async () => {
    await GET(req('?channel=sms'))
    const [sql, params] = mockQueryMany.mock.calls[0]!
    expect(sql).toContain('WHERE channel = $1')
    expect(params![0]).toBe('sms')
  })

  it('applies channel filter (whatsapp)', async () => {
    await GET(req('?channel=whatsapp'))
    expect((mockQueryMany.mock.calls[0]![1] as unknown[])[0]).toBe('whatsapp')
  })

  it('ignores an invalid channel value', async () => {
    await GET(req('?channel=telegram'))
    const [sql] = mockQueryMany.mock.calls[0]!
    expect(sql).not.toContain('channel =')
  })

  it('applies kind and status filters', async () => {
    await GET(req('?kind=order_shipped&status=sent'))
    const [sql, params] = mockQueryMany.mock.calls[0]!
    expect(sql).toContain('kind = $1')
    expect(sql).toContain('status = $2')
    expect(params!.slice(0, 2)).toEqual(['order_shipped', 'sent'])
  })

  it('ignores "all" sentinel for kind/status', async () => {
    await GET(req('?kind=all&status=all'))
    const [sql] = mockQueryMany.mock.calls[0]!
    expect(sql).not.toContain('kind =')
    expect(sql).not.toContain('status =')
  })

  it('applies search filter across to_number and body', async () => {
    await GET(req('?q=98765'))
    const [sql, params] = mockQueryMany.mock.calls[0]!
    expect(sql).toContain('to_number ILIKE $1')
    expect(sql).toContain('body ILIKE $1')
    expect(params![0]).toBe('%98765%')
  })

  it('honors pagination and clamps pageSize to 100', async () => {
    await GET(req('?page=3&pageSize=500'))
    const body = await (await GET(req('?page=3&pageSize=500'))).json()
    expect(body.page).toBe(3)
    expect(body.pageSize).toBe(100)
    // LIMIT/OFFSET are the last two params
    const params = mockQueryMany.mock.calls[0]![1] as unknown[]
    expect(params[params.length - 2]).toBe(100) // limit
    expect(params[params.length - 1]).toBe(200) // offset = (3-1)*100
  })

  it('count query receives params without limit/offset', async () => {
    await GET(req('?channel=sms'))
    const countParams = mockQueryCount.mock.calls[0]![1]
    expect(countParams).toEqual(['sms'])
  })
})
