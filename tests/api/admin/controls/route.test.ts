import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn(), query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/gst', () => ({ round2: vi.fn().mockImplementation((n: number) => Math.round(n * 100) / 100) }))
vi.mock('@/lib/s3', () => ({
  uploadProductImage: vi.fn().mockResolvedValue({
    url: 'https://cdn/x.jpg',
    thumbnailUrl: 'https://cdn/x-t.jpg',
    s3Key: 'products/p1/x.jpg',
    s3ThumbnailKey: 'products/p1/thumbnails/x.jpg',
    fileName: 'x.jpg',
    fileSize: 1234,
    mimeType: 'image/jpeg',
    width: 800,
    height: 600,
  }),
  copyGalleryImageToProduct: vi.fn().mockResolvedValue({
    url: 'https://cdn/g.jpg',
    thumbnailUrl: 'https://cdn/g-t.jpg',
    s3Key: 'products/p1/g.jpg',
    s3ThumbnailKey: 'products/p1/thumbnails/g.jpg',
  }),
}))

import { GET, POST } from '@/app/api/admin/controls/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryOne, query, withTransaction } from '@/lib/db'

const ADMIN = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['controls:read', 'controls:write'] }

const PRODUCTS = [
  {
    id: 'p1',
    name: 'Bolt',
    mrp_ex_gst: '100',
    mrp: '118',
    price_ex_gst: '90',
    base_price: '106.2',
    discount_pct: '10',
    gst_percentage: '18',
    has_variants: false,
  },
]

function makeMockClient(responses: Record<number, any> = {}) {
  let idx = 0
  return { query: vi.fn().mockImplementation(async () => responses[idx++] ?? { rows: [] }) } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(queryMany).mockResolvedValue(PRODUCTS as any)
})

function makeGet(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/controls')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
}

function makePost(body: unknown) {
  return new NextRequest('http://localhost/api/admin/controls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ── GET ──────────────────────────────────────────────────────────────────────

describe('GET /api/admin/controls', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await GET(makeGet())
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await GET(makeGet())
    expect(res.status).toBe(403)
  })

  it('returns products on happy path', async () => {
    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.products).toHaveLength(1)
  })

  it('filters by is_active=false', async () => {
    const res = await GET(makeGet({ is_active: 'false' }))
    expect(res.status).toBe(200)
  })

  it('filters by category_id', async () => {
    const res = await GET(makeGet({ category_id: 'cat-1' }))
    expect(res.status).toBe(200)
  })

  it('filters by brand_id', async () => {
    const res = await GET(makeGet({ brand_id: 'brand-1' }))
    expect(res.status).toBe(200)
  })

  it('filters by grade', async () => {
    const res = await GET(makeGet({ grade: 'A' }))
    expect(res.status).toBe(200)
  })

  it('filters by condition', async () => {
    const res = await GET(makeGet({ condition: 'new' }))
    expect(res.status).toBe(200)
  })

  it('filters by target_gender', async () => {
    const res = await GET(makeGet({ target_gender: 'unisex' }))
    expect(res.status).toBe(200)
  })

  it('filters by shipping_class', async () => {
    const res = await GET(makeGet({ shipping_class: 'standard' }))
    expect(res.status).toBe(200)
  })

  it('filters by tax_class', async () => {
    const res = await GET(makeGet({ tax_class: 'gst_18' }))
    expect(res.status).toBe(200)
  })

  it('filters by hsn_code', async () => {
    const res = await GET(makeGet({ hsn_code: '7318' }))
    expect(res.status).toBe(200)
  })

  it('lists active and inactive products together, never unpublished drafts', async () => {
    await GET(makeGet({ is_active: 'any', brand_id: 'brand-1' }))
    const [sql] = vi.mocked(queryMany).mock.calls[0]
    expect(sql).toContain('p.is_draft = false')
    expect(sql).not.toContain('p.is_active = true')
    expect(sql).not.toContain('p.is_active = false')
  })

  it('filters by stock level and searches name or SKU', async () => {
    await GET(makeGet({ stock: 'low', search: 'hex bolt' }))
    const [sql, params] = vi.mocked(queryMany).mock.calls[0]
    expect(sql).toContain("p.stock_status = 'Low Stock'")
    expect(sql).toContain('p.is_active = true')
    expect((params as unknown[]).length).toBeGreaterThan(0)
  })

  it('filters by several picked values and by technical specs', async () => {
    const res = await GET(makeGet({ category_id: 'cat-1', grade: '8.8|10.9', 'spec.thread_type': 'BSW' }))
    expect(res.status).toBe(200)
    const [sql, params] = vi.mocked(queryMany).mock.calls[0]
    expect(sql).toContain('lower(s.val) IN (lower($2), lower($3))')
    expect(params).toEqual(['cat-1', '8.8', '10.9', 'grade', 'material grade', 'BSW', 'thread type'])
  })

  it('filters by is_featured=true', async () => {
    const res = await GET(makeGet({ is_featured: 'true' }))
    expect(res.status).toBe(200)
  })

  it('filters by is_featured=false', async () => {
    const res = await GET(makeGet({ is_featured: 'false' }))
    expect(res.status).toBe(200)
  })

  it('filters by is_searchable=true', async () => {
    const res = await GET(makeGet({ is_searchable: 'true' }))
    expect(res.status).toBe(200)
  })

  it('filters by is_searchable=false', async () => {
    const res = await GET(makeGet({ is_searchable: 'false' }))
    expect(res.status).toBe(200)
  })

  it('filters by product_ids', async () => {
    const res = await GET(makeGet({ product_ids: 'p1,p2' }))
    expect(res.status).toBe(200)
  })

  it('ignores empty product_ids', async () => {
    const res = await GET(makeGet({ product_ids: '' }))
    expect(res.status).toBe(200)
  })
})

