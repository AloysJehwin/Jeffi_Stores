import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

import { GET } from '@/app/api/public/purchaseorder/[token]/route'
import { queryOne, queryMany } from '@/lib/db'

const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)

const params = { params: { token: 'po-tok' } }

function makeRequest() {
  return new Request('http://localhost/api/public/purchaseorder/po-tok')
}

const mockPO = {
  id: 'po1',
  po_number: 'PO/2024/001',
  supplier_name: 'Supplier Co',
  view_token: 'po-tok',
}

describe('GET /api/public/purchaseorder/[token]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 404 when PO not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('Not found')
  })

  it('returns po, items, and settings on success', async () => {
    mockQueryOne.mockResolvedValueOnce(mockPO)
    mockQueryMany
      .mockResolvedValueOnce([{ product_name: 'Bolt', quantity: 100, unit_cost: '5' }])
      .mockResolvedValueOnce([{ key: 'business_legal_name', value: 'Jeffi Stores' }])

    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.po.po_number).toBe('PO/2024/001')
    expect(json.items).toHaveLength(1)
    expect(json.settings.business_legal_name).toBe('Jeffi Stores')
  })

  it('returns empty items array when no items found', async () => {
    mockQueryOne.mockResolvedValueOnce(mockPO)
    mockQueryMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    const res = await GET(makeRequest() as any, params as any)
    const json = await res.json()
    expect(json.items).toEqual([])
  })

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection lost'))
    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('connection lost')
  })
})
