import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn() }))

import { GET } from '@/app/api/(admin)/admin/inventory/batches/available/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany, queryOne } from '@/lib/shared/db'

const ADMIN = { adminId: 'a1', role: 'super_admin', scopes: ['orders:read'] }
const BATCHES = [{ id: 'b1', lot_number: 'L1', quantity_remaining: '10', location: 'A1' }]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(queryMany).mockResolvedValue(BATCHES as any)
  vi.mocked(queryOne).mockResolvedValue(null as any)
})

function makeReq(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/inventory/batches/available')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
}

describe('GET /api/admin/inventory/batches/available', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await GET(makeReq({ order_id: 'ord-1' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await GET(makeReq({ order_id: 'ord-1' }))
    expect(res.status).toBe(403)
  })

  it('returns 400 when no order_id, quotation_id, or product_id', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(400)
  })

  // product_id path
  it('returns empty when product is not perishable/serialized', async () => {
    vi.mocked(queryOne).mockResolvedValue({ name: 'Bolt', perishable: false, serialized: false } as any)
    const res = await GET(makeReq({ product_id: 'p1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toEqual([])
    expect(body.serialized_items).toEqual([])
  })

  it('returns serialized_items for serialized product', async () => {
    vi.mocked(queryOne).mockResolvedValue({ name: 'Serial', perishable: false, serialized: true } as any)
    const res = await GET(makeReq({ product_id: 'p1', qty: '2' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.serialized_items).toHaveLength(1)
    expect(body.serialized_items[0].required_qty).toBe(2)
  })

  it('returns batches for perishable product', async () => {
    vi.mocked(queryOne).mockResolvedValue({ name: 'Perishable', perishable: true, serialized: false } as any)
    const res = await GET(makeReq({ product_id: 'p1', variant_id: 'v1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].batches).toEqual(BATCHES)
  })

  it('handles product_id with variant_id and sub_variant_id', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ name: 'P', perishable: true, serialized: false } as any)
      .mockResolvedValueOnce({ variant_name: 'Red' } as any)
    const res = await GET(makeReq({ product_id: 'p1', variant_id: 'v1', sub_variant_id: 'sv1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items[0].variant_name).toBe('Red')
  })

  // order_id path
  it('returns empty when no perishable/serialized order items', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)
    const res = await GET(makeReq({ order_id: 'ord-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toEqual([])
    expect(body.serialized_items).toEqual([])
  })

  it('returns batches for perishable order items', async () => {
    vi.mocked(queryMany)
      .mockResolvedValueOnce([
        {
          order_item_id: 'oi-1',
          product_id: 'p1',
          variant_id: null,
          sub_variant_id: null,
          product_name: 'Bolt',
          variant_name: null,
          quantity: '5',
          buy_unit: null,
          batch_id: null,
          sold_unit_factor: null,
          base_quantity: '5',
          perishable: true,
          serialized: false,
        },
      ] as any)
      .mockResolvedValueOnce(BATCHES as any)
    const res = await GET(makeReq({ order_id: 'ord-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].already_assigned).toBe(false)
  })

  it('returns serialized_items for serialized order items', async () => {
    vi.mocked(queryMany).mockResolvedValueOnce([
      {
        order_item_id: 'oi-2',
        product_id: 'p2',
        variant_id: 'v1',
        sub_variant_id: null,
        product_name: 'Serial',
        variant_name: 'V1',
        quantity: '1',
        buy_unit: null,
        batch_id: 'b-assigned',
        sold_unit_factor: null,
        base_quantity: '1',
        perishable: false,
        serialized: true,
      },
    ] as any)
    const res = await GET(makeReq({ order_id: 'ord-1' }))
    const body = await res.json()
    expect(body.serialized_items).toHaveLength(1)
    expect(body.serialized_items[0].already_assigned).toBe(true)
  })

  it('applies sold_unit_factor when > 1', async () => {
    vi.mocked(queryMany)
      .mockResolvedValueOnce([
        {
          order_item_id: 'oi-3',
          product_id: 'p3',
          variant_id: null,
          sub_variant_id: null,
          product_name: 'P',
          variant_name: null,
          quantity: '2',
          buy_unit: 'box',
          batch_id: null,
          sold_unit_factor: '12',
          base_quantity: '2',
          perishable: true,
          serialized: false,
        },
      ] as any)
      .mockResolvedValueOnce([] as any)
    const res = await GET(makeReq({ order_id: 'ord-1' }))
    const body = await res.json()
    expect(body.items[0].required_qty).toBe(24)
  })

  // quotation_id path
  it('returns empty when no matching quotation items', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)
    const res = await GET(makeReq({ quotation_id: 'q-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toEqual([])
    expect(body.serialized_items).toEqual([])
  })

  it('returns batches for perishable quotation items', async () => {
    vi.mocked(queryMany)
      .mockResolvedValueOnce([
        {
          order_item_id: 'qi-1',
          product_id: 'p1',
          variant_id: null,
          sub_variant_id: null,
          product_name: 'Bolt',
          variant_name: null,
          quantity: '3',
          sold_unit_factor: null,
          base_quantity: '3',
          perishable: true,
          serialized: false,
        },
      ] as any)
      .mockResolvedValueOnce(BATCHES as any)
    const res = await GET(makeReq({ quotation_id: 'q-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
  })

  it('returns serialized_items for serialized quotation items', async () => {
    vi.mocked(queryMany).mockResolvedValueOnce([
      {
        order_item_id: 'qi-2',
        product_id: 'p2',
        variant_id: 'v1',
        sub_variant_id: null,
        product_name: 'Serial',
        variant_name: null,
        quantity: '1',
        sold_unit_factor: null,
        base_quantity: '1',
        perishable: false,
        serialized: true,
      },
    ] as any)
    const res = await GET(makeReq({ quotation_id: 'q-1' }))
    const body = await res.json()
    expect(body.serialized_items).toHaveLength(1)
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(queryMany).mockRejectedValue(new Error('db fail'))
    const res = await GET(makeReq({ order_id: 'ord-1' }))
    expect(res.status).toBe(500)
  })
})
