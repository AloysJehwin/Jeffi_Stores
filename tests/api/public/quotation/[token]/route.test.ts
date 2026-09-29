import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

import { GET } from '@/app/api/public/quotation/[token]/route'
import { queryOne, queryMany } from '@/lib/db'

const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)

const params = { params: Promise.resolve({ token: 'qt-tok' }) }

function makeRequest() {
  return new Request('http://localhost/api/public/quotation/qt-tok')
}

const mockQuotation = {
  id: 'qt1',
  quote_number: 'QT/2024/001',
  customer_name: 'Test Customer',
  view_token: 'qt-tok',
}

describe('GET /api/public/quotation/[token]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 404 when quotation not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('Not found')
  })

  it('returns quotation, items, and settings on success', async () => {
    mockQueryOne.mockResolvedValueOnce(mockQuotation)
    mockQueryMany
      .mockResolvedValueOnce([{ description: 'Hex Bolt M6', quantity: 100, rate: '5' }])
      .mockResolvedValueOnce([{ key: 'business_legal_name', value: 'Jeffi Stores' }])

    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.quotation.quote_number).toBe('QT/2024/001')
    expect(json.items).toHaveLength(1)
    expect(json.settings.business_legal_name).toBe('Jeffi Stores')
  })

  it('returns empty items array when no items', async () => {
    mockQueryOne.mockResolvedValueOnce(mockQuotation)
    mockQueryMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    const res = await GET(makeRequest() as any, params as any)
    const json = await res.json()
    expect(json.items).toEqual([])
  })

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('db failure'))
    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('db failure')
  })
})
