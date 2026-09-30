import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/validate', async () => {
  const { z } = await import('zod')
  return { parseBody: vi.fn(), zUuid: z.string().uuid() }
})

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ── Imports after mocks ──────────────────────────────────────────────────────

import { POST as INFLATION_POST } from '@/app/api/admin/inflation/route'
import { GET as PICKUP_GET } from '@/app/api/admin/delhivery/pickup-request/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryMany, queryOne, withTransaction } from '@/lib/db'
import { parseBody } from '@/lib/validate'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryMany = vi.mocked(queryMany)
const mockQueryOne = vi.mocked(queryOne)
const mockWithTx = vi.mocked(withTransaction)
const mockParseBody = vi.mocked(parseBody)

const ADMIN = {
  adminId: 'a1',
  username: 'admin',
  role: 'super_admin',
  scopes: ['inflation', 'orders'],
  first_name: 'Test',
  last_name: 'Admin',
}

function makePost(body: unknown) {
  return new NextRequest('http://localhost/api/admin/inflation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeGet(params?: Record<string, string>) {
  const url = new URL('http://localhost/api/admin/delhivery/pickup-request')
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url.toString())
}

// ── Inflation POST: zero/invalid mrp_ex_gst else-branches ──────────────────────
// Line 174: product with no valid mrp_ex_gst → snapshot pushes before==after.
// Line 213: variant with no valid mrp_ex_gst → variant snapshot before==after.

describe('POST /api/admin/inflation — zero mrp_ex_gst snapshot branches', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  const validBody = { category_id: 'cat-1', category_name: 'Bolts', percentage: 5 }

  it('records product with no valid mrp_ex_gst without updating it (before == after)', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { percentage: 5, categoryId: 'cat-1' } } as any)
    // product with mrp_ex_gst = 0 → hits the else branch at line 174
    mockQueryMany.mockResolvedValue([
      {
        id: 'p-zero',
        name: 'No Price Product',
        has_variants: false,
        mrp_ex_gst: '0',
        mrp: '0',
        price_ex_gst: '0',
        base_price: '0',
        discount_pct: '0',
        gst_percentage: '18',
      },
    ] as any)

    const insertCalls: any[] = []
    const mockClient = {
      query: vi.fn().mockImplementation((sql: string, params?: any[]) => {
        if (sql.includes('product_variants pv') || sql.includes('product_sub_variants psv')) return { rows: [] }
        if (sql.includes('price_inflation_log')) insertCalls.push(params)
        return { rows: [] }
      }),
    }
    mockWithTx.mockImplementation(async (fn: any) => fn(mockClient))

    const res = await INFLATION_POST(makePost(validBody))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.product_count).toBe(1)
    // No UPDATE products call should have fired for the zero-price product
    const updateCalls = mockClient.query.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes('UPDATE products SET')
    )
    expect(updateCalls).toHaveLength(0)
    // snapshot in the log insert has before === after for the zero product
    const snapshotJson = JSON.parse(insertCalls[0][7])
    expect(snapshotJson[0].before).toEqual(snapshotJson[0].after)
  })

  it('records variant with no valid mrp_ex_gst without updating it (before == after)', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { percentage: 5, categoryId: 'cat-1' } } as any)
    // valid product so it updates, but its variant has zero mrp_ex_gst → line 213 else
    mockQueryMany.mockResolvedValue([
      {
        id: 'p1',
        name: 'Bolt',
        has_variants: true,
        mrp_ex_gst: '100',
        mrp: '118',
        price_ex_gst: '80',
        base_price: '94.40',
        discount_pct: '20',
        gst_percentage: '18',
      },
    ] as any)

    let insertParams: any[] | undefined
    const mockClient = {
      query: vi.fn().mockImplementation((sql: string, params?: any[]) => {
        if (sql.includes('product_variants pv')) {
          return {
            rows: [
              {
                id: 'v-zero',
                product_id: 'p1',
                variant_name: 'Broken',
                mrp_ex_gst: '0',
                mrp: '0',
                price_ex_gst: '0',
                price: '0',
                discount_pct: '20',
                gst_percentage: '18',
              },
            ],
          }
        }
        if (sql.includes('product_sub_variants psv')) return { rows: [] }
        if (sql.includes('price_inflation_log')) insertParams = params
        return { rows: [] }
      }),
    }
    mockWithTx.mockImplementation(async (fn: any) => fn(mockClient))

    const res = await INFLATION_POST(makePost(validBody))
    expect(res.status).toBe(200)
    // no UPDATE product_variants for the zero-price variant
    const variantUpdates = mockClient.query.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes('UPDATE product_variants SET')
    )
    expect(variantUpdates).toHaveLength(0)
    const snapshot = JSON.parse(insertParams![7])
    const variantSnap = snapshot[0].variants[0]
    expect(variantSnap.variant_name).toBe('Broken')
    expect(variantSnap.before).toEqual(variantSnap.after)
  })

  it('falls back to email in snapshot log when admin has no first/last name', async () => {
    mockAuth.mockResolvedValue({
      adminId: 'a2',
      email: 'noname@jeffistores.in',
      role: 'super_admin',
      scopes: ['inflation'],
    } as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { percentage: 5, categoryId: 'cat-1' } } as any)
    mockQueryMany.mockResolvedValue([
      {
        id: 'p1',
        name: 'Bolt',
        has_variants: false,
        mrp_ex_gst: '100',
        mrp: '118',
        price_ex_gst: '80',
        base_price: '94.40',
        discount_pct: '20',
        gst_percentage: '18',
      },
    ] as any)

    let appliedBy: string | undefined
    const mockClient = {
      query: vi.fn().mockImplementation((sql: string, params?: any[]) => {
        if (sql.includes('product_variants pv') || sql.includes('product_sub_variants psv')) return { rows: [] }
        if (sql.includes('price_inflation_log')) appliedBy = params?.[6]
        return { rows: [] }
      }),
    }
    mockWithTx.mockImplementation(async (fn: any) => fn(mockClient))

    const res = await INFLATION_POST(makePost({ category_id: 'cat-1', category_name: 'Bolts', percentage: 5 }))
    expect(res.status).toBe(200)
    expect(appliedBy).toBe('noname@jeffistores.in')
  })
})

