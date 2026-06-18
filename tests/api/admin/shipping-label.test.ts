import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryOne: vi.fn() }))

// pdfkit and bwip-js are eval-required inside the route — stub at module level
// so the route's eval('require') calls resolve to our mocks
vi.mock('pdfkit', () => {
  const { EventEmitter } = require('events')
  const MockPDFDocument = vi.fn().mockImplementation(() => {
    const ee = new EventEmitter()
    const doc: any = ee
    doc.rect = () => doc
    doc.lineWidth = () => doc
    doc.strokeColor = () => doc
    doc.stroke = () => doc
    doc.moveTo = () => doc
    doc.lineTo = () => doc
    doc.fontSize = () => doc
    doc.font = () => doc
    doc.fillColor = () => doc
    doc.text = () => doc
    doc.image = () => doc
    doc.end = () => {
      ee.emit('data', Buffer.from('pdf-chunk'))
      ee.emit('end')
    }
    return doc
  })
  return { default: MockPDFDocument }
})

vi.mock('bwip-js', () => ({
  default: { toBuffer: vi.fn().mockResolvedValue(Buffer.from('barcode')) },
  toBuffer: vi.fn().mockResolvedValue(Buffer.from('barcode')),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET } from '@/app/api/admin/orders/[id]/shipping-label/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'

// ── Helpers ────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['orders'] }
const ORDER_ID = 'order-uuid-1'

function makeReq(params: Record<string, string> = {}) {
  const url = new URL(`http://localhost/api/admin/orders/${ORDER_ID}/shipping-label`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString(), { headers: { cookie: 'admin_token=valid' } })
}

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)

const sampleOrder = {
  order_number: 'ORD-001',
  awb_number: 'AWB123456',
  total_amount: '1500',
  full_name: 'Alice Smith',
  address_line1: '123 Main St',
  address_line2: null,
  landmark: null,
  city: 'Raipur',
  state: 'Chhattisgarh',
  postal_code: '492001',
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/admin/orders/[id]/shipping-label', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
  })

  // ── Auth / authz ────────────────────────────────────────────────────────

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeReq(), { params: { id: ORDER_ID } })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when orders scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeReq(), { params: { id: ORDER_ID } })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  // NOTE: The 503 "key not configured" branch cannot be tested here because
  // `const TOKEN = process.env.DELHIVERY_API_KEY` is captured at module-load
  // time. Deleting the env var after import has no effect on the frozen const.
  // Coverage of that branch requires a separate test file that loads the route
  // module WITHOUT the env var in the vitest config env.

  it('returns 404 when order not found', async () => {
    mockQueryOne.mockResolvedValue(null)
    const res = await GET(makeReq(), { params: { id: ORDER_ID } })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Order not found')
  })

  it('returns 404 when order has no AWB number', async () => {
    mockQueryOne.mockResolvedValue({ ...sampleOrder, awb_number: null } as any)
    const res = await GET(makeReq(), { params: { id: ORDER_ID } })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('No AWB number for this order')
  })

  // ── A4 label (default) ──────────────────────────────────────────────────

  it('fetches A4 PDF when Delhivery returns PDF content-type', async () => {
    mockQueryOne.mockResolvedValue(sampleOrder as any)
    const pdfBuffer = Buffer.from('%PDF-1.4 fake pdf data')
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/pdf' },
      arrayBuffer: async () => pdfBuffer.buffer,
    } as any)

    const res = await GET(makeReq(), { params: { id: ORDER_ID } })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment.*shipping-label/)
  })

  it('serves A4 PDF inline when inline=1 param is set', async () => {
    mockQueryOne.mockResolvedValue(sampleOrder as any)
    const pdfBuffer = Buffer.from('%PDF-1.4 fake pdf')
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/pdf' },
      arrayBuffer: async () => pdfBuffer.buffer,
    } as any)

    const res = await GET(makeReq({ inline: '1' }), { params: { id: ORDER_ID } })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toMatch(/^inline/)
  })

  it('returns HTML print page when print=1 param is set (A4)', async () => {
    mockQueryOne.mockResolvedValue(sampleOrder as any)
    const pdfBuffer = Buffer.from('%PDF-1.4 fake')
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/pdf' },
      arrayBuffer: async () => pdfBuffer.buffer,
    } as any)

    const res = await GET(makeReq({ print: '1' }), { params: { id: ORDER_ID } })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toMatch(/text\/html/)
    const html = await res.text()
    expect(html).toContain('<iframe')
  })

  it('follows PDF URL redirect when Delhivery returns JSON with pdf_download_link', async () => {
    mockQueryOne.mockResolvedValue(sampleOrder as any)
    const fakePdf = Buffer.from('%PDF-1.4 from s3')
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ packages: [{ pdf_download_link: 'https://s3.example.com/label.pdf' }] }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => fakePdf.buffer,
      } as any)

    const res = await GET(makeReq(), { params: { id: ORDER_ID } })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
  })

  it('returns 502 when JSON has no pdf_download_link', async () => {
    mockQueryOne.mockResolvedValue(sampleOrder as any)
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ packages: [{}] }),
    } as any)

    const res = await GET(makeReq(), { params: { id: ORDER_ID } })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/No PDF link/)
  })

  it('returns 502 when Delhivery API returns non-ok for A4', async () => {
    mockQueryOne.mockResolvedValue(sampleOrder as any)
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    } as any)

    const res = await GET(makeReq(), { params: { id: ORDER_ID } })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/503/)
  })

  // ── 4R label ───────────────────────────────────────────────────────────

  it('returns 4R PDF generated from pdfkit', async () => {
    mockQueryOne.mockResolvedValue(sampleOrder as any)
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ packages: [{ sort_code: 'RIP', pin: '492001', name: 'Alice', add: '123 Main', oid: 'ORD-001', prd: 'Hardware', cod: '0', total_amount: '1500.00' }] }),
    } as any)

    const res = await GET(makeReq({ size: '4R' }), { params: { id: ORDER_ID } })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
  })

  it('returns 502 when 4R Delhivery API call fails', async () => {
    mockQueryOne.mockResolvedValue(sampleOrder as any)
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    } as any)

    const res = await GET(makeReq({ size: '4R' }), { params: { id: ORDER_ID } })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/404/)
  })

  it('returns HTML print page for 4R when print=1', async () => {
    mockQueryOne.mockResolvedValue(sampleOrder as any)
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ packages: [{}] }),
    } as any)

    const res = await GET(makeReq({ size: '4R', print: '1' }), { params: { id: ORDER_ID } })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toMatch(/text\/html/)
  })
})
