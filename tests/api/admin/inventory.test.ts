import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports of the modules under test
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/tenancy/tenant-context', () => ({
  resolveTenant: vi.fn(async () => null),
}))

vi.mock('@/lib/shared/db', () => ({
  queryMany: vi.fn(),
  queryOne: vi.fn(),
  query: vi.fn(),
  getClient: vi.fn(),
  withTransaction: vi.fn().mockImplementation(async (fn: (client: any) => any) => {
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT COUNT')) return { rows: [{ cnt: '0' }] }
        if (sql.includes('INSERT INTO purchase_orders')) return { rows: [{ id: 'new-po-id' }] }
        if (sql.includes('INSERT INTO purchase_order_items')) return { rows: [{}] }
        return { rows: [] }
      }),
    }
    return fn(mockClient)
  }),
}))

vi.mock('@/lib/orders/inventory', () => ({
  getStockLedger: vi.fn(),
  getStockValuation: vi.fn(),
  logStockMovement: vi.fn(),
  recomputeStockStatusForProduct: vi.fn(),
}))

vi.mock('@/lib/shared/admin-audit', () => ({
  logAdminAudit: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/catalog/search', () => ({
  buildSearchClause: vi.fn(),
}))

vi.mock('@/lib/shared/validate', () => {
  const { z } = require('zod')
  const zUuid = z.string().uuid()
  const zCurrency = z.coerce.number().min(0)
  const zNonEmpty = z.string().min(1)

  return {
    zUuid,
    zCurrency,
    zNonEmpty,
    parseBody: vi.fn((schema: any, data: any) => {
      const result = schema.safeParse(data)
      if (result.success) return { ok: true, data: result.data }
      return {
        ok: false,
        response: Response.json({ error: result.error.issues[0]?.message ?? 'Validation error' }, { status: 400 }),
      }
    }),
  }
})

// ---------------------------------------------------------------------------
// Import handlers AFTER mocks are set up
// ---------------------------------------------------------------------------

import { GET as stockGET, PATCH as stockPATCH } from '@controller/app/api/(admin)/admin/inventory/stock/route'
import { GET as poGET, POST as poPOST } from '@controller/app/api/(admin)/admin/inventory/po/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany, queryOne, getClient, withTransaction } from '@/lib/shared/db'
import { getStockLedger, getStockValuation } from '@/lib/orders/inventory'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['inventory'] }

function makeReq(url: string, opts: RequestInit = {}) {
  return new NextRequest(new Request(url, opts))
}

