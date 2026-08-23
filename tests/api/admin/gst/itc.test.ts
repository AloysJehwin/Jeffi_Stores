import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/db', () => ({
  queryMany: vi.fn(),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { GET } from '@/app/api/admin/gst/itc/route'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany } from '@/lib/db'

// ── Helpers ───────────────────────────────────────────────────────────────────

const SUPER_ADMIN = { adminId: 'a1', role: 'super_admin', scopes: [] }
const REGULAR_ADMIN = { adminId: 'a2', role: 'admin', scopes: [] }

function makeGet(qs = '') {
  return new NextRequest(`http://localhost/api/admin/gst/itc${qs}`)
}

const ITC_ROWS = [
  {
    po_id: 'po-1',
    po_number: 'PO-001',
    order_date: '2024-01-15',
    supplier_name: 'Acme Supplies',
    supplier_gstin: '33AABCU9603R1ZX',
    product_name: 'Bolt M8',
    sku: 'BOLT-M8',
    quantity: 100,
    unit_cost: '10.00',
    tax_rate: '18',
    taxable_amount: '1000.00',
    tax_amount: '180.00',
    po_status: 'received',
  },
  {
    po_id: 'po-2',
    po_number: 'PO-002',
    order_date: '2024-01-20',
    supplier_name: 'Acme Supplies',
    supplier_gstin: '33AABCU9603R1ZX',
    product_name: 'Nut M8',
    sku: 'NUT-M8',
    quantity: 200,
    unit_cost: '5.00',
    tax_rate: '18',
    taxable_amount: '1000.00',
    tax_amount: '180.00',
    po_status: 'partial',
  },
]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/gst/itc', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await GET(makeGet('?from=2024-01-01&to=2024-01-31'))
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'Unauthorized' })
  })

  it('returns 403 when authenticated but lacks gst:read scope', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(REGULAR_ADMIN as any)
    const res = await GET(makeGet('?from=2024-01-01&to=2024-01-31'))
    expect(res.status).toBe(403)
  })

  it('returns 400 when from date missing', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(SUPER_ADMIN as any)
    const res = await GET(makeGet('?to=2024-01-31'))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'from and to date params required' })
  })

  it('returns 400 when to date missing', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(SUPER_ADMIN as any)
    const res = await GET(makeGet('?from=2024-01-01'))
    expect(res.status).toBe(400)
  })

  it('returns 400 when both dates missing', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(SUPER_ADMIN as any)
    const res = await GET(makeGet())
    expect(res.status).toBe(400)
  })

  it('returns JSON with rows, summary, and supplierSummary', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(SUPER_ADMIN as any)
    vi.mocked(queryMany).mockResolvedValue(ITC_ROWS as any)
    const res = await GET(makeGet('?from=2024-01-01&to=2024-01-31'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows).toHaveLength(2)
    expect(body.summary.lineCount).toBe(2)
    expect(body.summary.totalTaxable).toBeCloseTo(2000)
    expect(body.summary.totalTax).toBeCloseTo(360)
    expect(body.period).toEqual({ from: '2024-01-01', to: '2024-01-31' })
  })

  it('aggregates supplier summary correctly', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(SUPER_ADMIN as any)
    vi.mocked(queryMany).mockResolvedValue(ITC_ROWS as any)
    const res = await GET(makeGet('?from=2024-01-01&to=2024-01-31'))
    const body = await res.json()
    expect(body.supplierSummary).toHaveLength(1)
    expect(body.supplierSummary[0].supplierName).toBe('Acme Supplies')
    expect(body.supplierSummary[0].poCount).toBe(2)
    expect(body.supplierSummary[0].taxable).toBeCloseTo(2000)
  })

  it('returns CSV when format=csv', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(SUPER_ADMIN as any)
    vi.mocked(queryMany).mockResolvedValue(ITC_ROWS as any)
    const res = await GET(makeGet('?from=2024-01-01&to=2024-01-31&format=csv'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(res.headers.get('content-disposition')).toContain('ITC_2024-01-01_to_2024-01-31.csv')
    const text = await res.text()
    expect(text).toContain('PO Number,Date,Supplier')
    expect(text).toContain('PO-001')
    expect(text).toContain('Acme Supplies')
  })

  it('returns empty rows and zero totals when no data', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(SUPER_ADMIN as any)
    vi.mocked(queryMany).mockResolvedValue([])
    const res = await GET(makeGet('?from=2024-01-01&to=2024-01-31'))
    const body = await res.json()
    expect(body.rows).toHaveLength(0)
    expect(body.summary.totalTaxable).toBe(0)
    expect(body.summary.totalTax).toBe(0)
    expect(body.supplierSummary).toHaveLength(0)
  })

  it('returns 500 on db error', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(SUPER_ADMIN as any)
    vi.mocked(queryMany).mockRejectedValue(new Error('db error'))
    const res = await GET(makeGet('?from=2024-01-01&to=2024-01-31'))
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'db error' })
  })

  it('queries with from and to params', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(SUPER_ADMIN as any)
    vi.mocked(queryMany).mockResolvedValue([])
    await GET(makeGet('?from=2024-03-01&to=2024-03-31'))
    const params = vi.mocked(queryMany).mock.calls[0][1] as any[]
    expect(params).toContain('2024-03-01')
    expect(params).toContain('2024-03-31')
  })
})