// ── Pickup poll: resolveStatusCode scan-activity branches (lines 30-33) ────────
// These branches resolve ambiguous status via scan activity strings for
// out-for-delivery, RTO delivered, out-for-return, and return-in-transit.

describe('GET /api/admin/delhivery/pickup-request?poll — scan activity resolution', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DELHIVERY_API_KEY = 'test-key'
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
  })

  afterEach(() => {
    process.env = OLD_ENV
  })

  function pollWithActivity(activity: string, statusType = 'UD') {
    mockQueryOne.mockResolvedValueOnce({ id: 'ph-1', awbs: ['AWB1'], pickup_status: 'pending' } as any)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          ShipmentData: [
            {
              Shipment: {
                Status: { StatusType: statusType },
                Scans: [{ ScanDetail: { ScanType: null, Scan: activity } }],
              },
            },
          ],
        }),
    })
    mockQuery.mockResolvedValue({ rows: [] } as any)
  }

  it('resolves "out for delivery" activity to OD → picked up', async () => {
    pollWithActivity('Shipment out for delivery')
    const res = await PICKUP_GET(makeGet({ poll: 'ph-1' }))
    expect(res.status).toBe(200)
    expect((await res.json()).pickup_status).toBe('picked_up')
  })

  it('resolves "rto delivered" activity to RTO-DL → picked up', async () => {
    pollWithActivity('RTO Delivered to origin')
    const res = await PICKUP_GET(makeGet({ poll: 'ph-1' }))
    expect(res.status).toBe(200)
    expect((await res.json()).pickup_status).toBe('picked_up')
  })

  it('resolves "out for return" activity to RTO-OT → picked up', async () => {
    pollWithActivity('Out for return to shipper')
    const res = await PICKUP_GET(makeGet({ poll: 'ph-1' }))
    expect(res.status).toBe(200)
    expect((await res.json()).pickup_status).toBe('picked_up')
  })

  it('resolves "return in transit" activity to RTO-IT → picked up', async () => {
    pollWithActivity('Return in transit')
    const res = await PICKUP_GET(makeGet({ poll: 'ph-1' }))
    expect(res.status).toBe(200)
    expect((await res.json()).pickup_status).toBe('picked_up')
  })

  it('resolves "in transit" activity to IT → picked up', async () => {
    pollWithActivity('Currently in transit')
    const res = await PICKUP_GET(makeGet({ poll: 'ph-1' }))
    expect(res.status).toBe(200)
    expect((await res.json()).pickup_status).toBe('picked_up')
  })

  it('resolves "rto initiated" activity to RTO → picked up', async () => {
    pollWithActivity('RTO initiated for shipment')
    const res = await PICKUP_GET(makeGet({ poll: 'ph-1' }))
    expect(res.status).toBe(200)
    expect((await res.json()).pickup_status).toBe('picked_up')
  })

  it('resolves "delivered" activity to DL → picked up', async () => {
    pollWithActivity('Delivered to customer')
    const res = await PICKUP_GET(makeGet({ poll: 'ph-1' }))
    expect(res.status).toBe(200)
    expect((await res.json()).pickup_status).toBe('picked_up')
  })

  it('keeps pending when exception activity resolves to nothing pickup-worthy', async () => {
    pollWithActivity('Address unknown, contact customer')
    const res = await PICKUP_GET(makeGet({ poll: 'ph-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pickup_status).toBe('pending')
    expect(body.updated).toBe(false)
  })
})