// ── POST ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/controls', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(makePost({ operation: 'inflate_price', value: '10', product_ids: ['p1'] }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await POST(makePost({ operation: 'inflate_price', value: '10', product_ids: ['p1'] }))
    expect(res.status).toBe(403)
  })

  it('returns 400 when operation missing', async () => {
    const res = await POST(makePost({ product_ids: ['p1'] }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when product_ids missing', async () => {
    const res = await POST(makePost({ operation: 'inflate_price', value: '10' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when product_ids empty', async () => {
    const res = await POST(makePost({ operation: 'inflate_price', value: '10', product_ids: [] }))
    expect(res.status).toBe(400)
  })

  // inflate_price
  it('inflate_price: updates products and variants', async () => {
    const client = makeMockClient({
      0: {
        rows: [
          { id: 'p1', name: 'Bolt', mrp_ex_gst: '100', discount_pct: '10', gst_percentage: '18', has_variants: false },
        ],
      }, // snapshot
      1: { rows: [{ id: 'p1', mrp_ex_gst: '100', discount_pct: '10', gst_percentage: '18', has_variants: false }] }, // products
      2: { rows: [] }, // update product
      3: { rows: [{ id: 'v1', mrp_ex_gst: '90', discount_pct: '10', gst_percentage: '18' }] }, // variants
      4: { rows: [] }, // update variant
      5: { rows: [{ id: 'sv1', mrp_ex_gst: '80', discount_pct: '10', gst_percentage: '18' }] }, // sub_variants
      6: { rows: [] }, // update sub_variant
      7: { rows: [{ id: 'log-1' }] }, // log insert
    })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    const res = await POST(makePost({ operation: 'inflate_price', value: '10', product_ids: ['p1'] }))
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  it('inflate_price: throws when pct <= 0', async () => {
    const client = makeMockClient({
      0: { rows: [] }, // snapshot
    })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    const res = await POST(makePost({ operation: 'inflate_price', value: '0', product_ids: ['p1'] }))
    expect(res.status).toBe(500)
  })

  it('inflate_price: skips products with NaN or zero mrp_ex_gst', async () => {
    const client = makeMockClient({
      0: { rows: [{ id: 'p1', name: 'P', mrp_ex_gst: '0', discount_pct: '0', gst_percentage: '18' }] },
      1: { rows: [{ id: 'p1', mrp_ex_gst: '0', discount_pct: '0', gst_percentage: '18', has_variants: false }] },
      2: { rows: [] }, // variants
      3: { rows: [] }, // sub_variants
      4: { rows: [{ id: 'log-1' }] },
    })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    const res = await POST(makePost({ operation: 'inflate_price', value: '5', product_ids: ['p1'] }))
    expect(res.status).toBe(200)
    expect((await res.json()).updated).toBe(0)
  })

  // set_discount
  it('set_discount: updates products and variants', async () => {
    const client = makeMockClient({
      0: {
        rows: [{ id: 'p1', name: 'P', mrp_ex_gst: '100', discount_pct: '0', price_ex_gst: '100', base_price: '118' }],
      },
      1: { rows: [{ id: 'p1', mrp_ex_gst: '100', gst_percentage: '18' }] },
      2: { rows: [] },
      3: { rows: [{ id: 'v1', mrp_ex_gst: '90', gst_percentage: '18' }] },
      4: { rows: [] },
      5: { rows: [{ id: 'log-1' }] },
    })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    const res = await POST(makePost({ operation: 'set_discount', value: '15', product_ids: ['p1'] }))
    expect(res.status).toBe(200)
  })

  it('set_discount: throws when discount > 100', async () => {
    const client = makeMockClient({ 0: { rows: [] } })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    const res = await POST(makePost({ operation: 'set_discount', value: '150', product_ids: ['p1'] }))
    expect(res.status).toBe(500)
  })

  it('set_discount: throws when discount is negative', async () => {
    const client = makeMockClient({ 0: { rows: [] } })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    const res = await POST(makePost({ operation: 'set_discount', value: '-5', product_ids: ['p1'] }))
    expect(res.status).toBe(500)
  })

  it('set_discount: skips products with zero mrp_ex_gst', async () => {
    const client = makeMockClient({
      0: { rows: [{ id: 'p1', name: 'P', mrp_ex_gst: '0', discount_pct: '0', price_ex_gst: '0', base_price: '0' }] },
      1: { rows: [{ id: 'p1', mrp_ex_gst: '0', gst_percentage: '18' }] },
      2: { rows: [] }, // variants (empty)
      3: { rows: [{ id: 'log-1' }] },
    })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    const res = await POST(makePost({ operation: 'set_discount', value: '10', product_ids: ['p1'] }))
    expect(res.status).toBe(200)
    expect((await res.json()).updated).toBe(0)
  })

  // set_mrp_ex_gst
  it('set_mrp_ex_gst: updates all products', async () => {
    const client = makeMockClient({
      0: {
        rows: [
          {
            id: 'p1',
            name: 'P',
            mrp_ex_gst: '100',
            mrp: '118',
            price_ex_gst: '90',
            base_price: '106.2',
            discount_pct: '10',
          },
        ],
      },
      1: { rows: [{ id: 'p1', discount_pct: '10', gst_percentage: '18' }] },
      2: { rows: [] },
      3: { rows: [{ id: 'log-1' }] },
    })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    const res = await POST(makePost({ operation: 'set_mrp_ex_gst', value: '200', product_ids: ['p1'] }))
    expect(res.status).toBe(200)
  })

  it('set_mrp_ex_gst: throws when value <= 0', async () => {
    const client = makeMockClient({ 0: { rows: [] } })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    const res = await POST(makePost({ operation: 'set_mrp_ex_gst', value: '0', product_ids: ['p1'] }))
    expect(res.status).toBe(500)
  })

  // simple field operations
  const simpleOps = [
    { op: 'set_tax_class', value: 'gst_18' },
    { op: 'set_condition', value: 'new' },
    { op: 'set_shipping_class', value: 'standard' },
    { op: 'set_target_gender', value: 'unisex' },
    { op: 'set_hsn_code', value: '7318' },
    { op: 'set_country_of_origin', value: 'India' },
    { op: 'set_featured', value: 'true' },
    { op: 'set_searchable', value: 'false' },
    { op: 'set_active', value: 'true' },
    { op: 'set_grade', value: 'A' },
  ]

  for (const { op, value } of simpleOps) {
    it(`${op}: updates products`, async () => {
      const client = makeMockClient({
        0: { rows: [{ id: 'p1', name: 'P' }] }, // snapshot
        1: { rows: [] }, // update
        2: { rows: [{ id: 'log-1' }] }, // log
      })
      vi.mocked(withTransaction).mockImplementation(fn => fn(client))
      const res = await POST(makePost({ operation: op, value, product_ids: ['p1'] }))
      expect(res.status).toBe(200)
    })
  }

  it('set_handling_days: valid value', async () => {
    const client = makeMockClient({
      0: { rows: [{ id: 'p1', name: 'P' }] },
      1: { rows: [] },
      2: { rows: [{ id: 'log-1' }] },
    })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    const res = await POST(makePost({ operation: 'set_handling_days', value: '2', product_ids: ['p1'] }))
    expect(res.status).toBe(200)
  })

  it('set_handling_days: throws for negative value', async () => {
    const client = makeMockClient({ 0: { rows: [{ id: 'p1', name: 'P' }] } })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    const res = await POST(makePost({ operation: 'set_handling_days', value: '-1', product_ids: ['p1'] }))
    expect(res.status).toBe(500)
  })

  it('set_warranty_months: valid value', async () => {
    const client = makeMockClient({
      0: { rows: [{ id: 'p1', name: 'P' }] },
      1: { rows: [] },
      2: { rows: [{ id: 'log-1' }] },
    })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    const res = await POST(makePost({ operation: 'set_warranty_months', value: '12', product_ids: ['p1'] }))
    expect(res.status).toBe(200)
  })

  it('set_warranty_months: throws for negative', async () => {
    const client = makeMockClient({ 0: { rows: [{ id: 'p1', name: 'P' }] } })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    const res = await POST(makePost({ operation: 'set_warranty_months', value: '-1', product_ids: ['p1'] }))
    expect(res.status).toBe(500)
  })

  // set_selling_unit
  it('set_selling_unit: creates base unit row and inherits to variants', async () => {
    const client = makeMockClient({
      0: {
        rows: [
          {
            id: 'p1',
            name: 'P',
            unit: null,
            factor: null,
            dimension: null,
            display_label: null,
            min_qty: null,
            max_qty: null,
            qty_step: null,
          },
        ],
      },
      1: { rows: [] }, // upsert product unit
      2: { rows: [{ id: 'v1', product_id: 'p1' }] }, // variants
      3: { rows: [] }, // demote existing base
      4: { rows: [] }, // upsert variant unit
      5: { rows: [] }, // update variant.unit varchar
      6: { rows: [{ id: 'log-1' }] },
    })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    const res = await POST(
      makePost({
        operation: 'set_selling_unit',
        value: {
          unit: 'pcs',
          factor: 1,
          dimension: 'count',
          display_label: 'Piece',
          min_qty: 1,
          max_qty: 100,
          qty_step: 1,
        },
        product_ids: ['p1'],
        inherit_to_variants: true,
      })
    )
    expect(res.status).toBe(200)
  })

  it('set_selling_unit: skips variant inheritance when inherit_to_variants=false', async () => {
    const client = makeMockClient({
      0: {
        rows: [
          {
            id: 'p1',
            name: 'P',
            unit: null,
            factor: null,
            dimension: null,
            display_label: null,
            min_qty: null,
            max_qty: null,
            qty_step: null,
          },
        ],
      },
      1: { rows: [] },
      2: { rows: [{ id: 'log-1' }] },
    })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    const res = await POST(
      makePost({
        operation: 'set_selling_unit',
        value: { unit: 'pcs', factor: 1 },
        product_ids: ['p1'],
        inherit_to_variants: false,
      })
    )
    expect(res.status).toBe(200)
  })

  it('set_selling_unit: throws when value is not object', async () => {
    const client = makeMockClient({ 0: { rows: [{ id: 'p1', name: 'P' }] } })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    const res = await POST(makePost({ operation: 'set_selling_unit', value: 'invalid', product_ids: ['p1'] }))
    expect(res.status).toBe(500)
  })

  it('set_selling_unit: throws when unit name missing', async () => {
    const client = makeMockClient({ 0: { rows: [{ id: 'p1', name: 'P' }] } })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    const res = await POST(makePost({ operation: 'set_selling_unit', value: { factor: 1 }, product_ids: ['p1'] }))
    expect(res.status).toBe(500)
  })

  it('set_selling_unit: throws when factor <= 0', async () => {
    const client = makeMockClient({ 0: { rows: [{ id: 'p1', name: 'P' }] } })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    const res = await POST(
      makePost({ operation: 'set_selling_unit', value: { unit: 'pcs', factor: 0 }, product_ids: ['p1'] })
    )
    expect(res.status).toBe(500)
  })

  it('set_selling_unit: handles null max_qty', async () => {
    const client = makeMockClient({
      0: {
        rows: [
          {
            id: 'p1',
            name: 'P',
            unit: null,
            factor: null,
            dimension: null,
            display_label: null,
            min_qty: null,
            max_qty: null,
            qty_step: null,
          },
        ],
      },
      1: { rows: [] },
      2: { rows: [] }, // variants empty (no inherit needed)
      3: { rows: [] }, // update variant.unit varchar
      4: { rows: [{ id: 'log-1' }] },
    })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    const res = await POST(
      makePost({
        operation: 'set_selling_unit',
        value: { unit: 'box', factor: 12, max_qty: null },
        product_ids: ['p1'],
      })
    )
    expect(res.status).toBe(200)
  })

  it('returns 500 for unknown operation', async () => {
    const client = makeMockClient({ 0: { rows: [] } })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    const res = await POST(makePost({ operation: 'unknown_op', value: '1', product_ids: ['p1'] }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('Unknown operation')
  })

  // ── set_images (multipart, slot-based) ──────────────────────────────────────
  function makeImagePost(fields: Record<string, string>, withFile = true) {
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) fd.append(k, v)
    if (withFile) fd.append('image_0', new File([new Uint8Array([1, 2, 3])], 'x.jpg', { type: 'image/jpeg' }))
    return new NextRequest('http://localhost/api/admin/controls', { method: 'POST', body: fd })
  }

  it('set_images enqueues a job and returns job_id; background worker replaces the slot', async () => {
    // Two products selected; only p1 has an image in slot 1 (display_order 0).
    vi.mocked(queryMany).mockResolvedValueOnce([
      {
        id: 'img1',
        product_id: 'p1',
        image_url: 'u',
        thumbnail_url: 't',
        s3_bucket: 'b',
        s3_key: 'k',
        s3_thumbnail_key: 'tk',
        file_name: 'old.jpg',
        file_size: 10,
        mime_type: 'image/jpeg',
        width: 100,
        height: 100,
        alt_text: null,
        display_order: 0,
        is_primary: true,
      },
    ] as any)
    // queryOne is called first to INSERT the job row (returns id), then for the log row.
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: 'job1' } as any)
      .mockResolvedValueOnce({ id: 'log1' } as any)
    vi.mocked(query).mockResolvedValue({ rows: [] } as any)
    const client = makeMockClient({})
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))

    const res = await POST(
      makeImagePost({ operation: 'set_images', product_ids: JSON.stringify(['p1', 'p2']), slot: '1' })
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.job_id).toBe('job1')
    expect(json.total).toBe(1) // only p1 has slot 1
    expect(json.skipped).toBe(1) // p2 skipped

    // Let the detached worker finish: it replaces the slot in a transaction and
    // ticks progress via query(). Flush pending microtasks.
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))
    expect(withTransaction).toHaveBeenCalled()
    // A completion UPDATE to bulk_image_jobs should have been issued.
    expect(vi.mocked(query).mock.calls.some(c => String(c[0]).includes('bulk_image_jobs'))).toBe(true)
  })

  it('set_images 400 when no product has the target slot', async () => {
    vi.mocked(queryMany).mockResolvedValueOnce([] as any)
    const res = await POST(makeImagePost({ operation: 'set_images', product_ids: JSON.stringify(['p1']), slot: '3' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('slot 3')
  })

  it('set_images 400 when no image file provided', async () => {
    const res = await POST(
      makeImagePost({ operation: 'set_images', product_ids: JSON.stringify(['p1']), slot: '1' }, false)
    )
    expect(res.status).toBe(400)
  })

  it('set_images 400 for an unsupported multipart operation', async () => {
    const res = await POST(makeImagePost({ operation: 'set_price', product_ids: JSON.stringify(['p1']), slot: '1' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Unsupported multipart operation')
  })

  it('set_images 400 when product_ids is empty (multipart)', async () => {
    const res = await POST(makeImagePost({ operation: 'set_images', product_ids: JSON.stringify([]), slot: '1' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('product_ids required')
  })

  it('set_images 400 for an invalid slot', async () => {
    const res = await POST(makeImagePost({ operation: 'set_images', product_ids: JSON.stringify(['p1']), slot: '0' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Invalid image slot')
  })

  it('set_images 404 when the referenced gallery image is not found', async () => {
    vi.mocked(queryMany).mockResolvedValueOnce([] as any) // gallery lookup returns nothing
    const res = await POST(
      makeImagePost(
        { operation: 'set_images', product_ids: JSON.stringify(['p1']), slot: '1', gallery_image_id: 'g-missing' },
        false // no file → gallery path
      )
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error).toContain('Gallery image not found')
  })

  it('set_images from a GALLERY image enqueues a job and the worker copies via copyGalleryImageToProduct', async () => {
    vi.mocked(queryMany)
      .mockResolvedValueOnce([
        {
          s3_key: 'gallery/g.png',
          s3_thumbnail_key: 'gallery/thumbnails/g.png',
          image_url: 'u',
          thumbnail_url: 't',
          file_name: 'g.png',
          file_size: 5,
          mime_type: 'image/png',
          width: 10,
          height: 10,
        },
      ] as any) // gallery row
      .mockResolvedValueOnce([
        {
          id: 'img1',
          product_id: 'p1',
          image_url: 'u',
          thumbnail_url: 't',
          s3_bucket: 'b',
          s3_key: 'k',
          s3_thumbnail_key: 'tk',
          file_name: 'old.png',
          file_size: 1,
          mime_type: 'image/png',
          width: 1,
          height: 1,
          alt_text: null,
          display_order: 0,
          is_primary: true,
        },
      ] as any) // slot read
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: 'jobG' } as any)
      .mockResolvedValueOnce({ id: 'logG' } as any)
    vi.mocked(query).mockResolvedValue({ rows: [] } as any)
    const client = makeMockClient({})
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))

    const res = await POST(
      makeImagePost(
        { operation: 'set_images', product_ids: JSON.stringify(['p1']), slot: '1', gallery_image_id: 'g1' },
        false
      )
    )
    expect(res.status).toBe(200)
    expect((await res.json()).job_id).toBe('jobG')
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))
    const { copyGalleryImageToProduct } = await import('@/lib/s3')
    expect(copyGalleryImageToProduct).toHaveBeenCalled()
  })

  it('set_images worker marks the job FAILED when the per-product replace throws', async () => {
    vi.mocked(queryMany).mockResolvedValueOnce([
      {
        id: 'img1',
        product_id: 'p1',
        image_url: 'u',
        thumbnail_url: 't',
        s3_bucket: 'b',
        s3_key: 'k',
        s3_thumbnail_key: 'tk',
        file_name: 'old.jpg',
        file_size: 10,
        mime_type: 'image/jpeg',
        width: 100,
        height: 100,
        alt_text: null,
        display_order: 0,
        is_primary: true,
      },
    ] as any)
    vi.mocked(queryOne).mockResolvedValueOnce({ id: 'jobF' } as any)
    vi.mocked(query).mockResolvedValue({ rows: [] } as any)
    // The replace transaction throws → worker catch sets status='failed'.
    vi.mocked(withTransaction).mockRejectedValue(new Error('db down'))

    const res = await POST(makeImagePost({ operation: 'set_images', product_ids: JSON.stringify(['p1']), slot: '1' }))
    expect(res.status).toBe(200) // enqueue still succeeds
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))
    // A bulk_image_jobs UPDATE marking failure should have been issued.
    const calls = vi.mocked(query).mock.calls.map(c => String(c[0]))
    expect(calls.some(sql => sql.includes('bulk_image_jobs') && sql.includes("'failed'"))).toBe(true)
  })
})
