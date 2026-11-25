import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/documents/order-documents', () => {
  class NothingToDownload extends Error {}
  return {
    MAX_DOCUMENT_ORDERS: 3,
    NothingToDownload,
    buildOrderDocuments: vi.fn(),
    documentsFilename: vi.fn(() => 'docs.pdf'),
    documentsResponse: vi.fn(() => new NextResponse('pdf', { status: 200 })),
    missingDocScope: vi.fn(),
    parseDocs: vi.fn(),
    parseLabelSize: vi.fn(() => 'a4'),
  }
})

import { POST } from '@admin/app/api/(admin)/admin/packing-slips/documents/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import * as od from '@/lib/documents/order-documents'

const admin = { adminId: 'a1', username: 'admin', role: 'admin', scopes: [] }
const call = (body: unknown) =>
  POST(new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }))

describe('POST /api/admin/packing-slips/documents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(od.parseDocs).mockReturnValue(['packing_slip'] as never)
    vi.mocked(od.missingDocScope).mockReturnValue(false as never)
  })

  it('returns 401 and 403 (needs packing_slips:write)', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await call({ order_ids: ['a'] })).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await call({ order_ids: ['a'] })).status).toBe(403)
    expect(hasScope).toHaveBeenLastCalledWith('admin', [], 'packing_slips:write')
  })

  it('returns 400 for missing, oversized or doc-less requests', async () => {
    expect((await call({})).status).toBe(400)
    expect((await call({ order_ids: ['a', 'b', 'c', 'd'] })).status).toBe(400)
    vi.mocked(od.parseDocs).mockReturnValue([] as never)
    expect((await call({ order_ids: ['a'], docs: [] })).status).toBe(400)
    expect(od.buildOrderDocuments).not.toHaveBeenCalled()
  })

  it('returns 403 when a document scope is missing', async () => {
    vi.mocked(od.missingDocScope).mockReturnValue(true as never)
    expect((await call({ order_ids: ['a'] })).status).toBe(403)
  })

  it('returns 404 when no orders are found', async () => {
    vi.mocked(od.buildOrderDocuments).mockResolvedValue(null as never)
    expect((await call({ order_ids: ['a'] })).status).toBe(404)
  })

  it('de-duplicates ids and builds the combined PDF', async () => {
    const result = { orderNumbers: ['1', '2'] }
    vi.mocked(od.buildOrderDocuments).mockResolvedValue(result as never)
    const res = await call({ order_ids: ['a', 'b', 'a'], docs: ['packing_slip'], label_size: 'a4' })
    expect(res.status).toBe(200)
    expect(od.buildOrderDocuments).toHaveBeenCalledWith({ orderIds: ['a', 'b'], docs: ['packing_slip'], labelSize: 'a4', admin })
    expect(od.documentsResponse).toHaveBeenCalledWith(result, 'docs.pdf')
  })

  it('defaults to the packing slip document', async () => {
    vi.mocked(od.buildOrderDocuments).mockResolvedValue({ orderNumbers: [] } as never)
    await call({ order_ids: ['a'] })
    expect(od.parseDocs).toHaveBeenCalledWith(['packing_slip'])
  })

  it('returns 422 for nothing to download and 500 otherwise', async () => {
    vi.mocked(od.buildOrderDocuments).mockRejectedValueOnce(new od.NothingToDownload('none'))
    expect((await call({ order_ids: ['a'] })).status).toBe(422)
    vi.mocked(od.buildOrderDocuments).mockRejectedValueOnce(new Error('x'))
    expect((await call({ order_ids: ['a'] })).status).toBe(500)
  })
})
