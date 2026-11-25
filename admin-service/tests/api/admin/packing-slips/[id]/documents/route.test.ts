import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/documents/order-documents', () => {
  class NothingToDownload extends Error {}
  return {
    NothingToDownload,
    buildOrderDocuments: vi.fn(),
    documentsFilename: vi.fn(() => 'docs.pdf'),
    documentsResponse: vi.fn(() => new NextResponse('pdf', { status: 200 })),
    missingDocScope: vi.fn(),
    parseDocs: vi.fn(),
    parseLabelSize: vi.fn(() => '4x6'),
  }
})

import { GET } from '@admin/app/api/(admin)/admin/packing-slips/[id]/documents/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import * as od from '@/lib/documents/order-documents'

const admin = { adminId: 'a1', username: 'admin', role: 'admin', scopes: [] }
const call = (qs = '') =>
  GET(new NextRequest(`http://localhost/x${qs}`), { params: Promise.resolve({ id: 'o1' }) })

describe('GET /api/admin/packing-slips/[id]/documents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(od.parseDocs).mockReturnValue(['packing_slip'] as never)
    vi.mocked(od.missingDocScope).mockReturnValue(false as never)
  })

  it('returns 401 and 403', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await call()).status).toBe(403)
    expect(hasScope).toHaveBeenLastCalledWith('admin', [], 'packing_slips:read')
  })

  it('returns 400 when no document is chosen', async () => {
    vi.mocked(od.parseDocs).mockReturnValue([] as never)
    expect((await call('?docs=zzz')).status).toBe(400)
    expect(od.buildOrderDocuments).not.toHaveBeenCalled()
  })

  it('returns 403 when a requested document needs a missing scope', async () => {
    vi.mocked(od.missingDocScope).mockReturnValue(true as never)
    expect((await call('?docs=invoice')).status).toBe(403)
    expect(od.buildOrderDocuments).not.toHaveBeenCalled()
  })

  it('returns 404 when the order is not found', async () => {
    vi.mocked(od.buildOrderDocuments).mockResolvedValue(null as never)
    expect((await call()).status).toBe(404)
  })

  it('builds the documents for the one order and responds with the PDF', async () => {
    const result = { orderNumbers: ['ORD-1'] }
    vi.mocked(od.buildOrderDocuments).mockResolvedValue(result as never)
    const res = await call('?docs=packing_slip&inline=1')
    expect(res.status).toBe(200)
    expect(od.parseDocs).toHaveBeenCalledWith('packing_slip')
    expect(od.buildOrderDocuments).toHaveBeenCalledWith({ orderIds: ['o1'], docs: ['packing_slip'], labelSize: '4x6', admin })
    expect(od.documentsResponse).toHaveBeenCalledWith(result, 'docs.pdf', true)
  })

  it('returns 422 when there is nothing to download', async () => {
    vi.mocked(od.buildOrderDocuments).mockRejectedValue(new od.NothingToDownload('Nothing shipped'))
    const res = await call()
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('Nothing shipped')
  })

  it('returns 500 on an unexpected failure', async () => {
    vi.mocked(od.buildOrderDocuments).mockRejectedValue(new Error('pdf'))
    expect((await call()).status).toBe(500)
  })
})
