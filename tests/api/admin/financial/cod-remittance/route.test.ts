import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
  requireAdminScope: vi.fn(),
}))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/documents/invoice', () => ({ generateOrderInvoice: vi.fn().mockResolvedValue(null) }))

import { GET, POST } from '@/app/api/(admin)/admin/financial/cod-remittance/route'
import { authenticateAdmin, requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne, query } from '@/lib/shared/db'

const ADMIN = { adminId: 'a1', role: 'administrator', scopes: ['financial:read', 'financial:write'] }

const TOTALS = {
  collected_count: '2',
  collected_amount: '500',
  pending_count: '1',
  pending_amount: '200',
  remitted_count: '1',
  remitted_amount: '300',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(requireAdminScope).mockResolvedValue(ADMIN as any)
  vi.mocked(queryOne).mockResolvedValue(TOTALS as any)
  vi.mocked(queryMany).mockResolvedValue([] as any)
  vi.mocked(query).mockResolvedValue({ rows: [] } as any)
})

function makeGet(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/financial/cod-remittance')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
}

function makePost(body: unknown) {
  return new NextRequest('http://localhost/api/admin/financial/cod-remittance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('GET /api/admin/financial/cod-remittance', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const res = await GET(makeGet())
    expect(res.status).toBe(401)
  })

  it('returns overview envelope with current/previous totals', async () => {
    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.range).toBeDefined()
    expect(body.previous_range).toBeDefined()
    expect(body.current.collected_amount).toBe(500)
    expect(body.current.pending_amount).toBe(200)
    expect(body.current.remitted_amount).toBe(300)
    expect(body.previous).toBeDefined()
    expect(Array.isArray(body.series)).toBe(true)
    expect(Array.isArray(body.by_dim)).toBe(true)
    expect(Array.isArray(body.top)).toBe(true)
  })

  it('400 on malformed from/to', async () => {
    const res = await GET(makeGet({ from: 'nope', to: 'nope' }))
    expect(res.status).toBe(400)
  })

  it('accepts status filter and forwards it to the top query', async () => {
    const res = await GET(makeGet({ status: 'cod_pending' }))
    expect(res.status).toBe(200)
    // top query is the 2nd queryMany call (series is 1st)
    const call = vi.mocked(queryMany).mock.calls[1]
    expect(call?.[1]?.[2]).toBe('cod_pending')
  })

  it('coerces an unknown status to "all"', async () => {
    const res = await GET(makeGet({ status: 'bogus' }))
    expect(res.status).toBe(200)
    const call = vi.mocked(queryMany).mock.calls[1]
    expect(call?.[1]?.[2]).toBe('all')
  })
})

describe('POST /api/admin/financial/cod-remittance', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(makePost({ orderIds: ['o1'] }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when orderIds missing', async () => {
    const res = await POST(makePost({}))
    expect(res.status).toBe(400)
  })

  it('returns 400 when orderIds is empty array', async () => {
    const res = await POST(makePost({ orderIds: [] }))
    expect(res.status).toBe(400)
  })

  it('marks orders as paid and returns success', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: 'o1' }, { id: 'o2' }] } as any)
    const res = await POST(makePost({ orderIds: ['o1', 'o2'] }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.marked).toBe(2)
  })
})
