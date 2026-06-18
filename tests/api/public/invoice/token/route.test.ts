import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

import { GET } from '@/app/api/public/invoice/[token]/route'
import { queryOne, queryMany } from '@/lib/db'

const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)

const params = { params: { token: 'tok-abc' } }

function makeRequest() {
  return new Request('http://localhost/api/public/invoice/tok-abc')
}

const mockOrder = {
  id: 'order1',
  invoice_number: 'INV/2024/001',
  customer_name: 'Test Customer',
  total_amount: '1000',
  view_token: 'tok-abc',
}

describe('GET /api/public/invoice/[token]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 404 when order not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('Not found')
  })

  it('returns order, items, and settings on success', async () => {
    mockQueryOne.mockResolvedValueOnce(mockOrder)
    mockQueryMany
      .mockResolvedValueOnce([{ id: 'item1', product_name: 'Bolt' }])
      .mockResolvedValueOnce([
        { key: 'business_gstin', value: '29ABCDE1234F1Z5' },
        { key: 'business_legal_name', value: 'Jeffi Stores' },
      ])

    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.order.invoice_number).toBe('INV/2024/001')
    expect(json.items).toHaveLength(1)
    expect(json.settings.business_gstin).toBe('29ABCDE1234F1Z5')
    expect(json.settings.business_legal_name).toBe('Jeffi Stores')
  })

  it('returns empty items array when no items', async () => {
    mockQueryOne.mockResolvedValueOnce(mockOrder)
    mockQueryMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const res = await GET(makeRequest() as any, params as any)
    const json = await res.json()
    expect(json.items).toEqual([])
  })

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('db error'))
    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('db error')
  })
})
