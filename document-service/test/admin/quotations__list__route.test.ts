import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from '../../src/next.js'

vi.mock('@jeffi/tenancy', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
  getClient: vi.fn(),
}))

vi.mock('@jeffi/list-filters', () => ({
  QUOTATIONS_ENTITY: { sorts: {} },
  QUOTE_SUBTOTAL_SQL: '0',
  QUOTE_TOTAL_SQL: '0',
  buildWhere: vi.fn(() => ({ where: '', params: [], nextIdx: 1 })),
  normalizeQuery: vi.fn(() => ({})),
  sortClause: vi.fn(() => 'ORDER BY q.created_at DESC'),
}))

vi.mock('../../src/lib/invoice-line-items.js', () => ({
  draftQuotationLineSchema: (() => {
    const { z } = require('zod')
    return z.record(z.string(), z.unknown())
  })(),
  quotationLineRow: vi.fn((item: any) => ({ amount: 100, gst_rate: 18, ...item })),
  quotationTotals: vi.fn(() => ({ subtotal: 100, cgst_amount: 9, sgst_amount: 9, total_amount: 118 })),
  insertQuotationItem: vi.fn(),
}))

vi.mock('../../src/lib/site-controls.js', () => ({
  getFeatureFlags: vi.fn(async () => ({ gstEnabled: true })),
}))

vi.mock('../../src/lib/brand.js', () => ({
  storeOrigin: vi.fn(async () => ({ city: 'Chennai', state: 'Tamil Nadu' })),
}))

vi.mock('../../src/lib/draft-locks.js', () => ({
  lockBadges: vi.fn(async () => ({})),
  lockNewDraft: vi.fn(),
}))

import { GET, POST } from '../../src/admin/quotations/list.js'
import { queryOne, queryMany, withTransaction } from '@jeffi/tenancy'
import { lockBadges, lockNewDraft } from '../../src/lib/draft-locks.js'
import { insertQuotationItem } from '../../src/lib/invoice-line-items.js'

const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockWithTx = vi.mocked(withTransaction)
const mockLockBadges = vi.mocked(lockBadges)
const mockLockNewDraft = vi.mocked(lockNewDraft)
const mockInsertItem = vi.mocked(insertQuotationItem)

const adminClaims = { internal: true, adminId: 'a1', tenantId: 't1', role: 'administrator', scopes: [] }
const noScopeClaims = { internal: true, adminId: 'a1', tenantId: 't1', role: 'staff', scopes: [] }

function makeReq(method: string, body?: any, qs = '', claims?: any) {
  const req = new NextRequest(`http://localhost/api/admin/quotations${qs}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
  })
  if (claims) req.claims = claims
  return req
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLockBadges.mockResolvedValue({})
})

describe('GET quotations/list', () => {
  it('401 when unauthenticated', async () => {
    expect((await GET(makeReq('GET'))).status).toBe(401)
  })
  it('403 when scope missing', async () => {
    expect((await GET(makeReq('GET', undefined, '', noScopeClaims))).status).toBe(403)
  })
  it('200 returns paginated quotations', async () => {
    mockQueryOne.mockResolvedValue({ total: '2' } as any)
    mockQueryMany.mockResolvedValue([
      { id: 'q1', status: 'draft' },
      { id: 'q2', status: 'sent' },
    ] as any)
    const res = await GET(makeReq('GET', undefined, '?page=1&pageSize=25', adminClaims))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(2)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(25)
    expect(body.quotations).toHaveLength(2)
  })
  it('attaches lock badge to draft rows', async () => {
    mockQueryOne.mockResolvedValue({ total: '1' } as any)
    mockQueryMany.mockResolvedValue([{ id: 'q1', status: 'draft' }] as any)
    mockLockBadges.mockResolvedValue({ q1: { ownerId: 'a2' } } as any)
    const res = await GET(makeReq('GET', undefined, '', adminClaims))
    const body = await res.json()
    expect(body.quotations[0].lock).toEqual({ ownerId: 'a2' })
  })
  it('500 when the count query throws', async () => {
    mockQueryOne.mockRejectedValue(new Error('DB down'))
    const res = await GET(makeReq('GET', undefined, '', adminClaims))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('DB down')
  })
})

describe('POST quotations/list', () => {
  it('401 when unauthenticated', async () => {
    expect((await POST(makeReq('POST', { consignee_name: 'X' }))).status).toBe(401)
  })
  it('403 when scope missing', async () => {
    expect((await POST(makeReq('POST', { consignee_name: 'X' }, '', noScopeClaims))).status).toBe(403)
  })
  it('400 when consignee_name missing', async () => {
    const res = await POST(makeReq('POST', { items: [] }, '', adminClaims))
    expect(res.status).toBe(400)
  })
  it('201 creates a quotation draft', async () => {
    mockQueryOne.mockResolvedValue({ max_seq: '4' } as any)
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 'qt-1', quote_number: 'QT/24-25/APR/5' }] }) // INSERT quotations
        .mockResolvedValueOnce({ rows: [{ id: 'item-1' }] }), // SELECT items
    }
    mockWithTx.mockImplementation(async (fn: any) => fn(client))
    const res = await POST(
      makeReq('POST', { consignee_name: 'Acme', items: [{ product_name: 'Widget' }] }, '', adminClaims)
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.quotation.id).toBe('qt-1')
    expect(mockInsertItem).toHaveBeenCalledTimes(1)
    expect(mockLockNewDraft).toHaveBeenCalledWith(expect.anything(), 'quotation', 'qt-1')
  })
  it('starts seq at 1 when no prior quotations', async () => {
    mockQueryOne.mockResolvedValue({ max_seq: null } as any)
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 'qt-2', quote_number: 'QT/24-25/APR/1' }] })
        .mockResolvedValueOnce({ rows: [] }),
    }
    mockWithTx.mockImplementation(async (fn: any) => fn(client))
    const res = await POST(makeReq('POST', { consignee_name: 'Beta', items: [] }, '', adminClaims))
    expect(res.status).toBe(201)
  })
  it('500 when the transaction fails', async () => {
    mockQueryOne.mockResolvedValue({ max_seq: '0' } as any)
    mockWithTx.mockRejectedValue(new Error('DB write failed'))
    const res = await POST(makeReq('POST', { consignee_name: 'Acme', items: [] }, '', adminClaims))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('DB write failed')
  })
})