function jsonReq(url: string, body: unknown) {
  return new NextRequest(
    new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

function patchReq(url: string, body: unknown) {
  return new NextRequest(
    new Request(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

// ---------------------------------------------------------------------------
// inventory/stock — GET
// ---------------------------------------------------------------------------

describe('GET /api/admin/inventory/stock', () => {
  beforeEach(() => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
  })

  it('returns ledger data with defaults', async () => {
    vi.mocked(getStockLedger).mockResolvedValue({ rows: [{ id: '1' }], total: 1 } as any)

    const res = await stockGET(makeReq('http://localhost/api/admin/inventory/stock'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ transactions: [{ id: '1' }], total: 1, page: 1, limit: 50 })
    expect(getStockLedger).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, offset: 0 }))
  })

  it('returns valuation data when view=valuation', async () => {
    vi.mocked(getStockValuation).mockResolvedValue({ rows: [], total: 0 } as any)

    const res = await stockGET(makeReq('http://localhost/api/admin/inventory/stock?view=valuation'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(getStockValuation).toHaveBeenCalled()
    expect(json).toHaveProperty('page', 1)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)

    const res = await stockGET(makeReq('http://localhost/api/admin/inventory/stock'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)

    const res = await stockGET(makeReq('http://localhost/api/admin/inventory/stock'))
    expect(res.status).toBe(403)
  })

  it('passes search and date filters to getStockLedger', async () => {
    vi.mocked(getStockLedger).mockResolvedValue({ rows: [], total: 0 } as any)

    await stockGET(makeReq('http://localhost/api/admin/inventory/stock?search=bolt&from=2024-01-01&to=2024-12-31'))

    expect(getStockLedger).toHaveBeenCalledWith(
      expect.objectContaining({
        search: 'bolt',
        from: '2024-01-01',
        to: '2024-12-31',
      })
    )
  })
})

// Valid RFC-4122 UUIDs (version 1, variant 1)
const PRODUCT_ID = '123e4567-e89b-12d3-a456-426614174000'

// ---------------------------------------------------------------------------
// inventory/stock — PATCH (stock adjustment)
// ---------------------------------------------------------------------------

describe('PATCH /api/admin/inventory/stock', () => {
  const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
  }

  beforeEach(() => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(getClient).mockResolvedValue(mockClient as any)
    vi.mocked(queryOne).mockResolvedValue({ name: 'Test Product' } as any)
  })

  it('adjusts product stock by new_quantity and returns success', async () => {
    mockClient.query
      .mockReset()
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ inventory_quantity: 10 }] }) // SELECT inventory_quantity FROM products
      .mockResolvedValueOnce(undefined) // UPDATE products
      .mockResolvedValueOnce(undefined) // COMMIT

    vi.mocked(queryOne).mockResolvedValue({ name: 'Test Product' } as any)

    const res = await stockPATCH(
      patchReq('http://localhost/api/admin/inventory/stock', {
        product_id: PRODUCT_ID,
        new_quantity: 50,
      })
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ success: true })
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)

    const res = await stockPATCH(
      patchReq('http://localhost/api/admin/inventory/stock', {
        product_id: PRODUCT_ID,
        new_quantity: 5,
      })
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid JSON body', async () => {
    const req = new NextRequest(
      new Request('http://localhost/api/admin/inventory/stock', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      })
    )
    const res = await stockPATCH(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when neither new_quantity nor unit_id+quantity_in_unit provided', async () => {
    const res = await stockPATCH(
      patchReq('http://localhost/api/admin/inventory/stock', {
        product_id: PRODUCT_ID,
      })
    )
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// inventory/po — forwarded to document-service (handler tests live there)
// ---------------------------------------------------------------------------

describe('/api/admin/inventory/po forwards to document-service', () => {
  const supplierId = '123e4567-e89b-12d3-a456-426614174001'
  const body = { supplier_id: supplierId, items: [{ product_id: '123e4567-e89b-12d3-a456-426614174002', quantity: 10, unit_cost: 25.5 }] }
  let fetchMock: MockInstance<typeof fetch>

  beforeEach(() => {
    process.env.SERVICE_AUTH_SECRET = 'test-secret'
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }))
  })

  it('GET needs inventory:read and forwards the filters', async () => {
    const res = await poGET(makeReq(`http://localhost/api/admin/inventory/po?status=draft&supplier_id=${supplierId}`))
    expect(res.status).toBe(200)
    expect(hasScope).toHaveBeenCalledWith(ADMIN.role, ADMIN.scopes, 'inventory:read')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(new RegExp(`/admin/inventory/po\\?status=draft&supplier_id=${supplierId}$`))
    expect(init?.method).toBe('GET')
  })

  it('POST needs inventory:write and forwards the body', async () => {
    const res = await poPOST(jsonReq('http://localhost/api/admin/inventory/po', body))
    expect(res.status).toBe(200)
    expect(hasScope).toHaveBeenCalledWith(ADMIN.role, ADMIN.scopes, 'inventory:write')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/admin\/inventory\/po$/)
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify(body))
  })

  it('passes document-service status and body through', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"supplier_id required"}', { status: 400, headers: { 'content-type': 'application/json' } }))
    const res = await poPOST(jsonReq('http://localhost/api/admin/inventory/po', { items: [] }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'supplier_id required' })
  })

  it.each([
    ['GET', () => poGET(makeReq('http://localhost/api/admin/inventory/po'))],
    ['POST', () => poPOST(jsonReq('http://localhost/api/admin/inventory/po', body))],
  ])('%s returns 401 when unauthenticated and 403 when scope missing', async (_m, call) => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await call()).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await call()).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
