import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/email', () => ({
  sendPurchaseOrderEmail: vi.fn(),
}))

vi.mock('@/lib/validate', () => ({
  parseBody: vi.fn(),
}))

import { GET, PATCH } from '@/app/api/admin/inventory/po/[id]/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany, query } from '@/lib/db'
import { parseBody } from '@/lib/validate'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockQuery = vi.mocked(query)
const mockParseBody = vi.mocked(parseBody)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['inventory'] }

function makeGetReq(id: string) {
  return new NextRequest(`http://localhost/api/admin/inventory/po/${id}`)
}
function makePatchReq(id: string, body: any) {
  return new NextRequest(`http://localhost/api/admin/inventory/po/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => { vi.clearAllMocks() })

describe('GET /api/admin/inventory/po/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGetReq('po-1'), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGetReq('po-1'), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 404 when PO not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await GET(makeGetReq('po-1'), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(404)
  })

  it('returns PO with items on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const po = { id: 'po-1', po_number: 'PO-001', supplier_name: 'ACME' }
    const items = [{ id: 'i1', product_name_current: 'Bolt', quantity: 10 }]
    mockQueryOne.mockResolvedValue(po)
    mockQueryMany.mockResolvedValue(items)
    const res = await GET(makeGetReq('po-1'), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.purchase_order).toEqual(po)
    expect(body.items).toEqual(items)
  })
})

describe('PATCH /api/admin/inventory/po/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(makePatchReq('po-1', { status: 'received' }), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(makePatchReq('po-1', { status: 'received' }), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 400 on invalid JSON', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const req = new NextRequest('http://localhost/api/admin/inventory/po/po-1', {
      method: 'PATCH',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(400)
  })

  it('returns validation error when parseBody fails', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const { NextResponse } = await import('next/server')
    mockParseBody.mockReturnValue({
      ok: false,
      response: NextResponse.json({ error: 'Validation failed' }, { status: 400 }),
    })
    const res = await PATCH(makePatchReq('po-1', { status: 'received' }), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(400)
  })

  it('updates PO on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { status: 'received', expected_date: null, notes: null } })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    const res = await PATCH(makePatchReq('po-1', { status: 'received' }), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })
})
