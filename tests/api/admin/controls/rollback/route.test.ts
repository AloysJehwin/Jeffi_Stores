import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ query: vi.fn(), queryMany: vi.fn(), withTransaction: vi.fn() }))

import { GET, POST } from '@/app/api/admin/controls/rollback/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryMany, withTransaction } from '@/lib/db'

const ADMIN = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['controls:read', 'controls:write'] }

const GOOD_LOG = {
  id: 'log-1',
  operation: 'inflate_price',
  snapshot: [{ id: 'p1', name: 'Bolt', before: { mrp: 100, mrp_ex_gst: 90, price_ex_gst: 80, base_price: 75, discount_pct: 5 } }],
  rolled_back_at: null,
  is_rollback: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(queryMany).mockResolvedValue([] as any)
  vi.mocked(query).mockResolvedValue({ rows: [GOOD_LOG] } as any)
  vi.mocked(withTransaction).mockImplementation(async (fn: any) =>
    fn({ query: vi.fn().mockResolvedValue({ rows: [] }) })
  )
})

function makePost(body: unknown) {
  return new NextRequest('http://localhost/api/admin/controls/rollback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('GET /api/admin/controls/rollback', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await GET(new NextRequest('http://localhost'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await GET(new NextRequest('http://localhost'))
    expect(res.status).toBe(403)
  })

  it('returns logs on happy path', async () => {
    vi.mocked(queryMany).mockResolvedValue([GOOD_LOG] as any)
    const res = await GET(new NextRequest('http://localhost'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.logs).toHaveLength(1)
  })
})

describe('POST /api/admin/controls/rollback', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(makePost({ log_id: 'log-1' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await POST(makePost({ log_id: 'log-1' }))
    expect(res.status).toBe(403)
  })

  it('returns 400 when log_id missing', async () => {
    const res = await POST(makePost({}))
    expect(res.status).toBe(400)
  })

  it('returns 404 when log entry not found', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [] } as any)
    const res = await POST(makePost({ log_id: 'missing' }))
    expect(res.status).toBe(404)
  })

  it('returns 409 when already rolled back', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ ...GOOD_LOG, rolled_back_at: '2024-01-01' }] } as any)
    const res = await POST(makePost({ log_id: 'log-1' }))
    expect(res.status).toBe(409)
  })

  it('returns 409 when entry is itself a rollback', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ ...GOOD_LOG, is_rollback: true }] } as any)
    const res = await POST(makePost({ log_id: 'log-1' }))
    expect(res.status).toBe(409)
  })

  it('returns 409 when snapshot is empty', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ ...GOOD_LOG, snapshot: [] }] } as any)
    const res = await POST(makePost({ log_id: 'log-1' }))
    expect(res.status).toBe(409)
  })

  it('rolls back inflate_price operation', async () => {
    const res = await POST(makePost({ log_id: 'log-1' }))
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  it('rolls back set_discount operation', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ ...GOOD_LOG, operation: 'set_discount' }] } as any)
    const res = await POST(makePost({ log_id: 'log-1' }))
    expect(res.status).toBe(200)
  })

  it('rolls back set_mrp_ex_gst operation', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ ...GOOD_LOG, operation: 'set_mrp_ex_gst' }] } as any)
    const res = await POST(makePost({ log_id: 'log-1' }))
    expect(res.status).toBe(200)
  })

  it('rolls back set_tax_class (simple field) operation', async () => {
    vi.mocked(query).mockResolvedValue({
      rows: [{ ...GOOD_LOG, operation: 'set_tax_class', snapshot: [{ id: 'p1', before: { tax_class: 'gst_18' } }] }]
    } as any)
    const res = await POST(makePost({ log_id: 'log-1' }))
    expect(res.status).toBe(200)
  })

  it('rolls back set_active operation', async () => {
    vi.mocked(query).mockResolvedValue({
      rows: [{ ...GOOD_LOG, operation: 'set_active', snapshot: [{ id: 'p1', before: { is_active: true } }] }]
    } as any)
    const res = await POST(makePost({ log_id: 'log-1' }))
    expect(res.status).toBe(200)
  })

  it('rolls back set_selling_unit with non-null unit', async () => {
    vi.mocked(query).mockResolvedValue({
      rows: [{ ...GOOD_LOG, operation: 'set_selling_unit', snapshot: [{ id: 'p1', before: { unit: 'pcs', factor: 1, dimension: 'count', display_label: 'Piece', min_qty: 1, max_qty: 100, qty_step: 1 } }] }]
    } as any)
    const res = await POST(makePost({ log_id: 'log-1' }))
    expect(res.status).toBe(200)
  })

  it('rolls back set_selling_unit with null unit (delete)', async () => {
    vi.mocked(query).mockResolvedValue({
      rows: [{ ...GOOD_LOG, operation: 'set_selling_unit', snapshot: [{ id: 'p1', before: { unit: null } }] }]
    } as any)
    const res = await POST(makePost({ log_id: 'log-1' }))
    expect(res.status).toBe(200)
  })

  it('rolls back an object-shape snapshot with variantUnits (both null-before delete and non-null re-insert)', async () => {
    vi.mocked(query).mockResolvedValue({
      rows: [{ ...GOOD_LOG, operation: 'set_selling_unit', snapshot: {
        products: [], variants: [], subs: [],
        variantUnits: [
          { variant_id: 'v1', product_id: 'p1', before: { unit: 'box', factor: 12, dimension: 'count', display_label: 'Box', min_qty: 1, max_qty: null, qty_step: 1, variant_unit: 'box' } },
          { variant_id: 'v2', product_id: 'p1', before: null }, // no base unit before → delete branch
        ],
      } }]
    } as any)
    const res = await POST(makePost({ log_id: 'log-1' }))
    expect(res.status).toBe(200)
    expect((await res.json()).restored).toBe(2)
  })

  it('skips a product snapshot row whose before has no fields', async () => {
    vi.mocked(query).mockResolvedValue({
      rows: [{ ...GOOD_LOG, operation: 'inflate_price', snapshot: [{ id: 'p1', before: {} }] }]
    } as any)
    const res = await POST(makePost({ log_id: 'log-1' }))
    expect(res.status).toBe(200)
    expect((await res.json()).restored).toBe(0)
  })

  it('rolls back set_images (restores the snapshotted slot row)', async () => {
    vi.mocked(query).mockResolvedValue({
      rows: [{ ...GOOD_LOG, operation: 'set_images', snapshot: {
        products: [], variants: [], subs: [], variantUnits: [],
        productImages: [{ product_id: 'p1', rows: [{ id: 'img1', product_id: 'p1', image_url: 'u', thumbnail_url: 't', s3_bucket: 'b', s3_key: 'k', s3_thumbnail_key: 'tk', file_name: 'old.jpg', file_size: 10, mime_type: 'image/jpeg', width: 100, height: 100, alt_text: null, display_order: 0, is_primary: true }] }],
      } }]
    } as any)
    const res = await POST(makePost({ log_id: 'log-1' }))
    expect(res.status).toBe(200)
    expect((await res.json()).restored).toBe(1)
  })

  it('returns 500 for unsupported operation', async () => {
    vi.mocked(query).mockResolvedValue({
      rows: [{ ...GOOD_LOG, operation: 'unknown_op' }]
    } as any)
    const res = await POST(makePost({ log_id: 'log-1' }))
    expect(res.status).toBe(500)
  })
})
