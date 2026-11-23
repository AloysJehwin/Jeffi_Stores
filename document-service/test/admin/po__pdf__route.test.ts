import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@jeffi/tenancy', () => ({ queryOne: vi.fn() }))
vi.mock('../../src/tenant/loaders', () => ({
  loadPurchaseOrder: vi.fn(),
  purchaseOrderPdf: vi.fn(),
}))

import { GET } from '../../src/admin/po/pdf.js'
import { NextRequest } from '../../src/next.js'
import { queryOne } from '@jeffi/tenancy'
import { loadPurchaseOrder, purchaseOrderPdf } from '../../src/tenant/loaders'

function req(claims?: object) {
  const r = new NextRequest('http://documents/admin/inventory/po/po-1/pdf')
  if (claims) (r as any).claims = claims
  return r
}
const ADMIN = { internal: true, adminId: 'a1', tenantId: 't1', role: 'administrator', scopes: [] }
const params = { params: Promise.resolve({ id: 'po-1' }) }

beforeEach(() => vi.clearAllMocks())

describe('GET /admin/inventory/po/:id/pdf', () => {
  it('401 without admin claims', async () => {
    const res = await GET(req(), params)
    expect(res.status).toBe(401)
  })

  it('403 without inventory:read scope', async () => {
    const res = await GET(req({ internal: true, adminId: 'a1', tenantId: 't1', role: 'staff', scopes: [] }), params)
    expect(res.status).toBe(403)
  })

  it('404 when the PO has no view_token', async () => {
    vi.mocked(queryOne).mockResolvedValue({ view_token: null } as any)
    const res = await GET(req(ADMIN), params)
    expect(res.status).toBe(404)
    expect(loadPurchaseOrder).not.toHaveBeenCalled()
  })

  it('404 when the loader returns nothing', async () => {
    vi.mocked(queryOne).mockResolvedValue({ view_token: 'tok' } as any)
    vi.mocked(loadPurchaseOrder).mockResolvedValue(null as any)
    const res = await GET(req(ADMIN), params)
    expect(res.status).toBe(404)
  })

  it('200 returns the PDF with inline filename disposition', async () => {
    vi.mocked(queryOne).mockResolvedValue({ view_token: 'tok' } as any)
    vi.mocked(loadPurchaseOrder).mockResolvedValue({ po: 1 } as any)
    const buffer = Buffer.from('%PDF-po')
    vi.mocked(purchaseOrderPdf).mockResolvedValue({ buffer, filename: 'PO-1.pdf' } as any)
    const res = await GET(req(ADMIN), params)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="PO-1.pdf"')
    expect(res.headers.get('Content-Length')).toBe(String(buffer.length))
    expect(Buffer.from(await res.arrayBuffer())).toEqual(buffer)
  })

  it('500 when generation throws', async () => {
    vi.mocked(queryOne).mockResolvedValue({ view_token: 'tok' } as any)
    vi.mocked(loadPurchaseOrder).mockResolvedValue({ po: 1 } as any)
    vi.mocked(purchaseOrderPdf).mockRejectedValue(new Error('render boom'))
    const res = await GET(req(ADMIN), params)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'render boom' })
  })
})
