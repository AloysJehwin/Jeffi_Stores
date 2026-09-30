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

import { GET } from '@/app/api/admin/gst/gstr3b/route'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne, queryMany } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)

const superAdmin = {
  adminId: 'a1',
  username: 'admin',
  role: 'administrator',
  scopes: [],
}
const regularAdmin = {
  adminId: 'a2',
  username: 'staff',
  role: 'admin',
  scopes: ['gst'],
}

function makeReq(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/gst/gstr3b')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
}

const outwardRow = {
  total_taxable: '10000',
  total_cgst: '900',
  total_sgst: '900',
  total_igst: '0',
  invoice_count: 5,
}

const byRateRows = [
  { gst_rate: '18', is_igst: false, buyer_gstin: null, taxable: '10000', cgst: '900', sgst: '900', igst: '0' },
]

const settingsRows = [
  { key: 'business_gstin', value: '22AAAAA0000A1Z5' },
  { key: 'business_legal_name', value: 'Test Corp' },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/gst/gstr3b', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeReq({ from: '2024-01-01', to: '2024-01-31' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when admin lacks gst:read scope', async () => {
    mockAuth.mockResolvedValue(regularAdmin)
    const res = await GET(makeReq({ from: '2024-01-01', to: '2024-01-31' }))
    expect(res.status).toBe(403)
  })

  it('returns 400 when from param missing', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    const res = await GET(makeReq({ to: '2024-01-31' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/from/)
  })

  it('returns 400 when to param missing', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    const res = await GET(makeReq({ from: '2024-01-01' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/to/)
  })

  it('returns 400 when both params missing', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    const res = await GET(makeReq())
    expect(res.status).toBe(400)
  })

  it('returns JSON GSTR-3B on happy path', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockQueryOne.mockResolvedValue(outwardRow)
    mockQueryMany
      .mockResolvedValueOnce(byRateRows) // byRate
      .mockResolvedValueOnce(settingsRows) // settings
    const res = await GET(makeReq({ from: '2024-01-01', to: '2024-01-31' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.gstin).toBe('22AAAAA0000A1Z5')
    expect(body.legalName).toBe('Test Corp')
    expect(body.summary.totalInvoices).toBe(5)
    expect(body.table31).toBeDefined()
  })

  it('returns CSV when format=csv', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockQueryOne.mockResolvedValue(outwardRow)
    mockQueryMany.mockResolvedValueOnce(byRateRows).mockResolvedValueOnce(settingsRows)
    const res = await GET(makeReq({ from: '2024-01-01', to: '2024-01-31', format: 'csv' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/csv')
    expect(res.headers.get('Content-Disposition')).toMatch(/GSTR3B/)
  })

  it('handles null outward row gracefully', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockQueryOne.mockResolvedValue(null)
    mockQueryMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const res = await GET(makeReq({ from: '2024-02-01', to: '2024-02-28' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.summary.totalInvoices).toBe(0)
    expect(body.summary.totalTax).toBe(0)
  })

  it('returns 500 on db error', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockQueryOne.mockRejectedValue(new Error('db connection failed'))
    const res = await GET(makeReq({ from: '2024-01-01', to: '2024-01-31' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/db connection failed/)
  })
})
